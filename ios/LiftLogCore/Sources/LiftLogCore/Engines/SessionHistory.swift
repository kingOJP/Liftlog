import Foundation

// Port of src/data/sessionHistory.ts — how the prescription engine reads an
// exercise's past: like-for-like by rep style and grip.

public struct ExerciseHistory: Hashable, Sendable {
    public var history: [ExerciseSession]
    public var borrowed: Bool
}

public enum SessionHistory {
    public static func expectedVariation(_ ex: Exercise, _ snap: TrainingSnapshot?) -> SetVariation {
        if ex.technique != nil || ex.grip != nil { return Variations.styleOf(SetVariation(technique: ex.technique, grip: ex.grip)) }
        guard let snap else { return SetVariation() }
        for session in snap.sessions {
            let sets = (snap.setsBySession[session.id ?? -1] ?? [])
                .filter { $0.exerciseId == ex.id && !Variations.isExtension($0.technique) }
            if sets.isEmpty { continue }
            return dominantVariation(sets)
        }
        return SetVariation()
    }

    static func dominantVariation(_ sets: [SetLog]) -> SetVariation {
        var keys: [String] = [], counts: [String: (n: Int, v: SetVariation)] = [:]
        for s in sets {
            let v = Variations.styleOf(s), k = Variations.variationKey(v)
            if counts[k] != nil { counts[k]!.n += 1 } else { keys.append(k); counts[k] = (1, v) }
        }
        var best: (n: Int, v: SetVariation)?
        for k in keys { let e = counts[k]!; if best == nil || e.n > best!.n { best = e } }
        return best?.v ?? SetVariation()
    }

    public static func exerciseHistory(_ snap: TrainingSnapshot, _ exerciseId: String, _ depth: Int,
                                       _ positions: [Int: [String: Int]], _ variation: SetVariation) -> ExerciseHistory {
        let matched = collect(snap, exerciseId, depth, positions) {
            Variations.sameVariation(SetVariation(technique: $0.technique, grip: $0.grip), variation)
        }
        if !matched.isEmpty || !Variations.hasVariation(variation) { return ExerciseHistory(history: matched, borrowed: false) }
        let plain = collect(snap, exerciseId, depth, positions) { _ in true }
        return ExerciseHistory(history: plain, borrowed: !plain.isEmpty)
    }

    static func collect(_ snap: TrainingSnapshot, _ exerciseId: String, _ depth: Int,
                        _ positions: [Int: [String: Int]], _ keep: (SetLog) -> Bool) -> [ExerciseSession] {
        var history: [ExerciseSession] = []
        for session in snap.sessions {
            let sets = (snap.setsBySession[session.id ?? -1] ?? [])
                .filter { $0.exerciseId == exerciseId && !Variations.isExtension($0.technique) && keep($0) }
                .jsSorted { Double($0.setNumber - $1.setNumber) }
                .map { s -> LoggedSet in
                    s.repLow != nil && s.repHigh != nil
                        ? LoggedSet(weight: s.weight, reps: s.reps, repLow: s.repLow, repHigh: s.repHigh)
                        : LoggedSet(weight: s.weight, reps: s.reps)
                }
            if !sets.isEmpty {
                history.append(ExerciseSession(completedAt: Analytics.sessionTimestamp(session), sets: sets,
                                               position: session.id.flatMap { positions[$0]?[exerciseId] }))
            }
            if history.count >= depth { break }
        }
        return history
    }
}
