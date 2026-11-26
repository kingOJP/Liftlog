import Foundation

// Port of src/data/recommendations.ts.

public struct LoggedSet: Codable, Hashable, Sendable {
    public var weight: Double
    public var reps: Double
    public var repLow: Int?
    public var repHigh: Int?
    public init(weight: Double, reps: Double, repLow: Int? = nil, repHigh: Int? = nil) {
        self.weight = weight; self.reps = reps; self.repLow = repLow; self.repHigh = repHigh
    }
}

public struct ExerciseSession: Codable, Hashable, Sendable {
    public var completedAt: Double
    public var sets: [LoggedSet]
    public var position: Int?
    public init(completedAt: Double, sets: [LoggedSet], position: Int? = nil) {
        self.completedAt = completedAt; self.sets = sets; self.position = position
    }
}

public enum RecKind: String, Codable, Hashable, Sendable { case increase, hold, decrease, deload, reanchor }
public enum RecDirection: String, Codable, Hashable, Sendable { case up, down, hold }

public struct WeightRec: Codable, Hashable, Sendable {
    public var weight: Double
    public var targetReps: Double?
    public var direction: RecDirection
    public var kind: RecKind
    public var reason: String
}

public struct PrescribedSlot: Codable, Hashable, Sendable {
    public var sets: Int, repLow: Int, repHigh: Int
    public init(sets: Int, repLow: Int, repHigh: Int) { self.sets = sets; self.repLow = repLow; self.repHigh = repHigh }
}

public struct PrescribedSet: Codable, Hashable, Sendable {
    public var setNumber: Int
    public var weight: Double?
    public var targetReps: Double?
}

public struct SetPlan: Codable, Hashable, Sendable {
    public var rec: WeightRec?
    public var sets: [PrescribedSet]
    public var goal: String
}

public struct OneRepMaxInput: Codable, Hashable, Sendable {
    public var weight: Double
    public var updatedAt: Double
}

public enum SetScheme: String, Codable, Hashable, Sendable { case straight, topSet = "top-set" }

public struct PrescriptionContext {
    public var weightType: WeightType?
    public var phase: PhaseKind?
    public var goal: Goal?
    public var experience: ExperienceLevel?
    public var unit: MeasureUnit?
    public var oneRepMax: OneRepMaxInput?
    public var now: Double?
    public var phaseOf: PlanMath.PhaseResolver?
    public var scheme: SetScheme?
    public init(weightType: WeightType? = nil, phase: PhaseKind? = nil, goal: Goal? = nil, experience: ExperienceLevel? = nil,
                unit: MeasureUnit? = nil, oneRepMax: OneRepMaxInput? = nil, now: Double? = nil,
                phaseOf: PlanMath.PhaseResolver? = nil, scheme: SetScheme? = nil) {
        self.weightType = weightType; self.phase = phase; self.goal = goal; self.experience = experience; self.unit = unit
        self.oneRepMax = oneRepMax; self.now = now; self.phaseOf = phaseOf; self.scheme = scheme
    }
}

public enum Recommendations {
    static let stallSessions = 3
    static let stallWindowDays = 35.0
    static let stallTolerance = 0.01
    static let positionShiftSlots = 2
    static let minWeight = 5.0
    static let pctLoadPerRep = 3.0
    public static let e1rmValidReps = 12.0
    static let e1rmBreakoutPct = 0.03
    static let bigMissReps = 2.0
    static let weeklyLoadCap: [ExperienceLevel: Double] = [.beginner: 0.10, .intermediate: 0.05, .advanced: 0.025]
    static let rangeMismatchReps = 2.0
    public static let reanchorSafety = 0.95
    static let maxAnchorMinShift = 0.05
    static let reanchorMaxStep = 0.20
    static let defaultExperience = ExperienceLevel.intermediate
    static let capEpsilon = 1e-6
    static let dayMs = 86_400_000.0
    static let weekMs = 7 * dayMs
    static let fatigueSampleSessions = 3
    static let defaultFatiguePct = 0.07

    static func typicalPosition(_ h: [ExerciseSession]) -> Int? {
        let p = h.compactMap(\.position).sorted()
        return p.isEmpty ? nil : p[p.count / 2]
    }
    static func isPositionShifted(_ s: ExerciseSession, _ typical: Int?) -> Bool {
        guard let p = s.position, let t = typical else { return false }
        return p >= t + positionShiftSlots
    }
    static func roundTo5(_ x: Double) -> Double { JS.round(x / 5) * 5 }
    static func roundToStep(_ x: Double, _ step: Double) -> Double { JS.round(x / step) * step }
    static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { Swift.min(hi, Swift.max(lo, x)) }

    public static func incrementFor(_ weight: Double, _ weightType: WeightType? = nil) -> Double {
        let rackLoaded = weightType == .dumbbell || weightType == .kettlebell
        if weight < 30 && !rackLoaded { return 2.5 }
        return Swift.max(5, roundTo5(weight * 0.025))
    }
    static func easeBack(_ weight: Double, _ factor: Double, _ step: Double) -> Double {
        Swift.max(minWeight, Swift.min(roundToStep(weight * factor, step), weight - step))
    }
    static func workingWeight(_ sets: [LoggedSet]) -> Double {
        var counts: [Double: Int] = [:]
        for s in sets { counts[s.weight, default: 0] += 1 }
        var best = sets[0].weight, bestCount = 0
        for (w, c) in counts where c > bestCount || (c == bestCount && w > best) { best = w; bestCount = c }
        return best
    }
    static func bestE1rm(_ sets: [LoggedSet]) -> Double { sets.reduce(0) { Swift.max($0, Analytics.epley1RM($1.weight, $1.reps)) } }

