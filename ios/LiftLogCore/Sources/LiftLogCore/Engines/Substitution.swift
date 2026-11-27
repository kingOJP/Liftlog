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

    public static func candidateProfiles() -> [ExerciseProfile] {
        let deleted = ProgramStore.getDeletedExerciseIds()
        var seenIds = Set<String>(), seenNames = Set<String>(), out: [ExerciseProfile] = []
        for ex in ProgramStore.getExerciseLibrary() where ex.archived != true {
            seenIds.insert(ex.id); seenNames.insert(Analytics.normalizeName(ex.name))
            let p = profileFor(ex.id, ex.name)
            if p.primaryMuscle != nil { out.append(p) }
        }
        for def in Catalog.exercises where !deleted.contains(def.id) && !seenIds.contains(def.id) && !seenNames.contains(Analytics.normalizeName(def.name)) {
            let p = profileFor(def.id)
            if p.primaryMuscle != nil { out.append(p) }
        }
        return out
    }

    struct Factor { var points: Double; var reason: String? = nil; var caution: String? = nil }
    static let windowDays = 28.0, dayMs = 86_400_000.0, maxReasons = 3

    struct RankContext {
        var target: ExerciseProfile
        var targetMuscles: Set<MuscleGroup>
        var patternsInDay: Set<MovementPattern>
        var loggedIds: Set<String>
        var trendUp: Set<String>, trendDown: Set<String>
        var weeklyRate: [MuscleGroup: Double]
        var observedEquipment: Set<Equipment>
        var band: VolumeTarget
    }

    public static func suggestReplacements(_ target: Exercise, _ day: WorkoutDay, _ snap: TrainingSnapshot?, limit: Int = 3,
                                           now: Double = LiftLogEnv.now(), goal: Goal? = nil, regression: Bool = false) -> [ReplacementSuggestion] {
        let tp = profileFor(target.id, target.name)
        guard let tm = tp.primaryMuscle else { return [] }
        let ctx = buildContext(tp, day, snap, now, goal)
        let dayIds = Set(day.exercises.map(\.id))
        var suggestions: [ReplacementSuggestion] = []
        for cand in candidateProfiles() {
            if cand.id == target.id || dayIds.contains(cand.id) { continue }
            if sameLift(cand.name, target.name) { continue }
            if !([cand.primaryMuscle!] + cand.secondaryMuscles).contains(tm) { continue }
            if regression && Experience.difficultyRank[cand.difficulty]! > Experience.difficultyRank[tp.difficulty]! { continue }
            var factors = scoreCandidate(cand, ctx)
            if regression {
                factors.append(cand.weightType == .bodyweight
                    ? Factor(points: -10, caution: "Still bodyweight — no way to start lighter")
                    : Factor(points: 16, reason: "Loadable, so you can start below bodyweight and build up to the real thing"))
                if cand.primaryMuscle == tm && cand.workoutType != tp.workoutType {
                    factors.append(Factor(points: 4, reason: "Same muscle through an easier movement"))
                }
            }
            let score = factors.reduce(0) { $0 + $1.points }
            if score <= 0 { continue }
            let reasons = factors.filter { $0.reason != nil }.jsSorted { $1.points - $0.points }.prefix(maxReasons).map { $0.reason! }
            suggestions.append(ReplacementSuggestion(exercise: cand, score: score, reasons: Array(reasons), cautions: factors.compactMap(\.caution)))
        }
        suggestions = suggestions.jsSorted { a, b in
            let d = b.score - a.score
            return d != 0 ? d : JS.localeCompare(a.exercise.name, b.exercise.name)
        }
        var unique: [ReplacementSuggestion] = []
        for s in suggestions {
            if unique.contains(where: { sameLift($0.exercise.name, s.exercise.name) }) { continue }
            unique.append(s)
            if unique.count >= limit { break }
        }
        return unique
    }

    static func buildContext(_ target: ExerciseProfile, _ day: WorkoutDay, _ snap: TrainingSnapshot?, _ now: Double, _ goal: Goal?) -> RankContext {
        var patterns = Set<MovementPattern>(), equipment = Set<Equipment>()
        for ex in day.exercises {
            let p = profileFor(ex.id, ex.name)
            if let e = p.equipment { equipment.insert(e) }
            if ex.id == target.id { continue }
            if let w = p.workoutType { patterns.insert(w) }
        }
        var logged = Set<String>(), up = Set<String>(), down = Set<String>(), rate: [MuscleGroup: Double] = [:]
        if let snap {
            for logs in snap.setsBySession.values { for l in logs { logged.insert(l.exerciseId) } }
            let d = Progress.progressDirections(Progress.assessSnapshot(snap, goal ?? .general))
            up = d.up; down = d.down
            let windowStart = now - windowDays * dayMs
            let inWindow = snap.sessions.filter { Analytics.sessionTimestamp($0) >= windowStart }
            if !inWindow.isEmpty {
                let oldest = inWindow.map(Analytics.sessionTimestamp).min()!
                let weeks = Swift.min(windowDays / 7, Swift.max(1, (now - oldest) / (7 * dayMs)))
                let totals = Analytics.muscleSetTotals(snap, include: { Analytics.sessionTimestamp($0) >= windowStart }).totals
                rate = totals.mapValues { $0 / weeks }
            }
            for id in logged { if let e = profileFor(id).equipment { equipment.insert(e) } }
        }
        return RankContext(target: target, targetMuscles: Set([target.primaryMuscle!] + target.secondaryMuscles), patternsInDay: patterns,
                           loggedIds: logged, trendUp: up, trendDown: down, weeklyRate: rate, observedEquipment: equipment,
                           band: Analytics.volumeTargetFor(goal))
    }

    static func scoreCandidate(_ cand: ExerciseProfile, _ ctx: RankContext) -> [Factor] {
        let target = ctx.target, muscle = target.primaryMuscle!
        var f: [Factor] = []
        if cand.primaryMuscle == muscle {
            f.append(Factor(points: 40, reason: "Trains \(muscle.rawValue) directly, like \(target.name)"))
        } else {
            f.append(Factor(points: 12, reason: "Works \(muscle.rawValue) as a secondary mover — a lighter stimulus than \(target.name)"))
        }
        let candMuscles = Set([cand.primaryMuscle!] + cand.secondaryMuscles)
        let shared = candMuscles.filter { ctx.targetMuscles.contains($0) }.count
        let union = candMuscles.union(ctx.targetMuscles).count
        let overlap = union > 0 ? Double(shared) / Double(union) : 0
        f.append(Factor(points: JS.round(overlap * 12), reason: overlap >= 0.5 ? "Covers nearly the same muscles" : nil))
        if let w = cand.workoutType {
            if ctx.patternsInDay.contains(w) {
                f.append(Factor(points: -14, caution: "Duplicates the \(w.rawValue) pattern already in this workout"))
            } else if w == target.workoutType {
                f.append(Factor(points: 12, reason: "Same movement pattern (\(w.rawValue))"))
            } else {
                f.append(Factor(points: 4, reason: "Brings a movement pattern the day doesn't have yet"))
            }
        }
        if cand.mechanics == target.mechanics {
            f.append(Factor(points: 6, reason: cand.mechanics == .compound ? "Compound movement, matching the slot it replaces" : "Isolation movement, matching the slot it replaces"))
        }
        if let wt = cand.weightType, wt == target.weightType { f.append(Factor(points: 3)) }
        if let e = cand.equipment {
            if !ctx.observedEquipment.isEmpty && !ctx.observedEquipment.contains(e) {
                f.append(Factor(points: -8, caution: "Needs a \(e.rawValue.lowercased()) — not seen in your training yet"))
            } else if ctx.observedEquipment.contains(e) {
                f.append(Factor(points: 6))
            }
        }
        if ctx.loggedIds.contains(cand.id) {
            if ctx.trendUp.contains(cand.id) {
                f.append(Factor(points: 18, reason: "You've trained it before and your strength on it is trending up"))
            } else {
                f.append(Factor(points: 13, reason: "You've trained it before — its progression history carries straight over"))
                if ctx.trendDown.contains(cand.id) { f.append(Factor(points: -16, caution: "Your strength on it has been declining lately")) }
            }
        }
        if !ctx.weeklyRate.isEmpty {
            // TS iterates the candidate's muscle Set in insertion order: primary first, then secondaries.
            var seen = Set<MuscleGroup>()
            for m in [cand.primaryMuscle!] + cand.secondaryMuscles where seen.insert(m).inserted && !ctx.targetMuscles.contains(m) {
                let r = ctx.weeklyRate[m] ?? 0
                if r >= ctx.band.high { f.append(Factor(points: -6, caution: "Adds volume to \(m.rawValue), already at the weekly ceiling")) }
                else if r < ctx.band.low { f.append(Factor(points: 3, reason: "Bonus work for \(m.rawValue), which is under its weekly target")) }
            }
        }
        let extra = candMuscles.count - ctx.targetMuscles.count
        if extra > 0 { f.append(Factor(points: Double(-2 * extra))) }
        return f
    }

    static func sameLift(_ a: String, _ b: String) -> Bool {
        let ta = Set(Analytics.normalizeName(a).components(separatedBy: " ")), tb = Set(Analytics.normalizeName(b).components(separatedBy: " "))
        let (small, large) = ta.count <= tb.count ? (ta, tb) : (tb, ta)
        return small.allSatisfy(large.contains)
    }
}

public struct ReplacementSuggestion: Codable, Hashable, Sendable {
    public var exercise: ExerciseProfile
    public var score: Double
    public var reasons: [String]
    public var cautions: [String]
}
