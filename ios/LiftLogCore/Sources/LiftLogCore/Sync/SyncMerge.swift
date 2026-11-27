import Foundation

/// syncMerge.ts `SessionMergePlan`: what a pull does to the local sessions.
public struct SessionMergePlan: Codable, Hashable, Sendable {
    public struct Replacement: Codable, Hashable, Sendable {
        public var localId: Int
        public var doc: SessionDoc
    }
    /// Local session ids to delete (tombstoned on the server)
    public var deleteLocalIds: [Int] = []
    /// Server docs that replace an existing local session (server copy is newer)
    public var replace: [Replacement] = []
    /// Server docs with no local counterpart — insert as new sessions
    public var insert: [SessionDoc] = []
    public var isEmpty: Bool { deleteLocalIds.isEmpty && replace.isEmpty && insert.isEmpty }
}

extension SessionDocSet {
    public init(exerciseId: String, setNumber: Int, weight: Double, reps: Double, order: Int? = nil, warmup: Bool? = nil,
                repLow: Int? = nil, repHigh: Int? = nil, technique: SetTechnique? = nil, grip: Grip? = nil) {
        self.exerciseId = exerciseId; self.setNumber = setNumber; self.weight = weight; self.reps = reps; self.order = order
        self.warmup = warmup; self.repLow = repLow; self.repHigh = repHigh; self.technique = technique; self.grip = grip
    }
}

/// Port of src/data/syncMerge.ts, the merge parts of src/data/sync.ts and
/// worker/planMerge.ts. Sessions are atomic documents keyed by an immutable
/// GUID and merged per document by `updatedAt`; tombstones make deletions
/// stick; nothing that exists only locally is ever dropped by a pull.
public enum SyncMerge {
    /// Legacy (pre-sync-v2) sessions derive a deterministic GUID from startedAt.
    public static func sessionGuid(_ s: Session) -> String { s.guid ?? "legacy-\(JS.string(s.startedAt))" }

    /// Legacy sessions have no updatedAt; their last meaningful write was completion.
    public static func sessionUpdatedAt(_ s: Session) -> Double { s.updatedAt ?? s.completedAt ?? s.startedAt }

    public static func planSessionMerge(local: [Session], incoming: [SessionDoc], tombstones: Set<String>) -> SessionMergePlan {
        var localByGuid: [String: Session] = [:]
        for s in local { localByGuid[sessionGuid(s)] = s }
        var plan = SessionMergePlan()
        for s in local where tombstones.contains(sessionGuid(s)) { plan.deleteLocalIds.append(s.id ?? -1) }
        for doc in incoming where !tombstones.contains(doc.guid) {
            if let existing = localByGuid[doc.guid] {
                if doc.updatedAt > sessionUpdatedAt(existing) { plan.replace.append(.init(localId: existing.id ?? -1, doc: doc)) }
                // else: the local copy is the same or newer — keep it; the next push uploads it
            } else {
                plan.insert.append(doc)
            }
        }
        return plan
    }

    /// sync.ts `groupWireSessions`: the wire's flat arrays → session documents.
    public static func groupWireSessions(_ sessions: [Session], _ setLogs: [SetLog]) -> [SessionDoc] {
        var bySession: [Int: [SetLog]] = [:]
        for l in setLogs { bySession[l.sessionId, default: []].append(l) }
        return sessions.map { s in
            SessionDoc(guid: sessionGuid(s), dayId: s.dayId, weekNumber: s.weekNumber, startedAt: s.startedAt,
                       completedAt: s.completedAt, updatedAt: sessionUpdatedAt(s),
                       note: (s.note?.isEmpty ?? true) ? nil : s.note,
                       sets: (s.id.flatMap { bySession[$0] } ?? []).map {
                           SessionDocSet(exerciseId: $0.exerciseId, setNumber: $0.setNumber, weight: $0.weight, reps: $0.reps,
                                         order: $0.order, warmup: $0.warmup, repLow: $0.repLow, repHigh: $0.repHigh,
                                         technique: $0.technique, grip: $0.grip)
                       })
        }
    }

    // MARK: Plan document (worker/planMerge.ts — the same rule on both sides)

    static func profileClock(_ doc: PlanState?) -> Double { doc?.profile?.updatedAt ?? -1 }