    static func freshBaseline(_ history: [ExerciseSession]) -> [ExerciseSession] {
        let withSets = history.filter { !$0.sets.isEmpty }
        if withSets.isEmpty { return [] }
        let typical = typicalPosition(withSets)
        let fresh = withSets.filter { !isPositionShifted($0, typical) }
        return fresh.isEmpty ? withSets : fresh
    }
    static func countedSets(_ s: ExerciseSession, _ sets: Int) -> [LoggedSet] {
        let w = workingWeight(s.sets)
        return Array(s.sets.filter { $0.weight == w }.prefix(sets))
    }
    static func equivalentReps(_ set: LoggedSet, _ weight: Double) -> Double {
        if weight <= 0 || set.weight <= weight { return set.reps }
        return set.reps + (((set.weight - weight) / weight) * 100) / pctLoadPerRep
    }

    struct Credit { var count: Int; var total: Double; var average: Double; var best: Double; var sets: [LoggedSet] }

    static func credit(_ s: ExerciseSession, _ sets: Int) -> Credit {
        let w = workingWeight(s.sets)
        let chosen = Array(s.sets.filter { $0.weight >= w }.jsSorted { equivalentReps($1, w) - equivalentReps($0, w) }.prefix(sets))
        let total = chosen.reduce(0) { $0 + equivalentReps($1, w) }
        return Credit(count: chosen.count, total: total, average: chosen.isEmpty ? 0 : total / Double(chosen.count),
                      best: chosen.reduce(0) { Swift.max($0, equivalentReps($1, w)) }, sets: chosen)
    }
    static func creditedAverage(_ s: ExerciseSession, _ sets: Int) -> Double? {
        let c = credit(s, sets); return c.count > 0 ? c.average : nil
    }
    static func bestWorkAt(_ sessions: [ExerciseSession], _ weight: Double, _ ex: PrescribedSlot) -> Double? {
        var best: Double? = nil
        for h in sessions where !h.sets.isEmpty {
            if abs(workingWeight(h.sets) - weight) >= 2.5 { continue }
            let c = credit(h, ex.sets)
            if c.count == 0 || c.average >= Double(ex.repHigh) + rangeMismatchReps { continue }
            if best == nil || c.total > best! { best = c.total }
        }
        return best
    }
    static func bestCountAt(_ sessions: [ExerciseSession], _ sets: Int) -> Double? {
        var best: Double? = nil
        for h in sessions where !h.sets.isEmpty && workingWeight(h.sets) == 0 {
            let c = credit(h, sets)
            if c.count == 0 { continue }
            if best == nil || c.total > best! { best = c.total }
        }
        return best
    }
    static func sessionRange(_ s: ExerciseSession) -> (repLow: Int, repHigh: Int)? {
        var order: [String] = [], counts: [String: Int] = [:]
        for x in s.sets {
            guard let lo = x.repLow, let hi = x.repHigh else { continue }
            let k = "\(lo)-\(hi)"
            if counts[k] == nil { order.append(k) }
            counts[k, default: 0] += 1
        }
        var best: String? = nil, bestCount = 0
        for k in order where counts[k]! > bestCount { best = k; bestCount = counts[k]! }
        guard let b = best else { return nil }
        let parts = b.split(separator: "-").map { Int($0)! }
        return (parts[0], parts[1])
    }
    static func sameEra(_ s: ExerciseSession, _ ex: PrescribedSlot) -> Bool {
        if let r = sessionRange(s) { return r.repLow == ex.repLow && r.repHigh == ex.repHigh }
        guard let avg = creditedAverage(s, ex.sets) else { return true }
        return avg < Double(ex.repHigh) + rangeMismatchReps && avg > Double(ex.repLow) - rangeMismatchReps
    }
    public static func historyDepthFor(_ experience: ExperienceLevel = .intermediate) -> Int {
        Progression.stallWindowFor(experience) + 2
    }
    public static func loadForReps(_ e1rm: Double, _ reps: Double) -> Double { e1rm / (1 + reps / 30) }
    public static func loadFromMax(_ oneRepMax: Double, _ repHigh: Double, _ weightType: WeightType? = nil) -> Double {
        let raw = loadForReps(oneRepMax, repHigh) * reanchorSafety
        let step = incrementFor(raw, weightType)
        return Swift.max(minWeight, (raw / step).rounded(.down) * step)
    }
    static func validE1rm(_ sets: [LoggedSet]) -> Double {
        sets.reduce(0) { $1.weight > 0 && $1.reps <= e1rmValidReps ? Swift.max($0, Analytics.epley1RM($1.weight, $1.reps)) : $0 }
    }
struct Reanchor { var weight: Double; var direction: RecDirection; var avgReps: Double; var e1rm: Double; var fromMax = false }

    static func maxReanchor(_ max: OneRepMaxInput?, _ last: ExerciseSession, _ ex: PrescribedSlot, _ weight: Double,
                            _ weightType: WeightType?) -> Reanchor? {
        guard let max, max.weight > 0, weight > 0, max.updatedAt > last.completedAt else { return nil }
        let anchor = loadFromMax(max.weight, Double(ex.repHigh), weightType)
        if abs(anchor - weight) / weight < maxAnchorMinShift { return nil }
        let lastAvg = creditedAverage(last, ex.sets)
        if anchor < weight && (lastAvg == nil || lastAvg! >= Double(ex.repLow)) { return nil }
        let step = incrementFor(weight, weightType)
        let capped = clamp(anchor, weight * (1 - reanchorMaxStep), weight * (1 + reanchorMaxStep))
        let target = Swift.max(minWeight, (capped / step).rounded(.down) * step)
        if target == weight { return nil }
        return Reanchor(weight: target, direction: target > weight ? .up : .down, avgReps: lastAvg ?? 0, e1rm: max.weight, fromMax: true)
    }

