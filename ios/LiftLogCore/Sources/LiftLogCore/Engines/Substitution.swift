import Foundation

// Port of src/data/substitution.ts — exercise profile normalization (the
// ranking engine lands with the Phase 1c port).

public enum Mechanics: String, Codable, Hashable, Sendable { case compound, isolation }

public struct ExerciseProfile: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var primaryMuscle: MuscleGroup?
    public var secondaryMuscles: [MuscleGroup]
    public var workoutType: MovementPattern?
    public var equipment: Equipment?
    public var weightType: WeightType?
    public var mechanics: Mechanics
    public var difficulty: ExerciseDifficulty
    public var prerequisites: [String]
    public var unit: MeasureUnit
}

public enum Substitution {
    static let compoundPatterns: Set<MovementPattern> = [
        .carry, .dip, .hipHinge, .hipThrust, .horizontalPress, .jump, .legPress, .lunge, .pullDown, .pullUp, .row, .squat, .verticalPress,
    ]

    public static func profileFor(_ id: String, _ fallbackName: String? = nil) -> ExerciseProfile {
        let r = Analytics.resolveExerciseIdentity(id, fallbackName)
        let name = Catalog.exerciseMap[id]?.name ?? fallbackName ?? Catalog.catalogDefFor(id)?.name ?? id
        return ExerciseProfile(
            id: id, name: name, primaryMuscle: r.primaryMuscle, secondaryMuscles: r.secondaryMuscles.compactMap { $0 },
            workoutType: r.workoutType, equipment: r.equipment, weightType: r.weightType,
            mechanics: r.workoutType.map(compoundPatterns.contains) == true ? .compound : .isolation,
            difficulty: Catalog.difficultyFor(id), prerequisites: Catalog.prerequisitesFor(id), unit: Catalog.unitFor(id))
    }
}
