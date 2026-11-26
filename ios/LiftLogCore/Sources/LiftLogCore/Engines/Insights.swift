import Foundation

// Port of src/data/insights.ts — the Coach card: weekly muscle volume vs the
// goal's band, per-lift progress, highlights, opportunities and the next day.

public enum VolumeStatus: String, Codable, Hashable, Sendable { case low, optimal, high }

public struct MuscleVolume: Codable, Hashable, Sendable {
    public var muscle: MuscleGroup
    public var sets: Double
    public var status: VolumeStatus
    public var inProgram: Bool
}

public enum InsightKind: String, Codable, Hashable, Sendable {
    case pr, trendUp = "trend-up", volumeUp = "volume-up", consistency
    case trendDown = "trend-down", plateau, volumeHigh = "volume-high", programGap = "program-gap"
}

public struct Insight: Codable, Hashable, Sendable {
    public var kind: InsightKind
    public var priority: Double
    public var title: String
    public var detail: String
    public var exerciseId: String?
    public var exerciseName: String?
}

public struct NextDay: Codable, Hashable, Sendable {
    public var dayId: Int
    public var label: String
    public var muscleGroups: String
    public var lastTrained: Double?
}

public struct Coaching: Sendable {
    public var hasData: Bool
    public var weekLabel: String
    public var nextDay: NextDay?
    public var muscleVolume: [MuscleVolume]
    public var progress: [ExerciseProgress]
    public var highlights: [Insight]
    public var opportunities: [Insight]
    public var plan: ProgramPlan
}

public enum Insights {
    static let maxHighlights = 3, maxOpportunities = 3
    static let prRecentDays = 10.0, volumeUpPct = 5.0, dayMs = 86_400_000.0

    static func volumeStatus(_ sets: Double, _ band: VolumeTarget) -> VolumeStatus {
        sets < band.low ? .low : sets > band.high ? .high : .optimal
    }

    static func capitalize(_ s: String) -> String { s.isEmpty ? s : s.prefix(1).uppercased() + s.dropFirst() }
    static func formatSets(_ s: Double) -> String { s == s.rounded() ? JS.string(s) : JS.toFixed(s, 1) }

