import XCTest
@testable import LiftLogCore

/// An in-memory worker: the same per-document rules worker/sync.ts applies
/// (upsert a session when its clock is newer, tombstones stick, plan doc via
/// mergePlanDocs, program by clock), plus ETag/304 and bearer checks.
final class FakeServer: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    var sessions: [String: SessionDoc] = [:]
    var tombstones: [String] = []
    var plan: PlanState?
    var program: [WorkoutDay]?
    var programUpdatedAt: Double = 0
    var version = 1
    var log: [(method: String, ifNoneMatch: String?)] = []
    var token = "tok"

    struct Push: Decodable {
        var sessions: [Session]
        var setLogs: [SetLog]
        var deletedSessionGuids: [String]
        var program: [WorkoutDay]
        var programUpdatedAt: Double
        var plan: PlanState?
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { try handle(request) }

    private func handle(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        lock.lock(); defer { lock.unlock() }
        let method = request.httpMethod ?? "GET"
        log.append((method, request.value(forHTTPHeaderField: "If-None-Match")))
        func respond(_ status: Int, _ body: Data = Data(), _ headers: [String: String] = [:]) -> (Data, HTTPURLResponse) {
            (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                   headerFields: headers.merging(["Content-Type": "application/json"]) { a, _ in a })!)
        }
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)" else { return respond(401, Data("{}".utf8)) }
        let etag = "\"v\(version)\""
        if method == "GET" {
            if request.value(forHTTPHeaderField: "If-None-Match") == etag { return respond(304) }
            var wireSessions: [[String: Any]] = [], wireSets: [[String: Any]] = []
            for (i, d) in sessions.values.sorted(by: { $0.startedAt < $1.startedAt }).enumerated() {
                var s: [String: Any] = ["id": i + 1, "guid": d.guid, "dayId": d.dayId, "weekNumber": d.weekNumber,
                                        "startedAt": d.startedAt, "updatedAt": d.updatedAt]
                if let c = d.completedAt { s["completedAt"] = c }
                if let n = d.note { s["note"] = n }
                wireSessions.append(s)
                for set in d.sets {
                    wireSets.append(["sessionId": i + 1, "exerciseId": set.exerciseId, "setNumber": set.setNumber,
                                     "weight": set.weight, "reps": set.reps])
                }
            }
            var body: [String: Any] = ["sessions": wireSessions, "setLogs": wireSets, "deletedSessionGuids": tombstones,
                                       "programUpdatedAt": programUpdatedAt]
            if let program { body["program"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(program)) }
            if let plan { body["plan"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan)) }
            return respond(200, try JSONSerialization.data(withJSONObject: body), ["ETag": etag])
        }
        let push = try JSONDecoder().decode(Push.self, from: request.httpBody!)
        for d in SyncMerge.groupWireSessions(push.sessions, push.setLogs) where !tombstones.contains(d.guid) {
            if let cur = sessions[d.guid], cur.updatedAt >= d.updatedAt { continue }
            sessions[d.guid] = d
        }
        for g in push.deletedSessionGuids where !tombstones.contains(g) { tombstones.append(g); sessions.removeValue(forKey: g) }
        if let p = push.plan { plan = SyncMerge.mergePlanDocs(current: plan, incoming: p).doc }
        if push.programUpdatedAt > programUpdatedAt { program = push.program; programUpdatedAt = push.programUpdatedAt }
        version += 1
        return respond(200, Data("{\"ok\":true}".utf8))
    }
}

/// One iPhone/iPad: its own SQLite store, which becomes `LiftLogEnv.store` while it acts.
final class Device {
    let store: LiftLogStore
    let client: SyncClient
    init(_ server: FakeServer, path: String? = nil) throws {
        store = try LiftLogStore(path: path)
        client = SyncClient(baseURL: URL(string: "https://liftlog.test")!, store: store, tokens: InMemoryTokenStore("tok"), transport: server)
    }
    func act<T>(_ body: () throws -> T) rethrows -> T { LiftLogEnv.store = store; return try body() }
    func push() async throws -> SyncClient.PushResult { LiftLogEnv.store = store; return try await client.push() }
    func pull() async throws -> SyncClient.PullResult { LiftLogEnv.store = store; return try await client.pull() }
    func sync() async throws -> (pull: SyncClient.PullResult, push: SyncClient.PushResult?) { LiftLogEnv.store = store; return try await client.sync() }
    func log(_ guid: String, start: Double, updatedAt: Double, sets: Int, note: String? = nil) throws {
        try act {
            _ = try store.saveSession(Session(guid: guid, dayId: 1, weekNumber: 1, startedAt: start, completedAt: start + 3_600_000,
                                              updatedAt: updatedAt, note: note),
                                      sets: (0..<sets).map { SetLog(sessionId: 0, exerciseId: "leg-press", setNumber: $0 + 1, weight: 100, reps: 8) })
            client.markLocalChange()
        }
    }
    func guids() throws -> Set<String> { Set(try store.allSessions().map(SyncMerge.sessionGuid)) }
    func session(_ guid: String) throws -> Session? { try store.allSessions().first { $0.guid == guid } }
    func setCount(_ guid: String) throws -> Int { try session(guid).map { try store.sets(forSession: $0.id!).count } ?? -1 }
}

