import Foundation

// Port of the pure helpers in src/data/plan.ts — label tables, block calendar
// math, phase resolution and phase validation.

public struct LabeledOption: Codable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let blurb: String
    public let hours: Double?
}
public struct PhaseInfo: Codable, Hashable, Sendable { public let label: String; public let blurb: String }

public enum PlanMath {
    struct Tables: Decodable {
        let GOALS, EXPERIENCE_LEVELS, EQUIPMENT_ACCESS, RACE_PROXIMITY, ENDURANCE_LOADS, DISCIPLINES, INJURY_AREAS: [LabeledOption]
        let PHASE_INFO: [String: PhaseInfo]
    }
    static let tables: Tables = try! JSONDecoder().decode(Tables.self, from: Data(CatalogData.planTablesJSON.utf8))

    public static var goals: [LabeledOption] { tables.GOALS }
    public static var experienceLevels: [LabeledOption] { tables.EXPERIENCE_LEVELS }
    public static var equipmentAccess: [LabeledOption] { tables.EQUIPMENT_ACCESS }
    public static var raceProximity: [LabeledOption] { tables.RACE_PROXIMITY }
    public static var enduranceLoads: [LabeledOption] { tables.ENDURANCE_LOADS }
    public static var disciplines: [LabeledOption] { tables.DISCIPLINES }
    public static var injuryAreas: [LabeledOption] { tables.INJURY_AREAS }
    public static func phaseInfo(_ p: PhaseKind) -> PhaseInfo { tables.PHASE_INFO[p.rawValue]! }

    public static func goalLabel(_ g: Goal) -> String { goals.first { $0.id == g.rawValue }?.label ?? g.rawValue }
    public static func experienceLabel(_ x: ExperienceLevel) -> String { experienceLevels.first { $0.id == x.rawValue }?.label ?? x.rawValue }
    public static func proximityLabel(_ p: RaceProximity) -> String { raceProximity.first { $0.id == p.rawValue }?.label ?? p.rawValue }
    public static func enduranceHours(_ l: EnduranceLoad) -> Double { enduranceLoads.first { $0.id == l.rawValue }?.hours ?? 5.5 }

    public static func isEasyPhase(_ p: PhaseKind?) -> Bool { p == .deload || p == .recovery || p == .raceWeek || p == .intro }
    public static func isOpenerPhase(_ p: PhaseKind) -> Bool { p == .intro || p == .recovery }

    static let dayMs = 86_400_000.0

    public static func parsePlanDate(_ v: String) -> Double? { SettingsStore.parseLocalDate(v) }
    public static func toPlanDate(_ ts: Double) -> String { ProgramMath.toLocalDateValue(ts) }
    public static func mondayOf(_ ts: Double) -> Double { ProgramMath.startOfWeek(ts) }
    public static func blockAnchor(startDate: String) -> Double { mondayOf(parsePlanDate(startDate) ?? LiftLogEnv.now()) }
    public static func blockAnchor(_ b: TrainingBlock) -> Double { blockAnchor(startDate: b.startDate) }
    public static func nextMonday(_ now: Double = LiftLogEnv.now()) -> String { toPlanDate(JSDate.addDays(mondayOf(now), 7)) }

    public static func blockWeekIndex(_ b: TrainingBlock, _ now: Double = LiftLogEnv.now()) -> Int {
        let days = JS.round((JSDate.startOfDay(now) - blockAnchor(b)) / dayMs)
        return Int((days / 7).rounded(.down))
    }
    public static func blockLengthWeeks(_ b: TrainingBlock) -> Int? { b.openEnded == true ? nil : b.phases.count }
    public static func blockEnded(_ b: TrainingBlock, _ now: Double = LiftLogEnv.now()) -> Bool {
        b.openEnded == true ? false : blockWeekIndex(b, now) >= b.phases.count
    }
    public static func blockEndTs(_ b: TrainingBlock) -> Double? {
        b.openEnded == true ? nil : ProgramMath.addWeeks(blockAnchor(b), b.phases.count)
    }

    public typealias PhaseResolver = (Double) -> PhaseKind?

