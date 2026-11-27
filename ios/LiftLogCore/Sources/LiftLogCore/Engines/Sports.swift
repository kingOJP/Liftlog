import Foundation

// Mirrors src/data/sports.ts — the research layer behind the 'sport-support'
// goal: day templates, event profiles, the interference budget, sport phases
// and niggle routing. Pure functions; parity fixture `sports`.

public struct SlotDose: Codable, Hashable, Sendable {
    public var sets: Int
    public var repLow: Int
    public var repHigh: Int
    public init(sets: Int, repLow: Int, repHigh: Int) { self.sets = sets; self.repLow = repLow; self.repHigh = repHigh }
}

public struct Slot: Codable, Hashable, Sendable {
    public var muscle: MuscleGroup
    public var patterns: [MovementPattern]?
    public var mechanics: Mechanics?
    public var main: Bool?
    public var heavy: Bool?
    public var reuse: Bool?
    public var preferIds: [String]?
    public var dose: SlotDose?
    public var why: String?

    public init(muscle: MuscleGroup, patterns: [MovementPattern]? = nil, mechanics: Mechanics? = nil, main: Bool? = nil,
                heavy: Bool? = nil, reuse: Bool? = nil, preferIds: [String]? = nil, dose: SlotDose? = nil, why: String? = nil) {
        self.muscle = muscle; self.patterns = patterns; self.mechanics = mechanics; self.main = main; self.heavy = heavy
        self.reuse = reuse; self.preferIds = preferIds; self.dose = dose; self.why = why
    }

    var isMain: Bool { main == true }
    func has(_ p: MovementPattern) -> Bool { patterns?.contains(p) ?? false }
}

public struct DayTemplate: Codable, Hashable, Sendable {
    public var title: String
    public var slots: [Slot]
    public var phases: [PhaseKind]?
    public var minLiftDays: Int?
    public init(title: String, slots: [Slot], phases: [PhaseKind]? = nil, minLiftDays: Int? = nil) {
        self.title = title; self.slots = slots; self.phases = phases; self.minLiftDays = minLiftDays
    }
}

public struct Niggle: Codable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var blurb: String
    public var sports: [SportId]?
}

public struct SportMeta: Codable, Hashable, Sendable {
    public var id: SportId
    public var label: String
    public var blurb: String
}

public struct EventProfile: Codable, Hashable, Sendable {
    public var mainReps: [Int]
    public var plyometrics: Bool
    public var volumeScale: Double
    public var emphases: [MuscleGroup]
    public var rationale: String
}

public struct SportEventMeta: Codable, Hashable, Sendable {
    public var id: SportEvent
    public var sport: SportId
    public var label: String
    public var blurb: String
    public var profile: EventProfile
}

public struct LiftBudget: Codable, Hashable, Sendable {
    public var days: Int
    public var maxWeeklySets: Int
    public var warning: String?
}

public struct SportPhases: Codable, Hashable, Sendable {
    public var phases: [PhaseKind]
    public var notes: [String]
    public var warnings: [String]
}

public struct SportPlan: Codable, Hashable, Sendable {
    public var splitName: String
    public var splitReason: String
    public var days: [DayTemplate]
    public var budget: LiftBudget
    public var rationale: [String]
    public var warnings: [String]
}

public enum Sports {
    static let buildPhases: [PhaseKind] = [.intro, .recovery, .accumulation, .intensification, .peak]
    static let throughMaintenance: [PhaseKind] = buildPhases + [.maintenance]

    // ── Niggles ──
    public static let niggles: [Niggle] = [
        Niggle(id: "achilles", label: "Achilles or calf", blurb: "Swaps to heavy-slow calf loading and drops the jumping"),
        Niggle(id: "knee", label: "Knee (runner's knee / ITB)", blurb: "Trims deep-knee loading, prioritises hip abduction and tempo"),
        Niggle(id: "back", label: "Low back or hip", blurb: "Drops barbell hinges and axial loading for supported work"),
        Niggle(id: "shoulder", label: "Shoulder", blurb: "No overhead pressing; rotation and posterior-cuff work stays", sports: [.triathlon]),
    ]

    public static func nigglesFor(_ sport: SportId) -> [Niggle] { niggles.filter { $0.sports == nil || $0.sports!.contains(sport) } }
    public static func niggleLabel(_ id: String) -> String { niggles.first { $0.id == id }?.label ?? id }

