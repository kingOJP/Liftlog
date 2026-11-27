import Foundation
import SQLite3

public enum SQLiteError: Error, CustomStringConvertible {
    case open(String), prepare(String), step(String)
    public var description: String {
        switch self { case .open(let m), .prepare(let m), .step(let m): return m }
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Thin wrapper over the SDK's SQLite3 (no third-party dependency).
public final class SQLiteDatabase {
    private var db: OpaquePointer?
    private let lock = NSRecursiveLock()

    /// `path` nil → in-memory database (tests).
    public init(path: String? = nil) throws {
        let p = path ?? ":memory:"
        if sqlite3_open_v2(p, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK {
            throw SQLiteError.open(String(cString: sqlite3_errmsg(db)))
        }
        try exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
    }

    deinit { sqlite3_close(db) }

    public enum Value: Equatable { case int(Int64), double(Double), text(String), null }

    public func exec(_ sql: String) throws {
        lock.lock(); defer { lock.unlock() }
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "sqlite error"
            sqlite3_free(err)
            throw SQLiteError.step(msg)
        }
    }

    @discardableResult
    public func run(_ sql: String, _ params: [Value] = []) throws -> Int64 {
        lock.lock(); defer { lock.unlock() }
        let stmt = try prepare(sql, params)
        defer { sqlite3_finalize(stmt) }
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw SQLiteError.step(String(cString: sqlite3_errmsg(db))) }
        return sqlite3_last_insert_rowid(db)
    }

    public func query(_ sql: String, _ params: [Value] = []) throws -> [[String: Value]] {
        lock.lock(); defer { lock.unlock() }
        let stmt = try prepare(sql, params)
        defer { sqlite3_finalize(stmt) }
        var rows: [[String: Value]] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLiteError.step(String(cString: sqlite3_errmsg(db))) }
            var row: [String: Value] = [:]
            for i in 0..<sqlite3_column_count(stmt) {
                let name = String(cString: sqlite3_column_name(stmt, i))
                switch sqlite3_column_type(stmt, i) {
                case SQLITE_INTEGER: row[name] = .int(sqlite3_column_int64(stmt, i))
                case SQLITE_FLOAT: row[name] = .double(sqlite3_column_double(stmt, i))
                case SQLITE_TEXT:
                    let text = sqlite3_column_text(stmt, i)
                    let count = Int(sqlite3_column_bytes(stmt, i))
                    row[name] = .text(text.map { String(decoding: UnsafeBufferPointer(start: $0, count: count), as: UTF8.self) } ?? "")
                default: row[name] = .null
                }
            }
            rows.append(row)
        }
        return rows
    }

    /// Runs `body` inside a transaction; rolls back if it throws.
    public func transaction<T>(_ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        try exec("BEGIN IMMEDIATE")
        do { let r = try body(); try exec("COMMIT"); return r } catch { try? exec("ROLLBACK"); throw error }
    }

    private func prepare(_ sql: String, _ params: [Value]) throws -> OpaquePointer? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw SQLiteError.prepare(String(cString: sqlite3_errmsg(db)))
        }
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            switch p {
            case .int(let v): sqlite3_bind_int64(stmt, idx, v)
            case .double(let v): sqlite3_bind_double(stmt, idx, v)
            case .text(let v):
                // Explicit byte length: a -1 length stops at the first NUL and silently truncates.
                let bytes = Array(v.utf8)
                if bytes.isEmpty {
                    sqlite3_bind_text(stmt, idx, "", 0, SQLITE_TRANSIENT)
                } else {
                    _ = bytes.withUnsafeBufferPointer { buf in
                        buf.withMemoryRebound(to: CChar.self) { sqlite3_bind_text(stmt, idx, $0.baseAddress, Int32($0.count), SQLITE_TRANSIENT) }
                    }
                }
            case .null: sqlite3_bind_null(stmt, idx)
            }
        }
        return stmt
    }
}

extension SQLiteDatabase.Value {
    var int: Int? { if case .int(let v) = self { return Int(v) }; if case .double(let v) = self { return Int(v) }; return nil }
    var double: Double? { if case .double(let v) = self { return v }; if case .int(let v) = self { return Double(v) }; return nil }
    var text: String? { if case .text(let v) = self { return v }; return nil }
    static func opt(_ v: Int?) -> Self { v.map { .int(Int64($0)) } ?? .null }
    static func opt(_ v: Double?) -> Self { v.map { .double($0) } ?? .null }
    static func opt(_ v: String?) -> Self { v.map { .text($0) } ?? .null }
    static func opt(_ v: Bool?) -> Self { v.map { .int($0 ? 1 : 0) } ?? .null }
}

/// The local store: a `kv` table mirroring localStorage (same keys, same JSON)
/// and `sessions` / `set_logs` tables mirroring the IndexedDB object stores
/// (CLAUDE.md "IndexedDB schema"). Weights are stored in lbs, as in the PWA.
public final class LiftLogStore: KeyValueStore {
    public let db: SQLiteDatabase
    public static let schemaVersion = 1

    public init(path: String? = nil) throws {
        db = try SQLiteDatabase(path: path)
        try migrate()
    }