    static func rangeReanchor(_ baseline: [ExerciseSession], _ ex: PrescribedSlot, _ weight: Double, _ step: Double) -> Reanchor? {
        if weight <= 0 || baseline.isEmpty { return nil }
        guard let avg = creditedAverage(baseline[0], ex.sets) else { return nil }
        let hi = Double(ex.repHigh), lo = Double(ex.repLow)
        let tooLight = avg >= hi + rangeMismatchReps, tooHeavy = avg <= lo - rangeMismatchReps
        if !tooLight && !tooHeavy { return nil }
        let prev = baseline.count > 1 ? creditedAverage(baseline[1], ex.sets) : nil
        if tooLight ? (prev != nil && prev! <= hi) : (prev == nil || prev! >= lo) { return nil }
        let e1rm = validE1rm(baseline[0].sets)
        let byE1rm: Double? = e1rm > 0 ? loadForReps(e1rm, hi) * reanchorSafety : nil
        let byReps = weight * (1 + ((avg - hi) * pctLoadPerRep) / 100)
        let predicted = byE1rm.map { tooLight ? Swift.max($0, byReps) : Swift.min($0, byReps) } ?? byReps
        let capped = clamp(predicted, weight * (1 - reanchorMaxStep), weight * (1 + reanchorMaxStep))
        let target = Swift.max(minWeight, (capped / step).rounded(.down) * step)
        if tooLight && target <= weight { return nil }
        if tooHeavy && target >= weight { return nil }
        return Reanchor(weight: target, direction: target > weight ? .up : .down, avgReps: avg, e1rm: e1rm)
    }

    static func repSum(_ sets: [LoggedSet]) -> Double { sets.reduce(0) { $0 + $1.reps } }

    static func predictReps(_ reps: Double, _ from: Double, _ to: Double) -> Double {
        if from <= 0 { return reps }
        return reps - (((to - from) / from) * 100) / pctLoadPerRep
    }

    static func sizedIncrement(_ weight: Double, _ avgReps: Double, _ repLow: Double, _ step: Double) -> Double {
        let room = Swift.max(0, avgReps - repLow)
        let maxJump = weight * (room * pctLoadPerRep) / 100
        if maxJump < step { return step }
        return (maxJump / step).rounded(.down) * step
    }