    // ── Sports ──
    public static let sports: [SportMeta] = [
        SportMeta(id: .triathlon, label: "Triathlon", blurb: "Swim, bike and run — the plan covers all three plus the durability they demand"),
        SportMeta(id: .running, label: "Running", blurb: "5k to marathon — tendon stiffness, pelvic stability and eccentric control"),
    ]
    public static func sportMeta(_ id: SportId) -> SportMeta { sports.first { $0.id == id } ?? sports[0] }
    public static func sportLabel(_ id: SportId) -> String { sportMeta(id).label }

    // ── Events ──
    public static let sportEvents: [SportEventMeta] = [
        SportEventMeta(id: .triSprint, sport: .triathlon, label: "Sprint",
            blurb: "750m / 20k / 5k — strength and power transfer strongly",
            profile: EventProfile(mainReps: [4, 6], plyometrics: true, volumeScale: 1, emphases: [.quads],
                rationale: "Sprint distance is short and hard, so maximal strength and rate of force development transfer directly. Main lifts stay heavy at 4–6 reps and the power session earns its place.")),
        SportEventMeta(id: .triOlympic, sport: .triathlon, label: "Olympic",
            blurb: "1.5k / 40k / 10k — moderate volume, real room for strength work",
            profile: EventProfile(mainReps: [4, 6], plyometrics: true, volumeScale: 1, emphases: [.quads, .hamstrings],
                rationale: "Olympic distance still rewards heavy strength work, and your weekly sport hours leave room for it. Main lifts run at 4–6 reps.")),
        SportEventMeta(id: .triHalf, sport: .triathlon, label: "Half (70.3)",
            blurb: "1.9k / 90k / 21k — lifting shifts toward durability",
            profile: EventProfile(mainReps: [5, 8], plyometrics: false, volumeScale: 0.85, emphases: [.calves, .abductors],
                rationale: "At half distance your legs are already absorbing a lot of eccentric load, so the plyometrics come out and the lifting shifts toward durability — calves and hip stability first, at 5–8 reps.")),
        SportEventMeta(id: .triFull, sport: .triathlon, label: "Full (140.6)",
            blurb: "3.8k / 180k / 42k — minimum effective dose only",
            profile: EventProfile(mainReps: [6, 8], plyometrics: false, volumeScale: 0.7, emphases: [.calves, .abductors, .hamstrings],
                rationale: "Full distance means the training itself is the limiter. Lifting drops to a minimum effective dose at 6–8 reps, aimed squarely at the tissues that break down over an Ironman — calves, hamstrings and hip stabilisers.")),
        SportEventMeta(id: .run5k, sport: .running, label: "5k",
            blurb: "Short and fast — heavy strength and plyometrics pay off most here",
            profile: EventProfile(mainReps: [4, 6], plyometrics: true, volumeScale: 1, emphases: [.calves, .quads],
                rationale: "5k racing is run close to your ceiling, which is exactly where heavy strength work and plyometrics buy the most: better running economy and a stronger finishing kick. Main lifts stay at 4–6 reps.")),
        SportEventMeta(id: .run10k, sport: .running, label: "10k",
            blurb: "Strength and economy, with slightly more mileage to respect",
            profile: EventProfile(mainReps: [4, 6], plyometrics: true, volumeScale: 0.95, emphases: [.calves, .hamstrings],
                rationale: "10k still rewards maximal strength and elastic return, so the heavy work and the power session both stay. Volume comes down a touch to respect the extra mileage.")),
        SportEventMeta(id: .runHalf, sport: .running, label: "Half marathon",
            blurb: "Economy plus durability — the tissues need to last",
            profile: EventProfile(mainReps: [5, 8], plyometrics: false, volumeScale: 0.85, emphases: [.calves, .hamstrings, .abductors],
                rationale: "Half-marathon training piles up eccentric load, so the jumping comes out and heavy-slow calf, hamstring and hip-abduction work comes in. Main lifts run at 5–8 reps.")),
        SportEventMeta(id: .runFull, sport: .running, label: "Marathon",
            blurb: "Injury-proofing first — the mileage is the training",
            profile: EventProfile(mainReps: [6, 8], plyometrics: false, volumeScale: 0.7, emphases: [.calves, .hamstrings, .abductors],
                rationale: "Marathon mileage is the training; lifting exists to keep you intact through it. No jumping, a minimum effective dose at 6–8 reps, and the volume that remains goes to calves, hamstrings and hip stabilisers — where marathon injuries actually happen.")),
    ]

