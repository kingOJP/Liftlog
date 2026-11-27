// Port of src/data/variations.ts — set-variation vocabulary, options and the
// muscle-emphasis shift table.

public struct Involvement: Codable, Hashable, Sendable {
    public var muscle: MuscleGroup
    public var weight: Double
    public init(muscle: MuscleGroup, weight: Double) { self.muscle = muscle; self.weight = weight }
}

public struct TechniqueInfo: Codable, Hashable, Sendable { public let label: String; public let short: String; public let blurb: String }
public struct GripInfo: Codable, Hashable, Sendable { public let label: String; public let short: String }

public enum Variations {
    public static let repStyles: [SetTechnique] = [.paused, .tempo, .deficit]
    public static let setExtensions: [SetTechnique] = [.drop, .restPause, .partials]
    public static let setTechniques: [SetTechnique] = repStyles + setExtensions
    public static let grips: [Grip] = [.close, .wide, .neutral, .underhand, .overhand, .mixed]
    public static let extensionSetCredit = 0.5

    public static func techniqueInfo(_ t: SetTechnique) -> TechniqueInfo {
        switch t {
        case .paused: TechniqueInfo(label: "Paused", short: "paused", blurb: "A dead stop at the bottom — no stretch reflex, so the same load buys fewer reps.")
        case .tempo: TechniqueInfo(label: "Tempo", short: "tempo", blurb: "A slow, controlled lowering (3–4 s down) — more time under tension per rep.")
        case .deficit: TechniqueInfo(label: "Deficit", short: "deficit", blurb: "From a plate or block — a longer range of motion and a harder start.")
        case .drop: TechniqueInfo(label: "Drop set", short: "drop", blurb: "Straight into a lighter weight with no rest — a continuation of the set before it.")
        case .restPause: TechniqueInfo(label: "Rest-pause", short: "rest-pause", blurb: "A short breath (10–20 s) and more reps at the same weight.")
        case .partials: TechniqueInfo(label: "Partials", short: "partials", blurb: "Reps through part of the range, usually once full reps run out.")
        }
    }

    public static func gripInfo(_ g: Grip) -> GripInfo {
        switch g {
        case .close: GripInfo(label: "Close", short: "close grip")
        case .wide: GripInfo(label: "Wide", short: "wide grip")
        case .neutral: GripInfo(label: "Neutral", short: "neutral grip")
        case .underhand: GripInfo(label: "Underhand", short: "underhand")
        case .overhand: GripInfo(label: "Overhand", short: "overhand")
        case .mixed: GripInfo(label: "Mixed", short: "mixed grip")
        }
    }

    public static func isExtension(_ t: SetTechnique?) -> Bool { t.map(setExtensions.contains) ?? false }
    public static func isRepStyle(_ t: SetTechnique?) -> Bool { t.map(repStyles.contains) ?? false }

    /// The like-for-like comparison key of a set: rep style + grip (extensions are not a style).
    public static func styleOf(technique: String?, grip: String?) -> SetVariation {
        let t = technique.flatMap(SetTechnique.init(rawValue:))
        return SetVariation(technique: isRepStyle(t) ? t : nil, grip: grip.flatMap(Grip.init(rawValue:)))
    }
    public static func styleOf(_ v: SetVariation) -> SetVariation { styleOf(technique: v.technique?.rawValue, grip: v.grip?.rawValue) }
    public static func styleOf(_ s: SetLog) -> SetVariation { styleOf(technique: s.technique?.rawValue, grip: s.grip?.rawValue) }

    public static func variationKey(_ v: SetVariation?) -> String {
        guard let v else { return "" }
        let k = "\(v.technique?.rawValue ?? "")|\(v.grip?.rawValue ?? "")"
        return k == "|" ? "" : k
    }

    public static func sameVariation(_ a: SetVariation?, _ b: SetVariation?) -> Bool {
        variationKey(styleOf(a ?? SetVariation())) == variationKey(styleOf(b ?? SetVariation()))
    }

    public static func hasVariation(_ v: SetVariation?) -> Bool { v.map { $0.technique != nil || $0.grip != nil } ?? false }

