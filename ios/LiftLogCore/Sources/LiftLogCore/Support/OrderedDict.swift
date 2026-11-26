/// A dictionary that iterates in insertion order — the iteration semantics of
/// a JS `Map` and of string-keyed object literals, which several engines'
/// outputs depend on.
public struct OrderedDict<Key: Hashable, Value> {
    public private(set) var keys: [Key] = []
    private var storage: [Key: Value] = [:]

    public init() {}

    public subscript(key: Key) -> Value? {
        get { storage[key] }
        set {
            if let v = newValue {
                if storage.updateValue(v, forKey: key) == nil { keys.append(key) }
            } else if storage.removeValue(forKey: key) != nil {
                keys.removeAll { $0 == key }
            }
        }
    }

    public subscript(key: Key, default def: @autoclosure () -> Value) -> Value {
        get { storage[key] ?? def() }
        set { self[key] = newValue }
    }

    public var count: Int { keys.count }
    public var isEmpty: Bool { keys.isEmpty }
    public var values: [Value] { keys.map { storage[$0]! } }
    public var entries: [(key: Key, value: Value)] { keys.map { ($0, storage[$0]!) } }
    public func has(_ key: Key) -> Bool { storage[key] != nil }
}

/// Encodes like the parity harness normalizes a JS `Map`: [[key, value], …].
extension OrderedDict: Encodable where Key: Encodable, Value: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        for (k, v) in entries {
            var pair = c.nestedUnkeyedContainer()
            try pair.encode(k); try pair.encode(v)
        }
    }
}