    public static func eventsFor(_ sport: SportId) -> [SportEventMeta] { sportEvents.filter { $0.sport == sport } }
    public static func eventMeta(_ id: SportEvent) -> SportEventMeta { sportEvents.first { $0.id == id } ?? sportEvents[0] }
    public static func defaultEventFor(_ sport: SportId) -> SportEvent { sport == .running ? .run10k : .triOlympic }

    // ── Interference budget ──
    static func daysByLoad(_ l: EnduranceLoad) -> Int { switch l { case .low, .moderate: 3; case .high, .veryHigh: 2 } }
    static func setsByLoad(_ l: EnduranceLoad) -> Double { switch l { case .low: 42; case .moderate: 38; case .high: 28; case .veryHigh: 24 } }

    public static func liftBudget(_ ctx: SportContext, _ requestedDays: Int, _ experience: ExperienceLevel = .intermediate) -> LiftBudget {
        let event = eventMeta(ctx.event).profile
        var days = min(requestedDays, daysByLoad(ctx.load))
        var maxWeeklySets = Int(JS.round(setsByLoad(ctx.load) * event.volumeScale))
        if experience == .beginner {
            days = min(days, 2)
            maxWeeklySets = min(maxWeeklySets, 26)
        }
        let warning = days < requestedDays
            ? "You asked for \(requestedDays) lifting days, but at \(loadLabel(ctx.load)) of \(sportLabel(ctx.sport).lowercased()) a week the plan uses \(days). "
              + "Lifting that costs you a quality session in your sport is a net loss — the extra day is better spent recovering."
            : nil
        return LiftBudget(days: days, maxWeeklySets: maxWeeklySets, warning: warning)
    }

    static func loadLabel(_ load: EnduranceLoad) -> String {
        let h = PlanMath.enduranceHours(load)
        return h >= 12 ? "12+ hours" : h >= 8 ? "8–11 hours" : h >= 4 ? "4–7 hours" : "under 4 hours"
    }

    // ── Phase layout ──
    public static func buildSportPhases(_ weeks: Double, _ proximity: RaceProximity, _ sport: SportId, _ introWeeks: Int = 0) -> SportPhases {
        var notes: [String] = [], warnings: [String] = []
        let label = sportLabel(sport).lowercased()
        let total = min(PlanMath.maxBlockWeeks, max(2, Int(JS.round(weeks))))
        let intro = min(introWeeks, PlanMath.maxOpenerWeeks, max(0, total - 2))

        let wantedTaper = proximity == .soon ? PlanMath.maxTaperWeeks : proximity == .mid ? 1 : 0
        var deload = wantedTaper
        while deload > 0 && total - intro - deload < PlanMath.minProductiveWeeksBeforeDeload { deload -= 1 }
        let productive = total - intro - deload

        let buildShare = proximity == .soon ? 0.25 : proximity == .mid ? 0.6 : 1
        let build = max(1, min(productive, Int(JS.round(Double(productive) * buildShare))))
        let maintain = productive - build

        var phases: [PhaseKind] = []
        for _ in 0..<max(0, intro) { phases.append(.intro) }
        for i in 0..<max(0, build) { phases.append(i == 0 ? .accumulation : .intensification) }
        for _ in 0..<max(0, maintain) { phases.append(.maintenance) }
        for _ in 0..<max(0, deload) { phases.append(.deload) }

        if intro > 0 {
            notes.append("Week\(intro > 1 ? "s 1–\(intro)" : " 1") \(intro > 1 ? "are" : "is") an introduction — same movements, easy loads. "
                + "Adding lifting to an endurance week is a new stress in itself; the first week is for learning the lifts, not testing them.")
        }
        let buildFrom = intro + 1
        notes.append("Weeks \(buildFrom)–\(intro + build) carry the strength work — heavy, low-volume, well short of failure. "
            + (proximity == .far || proximity == .none
                ? "With no race close, this is the window where strength work is cheap, so the whole block builds."
                : "This is the part of the block where lifting is allowed to cost you something."))
        if maintain > 0 {
            notes.append("Weeks \(intro + build + 1)–\(intro + build + maintain) hold the loads and cut the sets. "
                + "Your \(label) training is the priority from here; lifting exists to stop you losing what you built.")
        }
        if deload == 1 {
            notes.append("Week \(total) backs off — the load stays respectable but the volume is gutted, because intensity is the half of the dose that defends strength on reduced volume.")
        } else if deload > 1 {
            notes.append("Weeks \(total - deload + 1)–\(total) are a taper: one short session a week, roughly 10% lighter, at the bottom of every rep range. "
                + "You will not lose strength in a fortnight, and arriving at the start line with fresh legs is worth far more than the training those weeks would have bought.")
        }
        if proximity == .soon {
            notes.append("In race week itself, lift once early if at all, and nothing inside 72 hours of the start.")
        }
        if let problem = PlanMath.validatePhases(phases) { warnings.append(problem) }
        return SportPhases(phases: phases, notes: notes, warnings: warnings)
    }

