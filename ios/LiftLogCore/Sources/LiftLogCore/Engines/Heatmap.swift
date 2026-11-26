import Foundation

// Port of src/data/heatmap.ts — per-muscle weekly set rates over a window,
// time-range presets, the body-half split insight and the heat colour scale.

public struct MuscleHeat: Codable, Hashable, Sendable { public var sets: Double; public var weeklyRate: Double }

public struct HeatmapData: Sendable {
    public var byMuscle: [MuscleGroup: MuscleHeat]
    public var weeks: Double
}

public struct TimeWindow: Codable, Hashable, Sendable { public var from: Double; public var to: Double }

public enum HeatPreset: String, Codable, CaseIterable, Hashable, Sendable { case d7 = "7d", d30 = "30d", meso, custom }

public struct HeatRange: Codable, Hashable, Sendable {
    public var preset: HeatPreset
    public var customFrom: String
    public var customTo: String
}

public struct HeatPresetCopy: Codable, Hashable, Sendable {
    public var id: HeatPreset, label: String, menu: String, phrase: String, priorPhrase: String, vsLabel: String
}

public enum BodyHalf: String, Codable, Hashable, Sendable { case lower, upper, core }

public struct SplitInsight: Codable, Hashable, Sendable {
    public var half: BodyHalf
    public var pct: Double
    public var deltaPts: Double?
    public var untrained: [MuscleGroup]
}

public enum Heatmap {
    static let dayMs = 86_400_000.0
    public static let mesocycleDays = 28.0

    public static func computeMuscleHeat(_ snap: TrainingSnapshot, _ fromTs: Double, _ toTs: Double) -> HeatmapData {
        let weeks = Swift.max((toTs - fromTs) / (7 * dayMs), 1.0 / 7)
        let totals = Analytics.muscleSetTotals(snap) { s in
            let ts = Analytics.sessionTimestamp(s); return ts >= fromTs && ts <= toTs
        }.totals
        return HeatmapData(byMuscle: totals.mapValues { MuscleHeat(sets: $0, weeklyRate: $0 / weeks) }, weeks: weeks)
    }

    public static func mesocycleWindow(_ now: Double = LiftLogEnv.now()) -> TimeWindow {
        let start = SettingsStore.getProgramStart()
        let cycle = mesocycleDays * dayMs
        if now < start { return TimeWindow(from: now - cycle, to: now) }
        return TimeWindow(from: start + ((now - start) / cycle).rounded(.down) * cycle, to: now)
    }

    public static func presetWindow(_ preset: HeatPreset, _ now: Double = LiftLogEnv.now()) -> TimeWindow {
        switch preset {
        case .d7: return TimeWindow(from: now - 7 * dayMs, to: now)
        case .d30: return TimeWindow(from: now - 30 * dayMs, to: now)
        case .meso, .custom: return mesocycleWindow(now)
        }
    }

    public static let heatPresets: [HeatPresetCopy] = [
        .init(id: .d7, label: "7 Days", menu: "Last 7 days", phrase: "the last 7 days", priorPhrase: "the 7 days before", vsLabel: "vs prior 7 days"),
        .init(id: .d30, label: "30 Days", menu: "Last 30 days", phrase: "the last 30 days", priorPhrase: "the 30 days before", vsLabel: "vs prior 30 days"),
        .init(id: .meso, label: "Mesocycle", menu: "This mesocycle", phrase: "this mesocycle", priorPhrase: "the same stretch before it", vsLabel: "vs prior stretch"),
        .init(id: .custom, label: "Custom", menu: "Custom range", phrase: "this range", priorPhrase: "the same-length range before it", vsLabel: "vs prior range"),
    ]
    public static func presetCopy(_ p: HeatPreset) -> HeatPresetCopy { heatPresets.first { $0.id == p }! }

    public static func dateInputValue(_ ts: Double) -> String {
        let p = JSDate.parts(ts)
        return String(format: "%04d-%02d-%02d", p.year, p.month + 1, p.day)
    }

    static func fromDateInput(_ value: String, _ endOfDay: Bool) -> Double {
        let n = value.split(separator: "-").map { Int($0) ?? 0 }
        return endOfDay ? JSDate.make(n[0], n[1] - 1, n[2], 23, 59, 59) : JSDate.make(n[0], n[1] - 1, n[2])
    }

    public static func defaultHeatRange(_ now: Double = LiftLogEnv.now()) -> HeatRange {
        HeatRange(preset: .d30, customFrom: dateInputValue(now - 30 * dayMs), customTo: dateInputValue(now))
    }

