import Foundation

/// What the worker's GET /api/sync returns (sync.ts `pullSyncUnlocked`).
struct PullBody: Decodable {
    var sessions: [Session]
    var setLogs: [SetLog]
    var deletedSessionGuids: [String]?
    var program: [WorkoutDay]?
    var programUpdatedAt: Double?
    var exercises: [LibraryExercise]?
    var deletedExerciseIds: [String]?
    var plan: PlanState?
    var role: String?

    enum CodingKeys: String, CodingKey {
        case sessions, setLogs, deletedSessionGuids, program, programUpdatedAt, exercises, deletedExerciseIds, plan, role
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessions = try c.decodeIfPresent([Session].self, forKey: .sessions) ?? []
        setLogs = try c.decodeIfPresent([SetLog].self, forKey: .setLogs) ?? []
        deletedSessionGuids = try c.decodeIfPresent([String].self, forKey: .deletedSessionGuids)
        program = try c.decodeIfPresent([WorkoutDay].self, forKey: .program)
        programUpdatedAt = try c.decodeIfPresent(Double.self, forKey: .programUpdatedAt)
        exercises = try c.decodeIfPresent([LibraryExercise].self, forKey: .exercises)
        deletedExerciseIds = try c.decodeIfPresent([String].self, forKey: .deletedExerciseIds)
        // A plan document this build can't read is left alone (planMerge `isPlanDoc`), never half-applied.
        plan = try? c.decodeIfPresent(PlanState.self, forKey: .plan)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
    }
}

/// What POST /api/sync accepts (sync.ts `pushSyncUnlocked`).
struct PushBody: Encodable {
    struct WireSession: Encodable {
        var id: Int, guid: String, dayId: Int, weekNumber: Int, startedAt: Double
        var completedAt: Double?, updatedAt: Double, note: String?
    }
    var sessions: [WireSession]
    var setLogs: [SetLog]
    var exerciseLogs: [Int] = []
    var deletedSessionGuids: [String]
    var program: [WorkoutDay]
    var programUpdatedAt: Double
    var exercises: [LibraryExercise]
    var deletedExerciseIds: [String]
    var restoredExerciseIds: [String]
    var plan: PlanState?
}

/// Sync v2 for the native app. Merge rules are the PWA's, byte for byte:
/// per-session `updatedAt` with tombstones, LWW plan document (plans and
/// profile independently), clocked program and library, conditional (ETag) pull.
///
/// No-data-loss guarantees on top:
/// - A device never pushes before its first complete pull (`hasCompletedInitialPull`):
///   a new iPhone downloads the account's full history first.
/// - A pull only adds, replaces with a strictly newer copy, or applies a
///   tombstone; local-only sessions survive and upload on the next push.
/// - The merge plan commits in one SQLite transaction.
///
/// `LiftLogEnv.store` must be this `store` (the engines read the program,
/// library and plan document through it).
public final class SyncClient: @unchecked Sendable {
    public enum PullResult: Equatable, Sendable { case unchanged, merged(changed: Bool), unauthorized }
    public enum PushResult: Equatable, Sendable { case pushed, unauthorized }

    public static let initialPullKey = "liftlog_ios_initial_pull_done"

    let baseURL: URL
    let store: LiftLogStore
    let tokens: TokenStore
    let transport: HTTPTransport

    public init(baseURL: URL, store: LiftLogStore, tokens: TokenStore, transport: HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL; self.store = store; self.tokens = tokens; self.transport = transport
    }

    public var hasCompletedInitialPull: Bool { store.getItem(Self.initialPullKey) == "1" }

    var status: SyncStatus {
        get { store.getJSON(SyncStatus.self, StorageKey.syncStatus) ?? SyncStatus(hasUnpushed: false, authExpired: false) }
        set { store.setJSON(newValue, StorageKey.syncStatus) }
    }

    /// Call after any local write (a logged set, an edited plan, …).
    public func markLocalChange() { var s = status; s.hasUnpushed = true; status = s }

    public func tombstones() -> [String] { store.getJSON([String].self, StorageKey.deletedSessions) ?? [] }

    public func addTombstones(_ guids: [String]) {
        guard !guids.isEmpty else { return }
        var list = tombstones()
        var seen = Set(list)
        for g in guids where seen.insert(g).inserted { list.append(g) }
        store.setJSON(list, StorageKey.deletedSessions)
    }

    /// Deletes a session locally and records its tombstone so the deletion syncs.
    public func deleteSession(_ session: Session) throws {
        addTombstones([SyncMerge.sessionGuid(session)])
        if let id = session.id { try store.deleteSession(id: id) }
        markLocalChange()
    }

    /// Pull, then push. The push never runs if the pull did not complete.
    public func sync() async throws -> (pull: PullResult, push: PushResult?) {
        let pulled = try await pull()
        if pulled == .unauthorized { return (pulled, nil) }
        return (pulled, try await push())
    }

    public func pull() async throws -> PullResult {
        var r = try jsonRequest(baseURL.appendingPathComponent("/api/sync"), method: "GET", token: tokens.token())
        if hasCompletedInitialPull, let etag = store.getItem(StorageKey.syncEtag) { r.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, res) = try await transport.send(r)
        if res.statusCode == 401 { markAuthExpired(); return .unauthorized }
        if res.statusCode == 304 { markPulled(); return .unchanged }
        guard (200..<300).contains(res.statusCode) else { throw LiftLogAPIError.http(res.statusCode, String(decoding: data, as: UTF8.self)) }
        guard (res.value(forHTTPHeaderField: "Content-Type") ?? "").contains("application/json") else { throw LiftLogAPIError.nonJSON }
        let body = try JSONDecoder().decode(PullBody.self, from: data)
        let (changed, hold) = try apply(body)
        if let tag = res.value(forHTTPHeaderField: "ETag"), !hold { store.setItem(StorageKey.syncEtag, tag) }
        else { store.removeItem(StorageKey.syncEtag) }
        store.setItem(Self.initialPullKey, "1")
        markPulled()
        return .merged(changed: changed)
    }