    // ── Day templates ──
    static func d(_ s: Int, _ lo: Int, _ hi: Int) -> SlotDose { SlotDose(sets: s, repLow: lo, repHigh: hi) }

    static func triStrengthDay() -> DayTemplate {
        DayTemplate(title: "Max Strength — legs, trunk", slots: [
            Slot(muscle: .quads, patterns: [.squat, .legPress], mechanics: .compound, main: true, heavy: true,
                 preferIds: ["barbell-back-squat", "hack-squat", "leg-press", "goblet-squat"], dose: d(4, 4, 6),
                 why: "Peak hip and knee extension force — the strength that shows up as sustainable power on the bike and a cheaper stride on the run."),
            Slot(muscle: .hamstrings, patterns: [.hipHinge], main: true, heavy: true,
                 preferIds: ["romanian-deadlifts", "dumbbell-rdl", "cable-pull-through"], dose: d(3, 6, 8),
                 why: "Posterior-chain strength is the best-supported protective factor for the run leg, and it powers the top of the pedal stroke."),
            Slot(muscle: .calves, patterns: [.calfRaise],
                 preferIds: ["seated-calf-raises", "single-leg-calf-raise", "standing-calf-raises"], dose: d(3, 8, 12),
                 why: "Bent-knee calf work loads the soleus — the largest force contributor in running gait, and the tissue most often under-prepared for it. Three seconds down on every rep."),
            Slot(muscle: .obliques, patterns: [.antiRotation], preferIds: ["pallof-press", "dead-bug"], dose: d(2, 8, 12),
                 why: "Anti-rotation strength holds the aero position without leaking power, and keeps your pelvis honest as the run wears on."),
        ])
    }

    static func triUnilateralDay() -> DayTemplate {
        DayTemplate(title: "Unilateral + Upper — single leg, pull", slots: [
            Slot(muscle: .quads, patterns: [.lunge], mechanics: .compound, main: true,
                 preferIds: ["dumbbell-step-up", "bulgarian-split-squat", "walking-lunges"], dose: d(3, 6, 8),
                 why: "Loaded single-leg hip extension is the closest the gym gets to a pedal stroke, and it exposes the side-to-side asymmetry bilateral lifting hides."),
            Slot(muscle: .hamstrings, patterns: [.hipHinge], preferIds: ["single-leg-rdl", "dumbbell-rdl"], dose: d(3, 8, 10),
                 why: "Hamstring strength plus pelvic control in one movement — the combination that holds up in the back half of a run."),
            Slot(muscle: .lats, patterns: [.pullUp, .pullDown], mechanics: .compound, main: true,
                 preferIds: ["chin-ups", "lat-pull-down", "weighted-pull-ups"], dose: d(3, 6, 10),
                 why: "Vertical pulling strength for the catch — the phase of the stroke where propulsion is actually generated."),
            Slot(muscle: .upperBack, patterns: [.row], preferIds: ["seated-cable-row", "chest-supported-row", "bent-over-db-row"], dose: d(2, 8, 12),
                 why: "Postural counterweight to the hours you spend folded over the bars."),
            Slot(muscle: .delts, patterns: [.rotation, .reverseFly], preferIds: ["db-external-rotation", "db-y-raise", "face-pulls"], dose: d(2, 12, 15),
                 why: "Light external rotation balances the internally-rotated pull of swim volume. Two or three kilos is plenty — this slot is insurance, not training."),
        ], phases: throughMaintenance)
    }