    /// The clock the whole document sorts by: the newer of its two parts.
    public static func planDocClock(_ doc: PlanState) -> Double { max(doc.updatedAt, doc.profile?.updatedAt ?? 0) }

    /// The newer plans and the newer profile win independently; equal clocks keep the current copy.
    public static func mergePlanDocs(current: PlanState?, incoming: PlanState) -> (doc: PlanState, changed: Bool) {
        guard let current else { return (incoming, true) }
        let takePlans = incoming.updatedAt > current.updatedAt
        let takeProfile = profileClock(incoming) > profileClock(current)
        if !takePlans && !takeProfile { return (current, false) }
        var doc = takePlans ? incoming : current
        doc.profile = takeProfile ? incoming.profile : current.profile
        return (doc, true)
    }

    // MARK: Program document

    /// sync.ts pull: adopt the server program when its clock is newer; an
    /// unstamped local program yields to a non-empty server copy unless this
    /// device still owes a push; an unstamped empty server program is never adopted.
    public static func shouldAdoptProgram(serverProgram: [WorkoutDay]?, serverClock: Double, localClock: Double,
                                          hasUnpushed: Bool) -> (adopt: Bool, holdUnstamped: Bool) {
        let hold = localClock == 0 && hasUnpushed
        guard let serverProgram else { return (false, hold) }
        return (serverClock > localClock || (localClock == 0 && !serverProgram.isEmpty && !hold), hold)
    }

    /// exercises.ts `mergeExerciseMeta`: per exercise, a strictly newer local override survives.
    public static func mergeExerciseMeta(local: [String: ExerciseMetaOverride], incoming: [String: ExerciseMetaOverride]) -> [String: ExerciseMetaOverride] {
        var merged = local
        for (id, inc) in incoming {
            if let loc = local[id], (loc.updatedAt ?? 0) > (inc.updatedAt ?? 0) { continue }
            merged[id] = inc
        }
        return merged
    }
}

extension LiftLogStore {
    /// db/database.ts `applySessionMergePlan`: the whole plan — deletions,
    /// replacements and every inserted document with its sets — commits in ONE
    /// transaction, so a kill mid-pull can never leave a half-applied session.
    public func applySessionMergePlan(_ plan: SessionMergePlan) throws {
        try db.transaction {
            for id in plan.deleteLocalIds {
                try db.run("DELETE FROM set_logs WHERE sessionId = ?", [.int(Int64(id))])
                try db.run("DELETE FROM sessions WHERE id = ?", [.int(Int64(id))])
            }
            // Replaced sessions keep their local id, so references stay valid.
            for r in plan.replace {
                try db.run("DELETE FROM set_logs WHERE sessionId = ?", [.int(Int64(r.localId))])
                try db.run("UPDATE sessions SET guid = ?, dayId = ?, weekNumber = ?, startedAt = ?, completedAt = ?, updatedAt = ?, note = ? WHERE id = ?",
                           [.text(r.doc.guid), .int(Int64(r.doc.dayId)), .int(Int64(r.doc.weekNumber)), .double(r.doc.startedAt),
                            .opt(r.doc.completedAt), .double(r.doc.updatedAt), .opt((r.doc.note?.isEmpty ?? true) ? nil : r.doc.note),
                            .int(Int64(r.localId))])
                try insertDocSets(r.doc, sessionId: r.localId)
            }
            for doc in plan.insert {
                let id = Int(try db.run(
                    "INSERT INTO sessions(guid, dayId, weekNumber, startedAt, completedAt, updatedAt, note) VALUES(?,?,?,?,?,?,?)",
                    [.text(doc.guid), .int(Int64(doc.dayId)), .int(Int64(doc.weekNumber)), .double(doc.startedAt),
                     .opt(doc.completedAt), .double(doc.updatedAt), .opt((doc.note?.isEmpty ?? true) ? nil : doc.note)]))
                try insertDocSets(doc, sessionId: id)
            }
        }
    }

    private func insertDocSets(_ doc: SessionDoc, sessionId: Int) throws {
        for s in doc.sets {
            try insertSet(SetLog(sessionId: sessionId, exerciseId: s.exerciseId, setNumber: s.setNumber, weight: s.weight, reps: s.reps,
                                 order: s.order, warmup: s.warmup, repLow: s.repLow, repHigh: s.repHigh, technique: s.technique, grip: s.grip),
                          sessionId: sessionId)
        }
    }
}
