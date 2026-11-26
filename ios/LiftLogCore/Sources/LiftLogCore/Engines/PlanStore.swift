import Foundation

// Port of the read side of src/data/planStore.ts (the journey document).

public enum PlanStore {
    public static func emptyState() -> PlanState { PlanState(version: 1, plans: [], updatedAt: 0) }

    public static func getPlanState() -> PlanState {
        guard let s = LiftLogEnv.store.getJSON(PlanState.self, StorageKey.plan), s.version == 1 else { return emptyState() }
        return s
    }

    public static func planStateHasContent(_ s: PlanState) -> Bool {
        !s.plans.isEmpty || s.profile != nil || (s.strength.map { !$0.maxes.isEmpty || !$0.goals.isEmpty } ?? false)
    }

    public static func getTrainingProfile() -> TrainingProfile? { getPlanState().profile }
    public static func getProfileOrDefault() -> TrainingProfile { getPlanState().profile ?? PlanMath.defaultTrainingProfile() }
    public static func hasOnboarded() -> Bool { getPlanState().profile != nil }

    public static func getStrengthState() -> StrengthState { getPlanState().strength ?? StrengthState(maxes: [], goals: []) }
    public static func getOneRepMax(_ id: String) -> OneRepMax? { getStrengthState().maxes.first { $0.exerciseId == id } }
    public static func getStrengthGoal(_ id: String) -> StrengthGoal? { getStrengthState().goals.first { $0.exerciseId == id } }

    public static func getActivePlan() -> TrainingPlan? { getPlanState().plans.first { $0.status == .active } }
    public static func getActiveBlockInfo() -> (plan: TrainingPlan, block: TrainingBlock)? {
        guard let plan = getActivePlan(), let block = plan.blocks.first(where: { $0.status == .active }) else { return nil }
        return (plan, block)
    }
    public static func getActivePhase(_ now: Double = LiftLogEnv.now()) -> PhaseKind? {
        getActiveBlockInfo().flatMap { PlanMath.currentPhase($0.block, now) }
    }
    public static func getPhaseResolver() -> PlanMath.PhaseResolver { PlanMath.phaseResolverFor(getPlanState().plans) }

    public static func planHasChosenGoal(_ plan: TrainingPlan) -> Bool {
        plan.origin == .planned || plan.blocks.contains { $0.openEnded != true }
    }
    public static func getPlannedGoal() -> Goal? {
        let s = getPlanState()
        if let active = s.plans.first(where: { $0.status == .active }), planHasChosenGoal(active) { return active.goal }
        return s.pendingActivation?.goal
    }
    public static func getTrainingGoal() -> Goal { getPlannedGoal() ?? .general }
}
