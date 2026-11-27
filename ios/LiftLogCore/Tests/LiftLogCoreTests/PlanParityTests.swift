import XCTest
@testable import LiftLogCore

final class PlanParityTests: XCTestCase {
    func testPlanParity() throws {
        try Parity.run("plan", [
            "tables": { _ in obj([
                "GOALS": PlanMath.goals, "EXPERIENCE_LEVELS": PlanMath.experienceLevels,
                "EQUIPMENT_ACCESS": PlanMath.equipmentAccess, "RACE_PROXIMITY": PlanMath.raceProximity,
                "ENDURANCE_LOADS": PlanMath.enduranceLoads, "DISCIPLINES": PlanMath.disciplines,
                "INJURY_AREAS": PlanMath.injuryAreas,
                "PHASE_INFO": Dictionary(uniqueKeysWithValues: PhaseKind.allCases.map { ($0.rawValue, PlanMath.phaseInfo($0)) }),
            ]) },
            "goalLabel": { c in PlanMath.goalLabel(try c.arg(0)) },
            "experienceLabel": { c in PlanMath.experienceLabel(try c.arg(0)) },
            "proximityLabel": { c in PlanMath.proximityLabel(try c.arg(0)) },
            "enduranceHours": { c in PlanMath.enduranceHours(try c.arg(0)) },
            "phaseFlags": { c in
                let p: PhaseKind? = try c.arg(0)
                return obj(["easy": PlanMath.isEasyPhase(p), "opener": p.map(PlanMath.isOpenerPhase).json])
            },
            "parsePlanDate": { c in PlanMath.parsePlanDate(try c.arg(0)).json },
            "dates": { c in
                let ts: Double = try c.arg(0)
                return obj(["plan": PlanMath.toPlanDate(ts), "monday": PlanMath.mondayOf(ts), "next": PlanMath.nextMonday(ts)])
            },
            "blockStatic": { c in
                let b: TrainingBlock = try c.arg(0)
                return obj(["len": PlanMath.blockLengthWeeks(b).json, "end": PlanMath.blockEndTs(b).json])
            },
            "blockAt": { c in
                let b: TrainingBlock = try c.arg(0); let ts: Double = try c.arg(1)
                return obj(["week": PlanMath.blockWeekIndex(b, ts), "ended": PlanMath.blockEnded(b, ts),
                            "phase": PlanMath.blockPhaseAt(b, ts).json, "current": PlanMath.currentPhase(b, ts).json])
            },
            "phaseResolverFor": { c in
                let r = PlanMath.phaseResolverFor(try c.arg(0)); let ts: [Double] = try c.arg(1)
                return ts.map { r($0) }
            },
            "validatePhases": { c in
                let p: [PhaseKind] = try c.arg(0)
                return obj(["err": PlanMath.validatePhases(p).json, "productive": PlanMath.productiveWeeks(p)])
            },
            "defaults": { _ in obj(["sport": PlanMath.defaultSportContext(), "profile": PlanMath.defaultTrainingProfile()]) },
        ])
    }
}