    private func migrate() throws {
        try db.exec("""
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guid TEXT UNIQUE,
          dayId INTEGER NOT NULL,
          weekNumber INTEGER NOT NULL,
          startedAt REAL NOT NULL,
          completedAt REAL,
          updatedAt REAL,
          note TEXT
        );
        CREATE INDEX IF NOT EXISTS sessions_dayId ON sessions(dayId);
        CREATE TABLE IF NOT EXISTS set_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sessionId INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          exerciseId TEXT NOT NULL,
          setNumber INTEGER NOT NULL,
          weight REAL NOT NULL,
          reps REAL NOT NULL,
          "order" INTEGER,
          warmup INTEGER,
          repLow INTEGER,
          repHigh INTEGER,
          technique TEXT,
          grip TEXT
        );
        CREATE INDEX IF NOT EXISTS set_logs_sessionId ON set_logs(sessionId);
        CREATE INDEX IF NOT EXISTS set_logs_exerciseId ON set_logs(exerciseId);
        PRAGMA user_version = \(Self.schemaVersion);
        """)
    }

    // MARK: KeyValueStore (localStorage)

    public func getItem(_ key: String) -> String? {
        (try? db.query("SELECT value FROM kv WHERE key = ?", [.text(key)]))?.first?["value"]?.text
    }
    public func setItem(_ key: String, _ value: String) {
        _ = try? db.run("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [.text(key), .text(value)])
    }
    public func removeItem(_ key: String) { _ = try? db.run("DELETE FROM kv WHERE key = ?", [.text(key)]) }
    public func allKeys() -> [String] {
        ((try? db.query("SELECT key FROM kv ORDER BY key")) ?? []).compactMap { $0["key"]?.text }
    }

    // MARK: Sessions + set logs

    /// Inserts a session and all its sets atomically (the PWA's `saveSessionWithSets`).
    @discardableResult
    public func saveSession(_ session: Session, sets: [SetLog]) throws -> Int {
        try db.transaction {
            let id = Int(try db.run(
                "INSERT INTO sessions(guid, dayId, weekNumber, startedAt, completedAt, updatedAt, note) VALUES(?,?,?,?,?,?,?)",
                [.opt(session.guid), .int(Int64(session.dayId)), .int(Int64(session.weekNumber)), .double(session.startedAt),
                 .opt(session.completedAt), .opt(session.updatedAt), .opt(session.note)]))
            for s in sets { try insertSet(s, sessionId: id) }
            return id
        }
    }

    /// Replaces a session's sets atomically (the PWA's `replaceSessionSets`).
    public func replaceSets(sessionId: Int, sets: [SetLog], updatedAt: Double) throws {
        try db.transaction {
            try db.run("DELETE FROM set_logs WHERE sessionId = ?", [.int(Int64(sessionId))])
            for s in sets { try insertSet(s, sessionId: sessionId) }
            try db.run("UPDATE sessions SET updatedAt = ? WHERE id = ?", [.double(updatedAt), .int(Int64(sessionId))])
        }
    }

    public func deleteSession(id: Int) throws {
        try db.transaction {
            try db.run("DELETE FROM set_logs WHERE sessionId = ?", [.int(Int64(id))])
            try db.run("DELETE FROM sessions WHERE id = ?", [.int(Int64(id))])
        }
    }

    public func allSessions() throws -> [Session] {
        try db.query("SELECT * FROM sessions ORDER BY id").map { r in
            Session(id: r["id"]?.int, guid: r["guid"]?.text, dayId: r["dayId"]?.int ?? 0, weekNumber: r["weekNumber"]?.int ?? 0,
                    startedAt: r["startedAt"]?.double ?? 0, completedAt: r["completedAt"]?.double,
                    updatedAt: r["updatedAt"]?.double, note: r["note"]?.text)
        }
    }

    public func allSetLogs() throws -> [SetLog] { try setRows("SELECT * FROM set_logs ORDER BY id", []) }

    public func sets(forSession id: Int) throws -> [SetLog] {
        try setRows("SELECT * FROM set_logs WHERE sessionId = ? ORDER BY id", [.int(Int64(id))])
    }

    private func setRows(_ sql: String, _ params: [SQLiteDatabase.Value]) throws -> [SetLog] {
        try db.query(sql, params).map { r in
            SetLog(id: r["id"]?.int, sessionId: r["sessionId"]?.int ?? 0, exerciseId: r["exerciseId"]?.text ?? "",
                   setNumber: r["setNumber"]?.int ?? 0, weight: r["weight"]?.double ?? 0, reps: r["reps"]?.double ?? 0,
                   order: r["order"]?.int, warmup: r["warmup"]?.int.map { $0 != 0 }, repLow: r["repLow"]?.int,
                   repHigh: r["repHigh"]?.int, technique: r["technique"]?.text.flatMap(SetTechnique.init(rawValue:)),
                   grip: r["grip"]?.text.flatMap(Grip.init(rawValue:)))
        }
    }

    func insertSet(_ s: SetLog, sessionId: Int) throws {
        try db.run("""
            INSERT INTO set_logs(sessionId, exerciseId, setNumber, weight, reps, "order", warmup, repLow, repHigh, technique, grip)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            [.int(Int64(sessionId)), .text(s.exerciseId), .int(Int64(s.setNumber)), .double(s.weight), .double(s.reps),
             .opt(s.order), .opt(s.warmup), .opt(s.repLow), .opt(s.repHigh), .opt(s.technique?.rawValue), .opt(s.grip?.rawValue)])
    }
}
