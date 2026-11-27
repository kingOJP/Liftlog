import Foundation

// Port of src/data/prescribe.ts — every entry point's route to dosage.

public struct PrescribeOptions {
    public var name: String?
    public var slot: DosageSlot?
    public var snapshot: TrainingSnapshot?
    /// `.none` = use the planned goal; `.some(nil)` = explicitly no plan.
    public var goal: Goal??
    public var experience: ExperienceLevel?
    public init(name: String? = nil, slot: DosageSlot? = nil, snapshot: TrainingSnapshot? = nil,
                goal: Goal?? = .none, experience: ExperienceLevel? = nil) {
        self.name = name; self.slot = slot; self.snapshot = snapshot; self.goal = goal; self.experience = experience
    }
}

public enum Prescribe {
    static let historySessions = 4

    public static func exerciseHistory(_ exerciseId: String, _ snap: TrainingSnapshot?) -> [DosageHistorySession] {
        guard let snap else { return [] }
        var out: [DosageHistorySession] = []
        for session in snap.sessions {
            let reps = (snap.setsBySession[session.id ?? -1] ?? []).filter { $0.exerciseId == exerciseId }.map(\.reps)
            if !reps.isEmpty { out.append(DosageHistorySession(reps: reps)) }
            if out.count >= historySessions { break }
        }
        return out
    }

    public static func prescribeFor(_ exerciseId: String, _ opts: PrescribeOptions = .init()) -> RepPrescription? {
        let goal: Goal? = switch opts.goal { case .none: PlanStore.getPlannedGoal(); case .some(let g): g }
        return Dosage.resolvePrescription(
            profile: Substitution.profileFor(exerciseId, opts.name), slot: opts.slot, goal: goal,
            experience: opts.experience ?? Experience.effectiveExperience(PlanStore.getProfileOrDefault(), opts.snapshot),
            history: exerciseHistory(exerciseId, opts.snapshot))
    }

    public static func slotFor(_ exerciseId: String, _ name: String, _ opts: PrescribeOptions = .init()) -> Exercise {
        var o = opts; o.name = name
        let dose = prescribeFor(exerciseId, o)
        var ex = Exercise(id: exerciseId, name: name, sets: dose?.sets ?? 3)
        if let d = dose, let lo = d.repLow, let hi = d.repHigh { ex.repLow = lo; ex.repHigh = hi }
        if let src = dose?.source { ex.rangeSource = src }
        return ex
    }
}