    public static func variationLabel(_ v: SetVariation?) -> String? {
        guard let v else { return nil }
        var parts: [String] = []
        if let t = v.technique { parts.append(techniqueInfo(t).short) }
        if let g = v.grip { parts.append(gripInfo(g).short) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    public static func setCredit(_ technique: String?) -> Double {
        isExtension(technique.flatMap(SetTechnique.init(rawValue:))) ? extensionSetCredit : 1
    }
    public static func setCredit(_ technique: SetTechnique?) -> Double { setCredit(technique?.rawValue) }

    public static func countsForStrength(_ technique: String?) -> Bool {
        !isExtension(technique.flatMap(SetTechnique.init(rawValue:)))
    }
    public static func countsForStrength(_ technique: SetTechnique?) -> Bool { countsForStrength(technique?.rawValue) }

    public static func gripOptionsFor(_ pattern: MovementPattern?) -> [Grip] {
        switch pattern {
        case .horizontalPress?, .verticalPress?: [.close, .wide, .neutral]
        case .row?, .pullDown?, .pullUp?: [.close, .wide, .neutral, .underhand, .overhand]
        case .curl?: [.close, .wide, .neutral, .overhand]
        case .hipHinge?: [.overhand, .mixed]
        case .shrug?: [.wide]
        case .tricepExtension?: [.underhand]
        default: []
        }
    }

    static let deficitPatterns: [MovementPattern] = [.hipHinge, .lunge, .horizontalPress]

    public static func techniqueOptionsFor(_ pattern: MovementPattern?, unit: MeasureUnit = .reps) -> [SetTechnique] {
        if unit == .seconds { return [] }
        var out: [SetTechnique] = [.paused, .tempo]
        if let p = pattern, deficitPatterns.contains(p) { out.append(.deficit) }
        return out
    }

    public static func extensionOptionsFor(unit: MeasureUnit = .reps) -> [SetTechnique] {
        unit == .seconds ? [] : setExtensions
    }

    static let shiftCap = 0.75
    typealias Shift = (muscle: MuscleGroup, delta: Double)

    static func gripShifts(_ p: MovementPattern, _ g: Grip) -> [Shift] {
        switch (p, g) {
        case (.horizontalPress, .close), (.horizontalPress, .neutral), (.verticalPress, .close), (.verticalPress, .neutral):
            [(.triceps, 0.25)]
        case (.horizontalPress, .wide), (.verticalPress, .wide): [(.triceps, -0.25)]
        case (.row, .underhand): [(.lats, 0.25), (.biceps, 0.25)]
        case (.row, .close), (.row, .neutral): [(.lats, 0.25)]
        case (.row, .wide): [(.lats, -0.25), (.delts, 0.25)]
        case (.pullDown, .wide), (.pullUp, .wide): [(.biceps, -0.25)]
        case (.pullDown, .close), (.pullDown, .neutral), (.pullDown, .underhand),
             (.pullUp, .close), (.pullUp, .neutral), (.pullUp, .underhand): [(.biceps, 0.25)]
        case (.curl, .neutral), (.curl, .overhand), (.hipHinge, .overhand): [(.forearms, 0.5)]
        case (.shrug, .wide): [(.upperBack, 0.25)]
        default: []
        }
    }

    static func techniqueShifts(_ p: MovementPattern, _ t: SetTechnique) -> [Shift] {
        switch (p, t) {
        case (.hipHinge, .deficit): [(.quads, 0.5), (.lowerBack, 0.25)]
        case (.lunge, .deficit): [(.glutes, 0.25)]
        default: []
        }
    }

    public static func adjustInvolvement(_ base: [Involvement], _ pattern: MovementPattern?, _ variation: SetVariation?) -> [Involvement] {
        guard let pattern, let variation else { return base }
        let shifts = (variation.grip.map { gripShifts(pattern, $0) } ?? [])
            + (variation.technique.map { techniqueShifts(pattern, $0) } ?? [])
        if shifts.isEmpty { return base }
        let primary = base.first(where: { $0.weight == 1 })?.muscle
        var out = base
        for (muscle, delta) in shifts {
            if muscle == primary { continue }
            if let i = out.firstIndex(where: { $0.muscle == muscle }) {
                out[i].weight = Swift.min(shiftCap, Swift.max(0, out[i].weight + delta))
            } else if delta > 0 {
                out.append(Involvement(muscle: muscle, weight: Swift.min(shiftCap, delta)))
            }
        }
        return out.filter { $0.weight > 0 }
    }
}