final class SyncClientTests: XCTestCase {
    let T = 1_770_000_000_000.0
    override func setUp() { LiftLogEnv.nowProvider = { 1_775_000_000_000 } }

    func seededServer() -> FakeServer {
        let s = FakeServer()
        for i in 0..<5 {
            let start = T + Double(i) * 86_400_000
            s.sessions["web-\(i)"] = SessionDoc(guid: "web-\(i)", dayId: 1, weekNumber: 1, startedAt: start, completedAt: start + 3_600_000,
                                                updatedAt: start + 3_600_000, note: i == 0 ? "first" : nil,
                                                sets: (0..<3).map { SessionDocSet(exerciseId: "leg-press", setNumber: $0 + 1, weight: 100, reps: 8) })
        }
        s.tombstones = ["web-deleted"]
        s.plan = PlanState(version: 1, plans: [], updatedAt: 500)
        s.program = [WorkoutDay(id: 1, label: "Legs", muscleGroups: "Legs", exercises: [Exercise(id: "leg-press", name: "Leg Press", sets: 3)])]
        s.programUpdatedAt = 400
        return s
    }

    /// Google web account → new iPhone: the full history comes down before anything goes up,
    /// and a workout logged on the phone before its first sync survives and uploads.
    func testNewIPhonePullsFullHistoryBeforeFirstPush() async throws {
        let server = seededServer()
        let phone = try Device(server)
        try phone.log("phone-0", start: T + 10 * 86_400_000, updatedAt: T + 10 * 86_400_000, sets: 2)
        XCTAssertFalse(phone.client.hasCompletedInitialPull)
        _ = try await phone.push()  // a push asked for too early pulls first
        XCTAssertEqual(server.log.first?.method, "GET")
        XCTAssertEqual(try phone.guids(), ["web-0", "web-1", "web-2", "web-3", "web-4", "phone-0"])
        XCTAssertEqual(try phone.setCount("web-0"), 3)
        XCTAssertEqual(try phone.session("web-0")?.note, "first")
        XCTAssertEqual(Set(server.sessions.keys), ["web-0", "web-1", "web-2", "web-3", "web-4", "phone-0"])
        XCTAssertEqual(server.sessions["phone-0"]?.sets.count, 2)
        phone.act {
            XCTAssertEqual(ProgramStore.getStoredProgram().first?.label, "Legs")
            XCTAssertEqual(PlanStore.getPlanState().updatedAt, 500)
            XCTAssertEqual(phone.client.tombstones(), ["web-deleted"])
        }
    }

    /// Device switch: everything the old phone had arrives on the new one.
    func testDeviceSwitchLosesNothing() async throws {
        let server = FakeServer()
        let old = try Device(server)
        for i in 0..<20 { try old.log("old-\(i)", start: T + Double(i) * 86_400_000, updatedAt: T + Double(i) * 86_400_000, sets: i % 4 + 1) }
        _ = try await old.sync()
        let new = try Device(server)
        _ = try await new.sync()
        XCTAssertEqual(try new.guids(), try old.guids())
        for i in 0..<20 { XCTAssertEqual(try new.setCount("old-\(i)"), i % 4 + 1) }
    }