    static func triPowerDay() -> DayTemplate {
        DayTemplate(title: "Power & Stability — short session", slots: [
            Slot(muscle: .calves, patterns: [.jump], preferIds: ["pogo-hops"], dose: d(3, 12, 20),
                 why: "Low-amplitude hopping trains Achilles stiffness — the elastic return that makes each stride cost less. Quality over accumulation; stop when they stop feeling springy."),
            Slot(muscle: .quads, patterns: [.jump], preferIds: ["box-jump"], dose: d(3, 4, 6),
                 why: "Rate of force development, which matters more at short-course intensity than at long. Full recovery between sets — this is a power slot, not conditioning."),
            Slot(muscle: .abductors, patterns: [.abduction], preferIds: ["hip-abduction", "banded-hip-abduction"], dose: d(3, 12, 15),
                 why: "Glute-med strength controls the pelvis on every single-leg stance phase — the cheapest insurance there is against ITB and kneecap pain."),
            Slot(muscle: .obliques, patterns: [.plank], preferIds: ["side-plank"], dose: d(2, 30, 45),
                 why: "Lateral trunk stability under single-leg load. Logged in seconds — build the hold, not the reps."),
        ], phases: buildPhases, minLiftDays: 3)
    }

    static func runStrengthDay() -> DayTemplate {
        DayTemplate(title: "Max Strength — legs, trunk", slots: [
            Slot(muscle: .quads, patterns: [.squat, .legPress], mechanics: .compound, main: true, heavy: true,
                 preferIds: ["barbell-back-squat", "hack-squat", "leg-press", "goblet-squat"], dose: d(4, 4, 6),
                 why: "Heavy bilateral squatting is the most reliable route to better running economy — more force per stride means each one costs a smaller share of your ceiling."),
            Slot(muscle: .hamstrings, patterns: [.hipHinge], main: true, heavy: true,
                 preferIds: ["romanian-deadlifts", "dumbbell-rdl", "cable-pull-through"], dose: d(3, 6, 8),
                 why: "Hamstring strength is the single best-supported protective factor in running, and it drives hip extension through toe-off."),
            Slot(muscle: .calves, patterns: [.calfRaise], preferIds: ["seated-calf-raises", "single-leg-calf-raise"], dose: d(3, 8, 12),
                 why: "Bent-knee calf raises load the soleus, which absorbs more force per stride than any other muscle in the chain and is the tissue most often under-prepared for it. Three seconds down on every rep."),
            Slot(muscle: .obliques, patterns: [.antiRotation], preferIds: ["pallof-press", "dead-bug"], dose: d(2, 8, 12),
                 why: "Anti-rotation strength keeps your pelvis from giving way as the miles accumulate — the point where form and economy fall apart together."),
        ])
    }

    static func runDurabilityDay() -> DayTemplate {
        DayTemplate(title: "Unilateral & Durability — single leg, hips", slots: [
            Slot(muscle: .quads, patterns: [.lunge], mechanics: .compound, main: true,
                 preferIds: ["dumbbell-step-up", "bulgarian-split-squat", "walking-lunges"], dose: d(3, 6, 8),
                 why: "Running is a single-leg sport, and loaded single-leg work exposes the side-to-side asymmetry bilateral lifting hides."),
            Slot(muscle: .hamstrings, patterns: [.hipHinge], preferIds: ["single-leg-rdl", "dumbbell-rdl"], dose: d(3, 8, 10),
                 why: "Hamstring strength plus pelvic control in one movement — the combination that holds up in the last few miles."),
            Slot(muscle: .abductors, patterns: [.abduction], preferIds: ["hip-abduction", "banded-hip-abduction"], dose: d(3, 12, 15),
                 why: "Glute-med strength controls the pelvis through every stance phase — the cheapest insurance there is against ITB pain and a sore kneecap."),
            Slot(muscle: .calves, patterns: [.calfRaise], preferIds: ["single-leg-calf-raise", "standing-calf-raises"], dose: d(2, 8, 12),
                 why: "Straight-leg, single-leg calf work covers the gastrocnemius and the Achilles at the load a stride actually applies — one leg at a time, because that is how you run."),
            Slot(muscle: .upperBack, patterns: [.row], preferIds: ["seated-cable-row", "chest-supported-row", "bent-over-db-row"], dose: d(2, 8, 12),
                 why: "One pulling movement to keep your posture honest late in a race. A runner needs no more upper-body volume than this."),
        ], phases: throughMaintenance)
    }