    public static func computeCoaching(_ program: [WorkoutDay], _ snap: TrainingSnapshot, now: Double = LiftLogEnv.now(),
                                       phase: PhaseKind? = nil, goal: Goal = .general, phaseOf: PlanMath.PhaseResolver? = nil,
                                       experience: ExperienceLevel? = nil, decisions: [CoachDecision] = []) -> Coaching {
        let sessions = snap.sessions
        let plan = Coach.computeProgramPlan(program, snap, now: now, phase: phase, goal: goal, phaseOf: phaseOf, experience: experience, decisions: decisions)
        let currentWeekStart = ProgramMath.startOfWeek(now)
        let band = Analytics.volumeTargetFor(goal, experience)
        let scheduled = program.filter { ProgramMath.dayInPhase($0, phase) }
        if sessions.isEmpty || snap.setsBySession.isEmpty {
            return Coaching(hasData: false, weekLabel: "", nextDay: nextDayFromProgram(scheduled, sessions), muscleVolume: [], progress: [],
                            highlights: [], opportunities: [], plan: plan)
        }
        let weeksWithData = Set(sessions.map(Analytics.sessionWeekStart)).sorted(by: >)
        let coachWeek = weeksWithData.contains(currentWeekStart) ? currentWeekStart : (weeksWithData.first ?? currentWeekStart)
        let weekLabel = coachWeek == currentWeekStart ? "This week" : "Week of \(ProgramMath.weekStartLabel(coachWeek))"
        let vol = Analytics.muscleSetTotals(snap) { Analytics.sessionWeekStart($0) == coachWeek }
        var programMuscles: [MuscleGroup] = []
        for day in program { for ex in day.exercises {
            if let m = Analytics.primaryMuscleFor(ex.id), !programMuscles.contains(m) { programMuscles.append(m) }
        } }
        var muscles: [MuscleGroup] = []
        for m in vol.order + programMuscles where !muscles.contains(m) { muscles.append(m) }
        let muscleVolume = muscles.map { m -> MuscleVolume in
            let sets = JS.round((vol.totals[m] ?? 0) * 2) / 2
            return MuscleVolume(muscle: m, sets: sets, status: volumeStatus(sets, band), inProgram: programMuscles.contains(m))
        }.jsSorted { $1.sets - $0.sets }
        let progress = Progress.assessSnapshot(snap, goal, phaseOf: phaseOf).values.sorted { a, b in
            a.totalSessions != b.totalSessions ? a.totalSessions > b.totalSessions
                : JS.localeCompare(a.name, b.name) != 0 ? JS.localeCompare(a.name, b.name) < 0 : a.exerciseId < b.exerciseId
        }
        let programIds = Set(program.flatMap { $0.exercises.map(\.id) })
        var highlights: [Insight] = []
        for p in progress where programIds.contains(p.exerciseId) {
            let fresh = p.recentPRs.filter { now - $0.ts <= prRecentDays * dayMs }
            if fresh.isEmpty { continue }
            highlights.append(Insight(kind: .pr, priority: Double(100 + fresh.count), title: "New \(p.name) PR",
                detail: "\(fresh[0].label)\(fresh.count > 1 ? " — plus \(fresh.count - 1) more" : ""). That's the progression working.",
                exerciseId: p.exerciseId, exerciseName: p.name))
        }
        for p in progress where p.status == .progressing && programIds.contains(p.exerciseId) {
            highlights.append(Insight(kind: .trendUp, priority: 80 + p.score * 20, title: "\(p.name) is climbing",
                detail: "\(capitalize(p.evidence.prefix(2).joined(separator: "; "))) — keep riding this progression.",
                exerciseId: p.exerciseId, exerciseName: p.name))
        }
        var weekVolume: [Double: Double] = [:]
        for s in sessions {
            let v = (snap.setsBySession[s.id ?? -1] ?? []).reduce(0) { $0 + $1.weight * $1.reps }
            weekVolume[Analytics.sessionWeekStart(s), default: 0] += v
        }
        let thisWeekVol = weekVolume[coachWeek] ?? 0
        let lastWeekVol = weekVolume[ProgramMath.addWeeks(coachWeek, -1)] ?? 0
        if lastWeekVol > 0 && thisWeekVol > lastWeekVol * (1 + volumeUpPct / 100) {
            let pct = JS.round((thisWeekVol - lastWeekVol) / lastWeekVol * 100)
            highlights.append(Insight(kind: .volumeUp, priority: 60, title: "Training volume is rising",
                detail: "\(weekLabel)'s total volume is up \(JS.string(pct))% on last week — progressive overload in action."))
        }
        let recentCount = sessions.filter { now - Analytics.sessionTimestamp($0) <= 7 * dayMs }.count
        if recentCount > 0 && recentCount >= Swift.min(program.count, 3) {
            highlights.append(Insight(kind: .consistency, priority: 50, title: "\(recentCount) workouts in the last 7 days",
                detail: "Showing up is the biggest driver of long-term progress — this streak is doing more than any single set."))
        }
        var opportunities: [Insight] = []
        for p in progress where programIds.contains(p.exerciseId) && p.totalSessions >= Progress.minTrendSessions {
            if p.status == .declining {
                opportunities.append(Insight(kind: .trendDown, priority: 90 + abs(p.score) * 20, title: "\(p.name) is trending down",
                    detail: "\(capitalize(p.evidence.prefix(2).joined(separator: "; "))). Prioritize recovery — sleep and food — and hold volume at target rather than pushing load.",
                    exerciseId: p.exerciseId, exerciseName: p.name))
            } else if p.status == .stalled {
                opportunities.append(Insight(kind: .plateau, priority: 70, title: "\(p.name) has stalled",
                    detail: "No weight or rep PRs and \(p.evidence.prefix(2).joined(separator: ", ")) across your last \(p.sessions) sessions. If it doesn't move next session, the coach will recommend a deload — that's the plan working, not a setback.",
                    exerciseId: p.exerciseId, exerciseName: p.name))
            }
        }
        for mv in muscleVolume where mv.status == .high && mv.inProgram {
            opportunities.append(Insight(kind: .volumeHigh, priority: 60 + (mv.sets - band.high), title: "\(mv.muscle.rawValue) volume is running hot",
                detail: "\(formatSets(mv.sets)) weekly sets — past the \(JS.string(band.high))-set ceiling, extra sets mostly cost recovery. The coach will trim volume here if it persists."))
        }
        for s in plan.suggestions { opportunities.append(Insight(kind: .programGap, priority: 65, title: "Program gap", detail: s)) }
        highlights = highlights.jsSorted { $1.priority - $0.priority }
        opportunities = opportunities.jsSorted { $1.priority - $0.priority }
        return Coaching(hasData: true, weekLabel: weekLabel, nextDay: nextDayFromProgram(scheduled, sessions), muscleVolume: muscleVolume,
                        progress: progress, highlights: Array(highlights.prefix(maxHighlights)),
                        opportunities: Array(opportunities.prefix(maxOpportunities)), plan: plan)
    }

    static func nextDayFromProgram(_ program: [WorkoutDay], _ completed: [Session]) -> NextDay? {
        if program.isEmpty { return nil }
        var lastByDay: [Int: Double] = [:]
        for s in completed { let ts = s.completedAt ?? 0; if ts > (lastByDay[s.dayId] ?? 0) { lastByDay[s.dayId] = ts } }
        var latestIdx = -1, latestTs = 0.0
        for (i, d) in program.enumerated() { let ts = lastByDay[d.id] ?? 0; if ts > latestTs { latestTs = ts; latestIdx = i } }
        let day = latestIdx >= 0 ? program[(latestIdx + 1) % program.count] : program[0]
        return NextDay(dayId: day.id, label: day.label, muscleGroups: day.muscleGroups, lastTrained: lastByDay[day.id])
    }
}