    /// Offline edits on two devices: per-session newest wins, everything else is kept from both.
    func testOfflineEditsOnTwoDevicesMerge() async throws {
        let server = seededServer()
        let a = try Device(server), b = try Device(server)
        _ = try await a.sync(); _ = try await b.sync()
        // Offline: A edits web-1 (newer), B edits web-1 (older) and web-2, both log new workouts.
        try a.act { let s = try a.session("web-1")!; try a.store.replaceSets(sessionId: s.id!, sets: (0..<5).map { SetLog(sessionId: s.id!, exerciseId: "leg-press", setNumber: $0 + 1, weight: 110, reps: 8) }, updatedAt: T + 900_000_000); a.client.markLocalChange() }
        try b.act { let s = try b.session("web-1")!; try b.store.replaceSets(sessionId: s.id!, sets: [SetLog(sessionId: s.id!, exerciseId: "leg-press", setNumber: 1, weight: 90, reps: 8)], updatedAt: T + 800_000_000) }
        try b.act { let s = try b.session("web-2")!; try b.store.replaceSets(sessionId: s.id!, sets: [SetLog(sessionId: s.id!, exerciseId: "leg-press", setNumber: 1, weight: 120, reps: 5)], updatedAt: T + 850_000_000); b.client.markLocalChange() }
        try a.log("a-new", start: T + 20 * 86_400_000, updatedAt: T + 20 * 86_400_000, sets: 1)
        try b.log("b-new", start: T + 21 * 86_400_000, updatedAt: T + 21 * 86_400_000, sets: 1)
        _ = try await a.sync(); _ = try await b.sync(); _ = try await a.sync()
        for d in [a, b] {
            XCTAssertEqual(try d.guids(), ["web-0", "web-1", "web-2", "web-3", "web-4", "a-new", "b-new"])
            XCTAssertEqual(try d.setCount("web-1"), 5, "A's newer edit wins")
            XCTAssertEqual(try d.setCount("web-2"), 1, "B's edit to a different session survives")
        }
        XCTAssertEqual(server.sessions["web-1"]?.sets.count, 5)
    }

    /// A deletion on one device sticks everywhere, and the other device's stale copy can't resurrect it.
    func testTombstoneSticksAcrossDevices() async throws {
        let server = seededServer()
        let a = try Device(server), b = try Device(server)
        _ = try await a.sync(); _ = try await b.sync()
        try a.act { try a.client.deleteSession(try a.session("web-3")!) }
        _ = try await a.sync()
        try b.act { b.client.markLocalChange() }
        _ = try await b.sync()
        XCTAssertNil(server.sessions["web-3"])
        XCTAssertFalse(try b.guids().contains("web-3"))
        XCTAssertEqual(try b.guids().count, 4)
    }

