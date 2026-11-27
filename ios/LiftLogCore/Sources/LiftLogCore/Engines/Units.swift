// Port of src/data/units.ts. Storage is ALWAYS lbs; kg is a display/input
// preference only (liftlog_weight_unit).

public enum WeightUnit: String, Codable, Hashable, Sendable { case lb, kg }

public enum Units {
    public static let lbPerKg = 2.20462

    public static func getWeightUnit() -> WeightUnit {
        LiftLogEnv.store.getItem(StorageKey.weightUnit) == "kg" ? .kg : .lb
    }

    public static func saveWeightUnit(_ unit: WeightUnit) {
        LiftLogEnv.store.setItem(StorageKey.weightUnit, unit.rawValue)
    }

    public static func toDisplay(_ lbs: Double, _ unit: WeightUnit? = nil) -> Double {
        if (unit ?? getWeightUnit()) == .lb { return lbs }
        return JS.round((lbs / lbPerKg) * 10) / 10
    }

    public static func fromDisplay(_ value: Double, _ unit: WeightUnit? = nil) -> Double {
        if (unit ?? getWeightUnit()) == .lb { return value }
        return JS.round(value * lbPerKg * 4) / 4
    }

    public static func unitLabelFor(_ unit: WeightUnit? = nil) -> String {
        (unit ?? getWeightUnit()) == .kg ? "kg" : "lbs"
    }

    public static func fmtWeight(_ lbs: Double, _ unit: WeightUnit? = nil) -> String {
        let u = unit ?? getWeightUnit()
        return "\(JS.string(toDisplay(lbs, u))) \(unitLabelFor(u))"
    }
}
