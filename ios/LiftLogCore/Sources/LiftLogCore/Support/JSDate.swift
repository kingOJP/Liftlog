import Foundation

/// Local-time calendar arithmetic with JavaScript `Date` semantics:
/// `new Date(y, m, d, h, mi, s, ms)` with overflowing fields normalized,
/// `getDay()/getDate()/...` in the local zone, a skipped (spring-forward)
/// wall time resolving forward and a repeated one resolving to its first
/// occurrence. All timestamps are milliseconds since the epoch.
public struct LocalParts: Equatable {
    public var year: Int, month: Int, day: Int   // month is 0-based like JS
    public var hours: Int, minutes: Int, seconds: Int, ms: Int
    public var weekday: Int                       // 0 = Sunday
}

public enum JSDate {
    static func offsetMs(at ts: Double, _ tz: TimeZone) -> Double {
        Double(tz.secondsFromGMT(for: Date(timeIntervalSince1970: ts / 1000))) * 1000
    }

    /// Days since 1970-01-01 for a proleptic Gregorian civil date (any overflow in month/day allowed).
    static func daysFromCivil(_ y0: Int, _ m0: Int, _ d: Int) -> Int {
        // normalize month first (JS MakeDay)
        let y = y0 + Int((Double(m0) / 12).rounded(.down))
        let m = ((m0 % 12) + 12) % 12 + 1
        let yy = m <= 2 ? y - 1 : y
        let era = (yy >= 0 ? yy : yy - 399) / 400
        let yoe = yy - era * 400
        let mp = (m + 9) % 12
        let doy = (153 * mp + 2) / 5
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468 + (d - 1)
    }

    static func civilFromDays(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m - 1, d)
    }

    /// `new Date(year, month, day, h, mi, s, ms).getTime()` in `LiftLogEnv.timeZone`.
    public static func make(_ year: Int, _ month: Int, _ day: Int, _ h: Int = 0, _ mi: Int = 0, _ s: Int = 0, _ ms: Int = 0,
                            tz: TimeZone = LiftLogEnv.timeZone) -> Double {
        let days = Double(daysFromCivil(year, month, day))
        let localAsUTC = days * 86_400_000 + Double(h) * 3_600_000 + Double(mi) * 60_000 + Double(s) * 1000 + Double(ms)
        let before = offsetMs(at: localAsUTC - 86_400_000, tz)
        let after = offsetMs(at: localAsUTC + 86_400_000, tz)
        if before == after { return localAsUTC - before }
        let c1 = localAsUTC - before, c2 = localAsUTC - after
        let v1 = offsetMs(at: c1, tz) == before, v2 = offsetMs(at: c2, tz) == after
        if v1 && v2 { return Swift.min(c1, c2) }
        if v1 { return c1 }
        if v2 { return c2 }
        return c1 // skipped wall time: interpret with the pre-transition offset (moves forward)
    }

    public static func parts(_ ts: Double, tz: TimeZone = LiftLogEnv.timeZone) -> LocalParts {
        let local = ts + offsetMs(at: ts, tz)
        let days = Int((local / 86_400_000).rounded(.down))
        var rem = Int(local - Double(days) * 86_400_000)
        let (y, m, d) = civilFromDays(days)
        let h = rem / 3_600_000; rem -= h * 3_600_000
        let mi = rem / 60_000; rem -= mi * 60_000
        let s = rem / 1000; rem -= s * 1000
        let wd = ((days % 7) + 7 + 4) % 7 // 1970-01-01 was a Thursday
        return LocalParts(year: y, month: m, day: d, hours: h, minutes: mi, seconds: s, ms: rem, weekday: wd)
    }

    /// `d.setHours(0,0,0,0)` → timestamp of local midnight of the day containing `ts`.
    public static func startOfDay(_ ts: Double) -> Double {
        let p = parts(ts)
        return make(p.year, p.month, p.day)
    }

    /// `d.setDate(d.getDate() + n)` keeping the wall-clock time.
    public static func addDays(_ ts: Double, _ n: Int) -> Double {
        let p = parts(ts)
        return make(p.year, p.month, p.day + n, p.hours, p.minutes, p.seconds, p.ms)
    }

    static let monthNames = ["January", "February", "March", "April", "May", "June", "July",
                             "August", "September", "October", "November", "December"]
    static let shortMonthNames = monthNames.map { String($0.prefix(3)) }

    public static func monthName(_ ts: Double) -> String { monthNames[parts(ts).month] }
    public static func shortMonthName(_ ts: Double) -> String { shortMonthNames[parts(ts).month] }
}