    static func runPowerDay() -> DayTemplate {
        DayTemplate(title: "Power & Stability — short session", slots: [
            Slot(muscle: .calves, patterns: [.jump], preferIds: ["pogo-hops"], dose: d(3, 12, 20),
                 why: "Low-amplitude hopping trains Achilles stiffness — the elastic return that makes each stride cost less. Quality over accumulation; stop when they stop feeling springy."),
            Slot(muscle: .quads, patterns: [.jump], preferIds: ["box-jump"], dose: d(3, 4, 6),
                 why: "Rate of force development — the quality behind a finishing kick. Full recovery between sets; this is a power slot, not conditioning."),
            Slot(muscle: .obliques, patterns: [.plank], preferIds: ["side-plank"], dose: d(2, 30, 45),
                 why: "Lateral trunk stability under single-leg load. Logged in seconds — build the hold, not the reps."),
        ], phases: buildPhases, minLiftDays: 3)
    }

    static func applyWeakLink(_ days: inout [DayTemplate], _ weakLink: Discipline) -> [String] {
        var notes: [String] = []
        func findSlot(_ dayIdx: Int, _ muscle: MuscleGroup) -> Int? {
            guard dayIdx < days.count else { return nil }
            return days[dayIdx].slots.firstIndex { $0.muscle == muscle }
        }
        switch weakLink {
        case .bike:
            if let i = findSlot(1, .quads), days[1].slots[i].dose != nil {
                days[1].slots[i].dose!.sets += 1
                notes.append("Bike is your weak link, so the single-leg step-up carries an extra set — unilateral hip extension is the most direct strength transfer to sustained pedalling power.")
            }
        case .run:
            if let i = findSlot(0, .calves), days[0].slots[i].dose != nil {
                days[0].slots[i].dose!.sets += 1
                notes.append("Run is your weak link, so calf loading gets an extra set — the soleus and Achilles carry more force per stride than anything else in the chain.")
            }
        case .swim:
            if days.count > 1 && !days[1].slots.contains(where: { $0.muscle == .lats && $0.has(.pullOver) }) {
                days[1].slots.append(Slot(muscle: .lats, patterns: [.pullOver, .pullDown],
                    preferIds: ["straight-arm-pulldowns", "dumbbell-pullover"], dose: d(2, 10, 14),
                    why: "Straight-arm pulling mirrors the front of the catch, where a weak swim usually loses its water."))
                notes.append("Swim is your weak link, so the upper day adds a straight-arm pulling slot on top of the vertical pull.")
            }
        case .even: break
        }
        return notes
    }

