import Foundation

// Port of src/data/coach.ts — the adaptive planner: a pure overlay that
// redistributes ±1 set per slot toward each muscle's weekly band.

public enum PlanChangeKind: String, Codable, Hashable, Sendable { case addSet = "add-set", removeSet = "remove-set" }

public struct PlanChange: Codable, Hashable, Sendable {
    public var key: String
    public var dayId: Int
    public var dayLabel: String
    public var exerciseId: String
    public var exerciseName: String
    public var kind: PlanChangeKind
    public var fromSets: Int
    public var toSets: Int
    public var muscle: MuscleGroup
    public var reason: String
}

public struct DayPlan: Codable, Hashable, Sendable {
    public var dayId: Int
    public var changes: [PlanChange]
    public var estMinutesDelta: Int
}

public struct ProgramPlan: Sendable {
    public var ready: Bool
    public var weeklyMuscleSets: [MuscleGroup: Double]
    /// Insertion order of `weeklyMuscleSets` (TS Map order).
    public var muscleOrder: [MuscleGroup]
    public var days: [Int: DayPlan]
    public var dayOrder: [Int]
    public var changes: [PlanChange]
    public var suggestions: [String]
    public static let empty = ProgramPlan(ready: false, weeklyMuscleSets: [:], muscleOrder: [], days: [:], dayOrder: [], changes: [], suggestions: [])
}

public enum Coach {
    public static let minSessionsToAdapt = 6
    static let windowDays = 28.0
    static let maxSetsAdded = 2, maxSetsRemoved = 2, minExerciseSets = 2, maxExerciseSets = 5, minDaySessions = 2
    static let highVolumeBuffer = 2.0, suggestGap = 3.0
    public static let minutesPerSet = 3
    static let durationTolerance = 0.15
    static let dayMs = 86_400_000.0

    public static func estimatedMinutesFor(_ day: WorkoutDay) -> Double {
        let sets = day.exercises.reduce(0) { $0 + Swift.max(1, $1.sets) }
        return JS.round(Double(sets * minutesPerSet) / 5) * 5
    }

    static func fmtRate(_ rate: Double) -> String {
        let r = JS.round(rate * 2) / 2
        return r == r.rounded() ? JS.string(r) : JS.toFixed(r, 1)
    }

