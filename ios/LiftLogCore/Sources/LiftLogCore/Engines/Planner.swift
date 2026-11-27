import Foundation

// Mirrors src/data/planner.ts — the block planner: goal + constraints + history
// → an explained training-block proposal. Pure; parity fixture `planner`.

public struct PlannerInput: Codable, Hashable, Sendable {
    public var goal: Goal
    public var daysPerWeek: Int
    public var weeks: Double
    public var includeDeload: Bool
    public var openWithRecovery: Bool
    public var startDate: String
    public var notes: String
    public var experience: ExperienceLevel
    public var equipmentAccess: EquipmentAccess?
    public var priorityMuscles: [MuscleGroup]?
    public var injuries: String?
    public var injuryAreas: [InjuryArea]?
    public var sport: SportContext?
    public var previousGoal: Goal?
    public var focusExerciseIds: [String]?
}

public struct PlannerConfidence: Codable, Hashable, Sendable {
    public enum Level: String, Codable, Hashable, Sendable { case low, medium, high }
    public var level: Level
    public var sessions: Int
    public var detail: String
}

public struct ExerciseDecision: Codable, Hashable, Sendable {
    public enum Status: String, Codable, Hashable, Sendable { case kept, new, replacement }
    public var exerciseId: String
    public var name: String
    public var dayId: Int
    public var status: Status
    public var replacesName: String?
    public var reason: String
}

public struct MuscleWeeklySets: Codable, Hashable, Sendable {
    public var muscle: MuscleGroup
    public var sets: Double
}

public struct PlanProposal: Codable, Hashable, Sendable {
    public var input: PlannerInput
    public var confidence: PlannerConfidence
    public var splitName: String
    public var splitReason: String
    public var phases: [PhaseKind]
    public var phaseNotes: [String]
    public var days: [WorkoutDay]
    public var decisions: [ExerciseDecision]
    public var guidanceNotes: [String]
    public var muscleWeeklySets: [MuscleWeeklySets]
    public var intent: String
    public var progression: String
    public var warnings: [String]
}

public struct Guidance: Hashable, Sendable {
    public var bannedWeightTypes = Set<WeightType>()
    public var bannedEquipment = Set<Equipment>()
    public var avoidPatterns = Set<MovementPattern>()
    public var avoidNameParts: [String] = []
    public var notes: [String] = []
}

public struct StimulusChange: Codable, Hashable, Sendable {
    public var newExerciseShare: Double
    public var goalChanged: Bool
    public init(newExerciseShare: Double = 0, goalChanged: Bool = false) {
        self.newExerciseShare = newExerciseShare; self.goalChanged = goalChanged
    }
}

public struct IntroWeeks: Codable, Hashable, Sendable {
    public var weeks: Int
    public var reason: String?
}

public struct SplitChoice: Sendable {
    public var name: String
    public var reason: String
    public var days: [DayTemplate]
    public var warning: String?
}

