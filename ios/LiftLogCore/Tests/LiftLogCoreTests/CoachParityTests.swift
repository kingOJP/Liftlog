import XCTest
@testable import LiftLogCore

private struct Opts: Decodable {
    var goal: Goal?, experience: ExperienceLevel?, phase: PhaseKind?, decisions: [CoachDecision]?, phased: Bool?, now: Double?
}

private struct PlanJSON: Encodable {
    var ready: Bool, changes: [PlanChange], suggestions: [String], weeklyMuscleSets: [String: Double], days: [String: DayPlan]
    init(_ p: ProgramPlan) {
        ready = p.ready; changes = p.changes; suggestions = p.suggestions
        weeklyMuscleSets = Dictionary(uniqueKeysWithValues: p.weeklyMuscleSets.map { ($0.key.rawValue, $0.value) })
        days = Dictionary(uniqueKeysWithValues: p.days.map { (String($0.key), $0.value) })
    }
}

private struct CoachingJSON: Encodable {
    var hasData: Bool, weekLabel: String, nextDay: NextDay?, muscleVolume: [MuscleVolume], progress: [ExerciseProgress]
    var highlights: [Insight], opportunities: [Insight], plan: PlanJSON
    init(_ c: Coaching) {
        hasData = c.hasData; weekLabel = c.weekLabel; nextDay = c.nextDay; muscleVolume = c.muscleVolume; progress = c.progress
        highlights = c.highlights; opportunities = c.opportunities; plan = PlanJSON(c.plan)
    }
}

private struct PlanCase: Encodable { var plan: PlanJSON; var applied: [WorkoutDay] }

final class CoachParityTests: XCTestCase {
    func testCoachParity() throws {
        let plans = try JSONDecoder().decode([TrainingPlan].self, from: Data(#"""
        [{"id":"p","goal":"hypertrophy","origin":"planned","status":"active","createdAt":1,"blocks":[{"id":"b","name":"B","focus":"hypertrophy",
        "startDate":"2026-02-09","program":[],"intent":"","progression":"","status":"active","activatedAt":1,
        "phases":["accumulation","accumulation","deload","accumulation","accumulation","accumulation"]}]}]
        """#.utf8))
        try Parity.run("coach", [
            "computeProgramPlan": { c in
                let program: [WorkoutDay] = try c.arg(0), o: Opts = try c.arg(3)
                let plan = Coach.computeProgramPlan(program, Analytics.buildSnapshot(try c.arg(1), try c.arg(2)), now: o.now ?? c.now,
                    phase: o.phase, goal: o.goal, phaseOf: o.phased == true ? PlanMath.phaseResolverFor(plans) : nil,
                    experience: o.experience, decisions: o.decisions ?? [])
                return PlanCase(plan: PlanJSON(plan), applied: program.map { Coach.applyPlanToDay($0, plan) })
            },
            "computeCoaching": { c in
                let program: [WorkoutDay] = try c.arg(0), o: Opts = try c.arg(3)
                return CoachingJSON(Insights.computeCoaching(program, Analytics.buildSnapshot(try c.arg(1), try c.arg(2)), now: o.now ?? c.now,
                    phase: o.phase, goal: o.goal ?? .general, phaseOf: o.phased == true ? PlanMath.phaseResolverFor(plans) : nil,
                    experience: o.experience, decisions: o.decisions ?? []))
            },
            "estimatedMinutesFor": { c in Coach.estimatedMinutesFor(try c.arg(0)) },
        ])
    }
}