    public static func computeProgramPlan(_ program: [WorkoutDay], _ snap: TrainingSnapshot, now: Double = LiftLogEnv.now(),
                                          phase: PhaseKind? = nil, goal: Goal? = nil, phaseOf: PlanMath.PhaseResolver? = nil,
                                          experience: ExperienceLevel? = nil, decisions: [CoachDecision] = []) -> ProgramPlan {
        let declined = Set(decisions.filter { !$0.accepted }.map(\.key))
        let sessions = snap.sessions
        if PlanMath.isEasyPhase(phase) { return .empty }
        if sessions.count < minSessionsToAdapt || program.isEmpty { return .empty }
        let band = Analytics.volumeTargetFor(goal, experience)
        let mayAddSets = goal != .sportSupport && phase != .maintenance
        let windowStart = now - windowDays * dayMs
        let windowSessions = sessions.filter { Analytics.sessionTimestamp($0) >= windowStart }
        if windowSessions.count < minDaySessions { return .empty }
        let oldestTs = windowSessions.map(Analytics.sessionTimestamp).min()!
        let weeks = Swift.min(windowDays / 7, Swift.max(1, (now - oldestTs) / (7 * dayMs)))
        let windowTotals = Analytics.muscleSetTotals(snap) { Analytics.sessionTimestamp($0) >= windowStart }
        var sessionsPerDay: [Int: Int] = [:]
        for s in windowSessions { sessionsPerDay[s.dayId, default: 0] += 1 }
        let weeklyMuscleSets = windowTotals.totals.mapValues { $0 / weeks }
        let declining = Progress.progressDirections(Progress.assessSnapshot(snap, goal ?? .general, phaseOf: phaseOf)).down
        let avgDuration = Analytics.avgDurationByDay(snap)

        func daySetsForMuscle(_ day: WorkoutDay, _ muscle: MuscleGroup) -> Double {
            var sets = 0.0
            for ex in day.exercises { if let inv = Analytics.musclesForSlot(ex).first(where: { $0.muscle == muscle }) { sets += Double(ex.sets) * inv.weight } }
            return sets
        }
        var changes: [PlanChange] = []
        var suggestions: [String] = []
        var addedMinutesByDay: [Int: Int] = [:]
        var changedExercises = Set<String>()
        var programMuscles: [MuscleGroup] = []
        for day in program { for ex in day.exercises {
            if let p = Analytics.musclesForSlot(ex).first(where: { $0.weight == 1 }), !programMuscles.contains(p.muscle) { programMuscles.append(p.muscle) }
        } }
        func dayEligible(_ id: Int) -> Bool { (sessionsPerDay[id] ?? 0) >= minDaySessions }
        func durationHeadroom(_ id: Int) -> Bool {
            guard let avg = avgDuration[id] else { return true }
            let added = Double((addedMinutesByDay[id] ?? 0) + minutesPerSet)
            return added * 60_000 <= avg * durationTolerance
        }
        let gaps = mayAddSets
            ? programMuscles.map { (muscle: $0, rate: weeklyMuscleSets[$0] ?? 0) }.filter { $0.rate < band.low }.jsSorted { $0.rate - $1.rate }
            : []
        var added = 0
        for (muscle, rate) in gaps {
            if added >= maxSetsAdded { break }
            struct Candidate { var day: WorkoutDay; var ex: Exercise; var score: Double; var primary: Bool }
            var candidates: [Candidate] = []
            var setsPerCandidate: [String: Double] = [:]
            for day in program { for ex in day.exercises {
                if let inv = Analytics.musclesForSlot(ex).first(where: { $0.muscle == muscle }) { setsPerCandidate[ex.id] = Double(ex.sets) * inv.weight }
            } }
            let maxMuscleSets = Swift.max(0, setsPerCandidate.values.max() ?? 0)
            let loads = program.filter { dayEligible($0.id) }.map { daySetsForMuscle($0, muscle) }.filter { $0 > 0 }
            let minDayLoad = loads.min() ?? 0
            for day in program {
                if !dayEligible(day.id) || !durationHeadroom(day.id) { continue }
                for ex in day.exercises {
                    let involvement = Analytics.musclesForSlot(ex)
                    guard let inv = involvement.first(where: { $0.muscle == muscle }) else { continue }
                    if ex.sets >= maxExerciseSets { continue }
                    if changedExercises.contains("\(day.id):\(ex.id)") { continue }
                    if declined.contains("\(day.id):\(ex.id):add-set") { continue }
                    var score = inv.weight
                    let others = involvement.filter { $0.muscle != muscle }
                    score -= Double(others.count) * 0.1
                    if others.contains(where: { (weeklyMuscleSets[$0.muscle] ?? 0) >= band.high }) { score -= 0.5 }
                    if setsPerCandidate[ex.id] == maxMuscleSets && maxMuscleSets > 0 { score -= 0.3 }
                    if ex.sets >= 4 { score -= 0.2 }
                    if declining.contains(ex.id) { score -= 0.3 }
                    if daySetsForMuscle(day, muscle) == minDayLoad { score += 0.15 }
                    candidates.append(Candidate(day: day, ex: ex, score: score, primary: inv.weight == 1))
                }
            }
            candidates = candidates.jsSorted { $1.score - $0.score }
            guard let best = candidates.first else {
                if band.low - rate >= suggestGap {
                    let inProgram = Set(program.flatMap { $0.exercises.map(\.id) })
                    let pool = Catalog.exercises.filter { $0.primaryMuscle == muscle && !inProgram.contains($0.id)
                        && (experience != .beginner || Catalog.difficultyFor($0.id) != .advanced) }
                    let pick = (experience == .beginner ? pool.first { Catalog.difficultyFor($0.id) == .beginner } : nil) ?? pool.first
                    if let pick {
                        let shortest = program.jsSorted { a, b in
                            Double(a.exercises.reduce(0) { $0 + $1.sets } - b.exercises.reduce(0) { $0 + $1.sets })
                        }[0]
                        suggestions.append("\(muscle.rawValue) is averaging \(fmtRate(rate)) weekly sets with no good slot to add more — consider adding \(pick.name) to \(shortest.label).")
                    }
                }
                continue
            }
            let why = best.primary ? "it trains \(muscle.rawValue) directly with little extra fatigue"
                : "it works \(muscle.rawValue) alongside its main target, so the set does double duty"
            changes.append(PlanChange(key: "\(best.day.id):\(best.ex.id):add-set", dayId: best.day.id, dayLabel: best.day.label,
                exerciseId: best.ex.id, exerciseName: best.ex.name, kind: .addSet, fromSets: best.ex.sets, toSets: best.ex.sets + 1, muscle: muscle,
                reason: "\(muscle.rawValue) is averaging \(fmtRate(rate)) weekly sets — below the \(JS.string(band.low))–\(JS.string(band.high)) target. One set added here because \(why)."))
            changedExercises.insert("\(best.day.id):\(best.ex.id)")
            addedMinutesByDay[best.day.id, default: 0] += minutesPerSet
            added += 1
        }
        let overs = windowTotals.order.map { (muscle: $0, rate: weeklyMuscleSets[$0]!) }
            .filter { $0.rate > band.high + highVolumeBuffer }.jsSorted { $1.rate - $0.rate }
        var removed = 0
        for (muscle, rate) in overs {
            if removed >= maxSetsRemoved { break }
            var best: (day: WorkoutDay, ex: Exercise)?
            for day in program where dayEligible(day.id) {
                for ex in day.exercises {
                    if ex.sets <= minExerciseSets { continue }
                    if changedExercises.contains("\(day.id):\(ex.id)") { continue }
                    if declined.contains("\(day.id):\(ex.id):remove-set") { continue }
                    if Analytics.musclesForSlot(ex).first(where: { $0.weight == 1 })?.muscle != muscle { continue }
                    if best == nil || ex.sets > best!.ex.sets { best = (day, ex) }
                }
            }
            guard let best else { continue }
            changes.append(PlanChange(key: "\(best.day.id):\(best.ex.id):remove-set", dayId: best.day.id, dayLabel: best.day.label,
                exerciseId: best.ex.id, exerciseName: best.ex.name, kind: .removeSet, fromSets: best.ex.sets, toSets: best.ex.sets - 1, muscle: muscle,
                reason: "\(muscle.rawValue) is averaging \(fmtRate(rate)) weekly sets — past the \(JS.string(band.high))-set ceiling, extra sets cost more recovery than they build. One set trimmed to keep quality high."))
            changedExercises.insert("\(best.day.id):\(best.ex.id)")
            addedMinutesByDay[best.day.id, default: 0] -= minutesPerSet
            removed += 1
        }
        var days: [Int: DayPlan] = [:], dayOrder: [Int] = []
        for c in changes {
            var dp = days[c.dayId] ?? { dayOrder.append(c.dayId); return DayPlan(dayId: c.dayId, changes: [], estMinutesDelta: 0) }()
            dp.changes.append(c)
            dp.estMinutesDelta += (c.kind == .addSet ? 1 : -1) * minutesPerSet
            days[c.dayId] = dp
        }
        return ProgramPlan(ready: true, weeklyMuscleSets: weeklyMuscleSets, muscleOrder: windowTotals.order, days: days, dayOrder: dayOrder,
                           changes: changes, suggestions: suggestions)
    }

    public static func applyPlanToDay(_ day: WorkoutDay, _ plan: ProgramPlan) -> WorkoutDay {
        guard let dp = plan.days[day.id], !dp.changes.isEmpty else { return day }
        var byEx: [String: Int] = [:]
        for c in dp.changes { byEx[c.exerciseId] = c.toSets }
        var out = day
        out.exercises = day.exercises.map { ex in var e = ex; if let t = byEx[ex.id] { e.sets = t }; return e }
        return out
    }
}
