import XCTest
@testable import LiftLogCore

private struct GuidanceJSON: Encodable {
    var bannedWeightTypes: [String], bannedEquipment: [String], avoidPatterns: [String], avoidNameParts: [String], notes: [String]
    init(_ g: Guidance) {
        bannedWeightTypes = g.bannedWeightTypes.map(\.rawValue).sorted()
        bannedEquipment = g.bannedEquipment.map(\.rawValue).sorted()
        avoidPatterns = g.avoidPatterns.map(\.rawValue).sorted()
        avoidNameParts = g.avoidNameParts; notes = g.notes
    }
}

final class SportsPlannerParityTests: XCTestCase {
    func testSportsParity() throws {
        try Parity.run("sports", [
            "nigglesFor": { c in Sports.nigglesFor(try c.arg(0)) },
            "niggleLabel": { c in Sports.niggleLabel(try c.arg(0)) },
            "sportMeta": { c in Sports.sportMeta(try c.arg(0)) },
            "eventsFor": { c in Sports.eventsFor(try c.arg(0)) },
            "eventMeta": { c in Sports.eventMeta(try c.arg(0)) },
            "defaultEventFor": { c in Sports.defaultEventFor(try c.arg(0)) },
            "liftBudget": { c in Sports.liftBudget(try c.arg(0), try c.arg(1), try c.arg(2)) },
            "buildSportPhases": { c in Sports.buildSportPhases(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "buildSportPlan": { c in
                let band: VolumeTarget? = try c.arg(3)
                return Sports.buildSportPlan(try c.arg(0), try c.arg(1), try c.arg(2), band: band ?? Analytics.volumeTargetFor(.sportSupport))
            },
        ])
    }

    func testPlannerParity() throws {
        try Parity.run("planner", [
            "defaultBlockWeeks": { _ in Planner.defaultBlockWeeks() },
            "parseGuidance": { c in GuidanceJSON(Planner.parseGuidance(try c.arg(0))) },
            "applyInjuryArea": { c in
                var g = Planner.parseGuidance(try c.arg(0))
                for a in try c.arg(1, [InjuryArea].self) { Planner.applyInjuryArea(&g, a) }
                return GuidanceJSON(g)
            },
            "introWeeksFor": { c in Planner.introWeeksFor(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "stimulusChange": { c in Planner.stimulusChange(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "buildPhases": { c in
                let change: StimulusChange? = try c.arg(2)
                return Planner.buildPhases(try c.arg(0), try c.arg(1), change ?? StimulusChange())
            },
            "sessionBudgetFor": { c in Planner.sessionBudgetFor(try c.arg(0), try c.arg(1), try c.arg(2)) },
            "buildPlanProposal": { c in
                let s: [Session]? = try c.arg(2), l: [SetLog]? = try c.arg(3)
                let snap = s.flatMap { s in l.map { Analytics.buildSnapshot(s, $0) } }
                return Planner.buildPlanProposal(try c.arg(0), try c.arg(1), snap, try c.arg(4))
            },
        ])
    }
}