    public static func rangeWindow(_ range: HeatRange, _ now: Double = LiftLogEnv.now()) -> TimeWindow {
        if range.preset != .custom { return presetWindow(range.preset, now) }
        let (first, last) = range.customFrom <= range.customTo ? (range.customFrom, range.customTo) : (range.customTo, range.customFrom)
        return TimeWindow(from: fromDateInput(first, false), to: fromDateInput(last, true))
    }

    public static func previousWindow(_ w: TimeWindow) -> TimeWindow { TimeWindow(from: w.from - (w.to - w.from), to: w.from) }

    public static let bodyHalfLabel: [BodyHalf: String] = [.lower: "lower body", .upper: "upper body", .core: "core"]

    public static func bodyHalfFor(_ m: MuscleGroup) -> BodyHalf {
        let r = Taxonomy.regionFor(m)
        return r == .legs ? .lower : r == .core ? .core : .upper
    }

    public static func volumeSplit(_ heat: HeatmapData) -> [BodyHalf: Double]? {
        var sets: [BodyHalf: Double] = [.lower: 0, .upper: 0, .core: 0]
        var total = 0.0
        for (m, h) in heat.byMuscle { sets[bodyHalfFor(m), default: 0] += h.sets; total += h.sets }
        if total <= 0 { return nil }
        return sets.mapValues { $0 / total }
    }

    /// Ties in `untrained` break by muscle name (TS breaks them by Map insertion order).
    public static func splitInsight(_ current: HeatmapData, _ previous: HeatmapData?) -> SplitInsight? {
        guard let now = volumeSplit(current) else { return nil }
        let half: BodyHalf = now[.lower]! >= now[.upper]! ? .lower : .upper
        let before = previous.flatMap(volumeSplit)
        let untrained = (previous?.byMuscle ?? [:])
            .filter { m, h in h.sets > 0 && (current.byMuscle[m]?.sets ?? 0) <= 0 }
            .sorted { $0.value.sets != $1.value.sets ? $0.value.sets > $1.value.sets : $0.key.rawValue < $1.key.rawValue }
            .map(\.key)
        let pct = JS.round(now[half]! * 100)
        return SplitInsight(half: half, pct: pct, deltaPts: before.map { pct - JS.round($0[half]! * 100) }, untrained: untrained)
    }

    static let heatNone = "#2E3754", heatTarget = "#3897F0", heatElevated = "#5D5DFA", heatHigh = "#835EFB"
    public static let heatLegendGradient =
        "linear-gradient(90deg, \(heatNone) 0%, \(heatTarget) 50%, \(heatTarget) 72%, \(heatElevated) 88%, \(heatHigh) 100%)"

    static func overshoot(_ band: VolumeTarget) -> Double { Swift.max(3, JS.round((band.high - band.low) * 0.6)) }

    static func stopsFor(_ band: VolumeTarget) -> [(Double, String)] {
        let o = overshoot(band)
        return [(0, heatNone), (band.low, heatTarget), (band.high, heatTarget), (band.high + o, heatElevated), (band.high + o * 2, heatHigh)]
    }

    static func hexToRgb(_ hex: String) -> [Double] {
        let c = Array(hex)
        return [1, 3, 5].map { Double(Int(String(c[$0...($0 + 1)]), radix: 16)!) }
    }

    static func mix(_ a: String, _ b: String, _ t: Double) -> String {
        let x = hexToRgb(a), y = hexToRgb(b)
        let c = (0..<3).map { JS.string(JS.round(x[$0] + (y[$0] - x[$0]) * t)) }
        return "rgb(\(c[0]), \(c[1]), \(c[2]))"
    }

    public static func heatColor(_ weeklyRate: Double, _ band: VolumeTarget = Analytics.defaultVolumeTarget) -> String {
        let stops = stopsFor(band)
        if weeklyRate <= stops[0].0 { return stops[0].1 }
        for i in 1..<stops.count where weeklyRate <= stops[i].0 {
            return mix(stops[i - 1].1, stops[i].1, (weeklyRate - stops[i - 1].0) / (stops[i].0 - stops[i - 1].0))
        }
        return stops[stops.count - 1].1
    }

    public static func heatLabel(_ weeklyRate: Double, _ band: VolumeTarget = Analytics.defaultVolumeTarget) -> String {
        if weeklyRate <= 0 { return "No recent training" }
        if weeklyRate < band.low { return "Below target" }
        if weeklyRate <= band.high { return "On target" }
        if weeklyRate <= band.high + overshoot(band) { return "Elevated" }
        return "Very high — watch recovery"
    }
}