    static func weeklyCeiling(_ baseline: [ExerciseSession], _ now: Double, _ experience: ExperienceLevel) -> Double? {
        let cutoff = now - weekMs
        let inWeek = baseline.filter { $0.completedAt >= cutoff }
        guard let anchor = inWeek.last ?? baseline.first else { return nil }
        let weekAgo = workingWeight(anchor.sets)
        if weekAgo <= 0 { return nil }
        return weekAgo * (1 + weeklyLoadCap[experience]!)
    }
public static func calculateRecommendation(_ history: [ExerciseSession], _ exercise: Exercise,
                                               _ ctx: PrescriptionContext = .init()) -> WeightRec? {
        let weightType = ctx.weightType, phase = ctx.phase
        let goal = ctx.goal ?? .general, experience = ctx.experience ?? defaultExperience
        let now = ctx.now ?? LiftLogEnv.now()
        let baseline = freshBaseline(history)
        if baseline.isEmpty { return firstSessionFromMax(exercise, ctx) }
        let withSets = history.filter { !$0.sets.isEmpty }
        let skippedShifted = baseline[0] != withSets[0]
        let last = baseline[0]
        let weight = workingWeight(last.sets)
        if exercise.progression == .manual {
            return WeightRec(weight: weight, direction: .hold, kind: .hold, reason: "Your own progression — last time's weight is pre-filled, the rest is yours")
        }
        let countProgressed = weight == 0
        func withContext(_ r: WeightRec) -> WeightRec {
            guard skippedShifted else { return r }
            var o = r; o.reason = "\(r.reason) (last session ran later in your workout than usual — not held against you)"; return o
        }
        guard let repLow = exercise.repLow, let repHigh = exercise.repHigh else {
            if PlanMath.isEasyPhase(phase), weight > 0 {
                return withContext(WeightRec(weight: easeBack(weight, phase == .raceWeek ? 0.7 : phase == .intro ? 0.8 : 0.9, incrementFor(weight, weightType)),
                                             direction: .down, kind: .deload, reason: "Planned easy week — lighter than last time, crisp reps"))
            }
            return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold,
                                         reason: "No rep target set — log a few sessions and the coach will learn your working range"))
        }
        let ex = PrescribedSlot(sets: Swift.max(1, exercise.sets), repLow: repLow, repHigh: repHigh)
        let lo = Double(ex.repLow), hi = Double(ex.repHigh)
        let step = incrementFor(weight, weightType)
        let rangeChanged: Bool = { if let r = sessionRange(last) { return r.repLow != ex.repLow || r.repHigh != ex.repHigh }; return false }()
        let chosenRange = exercise.rangeSource != .history
        let reanchor: Reanchor? = countProgressed ? nil
            : (maxReanchor(ctx.oneRepMax, last, ex, weight, weightType) ?? (chosenRange ? rangeReanchor(baseline, ex, weight, step) : nil))
        if PlanMath.isEasyPhase(phase) {
            let firstExposure = phase == .intro && !countProgressed
                && baseline.allSatisfy { PlanMath.isEasyPhase(ctx.phaseOf?($0.completedAt) ?? nil) }
            if firstExposure {
                return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold,
                    reason: "Intro week — repeat the easy weight from your first session; the point is a second clean exposure, not a lighter one"))
            }
            let easy = phase == .deload ? "Planned deload week — ~10% lighter, crisp reps, let fatigue drain"
                : phase == .raceWeek ? "Race week — ~30% lighter and just a couple of sets. Sharpness, not fitness"
                : phase == .intro ? "Intro week — well short of your working weight. Learn the movement, leave 4–5 reps in the tank"
                : "Recovery week — ~10% lighter while you ramp back into training"
            let factor = phase == .raceWeek ? 0.7 : phase == .intro ? 0.8 : 0.9
            let introBase = reanchor?.weight ?? (phase == .deload ? weight : Swift.max(baseline.map { workingWeight($0.sets) }.max()!, weight))
            if countProgressed { return WeightRec(weight: 0, targetReps: lo, direction: .down, kind: .deload, reason: easy) }
            return WeightRec(weight: easeBack(introBase, factor, incrementFor(introBase, weightType)), direction: .down, kind: .deload, reason: easy)
        }
        if countProgressed {
            return withContext(repProgression(baseline, last, ex, goal, ctx.unit ?? .reps, experience))
        }
        if let r = reanchor {
            let range = "\(ex.repLow)–\(ex.repHigh)"
            if r.fromMax {
                return withContext(WeightRec(weight: r.weight, direction: r.direction, kind: .reanchor,
                    reason: "Your \(Units.fmtWeight(r.e1rm)) 1RM puts \(range) reps at \(Units.fmtWeight(r.weight)) (\(JS.string(pctOfMax(r.weight, r.e1rm)))% of max) — \(r.direction == .up ? "more than" : "less than") the \(Units.fmtWeight(weight)) you've been working. Re-anchoring to the max you entered"))
            }
            let basis = r.e1rm > 0 ? "your est. 1RM of \(Units.fmtWeight(JS.round(r.e1rm))) puts \(range) reps at" : "matching that effort to \(range) reps puts you at"
            return withContext(WeightRec(weight: r.weight, direction: r.direction, kind: .reanchor,
                reason: "You've been working \(Units.fmtWeight(weight)) for about \(JS.string(JS.round(r.avgReps))) reps — that's a \(r.direction == .up ? "lighter" : "heavier") range than this block's \(range). Re-anchoring: \(basis) \(Units.fmtWeight(r.weight))"))
        }
        let credited = credit(last, ex.sets)
        let strict = countedSets(last, ex.sets)
        let setsDone = credited.count
        let maxReps = credited.sets.map(\.reps).max() ?? -.infinity
        let repTotal = credited.total
        let avgReps = credited.average
        let strictAvg = repSum(strict) / Double(strict.count)
        let fullSetCount = setsDone >= ex.sets
        let e1rmMeaningful = maxReps <= e1rmValidReps
        func increaseTo(_ jump: Double, _ evidence: String) -> WeightRec {
            let era = baseline.filter { sameEra($0, ex) }
            let ceiling = weeklyCeiling(era.isEmpty ? baseline : era, now, experience)
            if let ceiling, weight >= ceiling - capEpsilon {
                return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold,
                    reason: "\(evidence) — but this lift already went up this week. Repeat \(Units.fmtWeight(weight)) and add load next week"))
            }
            var target = weight + jump, rateLimited = false
            if let ceiling, target > ceiling + capEpsilon {
                let allowed = Swift.max(step, ((ceiling - weight) / step).rounded(.down) * step)
                if allowed < jump { target = weight + allowed; rateLimited = true }
            }
            return withContext(WeightRec(weight: target, direction: .up, kind: .increase,
                reason: rateLimited ? "\(evidence) — up to \(Units.fmtWeight(target)), holding a steady week-over-week climb"
                                    : "\(evidence) — go to \(Units.fmtWeight(target))"))
        }
        let priorBest = bestWorkAt(Array(baseline.dropFirst()), weight, ex)
        let rangeTopped = credited.best >= hi
        let beginnerCeiling = experience == .beginner && fullSetCount && credited.sets.allSatisfy { $0.reps >= hi }
        if fullSetCount && rangeTopped && (beginnerCeiling || priorBest == nil || repTotal >= priorBest!) {
            let jump = goal == .fatLoss ? step : sizedIncrement(weight, avgReps, lo, step)
            let evidence = priorBest == nil ? "Hit \(ex.repHigh) reps at \(Units.fmtWeight(weight))"
                : "\(JS.string(JS.round(repTotal))) reps at \(Units.fmtWeight(weight)) — your best work at this load, with a set at \(ex.repHigh)"
            return increaseTo(jump, evidence)
        }
        let recentFresh = Array(baseline.prefix(stallSessions))
        if e1rmMeaningful && fullSetCount && recentFresh.count >= 2 && avgReps >= hi - 1 {
            let priorAtWeight = recentFresh.dropFirst().filter { abs(workingWeight($0.sets) - weight) < 2.5 }
            if let oldest = priorAtWeight.last, bestE1rm(last.sets) >= bestE1rm(oldest.sets) * (1 + e1rmBreakoutPct) {
                let gain = JS.round((bestE1rm(last.sets) / bestE1rm(oldest.sets) - 1) * 100)
                return increaseTo(step, "Est. 1RM up \(JS.string(gain))% at \(Units.fmtWeight(weight)) with reps at the top of the range")
            }
        }
        let stallWindow = Progression.stallWindowFor(experience)
        let window = Array(baseline.prefix(stallWindow))
        let sparseWindow = window.count >= stallWindow && window[0].completedAt - window[window.count - 1].completedAt > stallWindowDays * dayMs
        if window.count >= stallWindow && !sparseWindow {
            let sameWeight = window.allSatisfy { abs(workingWeight($0.sets) - weight) < 2.5 }
            let anchor = window[window.count - 1]
            let anchorTotal = credit(anchor, ex.sets).total
            let anchorE1rm = bestE1rm(anchor.sets)
            let since = window.dropLast()
            let bestTotal = since.map { credit($0, ex.sets).total }.max() ?? -.infinity
            let bestSinceE1rm = since.map { bestE1rm($0.sets) }.max() ?? -.infinity
            let volumeChangePct = Progression.deadband(Progression.pctChange(anchorTotal, bestTotal))
            let e1rmChangePct = e1rmMeaningful ? Progression.deadband(Progression.pctChange(anchorE1rm, bestSinceE1rm)) : nil
            let prEvents = since.filter { credit($0, ex.sets).total > anchorTotal || (e1rmMeaningful && bestE1rm($0.sets) > anchorE1rm * (1 + stallTolerance)) }.count
            let score = Progression.compositeScore(ProgressSignals(e1rmChangePct: e1rmChangePct, volumeChangePct: volumeChangePct, prEvents: Double(prEvents)), goal, experience)
            let flat = sameWeight && score < Progression.progressScore
            let stalled = sameWeight && score < Progression.stallScore
            let holds = Progression.holdsInsteadOfDeload(goal, experience)
            if holds ? flat : stalled {
                if holds {
                    let why = goal == .fatLoss ? "Holding \(Units.fmtWeight(weight)) through a deficit is the win — defend this load, PRs come back when you eat"
                        : goal == .sportSupport ? "Flat at \(Units.fmtWeight(weight)), but your legs are paying for the miles — holding this load through the block is the win"
                        : "Flat for \(window.count) sessions — repeat \(Units.fmtWeight(weight)) and chase one more rep before changing anything"
                    return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold, reason: why))
                }
                return withContext(WeightRec(weight: easeBack(weight, 0.9, step), direction: .down, kind: .deload,
                    reason: "\(window.count) sessions at \(Units.fmtWeight(weight)) with no gain in volume or strength — deload, then build back up"))
            }
        }
        let judgedAvg = Swift.max(strictAvg, avgReps)
        if judgedAvg < lo && rangeChanged {
            let was = sessionRange(last)!
            return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold,
                reason: "Your rep range moved from \(was.repLow)–\(was.repHigh) to \(ex.repLow)–\(ex.repHigh) — same \(Units.fmtWeight(weight)), new targets. Give it a session here before anything changes"))
        }
        if judgedAvg < lo {
            var repeated = false
            if baseline.count > 1, abs(workingWeight(baseline[1].sets) - weight) < 2.5, let prev = creditedAverage(baseline[1], ex.sets) { repeated = prev < lo }
            let bigMiss = goal != .fatLoss && judgedAvg <= lo - bigMissReps
            if repeated || bigMiss {
                return withContext(WeightRec(weight: easeBack(weight, 0.95, step), direction: .down, kind: .decrease,
                    reason: repeated ? "Two sessions under \(ex.repLow) reps — ease back and rebuild" : "Reps fell well under \(ex.repLow) reps — ease back and rebuild"))
            }
            return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold,
                reason: "Short of \(ex.repLow) reps, but one session isn't a trend — repeat \(Units.fmtWeight(weight)) before dropping it"))
        }
        let gap = JS.round((priorBest ?? 0) - repTotal), pb = JS.string(JS.round(priorBest ?? 0))
        let reason = !fullSetCount ? "Complete all \(ex.sets) sets at this weight, then chase reps"
            : sparseWindow ? "You've been away from this one — settle back in at \(Units.fmtWeight(weight)) before pushing, then a set at \(ex.repHigh) reps earns the next increase"
            : !rangeTopped ? "Get one set to \(ex.repHigh) reps at \(Units.fmtWeight(weight)) — that's what earns the next increase"
            : gap <= 0 ? "Match your best at \(Units.fmtWeight(weight)) (\(pb) reps) with a set at \(ex.repHigh) to earn the next increase"
            : "\(JS.string(gap)) more rep\(gap == 1 ? "" : "s") would match your best at \(Units.fmtWeight(weight)) (\(pb)) — that earns the next increase"
        return withContext(WeightRec(weight: weight, direction: .hold, kind: .hold, reason: reason))
    }
