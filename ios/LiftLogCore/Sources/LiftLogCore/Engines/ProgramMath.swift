import Foundation

// Port of src/data/program.ts (labels, Monday-anchored week math) and
// src/data/settings.ts (program start, rest duration).

public enum ProgramMath {
    public static let seedProgram: [WorkoutDay] = {
        try! JSONDecoder().decode([WorkoutDay].self, from: Data(CatalogData.seedProgramJSON.utf8))
    }()

    public static func dayInPhase(_ day: WorkoutDay, _ phase: PhaseKind?) -> Bool {
        guard let phases = day.phases, !phases.isEmpty else { return true }
        guard let phase else { return true }
        return phases.contains(phase)
    }

    public static func rangeLabel(_ lo: Int, _ hi: Int) -> String { lo == hi ? "\(lo)" : "\(lo)–\(hi)" }

    public static func prescriptionLabel(sets: Int, repLow: Int?, repHigh: Int?) -> String {
        if let lo = repLow, let hi = repHigh { return "\(sets) × \(rangeLabel(lo, hi))" }
        return "\(sets) set\(sets == 1 ? "" : "s")"
    }
    public static func prescriptionLabel(_ ex: Exercise) -> String { prescriptionLabel(sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh) }

    public static func prescriptionDetail(_ ex: Exercise) -> String {
        let sets = "\(ex.sets) set\(ex.sets == 1 ? "" : "s")"
        var base = sets
        if let lo = ex.repLow, let hi = ex.repHigh { base = "\(sets) · \(rangeLabel(lo, hi)) reps" }
        if let v = Variations.variationLabel(SetVariation(technique: ex.technique, grip: ex.grip)) { base = "\(base) · \(v)" }
        return ex.progression == .manual ? "\(base) · your own progression" : base
    }

    public static func startOfWeek(_ ts: Double) -> Double {
        let p = JSDate.parts(ts)
        return JSDate.make(p.year, p.month, p.day - (p.weekday == 0 ? 6 : p.weekday - 1))
    }

    public static func addWeeks(_ weekStart: Double, _ n: Int) -> Double { JSDate.addDays(weekStart, n * 7) }

    public static func weeksBetween(_ a: Double, _ b: Double) -> Int { Int(JS.round((b - a) / (7 * 86_400_000))) }

    public static func toLocalDateValue(_ ts: Double) -> String {
        let p = JSDate.parts(ts)
        return String(format: "%04d-%02d-%02d", p.year, p.month + 1, p.day)
    }

    public static func shortDateLabel(_ ts: Double) -> String {
        let p = JSDate.parts(ts)
        return "\(p.month + 1)/\(p.day)"
    }
    public static func weekStartLabel(_ ts: Double) -> String { shortDateLabel(ts) }

    public static func getWeekNumberForDate(_ ts: Double, programStart: Double? = nil) -> Int {
        let start = startOfWeek(programStart ?? SettingsStore.getProgramStart())
        let days = JS.round((JSDate.startOfDay(ts) - start) / 86_400_000)
        return Swift.max(1, Int((days / 7).rounded(.down)) + 1)
    }

    public static func getWeekNumber() -> Int { getWeekNumberForDate(LiftLogEnv.now()) }

    public static func getWeekDateRange() -> String {
        let monday = startOfWeek(LiftLogEnv.now())
        let sunday = JSDate.addDays(monday, 6)
        let m = JSDate.parts(monday), s = JSDate.parts(sunday)
        if m.month == s.month { return "\(JSDate.monthName(monday)) \(m.day)–\(s.day)" }
        return "\(JSDate.monthName(monday)) \(m.day)–\(JSDate.monthName(sunday)) \(s.day)"
    }
}

public enum SettingsStore {
    public static let restPresets = [60, 120, 180, 300]
    public static let defaultRestSeconds = 120
    static let restKey = "liftlog_rest_seconds"

    static func load() -> Settings { LiftLogEnv.store.getJSON(Settings.self, StorageKey.settings) ?? Settings() }

    /// yyyy-mm-dd → local-midnight timestamp, rejecting rolled-over dates (2026-13-01).
    public static func parseLocalDate(_ value: String) -> Double? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCIIDigit) }),
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        let ts = JSDate.make(y, m - 1, d)
        let p = JSDate.parts(ts)
        return p.year == y && p.month == m - 1 && p.day == d ? ts : nil
    }

    public static func getProgramStartValue() -> String {
        var s = load()
        if let v = s.programStart, parseLocalDate(v) != nil { return v }
        let today = ProgramMath.toLocalDateValue(LiftLogEnv.now())
        s.programStart = today
        LiftLogEnv.store.setJSON(s, StorageKey.settings)
        return today
    }

    public static func getProgramStart() -> Double { parseLocalDate(getProgramStartValue())! }

    @discardableResult
    public static func saveProgramStart(_ value: String) -> Bool {
        guard parseLocalDate(value) != nil else { return false }
        var s = load(); s.programStart = value
        LiftLogEnv.store.setJSON(s, StorageKey.settings)
        return true
    }

    public static func getRestDuration() -> Int {
        guard let raw = LiftLogEnv.store.getItem(restKey), let n = Double(raw.trimmingCharacters(in: .whitespaces)),
              restPresets.contains(where: { Double($0) == n }) else { return defaultRestSeconds }
        return Int(n)
    }

    public static func saveRestDuration(_ seconds: Int) { LiftLogEnv.store.setItem(restKey, String(seconds)) }
}

extension Character { var isASCIIDigit: Bool { isASCII && isNumber } }
