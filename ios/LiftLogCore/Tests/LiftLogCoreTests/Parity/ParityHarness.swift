import Foundation
import XCTest
@testable import LiftLogCore

/// Generic JSON value used to compare Swift outputs with TS fixtures.
enum JSONValue: Codable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

struct ParityCase: Decodable {
    let name: String
    let fn: String
    let args: [JSONValue]
    let output: JSONValue
    let now: Double
    let storage: [String: String]?

    func arg<T: Decodable>(_ i: Int, _ type: T.Type = T.self) throws -> T {
        let v = i < args.count ? args[i] : .null
        let data = try JSONEncoder().encode(v)
        do { return try JSONDecoder().decode(T.self, from: data) } catch {
            throw NSError(domain: "parity", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(name): arg \(i) as \(T.self): \(error)"])
        }
    }
}

struct ParityFixture: Decodable {
    let engine: String
    let cases: [ParityCase]
}

enum Parity {
    static let fixtureDir: URL = {
        // Tests/LiftLogCoreTests/Parity/ParityHarness.swift → ios/parity/fixtures
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("parity/fixtures")
    }()

    static let timeZone = TimeZone(identifier: "America/Chicago")!

    static func load(_ engine: String) throws -> ParityFixture {
        let data = try Data(contentsOf: fixtureDir.appendingPathComponent("\(engine).json"))
        return try JSONDecoder().decode(ParityFixture.self, from: data)
    }

    static func toJSON<T: Encodable>(_ value: T) throws -> JSONValue {
        let enc = JSONEncoder()
        enc.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "__inf", negativeInfinity: "__ninf", nan: "__nan")
        let data = try enc.encode(value)
        return normalizeNonFinite(try JSONDecoder().decode(JSONValue.self, from: data))
    }

    private static func normalizeNonFinite(_ v: JSONValue) -> JSONValue {
        switch v {
        case .string(let s) where s == "__inf" || s == "__ninf" || s == "__nan": return .null
        case .array(let a): return .array(a.map(normalizeNonFinite))
        case .object(let o): return .object(o.mapValues(normalizeNonFinite))
        default: return v
        }
    }

    /// Structural equality with JS-JSON semantics: an absent key equals null,
    /// numbers match to 1e-9 relative (formatting of doubles is the only
    /// thing allowed to differ — every engine computes in IEEE doubles).
    static func diff(_ expected: JSONValue, _ actual: JSONValue, path: String = "$") -> String? {
        switch (expected, actual) {
        case (.number(let a), .number(let b)):
            if a == b { return nil }
            let tol = Swift.max(1e-9, Swift.abs(a) * 1e-9)
            return Swift.abs(a - b) <= tol ? nil : "\(path): expected \(a), got \(b)"
        case (.array(let a), .array(let b)):
            if a.count != b.count { return "\(path): expected array of \(a.count), got \(b.count)\n  expected: \(brief(expected))\n  actual:   \(brief(actual))" }
            for i in a.indices { if let d = diff(a[i], b[i], path: "\(path)[\(i)]") { return d } }
            return nil
        case (.object(let a), .object(let b)):
            for k in Set(a.keys).union(b.keys).sorted() {
                if let d = diff(a[k] ?? .null, b[k] ?? .null, path: "\(path).\(k)") { return d }
            }
            return nil
        default:
            return expected == actual ? nil : "\(path): expected \(brief(expected)), got \(brief(actual))"
        }
    }

    static func brief(_ v: JSONValue) -> String {
        let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
        let s = (try? String(data: enc.encode(v), encoding: .utf8)) ?? "?"
        return s.count > 400 ? String(s.prefix(400)) + "…" : s
    }

    /// Runs every case in a fixture through `handlers[case.fn]`, under the
    /// case's storage, clock and America/Chicago. A case whose `fn` has no
    /// handler fails — nothing in a fixture can be silently skipped.
    static func run(_ engine: String, file: StaticString = #filePath, line: UInt = #line,
                    _ handlers: [String: (ParityCase) throws -> any Encodable]) throws {
        let fixture = try load(engine)
        XCTAssertFalse(fixture.cases.isEmpty, "\(engine): empty fixture", file: file, line: line)
        var failures = 0
        for c in fixture.cases {
            guard let handler = handlers[c.fn] else {
                XCTFail("\(engine)/\(c.name): no Swift handler for \(c.fn)", file: file, line: line); failures += 1; continue
            }
            LiftLogEnv.store = InMemoryKeyValueStore(c.storage ?? [:])
            LiftLogEnv.nowProvider = { c.now }
            LiftLogEnv.timeZone = timeZone
            do {
                let actual = try toJSON(AnyEncodable(try handler(c)))
                if let d = diff(c.output, actual) {
                    XCTFail("\(engine)/\(c.name) [\(c.fn)]: \(d)", file: file, line: line); failures += 1
                }
            } catch {
                XCTFail("\(engine)/\(c.name) [\(c.fn)]: threw \(error)", file: file, line: line); failures += 1
            }
        }
        print("parity \(engine): \(fixture.cases.count - failures)/\(fixture.cases.count) cases match")
    }
}

struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

/// `null` output (TS `undefined`/`null`).
struct JSNull: Encodable { func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encodeNil() } }

extension Optional where Wrapped: Encodable {
    /// Lets handlers return optionals; nil encodes as JSON null.
    var json: any Encodable { self.map { $0 as any Encodable } ?? JSNull() }
}