    static func applyNiggles(_ days: inout [DayTemplate], _ niggles: [String]) -> [String] {
        var notes: [String] = []
        let has = { (id: String) in niggles.contains(id) }

        if has("achilles") {
            for di in days.indices {
                days[di].slots = days[di].slots.compactMap { s in
                    guard s.has(.jump) else { return s }
                    guard s.muscle == .calves else { return nil }
                    var s = s
                    s.patterns = [.calfRaise]
                    s.preferIds = ["single-leg-calf-raise", "seated-calf-raises"]
                    s.dose = d(3, 8, 12)
                    s.why = "Heavy-slow calf loading instead of hopping — the tendon still gets the stimulus it needs, without the impact an irritable Achilles cannot absorb yet."
                    return s
                }
            }
            notes.append("Achilles/calf history noted — the jumping is out and calf work is loaded heavy and slow instead. Reintroduce hops only once it is quiet for a few weeks.")
        }

        if has("knee") {
            for di in days.indices {
                days[di].slots = days[di].slots.filter { !($0.has(.jump) && $0.muscle == .quads) }
                for si in days[di].slots.indices where days[di].slots[si].muscle == .quads && days[di].slots[si].has(.squat) {
                    days[di].slots[si].preferIds = ["leg-press", "hack-squat", "goblet-squat"]
                    days[di].slots[si].why = "Supported knee-extension work with a controlled range — the strength still transfers, and the joint gets a say in the depth."
                }
            }
            notes.append("Knee history noted — box jumps are out, squatting moves to supported variations, and hip abduction stays in as the direct fix for the pelvic control that usually drives runner's knee.")
        }

        if has("back") {
            for di in days.indices {
                for si in days[di].slots.indices {
                    if days[di].slots[si].has(.hipHinge) {
                        days[di].slots[si].preferIds = ["single-leg-rdl", "cable-pull-through", "seated-leg-curl", "lying-leg-curl"]
                        days[di].slots[si].why = "Lighter, supported posterior-chain work — the hamstrings and glutes still get loaded without a barbell compressing your spine."
                    }
                    if days[di].slots[si].muscle == .quads && days[di].slots[si].has(.squat) {
                        days[di].slots[si].preferIds = ["leg-press", "hack-squat"]
                    }
                }
            }
            notes.append("Low-back history noted — barbell hinges and axial squatting are replaced with supported and single-leg versions.")
        }

        if has("shoulder") {
            for di in days.indices {
                for si in days[di].slots.indices where days[di].slots[si].muscle == .delts {
                    days[di].slots[si].preferIds = ["db-external-rotation", "face-pulls", "db-y-raise"]
                    days[di].slots[si].dose = d(3, 12, 15)
                    days[di].slots[si].why = "Rotation and posterior-cuff work only — no overhead loading while the shoulder is unhappy. Light weight, strict form, every session."
                }
            }
            notes.append("Shoulder history noted — nothing goes overhead, and the rotation work gets an extra set because that is the part that actually helps.")
        }
        return notes
    }

    typealias SlotPath = (day: Int, slot: Int)

    static func paths(_ days: [DayTemplate]) -> [SlotPath] {
        days.indices.flatMap { di in days[di].slots.indices.map { (di, $0) } }
    }

    /// First slot (in day/slot order) with the most sets among `where` — a stable descending sort's head.
    static func firstMax(_ days: [DayTemplate], _ candidates: [SlotPath], where ok: (Slot) -> Bool) -> SlotPath? {
        var best: SlotPath?, bestSets = Int.min
        for p in candidates {
            let s = days[p.day].slots[p.slot]
            guard ok(s), let sets = s.dose?.sets else { continue }
            if sets > bestSets { best = p; bestSets = sets }
        }
        return best
    }