static func pctOfMax(_ load: Double, _ max: Double) -> Double { JS.round((load / max) * 100) }

    static func firstSessionFromMax(_ exercise: Exercise, _ ctx: PrescriptionContext) -> WeightRec? {
        guard let max = ctx.oneRepMax, max.weight > 0, let repLow = exercise.repLow, let repHigh = exercise.repHigh else { return nil }
        if ctx.weightType == .bodyweight || ctx.unit == .seconds { return nil }
        let anchor = loadFromMax(max.weight, Double(repHigh), ctx.weightType)
        let range = "\(repLow)–\(repHigh)"
        if PlanMath.isEasyPhase(ctx.phase) {
            let factor = ctx.phase == .raceWeek ? 0.7 : ctx.phase == .intro ? 0.8 : 0.9
            let eased = easeBack(anchor, factor, incrementFor(anchor, ctx.weightType))
            return WeightRec(weight: eased, direction: .down, kind: .deload,
                reason: "Easy week — your \(Units.fmtWeight(max.weight)) 1RM puts \(range) reps at \(Units.fmtWeight(anchor)); starting well under that at \(Units.fmtWeight(eased))")
        }
        return WeightRec(weight: anchor, direction: .hold, kind: .reanchor,
            reason: "First time logging this one — your \(Units.fmtWeight(max.weight)) 1RM puts \(range) reps at \(Units.fmtWeight(anchor)) (\(JS.string(pctOfMax(anchor, max.weight)))% of max)")
    }

    static func repProgression(_ baseline: [ExerciseSession], _ last: ExerciseSession, _ ex: PrescribedSlot, _ goal: Goal,
                               _ unit: MeasureUnit = .reps, _ experience: ExperienceLevel = .intermediate) -> WeightRec {
        let timed = unit == .seconds
        func n(_ v: Double) -> String { timed ? "\(JS.string(v))s" : "\(JS.string(v)) reps" }
        let lo = Double(ex.repLow), hi = Double(ex.repHigh)
        let credited = credit(last, ex.sets)
        let strict = countedSets(last, ex.sets)
        let set1 = strict.first?.reps ?? JS.round(credited.average)
        let fullSetCount = credited.count >= ex.sets
        let priorBest = bestCountAt(Array(baseline.dropFirst()), ex.sets)
        if fullSetCount && credited.best >= hi && (priorBest == nil || credited.total >= priorBest!) {
            let target = Swift.max(set1, hi) + 1
            let tot = JS.string(JS.round(credited.total))
            return WeightRec(weight: 0, targetReps: target, direction: .up, kind: .increase,
                reason: timed ? "\(tot)s total with a hold at \(ex.repHigh)s — your best here. Push for \(n(target)) on the first hold"
                              : "\(tot) reps with a set at \(ex.repHigh) — your best at this one. Push for \(JS.string(target)) reps on set 1, or add weight")
        }
        let strictAvg = strict.isEmpty ? credited.average : repSum(strict) / Double(strict.count)
        let judgedAvg = Swift.max(strictAvg, credited.average)
        let buildTarget = Swift.max(1, Swift.min(lo, JS.round(judgedAvg) + 1))
        let stallWindow = Progression.stallWindowFor(experience)
        let window = Array(baseline.prefix(stallWindow))
        let sparseWindow = window.count >= stallWindow && window[0].completedAt - window[window.count - 1].completedAt > stallWindowDays * dayMs
        if window.count >= stallWindow && !sparseWindow {
            let anchorTotal = credit(window[window.count - 1], ex.sets).total
            let progressed = window.dropLast().contains { credit($0, ex.sets).total > anchorTotal }
            if !progressed {
                if Progression.holdsInsteadOfDeload(goal, experience) {
                    let standard = Swift.max(set1, lo)
                    return WeightRec(weight: 0, targetReps: standard, direction: .hold, kind: .hold,
                        reason: goal == .fatLoss ? "Holding \(n(standard)) through a deficit is the win — defend this standard"
                            : goal == .sportSupport ? "Flat at \(n(standard)), but the miles are paying for it — holding here through the block is the win"
                            : "Flat for \(window.count) sessions — repeat \(n(standard)) and chase one more before changing anything")
                }
                if judgedAvg < lo {
                    return WeightRec(weight: 0, targetReps: buildTarget, direction: .down, kind: .deload,
                        reason: timed ? "Stalled \(window.count) sessions under \(n(lo)) — build to it: \(n(buildTarget)) per hold, clean"
                                      : "Stalled \(window.count) sessions under \(ex.repLow) reps — build to it: \(JS.string(buildTarget)) clean reps per set")
                }
                return WeightRec(weight: 0, targetReps: lo, direction: .down, kind: .deload,
                    reason: timed ? "Stalled \(window.count) sessions — reset to \(n(lo)) of clean bracing and build back up"
                                  : "Stalled \(window.count) sessions — reset to \(ex.repLow) crisp reps and build back up")
            }
        }
        if judgedAvg < lo {
            let prevAvg = baseline.count > 1 ? creditedAverage(baseline[1], ex.sets) : nil
            let repeated = prevAvg != nil && prevAvg! < lo
            let bigMiss = goal != .fatLoss && judgedAvg <= lo - bigMissReps
            if repeated || bigMiss {
                return WeightRec(weight: 0, targetReps: buildTarget, direction: .down, kind: .decrease,
                    reason: timed ? "Holds fell under \(n(lo)) — build to it: \(n(buildTarget)) per hold this time"
                                  : "Reps fell under \(ex.repLow) — build to it: \(JS.string(buildTarget)) clean reps per set this time")
            }
            return WeightRec(weight: 0, targetReps: lo, direction: .hold, kind: .hold,
                reason: "Short of \(n(lo)), but one session isn't a trend — aim for the range again before changing anything")
        }
        let target = clamp(set1 + 1, lo, hi)
        let reason = !fullSetCount ? "Complete all \(ex.sets) sets, then chase \(timed ? "time" : "reps")"
            : sparseWindow ? "You've been away from this one — settle back in, then aim for \(n(target))+ on set 1"
            : (priorBest != nil && credited.best >= hi)
                ? "\(JS.string(Swift.max(1, (priorBest! - credited.total).rounded(.up)))) more \(timed ? "seconds" : "reps") than your best here (\(JS.string(JS.round(priorBest!)))) earns the next step"
                : "In range — aim for \(n(target)) on set 1; a set at \(ex.repHigh) with your best total earns the next step"
        return WeightRec(weight: 0, targetReps: target, direction: .hold, kind: .hold, reason: reason)
    }

    public static let regressionMisses = 3
    public static func needsRegression(_ history: [ExerciseSession], _ exercise: Exercise) -> Bool {
        guard let repLow = exercise.repLow, exercise.repHigh != nil else { return false }
        let baseline = Array(freshBaseline(history).prefix(regressionMisses))
        if baseline.count < regressionMisses { return false }
        let sets = Swift.max(1, exercise.sets)
        return baseline.allSatisfy { h in
            if workingWeight(h.sets) != 0 { return false }
            guard let avg = creditedAverage(h, sets) else { return false }
            return avg < Double(repLow)
        }
    }