    public func push() async throws -> PushResult {
        if !hasCompletedInitialPull {
            if try await pull() == .unauthorized { return .unauthorized }
        }
        let sessions = try store.allSessions()
        let plan = PlanStore.getPlanState()
        let deleted = ProgramStore.getDeletedExerciseIds()
        let body = PushBody(
            sessions: sessions.map {
                .init(id: $0.id ?? 0, guid: SyncMerge.sessionGuid($0), dayId: $0.dayId, weekNumber: $0.weekNumber, startedAt: $0.startedAt,
                      completedAt: $0.completedAt, updatedAt: SyncMerge.sessionUpdatedAt($0), note: ($0.note?.isEmpty ?? true) ? nil : $0.note)
            },
            setLogs: try store.allSetLogs(),
            deletedSessionGuids: tombstones(),
            program: ProgramStore.getStoredProgram(),
            programUpdatedAt: ProgramStore.getProgramUpdatedAt(),
            exercises: ProgramStore.getExerciseLibrary(),
            deletedExerciseIds: deleted.sorted(),
            restoredExerciseIds: ProgramStore.getRestoredExerciseIds().sorted(),
            plan: PlanStore.planStateHasContent(plan) ? plan : nil)
        let r = try jsonRequest(baseURL.appendingPathComponent("/api/sync"), method: "POST", token: tokens.token(), body: body)
        let (data, res) = try await transport.send(r)
        if res.statusCode == 401 { markAuthExpired(); return .unauthorized }
        guard (200..<300).contains(res.statusCode) else { throw LiftLogAPIError.http(res.statusCode, String(decoding: data, as: UTF8.self)) }
        var s = status
        s.hasUnpushed = false; s.authExpired = false; s.lastSuccessAt = LiftLogEnv.now(); s.lastError = nil
        status = s
        return .pushed
    }

    /// The pull's merge, in sync.ts order. Returns (changed, heldUnstampedProgram).
    func apply(_ data: PullBody) throws -> (Bool, Bool) {
        if let role = data.role { store.setItem(StorageKey.role, role) }

        // Exercise tombstones are permanent — except one this device knowingly lifted and hasn't pushed yet.
        let serverDeleted = Set(data.deletedExerciseIds ?? [])
        let restored = ProgramStore.getRestoredExerciseIds()
        ProgramStore.addDeletedExerciseIds((data.deletedExerciseIds ?? []).filter { !restored.contains($0) })
        ProgramStore.clearRestoredExerciseIds(restored.filter { !serverDeleted.contains($0) }.sorted())
        let deleted = ProgramStore.getDeletedExerciseIds()
        if !deleted.isEmpty {
            var meta = store.getJSON([String: ExerciseMetaOverride].self, StorageKey.exerciseMeta) ?? [:]
            for id in deleted { meta.removeValue(forKey: id) }
            store.setJSON(meta, StorageKey.exerciseMeta)
            ProgramStore.saveExerciseLibrary(ProgramStore.getExerciseLibrary())
        }
        if let exercises = data.exercises { _ = ProgramStore.mergeExerciseLibrary(exercises) }

        // Sessions: merged per document, applied atomically.
        addTombstones(data.deletedSessionGuids ?? [])
        let docs = SyncMerge.groupWireSessions(data.sessions, data.setLogs)
        let plan = SyncMerge.planSessionMerge(local: try store.allSessions(), incoming: docs, tombstones: Set(tombstones()))
        var changed = false
        if !plan.isEmpty { try store.applySessionMergePlan(plan); changed = true }

        // Journey document: newer plans and newer profile win independently.
        if let server = data.plan {
            let current = store.getJSON(PlanState.self, StorageKey.plan)
            let merged = SyncMerge.mergePlanDocs(current: current, incoming: server)
            if merged.changed { store.setJSON(merged.doc, StorageKey.plan); changed = true }
        }

        // Program: clocked adoption (an unstamped local program with unpushed edits waits).
        let serverClock = data.programUpdatedAt ?? 0
        let localClock = ProgramStore.getProgramUpdatedAt()
        let (adopt, hold) = SyncMerge.shouldAdoptProgram(serverProgram: data.program, serverClock: serverClock,
                                                         localClock: localClock, hasUnpushed: status.hasUnpushed)
        if let program = data.program, adopt {
            let incoming = program.map { d -> WorkoutDay in var d = d; d.exercises = d.exercises.filter { !deleted.contains($0.id) }; return d }
            if incoming != ProgramStore.getStoredProgram() || serverClock != localClock {
                ProgramStore.saveStoredProgram(incoming, now: serverClock); changed = true
            }
        } else if !deleted.isEmpty {
            let current = ProgramStore.getStoredProgram()
            let scrubbed = current.map { d -> WorkoutDay in var d = d; d.exercises = d.exercises.filter { !deleted.contains($0.id) }; return d }
            if scrubbed != current { ProgramStore.saveStoredProgram(scrubbed); changed = true }
        }
        ProgramStore.ensureProgramExercisesInLibrary(ProgramStore.getStoredProgram())
        return (changed, hold)
    }

    private func markPulled() { var s = status; s.lastPullAt = LiftLogEnv.now(); s.authExpired = false; status = s }
    private func markAuthExpired() { var s = status; s.authExpired = true; status = s }
}