    public static func buildSportPlan(_ ctx: SportContext, _ requestedDays: Int, _ experience: ExperienceLevel = .intermediate,
                                      band: VolumeTarget = Analytics.volumeTargetFor(.sportSupport)) -> SportPlan {
        let meta = sportMeta(ctx.sport)
        let event = eventMeta(ctx.event)
        let profile = event.profile
        let budget = liftBudget(ctx, requestedDays, experience)
        var warnings: [String] = []
        if let w = budget.warning { warnings.append(w) }

        let templates = ctx.sport == .running
            ? [runStrengthDay(), runDurabilityDay(), runPowerDay()]
            : [triStrengthDay(), triUnilateralDay(), triPowerDay()]
        var days = Array(templates
            .filter { profile.plyometrics || !$0.slots.contains { $0.has(.jump) } }
            .filter { ($0.minLiftDays ?? 0) <= budget.days }
            .prefix(max(0, budget.days)))

        for di in days.indices {
            for si in days[di].slots.indices where days[di].slots[si].heavy == true && days[di].slots[si].dose != nil {
                days[di].slots[si].dose!.repLow = profile.mainReps[0]
                days[di].slots[si].dose!.repHigh = profile.mainReps[1]
            }
        }

        var rationale: [String] = [
            "Two or three sessions a week of heavy, low-volume, multi-joint lifting is the dose the concurrent-training research supports for endurance athletes — enough to raise maximal strength, cheap enough that your sport keeps its recovery.",
            "Every main lift stops two to three reps short of failure. The strength adaptation does not need the last rep; your next session does need the recovery it would cost.",
            "Volume sits well under a bodybuilding dose on purpose: added muscle mass is weight you carry for the whole race, and rising tonnage is a cost here rather than a sign of progress.",
            "\(event.label): \(profile.rationale)",
        ]

        for muscle in profile.emphases {
            var best: SlotPath?, bestSets = Int.max
            for p in paths(days) {
                let s = days[p.day].slots[p.slot]
                guard s.muscle == muscle, let sets = s.dose?.sets, !s.isMain else { continue }
                if sets < bestSets { best = p; bestSets = sets }
            }
            if let p = best, bestSets < 4 { days[p.day].slots[p.slot].dose!.sets += 1 }
        }

        if ctx.sport == .triathlon { rationale += applyWeakLink(&days, ctx.weakLink) }
        rationale += applyNiggles(&days, ctx.niggles)

        let trimmable: (Slot) -> Bool = { !$0.isMain && $0.dose != nil && $0.dose!.sets > 2 }
        func setsFor(_ muscle: MuscleGroup) -> Int {
            days.flatMap(\.slots).filter { $0.muscle == muscle }.reduce(0) { $0 + ($1.dose?.sets ?? 3) }
        }
        var muscles: [MuscleGroup] = []
        for s in days.flatMap(\.slots) where !muscles.contains(s.muscle) { muscles.append(s.muscle) }
        for muscle in muscles {
            var guardN = 0
            while Double(setsFor(muscle)) > band.high {
                guardN += 1
                if guardN > 20 { break }
                let slotsFor = paths(days).filter { days[$0.day].slots[$0.slot].muscle == muscle }
                if let p = firstMax(days, slotsFor, where: trimmable) {
                    days[p.day].slots[p.slot].dose!.sets -= 1
                    continue
                }
                guard let h = firstMax(days, slotsFor, where: { $0.isMain && $0.dose != nil && $0.dose!.sets > 3 }) else { break }
                days[h.day].slots[h.slot].dose!.sets -= 1
            }
        }

        func total() -> Int { days.reduce(0) { $0 + $1.slots.reduce(0) { $0 + ($1.dose?.sets ?? 3) } } }
        var guardN = 0
        var dropped: [MuscleGroup] = []
        while total() > budget.maxWeeklySets {
            guardN += 1
            if guardN > 60 { break }
            if let p = firstMax(days, paths(days), where: trimmable) {
                days[p.day].slots[p.slot].dose!.sets -= 1
                continue
            }
            guard let victim = paths(days).last(where: { !days[$0.day].slots[$0.slot].isMain }) else { break }
            dropped.append(days[victim.day].slots[victim.slot].muscle)
            days[victim.day].slots.remove(at: victim.slot)
        }
        if !dropped.isEmpty {
            var unique: [MuscleGroup] = []
            for m in dropped where !unique.contains(m) { unique.append(m) }
            warnings.append(
                "At \(loadLabel(ctx.load)) of \(sportLabel(ctx.sport).lowercased()) a week there is only room for a minimum effective dose, so "
                + "\(dropped.count == 1 ? "one accessory slot was" : "\(dropped.count) accessory slots were") dropped (\(unique.map(\.rawValue).joined(separator: ", "))). "
                + "The heavy lifts are what defend your strength — those stay.")
        }

        let hasPower = days.contains { $0.slots.contains { $0.has(.jump) } }
        let secondDayName = ctx.sport == .running ? "Durability" : "Unilateral"
        let splitName = days.count >= 3 && hasPower
            ? "Strength · \(secondDayName) · Power"
            : days.count >= 2 ? "Strength · \(secondDayName)" : "Single strength session"
        let focusWord = ctx.sport == .running ? "hip-durability" : "pulling"
        let splitReason = days.count >= 3 && hasPower
            ? "Three days: one heavy bilateral session, one single-leg and \(focusWord) session, and a short power/stability session that costs almost nothing to recover from. "
              + "The power day is the first to go once your race gets close — you can see that in the week-by-week plan."
            : days.count >= 2
                ? "Two days — the dose the research keeps validating for endurance athletes. One heavy bilateral session, one single-leg and \(focusWord) session, both under 45 minutes."
                : "One session a week holds the strength you have. It won't build much, which is the right trade at this point in your season."

        if !profile.plyometrics && budget.days >= 3 {
            warnings.append("\(meta.label) at \(event.label.lowercased()) distance doesn't get a plyometric day — your legs are already taking more impact than jumping could usefully add, so the plan uses \(days.count) \(days.count == 1 ? "session" : "sessions") rather than the \(budget.days) your schedule allows.")
        }

        return SportPlan(splitName: splitName, splitReason: splitReason, days: days, budget: budget, rationale: rationale, warnings: warnings)
    }
}