static func topSetView(_ history: [ExerciseSession]) -> [ExerciseSession] {
        history.map { h in
            if h.sets.isEmpty { return h }
            let top = h.sets.map(\.weight).max()!
            var o = h; o.sets = h.sets.filter { $0.weight == top }; return o
        }
    }

    static func fatigueDrops(_ baseline: [ExerciseSession], _ sets: Int, _ baseReps: Double) -> [Double] {
        var sums = [Double](repeating: 0, count: Swift.max(sets, 1)), counts = [Int](repeating: 0, count: Swift.max(sets, 1))
        for h in baseline.prefix(fatigueSampleSessions) {
            let w = workingWeight(h.sets)
            let working = h.sets.filter { $0.weight == w }
            if working.count < 2 { continue }
            var i = 1
            while i < Swift.min(working.count, sets) { sums[i] += working[i].reps - working[0].reps; counts[i] += 1; i += 1 }
        }
        var drops: [Double] = [0]
        var i = 1
        while i < sets {
            let drop = counts[i] > 0 ? JS.round(sums[i] / Double(counts[i])) : -JS.round(baseReps * defaultFatiguePct * Double(i))
            drops.append(Swift.min(0, drop)); i += 1
        }
        return drops
    }

    public static func buildSetPlan(_ history: [ExerciseSession], _ exercise: Exercise, _ ctx: PrescriptionContext = .init()) -> SetPlan {
        let count = Swift.max(1, exercise.sets)
        let rec = calculateRecommendation(history, exercise, ctx)
        let phase = ctx.phase
        let timed = ctx.unit == .seconds
        let unitWord = timed ? "seconds" : "reps"
        if exercise.progression == .manual {
            let baseline = freshBaseline(history)
            let lastSets = baseline.isEmpty ? [] : countedSets(baseline[0], count)
            return SetPlan(rec: nil, sets: (0..<count).map { i in
                PrescribedSet(setNumber: i + 1, weight: (i < lastSets.count ? lastSets[i].weight : nil) ?? lastSets.first?.weight ?? rec?.weight, targetReps: nil)
            }, goal: "Your own progression — the coach stays out of this one and just remembers the weights.")
        }
        guard let repLow = exercise.repLow, let repHigh = exercise.repHigh else {
            return SetPlan(rec: rec, sets: (0..<count).map { PrescribedSet(setNumber: $0 + 1, weight: rec?.weight, targetReps: nil) },
                           goal: "No \(unitWord.dropLast()) target yet — log this session and the coach will learn the range you work in.")
        }
        let ex = PrescribedSlot(sets: exercise.sets, repLow: repLow, repHigh: repHigh)
        let lo = Double(repLow), hi = Double(repHigh)
        if ctx.scheme == .topSet && count > 1, let topPlan = topSetPlan(history, exercise, ex, count, ctx) { return topPlan }
        guard let rec else {
            return SetPlan(rec: nil, sets: (0..<count).map { PrescribedSet(setNumber: $0 + 1, weight: nil, targetReps: lo) },
                goal: timed ? "First time on this one — hold \(repLow)–\(repHigh) seconds with clean form, and stop before the form goes."
                    : ctx.weightType == .bodyweight ? "First time on this one — \(repLow)–\(repHigh) controlled reps, stopping while they still look good."
                    : "First time on this lift — find a weight you can control for \(repLow)–\(repHigh) reps with 1–2 in reserve.")
        }
        let bodyweight = rec.targetReps != nil && rec.weight == 0
        if rec.kind == .deload && PlanMath.isEasyPhase(phase) {
            return SetPlan(rec: rec, sets: (0..<count).map { PrescribedSet(setNumber: $0 + 1, weight: rec.weight, targetReps: lo) },
                goal: timed ? "Hold each set to the target and stop — the easy week is the plan working."
                            : "Leave 3–4 reps in reserve on every set. The easy week is the plan working.")
        }
        let baseline = freshBaseline(history)
        let lastCounted = baseline.isEmpty ? [] : countedSets(baseline[0], count)
        let lastWeight = lastCounted.first?.weight
        let lastAvg = baseline.isEmpty ? nil : creditedAverage(baseline[0], count)
        let openCeiling = bodyweight && rec.kind == .increase
        let topClamp = openCeiling ? Double.infinity : hi
        let floor = bodyweight && rec.targetReps != nil ? Swift.min(lo, rec.targetReps!) : lo
        let anchoredFirstSession = baseline.isEmpty && rec.kind == .reanchor
        let baseReps: Double
        if rec.kind == .hold {
            baseReps = clamp((lastCounted.first?.reps ?? lo) + 1, lo, bodyweight ? Swift.max(hi, rec.targetReps ?? 0) : hi)
        } else if bodyweight { baseReps = clamp(rec.targetReps!, floor, topClamp) }
        else if anchoredFirstSession { baseReps = clamp(hi - 1, lo, hi) }
        else if let la = lastAvg, let lw = lastWeight, lw > 0 { baseReps = clamp(JS.round(predictReps(la, lw, rec.weight)), lo, hi) }
        else { baseReps = lo }
        let drops = fatigueDrops(baseline, count, baseReps)
        let sets = (0..<count).map { PrescribedSet(setNumber: $0 + 1, weight: rec.weight, targetReps: clamp(baseReps + drops[$0], floor, topClamp)) }
        let planTotal = JS.string(sets.reduce(0) { $0 + ($1.targetReps ?? 0) })
        let toBeat = rec.weight > 0 ? bestWorkAt(freshBaseline(history), rec.weight, ex) : nil
        let holdGoal = toBeat == nil
            ? "Hit every target (\(planTotal) reps) — a set at \(repHigh) reps earns the next increase."
            : "Hit every target (\(planTotal) reps) — a set at \(repHigh), and \(JS.string(JS.round(toBeat!)))+ total at \(Units.fmtWeight(rec.weight)), earns the next increase."
        let countToBeat = bodyweight ? bestCountAt(freshBaseline(history), count) : nil
        let countGoal = timed
            ? "Hit every hold (\(planTotal)s total) — a hold at \(repHigh)s\(countToBeat.map { ", and \(JS.string(JS.round($0)))s+ in total," } ?? "") earns a longer target."
            : "Hit every target (\(planTotal) reps) — a set at \(repHigh)\(countToBeat.map { ", and \(JS.string(JS.round($0)))+ in total," } ?? "") earns a harder target or added load."
        let w = Units.fmtWeight(rec.weight)
        let goal = bodyweight ? countGoal
            : anchoredFirstSession ? "First session at \(w), set from your 1RM. Around \(planTotal) reps with 1–2 in reserve — the coach corrects from what you actually hit."
            : rec.kind == .reanchor ? "First session at \(w) — this is an estimate from your log, not a test. Around \(planTotal) reps with 1–2 in reserve, and the coach corrects from what you actually hit."
            : rec.kind == .increase ? "New load: \(w) — around \(planTotal) reps today. A set at \(repHigh) earns the next jump."
            : rec.kind == .hold ? holdGoal
            : "Rebuild at \(w): \(planTotal) clean reps, then start climbing again."
        return SetPlan(rec: rec, sets: sets, goal: goal)
    }

    static func topSetPlan(_ history: [ExerciseSession], _ exercise: Exercise, _ ex: PrescribedSlot, _ count: Int,
                           _ ctx: PrescriptionContext) -> SetPlan? {
        let topHistory = topSetView(history)
        var one = exercise; one.sets = 1
        guard let rec = calculateRecommendation(topHistory, one, ctx), rec.weight > 0 else { return nil }
        let lo = Double(ex.repLow), hi = Double(ex.repHigh)
        let step = incrementFor(rec.weight, ctx.weightType)
        let factor = Dosage.backoffFactor(ctx.phase)
        let backoff = Swift.max(minWeight, Swift.min(rec.weight - step, roundToStep(rec.weight * factor, step)))
        func rows(_ tw: Double, _ tr: Double, _ ow: Double, _ or: Double) -> [PrescribedSet] {
            (0..<count).map { $0 == 0 ? PrescribedSet(setNumber: 1, weight: tw, targetReps: tr) : PrescribedSet(setNumber: $0 + 1, weight: ow, targetReps: or) }
        }
        if rec.kind == .deload && PlanMath.isEasyPhase(ctx.phase) {
            return SetPlan(rec: rec, sets: rows(rec.weight, lo, backoff, lo),
                           goal: "Easy week — the top set stays submaximal and the back-offs are light. Leave 3–4 reps in reserve on every set.")
        }
        let baseline = freshBaseline(topHistory)
        let lastTop = baseline.isEmpty ? nil : countedSets(baseline[0], 1).first
        let topReps: Double
        if rec.kind == .hold { topReps = clamp((lastTop?.reps ?? lo) + 1, lo, hi) }
        else if let lt = lastTop, lt.weight > 0 { topReps = clamp(JS.round(predictReps(lt.reps, lt.weight, rec.weight)), lo, hi) }
        else { topReps = lo }
        let offReps = clamp(JS.round(predictReps(topReps, rec.weight, backoff)), lo, hi)
        var oneSlot = ex; oneSlot.sets = 1
        let toBeat = bestWorkAt(baseline, rec.weight, oneSlot)
        let w = Units.fmtWeight(rec.weight), b = Units.fmtWeight(backoff), tr = JS.string(topReps)
        let goal = rec.kind == .reanchor ? "Top set re-anchored to \(w) from your log — around \(tr) reps with 1–2 in reserve, then \(count - 1) back-offs at \(b)."
            : rec.kind == .increase ? "New top set: \(w) × \(tr), then \(count - 1) back-offs at \(b). A top set at \(ex.repHigh) reps earns the next jump."
            : rec.kind == .hold ? "Top set \(w) × \(tr)\(toBeat != nil && toBeat! > topReps ? " (your best here is \(JS.string(JS.round(toBeat!))))" : ""), then \(count - 1) back-offs at \(b). A top set at \(ex.repHigh) earns the next jump."
            : "Rebuild: top set \(w) × \(tr), back-offs at \(b), then start climbing again."
        return SetPlan(rec: rec, sets: rows(rec.weight, topReps, backoff, offReps), goal: goal)
    }
}
