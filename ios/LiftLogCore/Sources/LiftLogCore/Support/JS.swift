import Foundation

// JavaScript number semantics the engines rely on. The TypeScript engines are
// the reference implementation; parity tests compare against their output, so
// rounding and formatting must follow ECMAScript rules exactly, not Swift's.
public enum JS {
    /// `Math.round`: rounds half toward +∞ (Math.round(-2.5) === -2).
    @inlinable public static func round(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let f = Foundation.floor(x)
        return x - f >= 0.5 ? f + 1 : f
    }

    /// `String(n)` / template-literal interpolation of a number.
    public static func string(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x.isInfinite { return x > 0 ? "Infinity" : "-Infinity" }
        if x == 0 { return "0" }
        if x == x.rounded(), Swift.abs(x) < 1e21 {
            return String(format: "%.0f", x)
        }
        // Swift's description is the shortest round-trip form, like JS; only
        // the exponent notation differs ("1e-07" vs "1e-7", "1e+21").
        var s = "\(x)"
        if let eIdx = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            let mantissa = String(s[s.startIndex..<eIdx])
            var exp = String(s[s.index(after: eIdx)...])
            var sign = "+"
            if exp.hasPrefix("-") { sign = "-"; exp.removeFirst() } else if exp.hasPrefix("+") { exp.removeFirst() }
            while exp.count > 1 && exp.hasPrefix("0") { exp.removeFirst() }
            let m = mantissa.hasSuffix(".0") ? String(mantissa.dropLast(2)) : mantissa
            s = "\(m)e\(sign)\(exp)"
            return s
        }
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }

    public static func string(_ x: Int) -> String { String(x) }

    /// `Number.prototype.toFixed(digits)` — rounds half up on the exact
    /// decimal value of the double (printf rounds ties to even).
    public static func toFixed(_ x: Double, _ digits: Int) -> String {
        if !x.isFinite { return string(x) }
        if Swift.abs(x) >= 1e21 { return string(x) }
        let negative = x < 0
        let expanded = String(format: "%.\(digits + 40)f", Swift.abs(x))
        guard let dot = expanded.firstIndex(of: ".") else { return expanded }
        let intPart = Array(expanded[expanded.startIndex..<dot])
        let frac = Array(expanded[expanded.index(after: dot)...])
        var digitsArr = intPart + frac.prefix(digits)
        let roundUp = frac.count > digits && frac[digits] >= "5"
        if roundUp {
            var i = digitsArr.count - 1
            var carry = true
            while carry && i >= 0 {
                if digitsArr[i] == "9" { digitsArr[i] = "0"; i -= 1 } else {
                    digitsArr[i] = Character(String(digitsArr[i].wholeNumberValue! + 1)); carry = false
                }
            }
            if carry { digitsArr.insert("1", at: 0) }
        }
        let intCount = digitsArr.count - digits
        var out = String(digitsArr[0..<intCount])
        if digits > 0 { out += "." + String(digitsArr[intCount...]) }
        return negative ? "-" + out : out
    }

    /// Stable sort with a JS-style comparator (negative = a first).
    public static func sorted<T>(_ array: [T], by compare: (T, T) -> Double) -> [T] {
        let indexed = array.enumerated().map { ($0.offset, $0.element) }
        return indexed.sorted { a, b in
            let c = compare(a.1, b.1)
            if c < 0 { return true }
            if c > 0 { return false }
            return a.0 < b.0
        }.map { $0.1 }
    }

    /// `String.prototype.localeCompare` for the ASCII-ish names the engines sort.
    public static func localeCompare(_ a: String, _ b: String) -> Double {
        let r = a.compare(b, options: [], range: nil, locale: Locale(identifier: "en-US"))
        switch r {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }

    public static func max(_ values: [Double]) -> Double { values.reduce(-Double.infinity) { Swift.max($0, $1) } }
    public static func min(_ values: [Double]) -> Double { values.reduce(Double.infinity) { Swift.min($0, $1) } }
}

extension Array {
    /// Stable `Array.prototype.sort` with a numeric comparator.
    public func jsSorted(_ compare: (Element, Element) -> Double) -> [Element] { JS.sorted(self, by: compare) }
    public mutating func jsSort(_ compare: (Element, Element) -> Double) { self = JS.sorted(self, by: compare) }
}