    /// Plans and profile are merged independently: an edit to each on different devices both survive.
    func testPlanDocumentPlansAndProfileMergeIndependently() async throws {
        let server = seededServer()
        let a = try Device(server), b = try Device(server)
        _ = try await a.sync(); _ = try await b.sync()
        try a.act { var p = PlanStore.getPlanState(); p.strength = try JSONDecoder().decode(StrengthState.self, from: Data(#"{"maxes":[{"exerciseId":"leg-press","weight":300,"source":"tested","date":"2026-03-01","updatedAt":900}],"goals":[]}"#.utf8)); p.updatedAt = 900; a.store.setJSON(p, StorageKey.plan); a.client.markLocalChange() }
        b.act { var p = PlanStore.getPlanState(); var prof = PlanMath.defaultTrainingProfile(); prof.injuries = "knee"; prof.updatedAt = 950; p.profile = prof; b.store.setJSON(p, StorageKey.plan); b.client.markLocalChange() }
        _ = try await a.sync(); _ = try await b.sync(); _ = try await a.sync()
        for d in [a, b] { d.act {
            let p = PlanStore.getPlanState()
            XCTAssertEqual(p.updatedAt, 900); XCTAssertEqual(p.strength?.maxes.first?.weight, 300); XCTAssertEqual(p.profile?.injuries, "knee")
        } }
    }

    func testConditionalPullAndExpiredAuth() async throws {
        let server = seededServer()
        let phone = try Device(server)
        let first = try await phone.sync()
        XCTAssertEqual(first.pull, .merged(changed: true))
        _ = try await phone.pull()  // our own push moved the server's ETag: one full pull, then 304s
        let again = try await phone.pull()
        XCTAssertEqual(again, SyncClient.PullResult.unchanged)
        XCTAssertEqual(server.log.last?.ifNoneMatch, "\"v\(server.version)\"")
        server.token = "rotated"
        let expired = try await phone.sync()
        XCTAssertEqual(expired.pull, .unauthorized)
        XCTAssertNil(expired.push, "never push after a failed pull")
        XCTAssertEqual(try phone.guids().count, 5, "an auth failure drops nothing")
    }

    /// A merge plan commits atomically and a replaced session keeps its local id.
    func testReplaceKeepsLocalIdAndSets() throws {
        let store = try LiftLogStore()
        let id = try store.saveSession(Session(guid: "x", dayId: 1, weekNumber: 1, startedAt: 1, updatedAt: 1),
                                       sets: [SetLog(sessionId: 0, exerciseId: "a", setNumber: 1, weight: 1, reps: 1)])
        try store.applySessionMergePlan(SessionMergePlan(replace: [.init(localId: id, doc: SessionDoc(guid: "x", dayId: 2, weekNumber: 1, startedAt: 1, updatedAt: 2,
                                                                                                          sets: [SessionDocSet(exerciseId: "b", setNumber: 1, weight: 2, reps: 3, repLow: 4, repHigh: 8)]))]))
        let s = try store.allSessions()
        XCTAssertEqual(s.map(\.id), [id]); XCTAssertEqual(s[0].dayId, 2)
        XCTAssertEqual(try store.sets(forSession: id).map(\.exerciseId), ["b"])
        XCTAssertEqual(try store.sets(forSession: id).first?.repHigh, 8)
    }

    /// Drafts are written on every change and survive the app being killed (the store reopened).
    func testDraftPersistsAcrossRelaunchAndIsProtected() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("draft-\(UUID().uuidString).sqlite").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        let now = 1_775_000_000_000.0
        do {
            let store = try LiftLogStore(path: path)
            var draft = DraftSession(dayId: 2, startedAt: now - 600_000, savedAt: now - 600_000, sets: [:])
            DraftStore.save(draft, store: store)
            draft.sets["leg-press"] = [try JSONDecoder().decode(DraftSet.self, from: Data(#"{"weight":100,"reps":8}"#.utf8))]
            draft.savedAt = now
            DraftStore.save(draft, store: store)
        }
        let reopened = try LiftLogStore(path: path)
        XCTAssertEqual(DraftStore.resumable(dayId: 2, now: now, store: reopened)?.sets["leg-press"]?.count, 1)
        XCTAssertNotNil(DraftStore.conflicting(dayId: 3, now: now, store: reopened), "another day must ask before replacing it")
        XCTAssertNil(DraftStore.conflicting(dayId: 2, now: now, store: reopened))
    }
}

/// Native sign-in against the worker's contract.
final class AuthServiceTests: XCTestCase {
    final class Canned: HTTPTransport, @unchecked Sendable {
        var status = 200, body = "", seen: [URLRequest] = []
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            seen.append(request)
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
        }
    }

    func testUnmatchedAppleAsksToLinkAndStoresNoToken() async throws {
        let t = Canned(); t.status = 409
        t.body = #"{"status":"link_required","linkToken":"lt","expiresAt":1,"prompt":"Already use LiftLog? Sign in with Google to link"}"#
        let tokens = InMemoryTokenStore()
        let auth = AuthService(baseURL: URL(string: "https://liftlog.test")!, tokens: tokens, transport: t)
        guard case .linkRequired(let link) = try await auth.signInWithApple(identityToken: "id", rawNonce: "n") else { return XCTFail() }
        XCTAssertEqual(link.linkToken, "lt")
        XCTAssertNil(tokens.token())

        t.status = 200
        t.body = #"{"token":"sess","expiresAt":9,"user":{"id":"u1","email":"a@b.c"},"identities":[{"provider":"google"},{"provider":"apple"}],"linked":"explicit"}"#
        guard case .signedIn(let s) = try await auth.signInWithGoogle(idToken: "g", linkToken: link.linkToken) else { return XCTFail() }
        XCTAssertEqual(s.identities.count, 2)
        XCTAssertEqual(tokens.token(), "sess")
        let sent = try JSONSerialization.jsonObject(with: t.seen.last!.httpBody!) as! [String: String]
        XCTAssertEqual(sent["linkToken"], "lt")
        XCTAssertTrue(t.seen.last!.url!.path.hasSuffix("/api/auth/google/native"))

        _ = try await auth.identities()
        XCTAssertEqual(t.seen.last!.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
    }

    func testNonceIsSha256OfRaw() {
        let n = AuthService.makeNonce()
        XCTAssertEqual(n.raw.count, 64); XCTAssertEqual(n.sha256.count, 64); XCTAssertNotEqual(n.raw, n.sha256)
    }
}