private enum Rx {
    static func make(_ p: String) -> NSRegularExpression { try! NSRegularExpression(pattern: p) }
    static func test(_ r: NSRegularExpression, _ s: String) -> Bool {
        r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }
    static func replace(_ r: NSRegularExpression, _ s: String, _ f: (String) -> String) -> String {
        var out = s
        for m in r.matches(in: s, range: NSRange(s.startIndex..., in: s)).reversed() {
            let range = Range(m.range, in: s)!
            out.replaceSubrange(Range(m.range, in: out)!, with: f(String(s[range])))
        }
        return out
    }
    static func split(_ r: NSRegularExpression, _ s: String) -> [String] {
        var parts: [String] = [], last = s.startIndex
        for m in r.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
            let range = Range(m.range, in: s)!
            parts.append(String(s[last..<range.lowerBound]))
            last = range.upperBound
        }
        parts.append(String(s[last...]))
        return parts
    }

    static let dumbbellOnly = make(#"\bdumbbells?\s*only\b|\bonly\s+(have\s+)?dumbbells\b"#)
    static let noBarbell = make(#"\b(no|without a?|don'?t have a?)\s*barbell\b"#)
    static let home = make(#"\bhome gym\b|\bno (cable|machine)s?\b|\btraining at home\b"#)
    static let liftNames = make(#"\b(back|front|box|goblet|hack|split|bulgarian split|pistol|zercher|overhead|pause[d]?)\s+squats?\b|\bback\s+extensions?\b|\bhip\s+thrusts?\b|\bshoulder\s+press(es)?\b|\bknee\s+(push|drive|raise)s?\b"#)
    static let hurt = make(#"\b(pain(ful|s)?|injur\w*|hurt\w*|issues?|problems?|tweak\w*|surgery|sore(ness)?|tight(ness)?|ach(e|es|ing|y)|niggl\w*|strain\w*|tendi?n[io]tis|impingement|bad|dodgy|weak|cranky|flare\w*|bother\w*)\b"#)
    static let negated = make(#"\b(no|not|never|without|free of|recovered|fully|healed|fine now|ok now|okay now|better now|used to|years? ago|months? ago|ages ago|no longer)\b"#)
    static let clauseSplit = make(#"[.,;!?\n]|\bbut\b|\band\b|\bhowever\b"#)
    static let knee = make(#"\bknees?\b|\bpatell\w*\b|\bitb\b|\bit band\b"#)
    static let shoulder = make(#"\bshoulders?\b|\brotator\b|\bcuff\b"#)
    static let back = make(#"\b(lower|low)\s+back\b|\blumbar\b|\bback\b|\bsciatic\w*\b|\bdisc\b"#)
    static let hip = make(#"\bhips?\b|\bgroin\b|\bsi joint\b"#)
    static let elbow = make(#"\belbows?\b|\btennis elbow\b|\bgolfer'?s elbow\b"#)
    static let wrist = make(#"\bwrists?\b|\bcarpal\b"#)
}

public enum Planner {
    static let defaultNote = "Notes saved with the plan — review the workouts below and swap anything that doesn't fit."

    // ── Guidance parsing ──
    public static func parseGuidance(_ raw: String) -> Guidance {
        var g = Guidance()
        let text = raw.lowercased()
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return g }

        if Rx.test(Rx.dumbbellOnly, text) {
            for w: WeightType in [.barbell, .ezBar, .machine, .kettlebell] { g.bannedWeightTypes.insert(w) }
            for e: Equipment in [.cableMachine, .machine, .smithMachine, .squatRack] { g.bannedEquipment.insert(e) }
            g.notes.append("Dumbbell-only setup — no barbell, cable or machine work in this plan.")
        } else {
            if Rx.test(Rx.noBarbell, text) {
                g.bannedWeightTypes.insert(.barbell)
                g.notes.append("No barbell available — dumbbell and machine alternatives cover the heavy work.")
            }
            if Rx.test(Rx.home, text) {
                g.bannedEquipment.insert(.cableMachine); g.bannedEquipment.insert(.machine); g.bannedEquipment.insert(.smithMachine)
                g.notes.append("Home setup — machine and cable exercises are swapped for free-weight versions.")
            }
        }

        let replaced = Rx.replace(Rx.liftNames, text) { m in
            m.contains("squat") ? "squat" : m.contains("extension") ? "extension" : m.contains("thrust") ? "thrust" : m.contains("press") ? "press" : "drill"
        }
        var flagged = Set<String>()
        for clause in Rx.split(Rx.clauseSplit, replaced) {
            if !Rx.test(Rx.hurt, clause) || Rx.test(Rx.negated, clause) { continue }
            if Rx.test(Rx.knee, clause) { flagged.insert("knee") }
            if Rx.test(Rx.shoulder, clause) { flagged.insert("shoulder") }
            if Rx.test(Rx.back, clause) { flagged.insert("back") }
            if Rx.test(Rx.hip, clause) { flagged.insert("hip") }
            if Rx.test(Rx.elbow, clause) { flagged.insert("elbow") }
            if Rx.test(Rx.wrist, clause) { flagged.insert("wrist") }
        }
        if flagged.contains("knee") { applyInjuryArea(&g, .knee) }
        if flagged.contains("shoulder") { applyInjuryArea(&g, .shoulder) }
        if flagged.contains("back") { applyInjuryArea(&g, .lowerBack) }
        if flagged.contains("hip") { applyInjuryArea(&g, .hip) }
        if flagged.contains("elbow") { applyInjuryArea(&g, .elbow) }
        if flagged.contains("wrist") { applyInjuryArea(&g, .wrist) }

        if g.notes.isEmpty { g.notes.append(defaultNote) }
        return g
    }

    public static func applyInjuryArea(_ g: inout Guidance, _ area: InjuryArea) {
        func add(_ patterns: [MovementPattern], _ names: [String], _ note: String) {
            for p in patterns { g.avoidPatterns.insert(p) }
            for n in names where !g.avoidNameParts.contains(n) { g.avoidNameParts.append(n) }
            if !g.notes.contains(note) { g.notes.append(note) }
        }
        switch area {
        case .knee:
            add([.squat, .lunge, .legExtension, .jump], [],
                "Knee issue noted — squats, lunges, jumps and leg extensions are out; pressing and hinging carry the legs. Start lighter than feels necessary.")
        case .shoulder:
            add([.dip, .verticalPress], [],
                "Shoulder issue noted — no overhead pressing or dips; horizontal pressing and raises stay.")
        case .lowerBack:
            add([.hipHinge, .squat], ["good morning"],
                "Lower-back issue noted — barbell hinges and squats are out; supported machine work covers the posterior chain.")
        case .hip:
            add([.lunge, .hipHinge], ["bulgarian", "pistol"],
                "Hip issue noted — no deep lunging or heavy hinging; machines and hip thrusts carry the lower body.")
        case .elbow:
            add([.dip], ["skull", "close-grip", "close grip", "preacher"],
                "Elbow issue noted — no skull-crushers, dips or close-grip pressing; cable pressdowns and neutral-grip pulls stay.")
        case .wrist:
            add([], ["wrist curl", "barbell bench", "barbell overhead", "front squat", "push-up", "push up"],
                "Wrist issue noted — no barbell pressing, push-ups or wrist curls; neutral-grip dumbbell and machine work instead.")
        }
    }

    static func applyEquipmentAccess(_ g: inout Guidance, _ access: EquipmentAccess?) {
        guard let access, access != .fullGym else { return }
        func ban(_ ws: [WeightType], _ es: [Equipment]) {
            for w in ws { g.bannedWeightTypes.insert(w) }
            for e in es { g.bannedEquipment.insert(e) }
        }
        switch access {
        case .homeRack:
            ban([], [.cableMachine, .machine, .smithMachine])
            g.notes.append("Home gym with a rack — machine and cable work is swapped for barbell, dumbbell and bodyweight versions.")
        case .dumbbellsOnly:
            ban([.barbell, .ezBar, .machine, .kettlebell], [.cableMachine, .machine, .smithMachine, .squatRack, .pullUpBar, .dipStation])
            g.notes.append("Dumbbell-only setup — the whole plan is built from dumbbell and bodyweight movements.")
        case .minimal:
            ban([.barbell, .ezBar, .machine], [.cableMachine, .machine, .smithMachine, .squatRack])
            g.notes.append("Minimal equipment — bodyweight, bands and dumbbell work carry the plan; loads matter less than effort here.")
        case .fullGym: break
        }
    }

    // ── Split templates ──
    static func S(_ m: MuscleGroup, _ p: [MovementPattern], _ mech: Mechanics? = nil, main: Bool = false, reuse: Bool = false) -> Slot {
        Slot(muscle: m, patterns: p, mechanics: mech, main: main ? true : nil, reuse: reuse ? true : nil)
    }

    public static func splitFor(_ daysPerWeek: Int, _ experience: ExperienceLevel = .intermediate) -> SplitChoice {
        let upperA = DayTemplate(title: "Upper — Chest, Back, Arms", slots: [
            S(.chest, [.horizontalPress], .compound, main: true), S(.upperBack, [.row], .compound, main: true),
            S(.delts, [.verticalPress, .lateralRaise]), S(.lats, [.pullDown, .pullUp]),
            S(.triceps, [.tricepExtension, .dip]), S(.biceps, [.curl]),
        ])
        let lowerA = DayTemplate(title: "Lower — Quads, Hamstrings, Glutes", slots: [
            S(.quads, [.squat, .legPress], .compound, main: true), S(.hamstrings, [.hipHinge, .legCurl], main: true),
            S(.glutes, [.hipThrust, .lunge]), S(.quads, [.legExtension, .lunge]), S(.calves, [.calfRaise]),
        ])
        let upperB = DayTemplate(title: "Upper — Shoulders, Back, Chest", slots: [
            S(.lats, [.pullUp, .pullDown], .compound, main: true), S(.chest, [.horizontalPress, .fly], main: true),
            S(.delts, [.lateralRaise]), S(.upperBack, [.row]), S(.delts, [.facePull, .reverseFly]),
            S(.biceps, [.curl]), S(.triceps, [.tricepExtension, .dip]),
        ])
        let lowerB = DayTemplate(title: "Lower — Hamstrings, Quads, Calves", slots: [
            S(.hamstrings, [.legCurl, .hipHinge], main: true), S(.quads, [.legPress, .squat, .lunge], .compound, main: true),
            S(.glutes, [.hipThrust, .hipHinge]), S(.calves, [.calfRaise]), S(.abs, [.crunch]),
        ])
        let push = DayTemplate(title: "Push — Chest, Delts, Triceps", slots: [
            S(.chest, [.horizontalPress], .compound, main: true), S(.chest, [.fly, .dip, .horizontalPress]),
            S(.delts, [.verticalPress, .lateralRaise]), S(.delts, [.lateralRaise]),
            S(.triceps, [.tricepExtension, .dip]), S(.triceps, [.tricepExtension]),
        ])
        let pull = DayTemplate(title: "Pull — Back, Rear Delts, Biceps", slots: [
            S(.lats, [.pullDown, .pullUp], .compound, main: true), S(.upperBack, [.row], .compound, main: true),
            S(.lats, [.pullOver, .pullDown, .row]), S(.delts, [.facePull, .reverseFly]), S(.biceps, [.curl]), S(.biceps, [.curl]),
        ])
        let legs = DayTemplate(title: "Legs — Quads, Hamstrings, Calves", slots: [
            S(.quads, [.squat, .legPress], .compound, main: true), S(.hamstrings, [.hipHinge, .legCurl], main: true),
            S(.quads, [.legExtension, .lunge]), S(.glutes, [.hipThrust, .lunge]), S(.calves, [.calfRaise]),
        ])
        let fullA = DayTemplate(title: "Full Body A", slots: [
            S(.quads, [.squat, .legPress], .compound, main: true), S(.chest, [.horizontalPress], .compound, main: true),
            S(.upperBack, [.row]), S(.delts, [.lateralRaise]), S(.calves, [.calfRaise]),
        ])
        let fullB = DayTemplate(title: "Full Body B", slots: [
            S(.hamstrings, [.hipHinge, .legCurl], main: true), S(.lats, [.pullDown, .pullUp], .compound, main: true),
            S(.delts, [.verticalPress, .lateralRaise]), S(.biceps, [.curl]), S(.abs, [.crunch]),
        ])
        let fullC = DayTemplate(title: "Full Body C", slots: [
            S(.quads, [.squat, .legPress, .lunge], .compound, main: true, reuse: true),
            S(.chest, [.horizontalPress, .fly], main: true, reuse: true),
            S(.upperBack, [.row], reuse: true), S(.glutes, [.hipThrust]), S(.triceps, [.tricepExtension, .dip]),
        ])

        let days = min(6, max(2, daysPerWeek))
        if experience == .beginner {
            if days <= 2 {
                return SplitChoice(name: "Full Body ×2",
                    reason: "Two full-body sessions a week hit every movement twice — the ideal way to build skill and strength when you're starting out.",
                    days: [fullA, fullB])
            }
            if days == 3 {
                return SplitChoice(name: "Full Body ×3",
                    reason: "Three full-body days is the most-validated beginner program there is: you practise the big movements often, recover between sessions, and progress week to week.",
                    days: [fullA, fullB, fullC])
            }
            return SplitChoice(name: "Upper / Lower ×2",
                reason: "Four days split upper/lower keeps each session short while training everything twice a week — plenty of frequency without the volume of a body-part split.",
                days: [upperA, lowerA, upperB, lowerB],
                warning: days >= 5
                    ? "You picked \(days) days, but as a beginner you'll build faster on 3–4 — recovery, not gym time, is the limiter early on. This plan uses 4 focused days; add the extra day as a walk or mobility session."
                    : nil)
        }
        switch days {
        case 2: return SplitChoice(name: "Full Body ×2",
            reason: "Two sessions cover every muscle twice a week — at this schedule, full-body training is the only layout that hits the frequency research keeps validating.",
            days: [fullA, fullB])
        case 3: return SplitChoice(name: "Full Body ×3",
            reason: "Three full-body days train everything ~1.5–2× a week with a rest day between sessions — the highest-return schedule per gym hour.",
            days: [fullA, fullB, fullC])
        case 4: return SplitChoice(name: "Upper / Lower ×2",
            reason: "Four days split upper/lower trains every muscle twice a week — the frequency sweet spot — while keeping each session under an hour.",
            days: [upperA, lowerA, upperB, lowerB])
        case 5: return SplitChoice(name: "Push / Pull / Legs + Upper / Lower",
            reason: "Five days blend a push/pull/legs cycle with an upper/lower pair, so every muscle still lands twice a week without any session turning into a marathon.",
            days: [push, pull, legs, upperA, lowerA])
        default: return SplitChoice(name: "Push / Pull / Legs ×2",
            reason: "Six days run the push/pull/legs cycle twice — maximum volume distribution with every muscle trained twice a week.",
            days: [push, pull, legs, push, pull, legs])
        }
    }

    static func doseFor(_ goal: Goal, _ slot: Slot, _ p: ExerciseProfile, _ experience: ExperienceLevel) -> RepPrescription {
        if let d = slot.dose { return RepPrescription(sets: d.sets, repLow: d.repLow, repHigh: d.repHigh) }
        return Dosage.dosage(goal, DosageSlot(main: slot.main), p, experience)
    }

    public static func defaultBlockWeeks() -> Int { 6 }

    // ── Intro weeks ──
    public static let novelSelectionShare = 0.5

    public static func introWeeksFor(_ experience: ExperienceLevel, _ weeks: Double, _ change: StimulusChange, _ openWithRecovery: Bool) -> IntroWeeks {
        if openWithRecovery { return IntroWeeks(weeks: 0, reason: nil) }
        if experience == .beginner {
            let n = weeks >= 8 ? 2 : 1
            return IntroWeeks(weeks: n,
                reason: "You're starting out, so the block opens with \(n == 1 ? "an introductory week" : "two introductory weeks"): same movements, easy loads, no chasing numbers. "
                    + "Technique first is not a formality — it is what makes the following weeks trainable.")
        }
        let novelSelection = change.newExerciseShare >= novelSelectionShare
        if change.goalChanged {
            return IntroWeeks(weeks: 1,
                reason: "You've changed what you're training for, which changes the rep ranges your body is used to. "
                    + "Week 1 is an introduction at easy loads — unaccustomed rep ranges cause disproportionate soreness the first time through, and one easy exposure removes most of it.")
        }
        if novelSelection {
            return IntroWeeks(weeks: 1,
                reason: "Most of these lifts are new to you, so week 1 is an introduction at easy loads. "
                    + "The first hard session on an unfamiliar movement causes far more soreness than the second — this spends that once, cheaply.")
        }
        return IntroWeeks(weeks: 0, reason: nil)
    }

    public static func stimulusChange(_ days: [WorkoutDay], _ currentProgram: [WorkoutDay], _ goal: Goal, _ previousGoal: Goal?) -> StimulusChange {
        let current = Set(currentProgram.flatMap { $0.exercises.map(\.id) })
        let proposed = days.flatMap { $0.exercises.map(\.id) }
        let share = current.isEmpty || proposed.isEmpty
            ? 0 : Double(proposed.filter { !current.contains($0) }.count) / Double(proposed.count)
        return StimulusChange(newExerciseShare: share, goalChanged: previousGoal != nil && previousGoal != goal)
    }

    public static func buildPhases(_ input: PlannerInput, _ previousRetro: BlockRetrospective? = nil,
                                   _ change: StimulusChange = StimulusChange()) -> SportPhases {
        let intro = introWeeksFor(input.experience, input.weeks, change, input.openWithRecovery)
        if input.goal == .sportSupport, let sport = input.sport {
            var out = Sports.buildSportPhases(input.weeks, sport.proximity, sport.sport, intro.weeks)
            if intro.weeks > 0, let r = intro.reason { out.notes.insert(r, at: 0) }
            return out
        }
        var notes: [String] = [], warnings: [String] = []
        let weeks = min(12, max(3, Int(JS.round(input.weeks))))
        let introWeeks = min(intro.weeks, PlanMath.maxOpenerWeeks, max(0, weeks - 2))
        let recovery = input.openWithRecovery ? 1 : 0
        var deload = input.includeDeload ? 1 : 0
        var productive = weeks - recovery - introWeeks - deload
        if deload > 0 && productive < PlanMath.minProductiveWeeksBeforeDeload {
            deload = 0
            productive = weeks - recovery - introWeeks
            warnings.append("Dropped the closing deload: a \(weeks)-week block\(recovery > 0 ? " with a recovery opener" : "") leaves fewer than \(PlanMath.minProductiveWeeksBeforeDeload) productive weeks to earn one. Extend the block to get it back.")
        }
        var phases: [PhaseKind] = []
        if recovery > 0 { phases.append(.recovery) }
        for _ in 0..<max(0, introWeeks) { phases.append(.intro) }
        if input.goal == .strength && productive >= 4 {
            let acc = Int((Double(productive - 1) / 2).rounded(.up))
            let int = productive - 1 - acc
            for _ in 0..<acc { phases.append(.accumulation) }
            for _ in 0..<max(0, int) { phases.append(.intensification) }
            phases.append(.peak)
        } else {
            let acc = Int((Double(productive) * 0.6).rounded(.up))
            for i in 0..<max(0, productive) { phases.append(i < acc ? .accumulation : .intensification) }
        }
        if deload > 0 { phases.append(.deload) }

        if recovery > 0 {
            notes.append("Week 1 is a recovery week — you just closed out a block, and easing back in beats grinding back in.")
        }
        if introWeeks > 0, let r = intro.reason { notes.append(r) }
        if deload > 0 {
            let stalls = previousRetro?.carryover.reviewExerciseIds.count ?? 0
            notes.append("The deload lands in week \(phases.count) — after \(productive) hard weeks, fatigue starts masking fitness; one planned easy week lets it show."
                + (stalls > 0 ? " Your last block ended with \(stalls) stalled lift\(stalls == 1 ? "" : "s"), so this one is non-negotiable." : ""))
        } else if !input.includeDeload {
            notes.append("No deload scheduled — the block simply ends. The in-workout coach still deloads any single lift that stalls.")
        }
        if let problem = PlanMath.validatePhases(phases) { warnings.append(problem) }
        return SportPhases(phases: phases, notes: notes, warnings: warnings)
    }

    // ── Selection ──
    final class SelectCtx {
        var goal: Goal
        var experience: ExperienceLevel
        var byMuscle: [MuscleGroup: [ExerciseProfile]] = [:]
        var byId: [String: ExerciseProfile] = [:]
        var used = Set<String>()
        var dayUsed: [String] = []
        var currentIds = Set<String>()
        var trendUp = Set<String>()
        var trendDown = Set<String>()
        var loggedIds = Set<String>()
        var observedEquipment = Set<Equipment>()
        var keep = Set<String>()
        var review = Set<String>()
        var focus = Set<String>()
        init(goal: Goal, experience: ExperienceLevel) { self.goal = goal; self.experience = experience }
    }

    static func meetsSkillGate(_ p: ExerciseProfile, _ ctx: SelectCtx) -> Bool {
        if ctx.experience != .beginner { return true }
        if ctx.focus.contains(p.id) { return true }
        if p.prerequisites.isEmpty { return true }
        return ctx.loggedIds.contains(p.id) || p.prerequisites.contains { ctx.loggedIds.contains($0) }
    }

    static let strengthAnchors: [(muscle: MuscleGroup, pattern: MovementPattern, preferIds: [String])] = [
        (.chest, .horizontalPress, ["flat-barbell-bench-press", "incline-barbell-press"]),
        (.quads, .squat, ["barbell-back-squat"]),
        (.hamstrings, .hipHinge, ["conventional-deadlift", "romanian-deadlifts"]),
        (.delts, .verticalPress, ["barbell-overhead-press"]),
    ]

    static func anchorStrengthMains(_ days: [DayTemplate]) -> [DayTemplate] {
        days.map { day in
            var day = day
            day.slots = day.slots.map { slot in
                guard let a = strengthAnchors.first(where: { $0.muscle == slot.muscle && slot.has($0.pattern) && (slot.isMain || $0.pattern == .verticalPress) }),
                      slot.preferIds == nil else { return slot }
                var s = slot
                s.main = true
                s.preferIds = a.preferIds
                return s
            }
            return day
        }
    }

    static func allowedByGuidance(_ p: ExerciseProfile, _ g: Guidance) -> Bool {
        if let w = p.weightType, g.bannedWeightTypes.contains(w) { return false }
        if let e = p.equipment, g.bannedEquipment.contains(e) { return false }
        if let t = p.workoutType, g.avoidPatterns.contains(t) { return false }
        let lower = p.name.lowercased()
        return !g.avoidNameParts.contains { lower.contains($0) }
    }

    static func scoreCandidate(_ p: ExerciseProfile, _ slot: Slot, _ ctx: SelectCtx) -> Int {
        var score = 0
        if let prefer = slot.preferIds, let idx = prefer.firstIndex(of: p.id) { score += 40 - idx * 4 }
        if let patterns = slot.patterns, let t = p.workoutType, let idx = patterns.firstIndex(of: t) { score += 12 - idx * 2 }
        if let mech = slot.mechanics { score += p.mechanics == mech ? 6 : -6 }
        if ctx.currentIds.contains(p.id) { score += ctx.review.contains(p.id) ? -10 : 12 }
        if slot.reuse == true && ctx.used.contains(p.id) { score += 30 }
        if ctx.keep.contains(p.id) { score += 8 }
        if ctx.trendUp.contains(p.id) { score += 10 }
        if ctx.trendDown.contains(p.id) { score -= 12 }
        if ctx.review.contains(p.id) && !ctx.currentIds.contains(p.id) { score -= 6 }
        if ctx.loggedIds.contains(p.id) { score += 6 }
        if let e = p.equipment, !ctx.observedEquipment.isEmpty { score += ctx.observedEquipment.contains(e) ? 4 : -5 }
        let rank = p.difficulty.rank
        if ctx.experience == .beginner {
            if rank == ExerciseDifficulty.beginner.rank { score += 14 } else if rank == ExerciseDifficulty.advanced.rank { score -= 16 }
        } else if ctx.experience == .advanced {
            if rank >= ExerciseDifficulty.intermediate.rank { score += 4 }
        }
        return score
    }

    static func reasonFor(_ p: ExerciseProfile, _ slot: Slot, _ ctx: SelectCtx) -> String {
        if let why = slot.why { return why }
        if ctx.focus.contains(p.id) {
            return "Your goal lift — it leads this day so every week trains it heavy and fresh, and the block's loading is built to move its 1RM."
        }
        if ctx.currentIds.contains(p.id) {
            if ctx.trendUp.contains(p.id) { return "Kept — your strength on it is climbing, and momentum like that is never rotated away." }
            if ctx.review.contains(p.id) { return "Kept despite a recent stall — no stronger alternative fit this slot; the deload should unstick it." }
            return "Kept from your current program — consistency on a lift you know compounds faster than novelty."
        }
        if ctx.loggedIds.contains(p.id) {
            if ctx.trendUp.contains(p.id) { return "Brought back — it was producing progress when you last trained it." }
            return "You've trained it before, so its progression history carries straight over."
        }
        if ctx.experience == .beginner && p.difficulty == .beginner {
            return "Beginner-friendly \(slot.muscle.rawValue) work — easy to learn and load safely while you build a base."
        }
        let pattern = p.workoutType.map { " (\($0.rawValue.lowercased()))" } ?? ""
        return "Direct \(slot.muscle.rawValue) work\(pattern) — an evidence-based pick for this slot."
    }

    static func pickForSlot(_ slot: Slot, _ ctx: SelectCtx, _ guidance: Guidance) -> (profile: ExerciseProfile, reason: String)? {
        let eligible = { (p: ExerciseProfile) in
            !ctx.dayUsed.contains(p.id) && (slot.reuse == true || !ctx.used.contains(p.id))
                && (ctx.focus.contains(p.id) || allowedByGuidance(p, guidance))
        }
        var pool = (ctx.byMuscle[slot.muscle] ?? []).filter(eligible)
        for id in slot.preferIds ?? [] {
            if let p = ctx.byId[id], eligible(p), !pool.contains(where: { $0.id == p.id }) { pool.append(p) }
        }
        if pool.isEmpty { return nil }

        if slot.heavy != true && ctx.dayUsed.contains(where: { Dosage.isHeavyAxial(Substitution.profileFor($0)) }) {
            let unloaded = pool.filter { !Dosage.isHeavyAxial($0) }
            if !unloaded.isEmpty { pool = unloaded }
        }
        let gated = pool.filter { meetsSkillGate($0, ctx) }
        if !gated.isEmpty { pool = gated }

        let patternPool = slot.patterns.map { pats in pool.filter { $0.workoutType != nil && pats.contains($0.workoutType!) } } ?? pool
        let candidates = patternPool.isEmpty ? pool : patternPool
        var scores: [String: Int] = [:]
        for c in candidates { scores[c.id] = scoreCandidate(c, slot, ctx) }
        let sorted = candidates.jsSorted { a, b in
            let d = Double(scores[b.id]! - scores[a.id]!)
            return d != 0 ? d : JS.localeCompare(a.name, b.name)
        }
        let best = sorted[0]
        return (best, reasonFor(best, slot, ctx))
    }

    static func confidenceFor(_ snapshot: TrainingSnapshot?, _ experience: ExperienceLevel = .intermediate) -> PlannerConfidence {
        let sessions = snapshot?.sessions.count ?? 0
        if sessions == 0 {
            return PlannerConfidence(level: .low, sessions: sessions,
                detail: "No training history yet, so this plan leans on established exercise science, calibrated for \(experience == .intermediate || experience == .advanced ? "an" : "a") \(PlanMath.experienceLabel(experience).lowercased()) lifter. It gets personal fast — every workout you log sharpens the next block.")
        }
        if sessions < 12 {
            return PlannerConfidence(level: .medium, sessions: sessions,
                detail: "Built from \(sessions) logged workout\(sessions == 1 ? "" : "s") plus evidence-based defaults — enough to keep what's working, not yet enough to read every trend.")
        }
        return PlannerConfidence(level: .high, sessions: sessions,
            detail: "Grounded in \(sessions) logged workouts — exercise selection and volume reflect what has actually produced progress for you.")
    }

    // ── Main ──
    static let minutesPerSet = 3
    static let sessionOverheadMin = 10
    static let longSessionMin = 95
    static let hourSessionMin = 65
    static let noMarathonMin = 75
    static let sportSessionMin = 55
    static let maxVolumeTrims = 40
    static let maxRetroBumps = 3
    public static let maxBlockGrowth = 0.25

    public static func sessionBudgetFor(_ splitName: String, _ goal: Goal, _ sport: Bool) -> Int {
        if sport { return sportSessionMin }
        if splitName.hasPrefix("Upper / Lower") { return hourSessionMin }
        if splitName.contains("+") || goal == .general { return noMarathonMin }
        return longSessionMin
    }

    public static func buildPlanProposal(_ input: PlannerInput, _ currentProgram: [WorkoutDay], _ snapshot: TrainingSnapshot?,
                                         _ previousRetro: BlockRetrospective? = nil, phaseOf: PlanMath.PhaseResolver? = nil) -> PlanProposal {
        var guidance = parseGuidance([input.notes, input.injuries ?? ""].joined(separator: ". "))
        for area in input.injuryAreas ?? [] { applyInjuryArea(&guidance, area) }
        if guidance.notes.count > 1, let idx = guidance.notes.firstIndex(of: defaultNote) { guidance.notes.remove(at: idx) }
        applyEquipmentAccess(&guidance, input.equipmentAccess)

        let sportPlan = input.goal == .sportSupport && input.sport != nil
            ? Sports.buildSportPlan(input.sport!, input.daysPerWeek, input.experience) : nil
        var split: SplitChoice
        if let sp = sportPlan {
            split = SplitChoice(name: sp.splitName, reason: sp.splitReason, days: sp.days, warning: nil)
        } else {
            split = splitFor(input.daysPerWeek, input.experience)
            if input.goal == .strength { split.days = anchorStrengthMains(split.days) }
        }
        var warnings: [String] = []
        if let w = split.warning { warnings.append(w) }
        if let sp = sportPlan {
            warnings += sp.warnings
            guidance.notes += sp.rationale
        }
        let confidence = confidenceFor(snapshot, input.experience)

        let ctx = SelectCtx(goal: input.goal, experience: input.experience)
        if let snapshot {
            for logs in snapshot.setsBySession.values { for l in logs { ctx.loggedIds.insert(l.exerciseId) } }
            let directions = Progress.progressDirections(Progress.assessSnapshot(snapshot, input.goal, include: { _ in true }, phaseOf: phaseOf))
            ctx.trendUp = directions.up
            ctx.trendDown = directions.down
            for id in ctx.loggedIds { if let eq = Substitution.profileFor(id).equipment { ctx.observedEquipment.insert(eq) } }
        }
        for p in Substitution.candidateProfiles() {
            guard let m = p.primaryMuscle else { continue }
            ctx.byId[p.id] = p
            ctx.byMuscle[m, default: []].append(p)
        }

        var currentOrder: [String] = []
        var currentNameById: [String: String] = [:]
        for d in currentProgram {
            for e in d.exercises {
                if !currentOrder.contains(e.id) { currentOrder.append(e.id) }
                currentNameById[e.id] = e.name
            }
        }
        ctx.currentIds = Set(currentOrder)

        var focusOrder: [String] = []
        for id in input.focusExerciseIds ?? [] where !focusOrder.contains(id) { focusOrder.append(id) }
        ctx.focus = Set(focusOrder)
        var dayTemplates = split.days
        for id in focusOrder {
            let p = Substitution.profileFor(id, currentNameById[id])
            guard p.primaryMuscle != nil else { continue }
            if !allowedByGuidance(p, guidance) {
                warnings.append("\(p.name) is your goal lift but conflicts with your equipment or injury constraints — it was programmed anyway. Review it below.")
            }
            anchorFocusLift(&dayTemplates, p, ctx.focus)
            guidance.notes.append("Designed around your \(p.name) goal — it leads its day as the main lift, and the block's loading is built to move its 1RM.")
        }

        ctx.keep = Set(previousRetro?.carryover.keepExerciseIds ?? [])
        ctx.review = Set((previousRetro?.carryover.reviewExerciseIds ?? []) + Array(ctx.trendDown))
        if input.goal == .strength {
            for day in currentProgram {
                for ex in day.exercises where ex.main == true {
                    ctx.review.remove(ex.id)
                    ctx.keep.insert(ex.id)
                }
            }
        }

        var days: [WorkoutDay] = []
        var decisions: [ExerciseDecision] = []
        for (i, template) in dayTemplates.enumerated() {
            let dayId = i + 1
            var exercises: [Exercise] = []
            ctx.dayUsed = []
            for slot in template.slots {
                guard let picked = pickForSlot(slot, ctx, guidance) else {
                    warnings.append("Couldn't find a \(slot.muscle.rawValue) exercise matching your constraints for Day \(dayId) — add one manually if you want that slot filled.")
                    continue
                }
                ctx.used.insert(picked.profile.id)
                ctx.dayUsed.append(picked.profile.id)
                let dose = doseFor(input.goal, slot, picked.profile, input.experience)
                exercises.append(Exercise(id: picked.profile.id, name: picked.profile.name, sets: dose.sets, repLow: dose.repLow,
                                          repHigh: dose.repHigh, main: slot.isMain ? true : nil, rangeSource: .plan))
                decisions.append(ExerciseDecision(exerciseId: picked.profile.id, name: picked.profile.name, dayId: dayId,
                                                  status: ctx.currentIds.contains(picked.profile.id) ? .kept : .new, reason: picked.reason))
            }
            days.append(WorkoutDay(id: dayId, label: "Day \(dayId)", muscleGroups: template.title, exercises: exercises, phases: template.phases))
        }

        var displaced = currentOrder.filter { ctx.review.contains($0) && !ctx.used.contains($0) }
        for di in decisions.indices {
            if decisions[di].status != .new || displaced.isEmpty { continue }
            let primary = Substitution.profileFor(decisions[di].exerciseId).primaryMuscle
            guard let matchIdx = displaced.firstIndex(where: { Substitution.profileFor($0, currentNameById[$0]).primaryMuscle == primary }) else { continue }
            let oldId = displaced.remove(at: matchIdx)
            let oldName = currentNameById[oldId] ?? oldId
            decisions[di].status = .replacement
            decisions[di].replacesName = oldName
            decisions[di].reason = "Fresh stimulus for \(primary.map(\.rawValue) ?? "undefined") — \(oldName) has stalled, and rotating the movement is how a plateau gets broken."
        }

        var bumped: [(Int, Int)] = []
        if let retro = previousRetro, sportPlan == nil {
            for muscle in retro.carryover.underMuscles.prefix(maxRetroBumps) {
                if let p = bumpSets(&days, &decisions, muscle, +1, "+1 set — \(muscle.rawValue) finished last block under its weekly volume target.") { bumped.append(p) }
            }
            for muscle in retro.carryover.overMuscles {
                _ = bumpSets(&days, &decisions, muscle, -1, "−1 set — \(muscle.rawValue) ran past the weekly ceiling last block; trimming protects recovery.")
            }
        }
        if sportPlan == nil {
            for muscle in input.priorityMuscles ?? [] {
                if let p = bumpSets(&days, &decisions, muscle, +1, "+1 set — you flagged \(muscle.rawValue) as a priority, so it gets extra volume.") { bumped.append(p) }
            }
        }

        let currentSets = currentProgram.reduce(0) { $0 + $1.exercises.reduce(0) { $0 + $1.sets } }
        func totalSets() -> Int { days.reduce(0) { $0 + $1.exercises.reduce(0) { $0 + $1.sets } } }
        if currentSets > 0 && sportPlan == nil {
            let ceiling = Double(currentSets) * (1 + maxBlockGrowth)
            var undone = 0
            while Double(totalSets()) > ceiling, let (d, e) = bumped.popLast() {
                if days[d].exercises[e].sets > 2 { days[d].exercises[e].sets -= 1; undone += 1 }
            }
            if undone > 0 {
                warnings.append("Weekly volume is held within \(Int(JS.round(maxBlockGrowth * 100)))% of your current block — \(undone) of the extra sets wait for the block after this one.")
            }
            if Double(totalSets()) > ceiling {
                warnings.append("This block carries \(JS.string(JS.round((Double(totalSets()) / Double(currentSets) - 1) * 100)))% more weekly sets than your current one — a big step. Trim a set or two in the review below if the sessions run long.")
            }
        }

        let change = stimulusChange(days, currentProgram, input.goal, input.previousGoal)
        let phasePlan = buildPhases(input, previousRetro, change)
        warnings += phasePlan.warnings

        let band = Analytics.volumeTargetFor(input.goal, input.experience)
        capWeeklyVolume(&days, &decisions, band)

        let weekly = projectWeeklySets(days)
        let stillOver = weekly.entries.filter { $0.value > band.high }.map(\.key.rawValue)
        if !stillOver.isEmpty {
            warnings.append("\(stillOver.joined(separator: ", ")) still projects past the \(JS.string(band.high))-set weekly ceiling and can't be trimmed further without dropping an exercise — remove one below if that worries you.")
        }
        let muscleWeeklySets = weekly.entries
            .map { MuscleWeeklySets(muscle: $0.key, sets: JS.round($0.value * 2) / 2) }
            .jsSorted { $1.sets - $0.sets }

        let sessionCap = sessionBudgetFor(split.name, input.goal, sportPlan != nil)
        for day in days {
            let setCount = day.exercises.reduce(0) { $0 + $1.sets }
            let est = sessionOverheadMin + setCount * minutesPerSet
            if est > sessionCap {
                warnings.append("Day \(day.id) projects ~\(est) minutes against the ~\(sessionCap) this split promises — trim a set or drop an exercise if that doesn't fit your schedule.")
            }
        }

        return PlanProposal(input: input, confidence: confidence, splitName: split.name, splitReason: split.reason,
                            phases: phasePlan.phases, phaseNotes: phasePlan.notes, days: days, decisions: decisions,
                            guidanceNotes: guidance.notes, muscleWeeklySets: muscleWeeklySets,
                            intent: intentFor(input, split.name, phasePlan.phases),
                            progression: progressionFor(input.goal, phasePlan.phases, input.experience, input.sport),
                            warnings: warnings)
    }

    static func anchorFocusLift(_ days: inout [DayTemplate], _ p: ExerciseProfile, _ focus: Set<String>) {
        let muscle = p.primaryMuscle!
        var best: (d: Int, s: Int, score: Int)?
        for di in days.indices {
            for si in days[di].slots.indices {
                let slot = days[di].slots[si]
                if slot.muscle != muscle { continue }
                if let claimedBy = slot.preferIds?.first, claimedBy != p.id, focus.contains(claimedBy) { continue }
                let patternMatch = p.workoutType != nil && slot.has(p.workoutType!)
                let score = (patternMatch ? 2 : 0) + (slot.isMain ? 1 : 0)
                if best == nil || score > best!.score { best = (di, si, score) }
            }
        }
        if let b = best {
            var slot = days[b.d].slots[b.s]
            slot.preferIds = [p.id] + (slot.preferIds ?? []).filter { $0 != p.id }
            slot.main = true
            slot.mechanics = nil
            if let t = p.workoutType, !(slot.patterns ?? []).contains(t) { slot.patterns = [t] + (slot.patterns ?? []) }
            days[b.d].slots[b.s] = slot
            return
        }
        guard !days.isEmpty else { return }
        var lightest = 0
        for i in days.indices where days[i].slots.count < days[lightest].slots.count { lightest = i }
        days[lightest].slots.insert(Slot(muscle: muscle, patterns: p.workoutType.map { [$0] }, main: true, preferIds: [p.id]), at: 0)
    }

    static func bumpSets(_ days: inout [WorkoutDay], _ decisions: inout [ExerciseDecision], _ muscle: MuscleGroup,
                         _ delta: Int, _ note: String) -> (Int, Int)? {
        var best: (Int, Int)?
        for di in days.indices {
            for ei in days[di].exercises.indices {
                let ex = days[di].exercises[ei]
                if Substitution.profileFor(ex.id, ex.name).primaryMuscle != muscle { continue }
                if delta > 0 && ex.sets >= 5 { continue }
                if delta < 0 && ex.sets <= (ex.main == true ? 3 : 2) { continue }
                guard let (bd, be) = best else { best = (di, ei); continue }
                let b = days[bd].exercises[be]
                let bMain = b.main == true, xMain = ex.main == true
                if delta < 0 {
                    if (bMain && !xMain) || (bMain == xMain && ex.sets > b.sets) { best = (di, ei) }
                } else if ex.sets < b.sets {
                    best = (di, ei)
                }
            }
        }
        guard let (bd, be) = best else { return nil }
        days[bd].exercises[be].sets += delta
        let id = days[bd].exercises[be].id
        if let i = decisions.firstIndex(where: { $0.exerciseId == id }) { decisions[i].reason = "\(decisions[i].reason) \(note)" }
        return (bd, be)
    }

    static func projectWeeklySets(_ days: [WorkoutDay]) -> OrderedDict<MuscleGroup, Double> {
        var weekly = OrderedDict<MuscleGroup, Double>()
        for day in days {
            for ex in day.exercises {
                let p = Substitution.profileFor(ex.id, ex.name)
                if let m = p.primaryMuscle { weekly[m] = weekly[m, default: 0] + Double(ex.sets) }
                for m in p.secondaryMuscles { weekly[m] = weekly[m, default: 0] + Double(ex.sets) * 0.5 }
            }
        }
        return weekly
    }

    static func capWeeklyVolume(_ days: inout [WorkoutDay], _ decisions: inout [ExerciseDecision], _ band: VolumeTarget) {
        for _ in 0..<maxVolumeTrims {
            guard let over = projectWeeklySets(days).entries.filter({ $0.value > band.high }).jsSorted({ $1.value - $0.value }).first else { return }
            let trimmed = bumpSets(&days, &decisions, over.key, -1,
                "−1 set — \(over.key.rawValue) projected \(JS.string(JS.round(over.value * 2) / 2)) weekly sets once the secondary work from your compounds is counted, past the \(JS.string(band.high))-set ceiling.")
            if trimmed == nil { return }
        }
    }

    static func intentFor(_ input: PlannerInput, _ splitName: String, _ phases: [PhaseKind]) -> String {
        let weeks = phases.count
        if input.goal == .sportSupport, let sp = input.sport {
            let sport = Sports.sportLabel(sp.sport).lowercased()
            let arc = phases.contains(.maintenance)
                ? "build strength early, then hold it through your heaviest training weeks so your sport gets the recovery back"
                : "build strength while it is cheap to build — there is no race close enough for that to cost you anything"
            return "\(weeks) weeks of lifting in service of your \(sport): \(splitName) keeps the sessions short, heavy and well short of failure. "
                + "The plan is to \(arc). If a session ever clashes with a quality \(sport) workout, the \(sport) workout wins — that is not a compromise, it is the design."
        }
        let deload = phases.last == .deload
        let hard = phases.filter { !PlanMath.isEasyPhase($0) }.count
        let arc = deload
            ? "build for \(hard) weeks, then deload and reassess"
            : hard == weeks
                ? "build across all \(weeks) weeks, then roll straight into the next block"
                : "ease in, build for \(hard) weeks, then roll straight into the next block"
        switch input.goal {
        case .strength:
            return "\(weeks) weeks aimed at moving more weight: \(splitName) keeps the big lifts fresh, loading climbs from volume work toward a heavy peak week, and assistance volume keeps joints and muscles resilient. The plan is to \(arc)."
        case .fatLoss:
            return "\(weeks) weeks of muscle insurance while you diet: \(splitName) holds every muscle at an effective weekly dose, because training intensity — not extra gym cardio — is what protects lean mass in a deficit. The plan is to \(arc)."
        case .athletic:
            return "\(weeks) weeks of strength with carryover: \(splitName) anchors each session on a big compound movement and backs it with balanced volume across the whole body. The plan is to \(arc)."
        case .general:
            return "\(weeks) weeks of balanced, sustainable training: \(splitName) covers every muscle at an effective dose without any marathon sessions. The plan is to \(arc)."
        default:
            return "\(weeks) weeks of focused hypertrophy: \(splitName) trains every muscle about twice a week inside the 10–20 weekly hard-set band, adding reps and load as you earn them. The plan is to \(arc)."
        }
    }

    static func introSentence(_ count: Int) -> String {
        count == 1
            ? "Week 1 is an introduction: run the prescribed sets and reps at a weight you could clearly do 4–5 more reps with. "
              + "Nothing is being tested — you are teaching your body the movements so the following weeks can be hard."
            : "Weeks 1–\(count) are an introduction: the prescribed sets and reps at a weight you could clearly do 4–5 more reps with. "
              + "Both weeks sit at the same easy load — nothing is being tested yet, and the first exposure is the one that makes you sore."
    }

    static func progressionFor(_ goal: Goal, _ phases: [PhaseKind], _ experience: ExperienceLevel = .intermediate, _ sport: SportContext? = nil) -> String {
        let introCount = phases.filter { $0 == .intro }.count
        if goal == .sportSupport, let sport {
            let meta = Sports.sportMeta(sport.sport)
            let taperWeek = (phases.firstIndex(of: .deload) ?? -1) + 1
            let maintainFrom = (phases.firstIndex(of: .maintenance) ?? -1) + 1
            var lines: [String] = []
            if introCount > 0 { lines.append(introSentence(introCount)) }
            lines.append("Load climbs on the main lifts whenever you own the top of the rep range with two or three reps still in the tank. "
                + "If a set feels like a grind, it was too heavy — stop the set, not the session.")
            if maintainFrom > 0 {
                lines.append("From week \(maintainFrom) the loads stop climbing and the sets come down. That is deliberate: strength is defended by intensity, and the volume is what your \(meta.label.lowercased()) training needs back.")
            }
            if taperWeek > 0 { lines.append("Week \(taperWeek) backs off — same kind of weight, a third of the work.") }
            lines.append("The coach will never add sets to this plan. It can trim them, and it will if your logged sessions say you are running out of road.")
            return lines.joined(separator: " ")
        }
        let deloadWeek = (phases.firstIndex(of: .deload) ?? -1) + 1
        let deloadLine = deloadWeek > 0
            ? " Week \(deloadWeek) is a planned deload — roughly 10% lighter across the board — so the rebound lands inside this block, not after it."
            : " No deload is scheduled; any lift that stalls still gets an automatic reactive deload from the in-workout coach."
        let introLine = introCount > 0 ? "\(introSentence(introCount)) " : ""
        if experience == .beginner {
            return introLine
                + "Start each new lift lighter than feels necessary — a weight you could do 3–4 more reps with — and focus on clean, controlled form. "
                + "Each session, if you hit the top of the rep range with good technique, add the smallest jump (usually \(Units.fmtWeight(5)), or \(Units.fmtWeight(2.5)) on smaller lifts) next time. "
                + "As a beginner this simple \"add a little every week\" progression works for months — the coach handles the bookkeeping and eases you back if a weight gets away from you."
                + deloadLine + " \(PlanMath.goalLabel(goal)) stays the destination — just keep showing up."
        }
        let base = goal == .strength
            ? "Loading runs on double progression with bigger jumps on the main lifts: own the top of the rep range on every set and the coach adds weight next session. As the block moves into its peak weeks, reps drop and loads climb."
            : "Loading runs on double progression: hit the top of the rep range on every set and the coach adds weight next session; miss the bottom and it eases you back. Set counts stay adaptive week to week within the block's guardrails."
        return introLine + base + deloadLine + " \(PlanMath.goalLabel(goal)) stays the destination — the in-workout coach optimizes the route."
    }
}