    public static func blockPhaseAt(_ b: TrainingBlock, _ ts: Double) -> PhaseKind? {
        if b.status == .pending { return nil }
        if ts < blockAnchor(b) { return nil }
        if b.openEnded == true { return b.completedAt != nil && ts > b.completedAt! ? nil : .accumulation }
        let w = blockWeekIndex(b, ts)
        return w >= 0 && w < b.phases.count ? b.phases[w] : nil
    }

    public static func phaseResolverFor(_ plans: [TrainingPlan]) -> PhaseResolver {
        let blocks = plans.flatMap(\.blocks).filter { $0.status != .pending }
            .jsSorted { blockAnchor($1) - blockAnchor($0) }
        return { ts in
            for b in blocks { if let p = blockPhaseAt(b, ts) { return p } }
            return nil
        }
    }
    public static func blockPhaseResolver(_ b: TrainingBlock) -> PhaseResolver { { blockPhaseAt(b, $0) } }

    public static func currentPhase(_ b: TrainingBlock, _ now: Double = LiftLogEnv.now()) -> PhaseKind? {
        let w = blockWeekIndex(b, now)
        if w < 0 { return nil }
        if b.openEnded == true { return .accumulation }
        return w < b.phases.count ? b.phases[w] : nil
    }

    public static let minProductiveWeeksBeforeDeload = 3
    public static let maxBlockWeeks = 12
    public static let maxOpenerWeeks = 2
    public static let maxTaperWeeks = 2

    public static func productiveWeeks(_ phases: [PhaseKind]) -> Int { phases.filter { !isEasyPhase($0) }.count }

    public static func validatePhases(_ phases: [PhaseKind]) -> String? {
        if phases.isEmpty { return "A block needs at least one week." }
        if phases.count > maxBlockWeeks {
            return "Blocks longer than \(maxBlockWeeks) weeks outrun any plan — split this into two blocks."
        }
        guard let firstHard = phases.firstIndex(where: { !isOpenerPhase($0) }) else {
            return "A block needs at least one week of real training."
        }
        if phases[firstHard...].contains(where: isOpenerPhase) {
            return "Intro and recovery weeks only make sense at the start of a block, before the training proper."
        }
        if firstHard > maxOpenerWeeks {
            return "More than \(maxOpenerWeeks) easy opening weeks stops being an introduction and starts being the block."
        }
        let raceWeeks = phases.filter { $0 == .raceWeek }.count
        if raceWeeks > 1 { return "One race week per block — a second race needs its own block." }
        if raceWeeks == 1 && phases.last != .raceWeek {
            return "Race week is the last week of the block — nothing gets programmed past the start line."
        }
        let deloads = phases.filter { $0 == .deload }.count
        if deloads > maxTaperWeeks {
            return "More than \(maxTaperWeeks) easy weeks in a row stops being a taper and starts being detraining."
        }
        if deloads > 0, let at = phases.firstIndex(of: .deload) {
            let tail = Array(phases[at...])
            let raceTail = raceWeeks == 1 && tail.last == .raceWeek
            let shouldBeDeload = raceTail ? Array(tail.dropLast()) : tail
            if !shouldBeDeload.allSatisfy({ $0 == .deload }) {
                return "Deload weeks close the block — training on tired legs after an easy week wastes both."
            }
            if productiveWeeks(Array(phases[..<at])) < minProductiveWeeksBeforeDeload {
                return "A deload needs at least \(minProductiveWeeksBeforeDeload) productive weeks before it — there's no fatigue to shed yet."
            }
        }
        return nil
    }

    public static func generatePlanId() -> String { UUID().uuidString.lowercased() }

    public static func defaultSportContext() -> SportContext {
        SportContext(sport: .triathlon, event: .triOlympic, proximity: .none, load: .moderate, weakLink: .even, niggles: [])
    }

    public static func defaultTrainingProfile() -> TrainingProfile {
        let json = #"{"injuries":"","equipment":"full-gym","daysPerWeek":3,"experience":"beginner","priorityMuscles":[],"updatedAt":0}"#
        return try! JSONDecoder().decode(TrainingProfile.self, from: Data(json.utf8))
    }
}
