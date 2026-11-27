import Foundation

// Port of src/data/strength.ts — 1RM records, %1RM bands, logged maxes,
// strength trends and goal projections.

public struct PercentBand: Codable, Hashable, Sendable { public var low: Double; public var high: Double }
public struct LoadBand: Codable, Hashable, Sendable { public var working: Double; public var top: Double; public var pct: PercentBand }
public struct ProgramLoad: Codable, Hashable, Sendable { public var day: WorkoutDay; public var slot: Exercise; public var band: LoadBand? }
public struct LoggedMax: Codable, Hashable, Sendable { public var e1rm: Double; public var weight: Double; public var reps: Double; public var ts: Double }
public struct E1rmTsPoint: Codable, Hashable, Sendable { public var ts: Double; public var e1rm: Double }
public struct StrengthTrend: Codable, Hashable, Sendable { public var ratePctPerWeek: Double; public var points: Int; public var spanWeeks: Double }
public enum MaxBasis: String, Codable, Hashable, Sendable { case tested, entered, log }
public struct CurrentMax: Codable, Hashable, Sendable { public var value: Double; public var basis: MaxBasis; public var ts: Double; public var logExceedsStored: Bool }
public enum GoalFeasibility: String, Codable, Hashable, Sendable { case reached, close, realistic, ambitious, longShot = "long-shot" }
public enum ProjectionBasis: String, Codable, Hashable, Sendable { case observed, expected, tempered }

public struct GoalProjection: Codable, Hashable, Sendable {
    public var current: Double, target: Double, gapPct: Double
    public var feasibility: GoalFeasibility
    public var weeks: Double?, weeksFast: Double?, weeksSlow: Double?, etaTs: Double?
    public var ratePctPerWeek: Double
    public var basis: ProjectionBasis
    public var notes: [String]
}

public struct ProjectionInput: Codable, Hashable, Sendable {
    public var current: Double, target: Double
    public var experience: ExperienceLevel
    public var goal: Goal
    public var trend: StrengthTrend?
    public var now: Double?
}

public enum Strength {
    public static func emptyStrengthState() -> StrengthState { StrengthState(maxes: [], goals: []) }
    public static func pctOfMaxForReps(_ reps: Double) -> Double { 1 / (1 + reps / 30) }
    public static func pctOfMax(_ load: Double, _ max: Double) -> Double { max > 0 ? JS.round(load / max * 100) : 0 }

    public static func percentBandFor(_ slot: Exercise) -> PercentBand? {
        guard let lo = slot.repLow, let hi = slot.repHigh else { return nil }
        return PercentBand(low: JS.round(pctOfMaxForReps(Double(hi)) * Recommendations.reanchorSafety * 100),
                           high: JS.round(pctOfMaxForReps(Double(lo)) * Recommendations.reanchorSafety * 100))
    }

    public static func loadBandFor(_ max: Double, _ slot: Exercise, _ weightType: WeightType? = nil) -> LoadBand? {
        guard let pct = percentBandFor(slot), max > 0, let lo = slot.repLow, let hi = slot.repHigh else { return nil }
        return LoadBand(working: Recommendations.loadFromMax(max, Double(hi), weightType),
                        top: JS.round(Recommendations.loadForReps(max, Double(lo)) * Recommendations.reanchorSafety), pct: pct)
    }

    public static func programLoadsFor(_ exerciseId: String, _ max: Double, _ program: [WorkoutDay], _ weightType: WeightType? = nil) -> [ProgramLoad] {
        program.flatMap { day in day.exercises.filter { $0.id == exerciseId }.map { ProgramLoad(day: day, slot: $0, band: loadBandFor(max, $0, weightType)) } }
    }

    static func validForMax(_ s: SetLog, _ id: String) -> Bool {
        s.exerciseId == id && s.weight > 0 && s.reps > 0 && s.reps <= Recommendations.e1rmValidReps && Variations.countsForStrength(s.technique)
    }

    public static func bestLoggedMax(_ snap: TrainingSnapshot, _ exerciseId: String) -> LoggedMax? {
        var best: LoggedMax?
        for session in snap.sessions {
            let ts = Analytics.sessionTimestamp(session)
            for s in snap.setsBySession[session.id ?? -1] ?? [] where validForMax(s, exerciseId) {
                let e = Analytics.epley1RM(s.weight, s.reps)
                if best == nil || e > best!.e1rm { best = LoggedMax(e1rm: e, weight: s.weight, reps: s.reps, ts: ts) }
            }
        }
        return best
    }

    public static func e1rmSeriesFor(_ snap: TrainingSnapshot, _ exerciseId: String) -> [E1rmTsPoint] {
        var pts: [E1rmTsPoint] = []
        for session in snap.sessions {
            var best = 0.0
            for s in snap.setsBySession[session.id ?? -1] ?? [] where validForMax(s, exerciseId) { best = Swift.max(best, Analytics.epley1RM(s.weight, s.reps)) }
            if best > 0 { pts.append(E1rmTsPoint(ts: Analytics.sessionTimestamp(session), e1rm: best)) }
        }
        return pts.jsSorted { $0.ts - $1.ts }
    }

    public static let trendWindowWeeks = 12.0
    static let trendMinPoints = 3, trendMinSpanWeeks = 3.0, weekMs = 7 * 86_400_000.0

    public static func strengthTrend(_ snap: TrainingSnapshot, _ exerciseId: String, now: Double = LiftLogEnv.now()) -> StrengthTrend? {
        let cutoff = now - trendWindowWeeks * weekMs
        let pts = e1rmSeriesFor(snap, exerciseId).filter { $0.ts >= cutoff }
        if pts.count < trendMinPoints { return nil }
        let span = (pts[pts.count - 1].ts - pts[0].ts) / weekMs
        if span < trendMinSpanWeeks { return nil }
        let xs = pts.map { ($0.ts - pts[0].ts) / weekMs }, ys = pts.map(\.e1rm)
        let mx = xs.reduce(0, +) / Double(xs.count), my = ys.reduce(0, +) / Double(ys.count)
        var num = 0.0, den = 0.0
        for i in xs.indices { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx) }
        if den == 0 { return nil }
        let slope = num / den
        let level = my + slope * (xs[xs.count - 1] - mx)
        if level <= 0 { return nil }
        return StrengthTrend(ratePctPerWeek: slope / level * 100, points: pts.count, spanWeeks: span)
    }

    public static func currentMax(_ stored: OneRepMax?, _ logged: LoggedMax?) -> CurrentMax? {
        if let stored, stored.weight > 0 {
            if let logged, logged.ts > stored.updatedAt && logged.e1rm > stored.weight {
                return CurrentMax(value: JS.round(logged.e1rm), basis: .log, ts: logged.ts, logExceedsStored: true)
            }
            return CurrentMax(value: stored.weight, basis: stored.source == .tested ? .tested : .entered, ts: stored.updatedAt, logExceedsStored: false)
        }
        if let logged { return CurrentMax(value: JS.round(logged.e1rm), basis: .log, ts: logged.ts, logExceedsStored: false) }
        return nil
    }

    public static let expectedWeeklyGainPct: [ExperienceLevel: Double] = [.beginner: 1.3, .intermediate: 0.55, .advanced: 0.18]
    static let observedMinScale = 0.5, observedMaxScale = 2.0, flatTrendScale = 0.5, etaFast = 1.4, etaSlow = 0.7
    public static let projectionHorizonWeeks = 104.0
    public static let goalRateScale: [Goal: Double] = [.strength: 1.15, .hypertrophy: 1.0, .general: 0.9, .athletic: 1.0, .fatLoss: 0.3, .sportSupport: 0.5]

    static func weeksAt(_ ratio: Double, _ rate: Double) -> Double? {
        if rate <= 0 { return nil }
        let w = log(ratio) / log(1 + rate / 100)
        return w > projectionHorizonWeeks ? nil : w.rounded(.up)
    }

    public static func projectGoal(_ input: ProjectionInput) -> GoalProjection {
        let current = input.current, target = input.target, experience = input.experience, goal = input.goal
        let now = input.now ?? LiftLogEnv.now()
        var notes: [String] = []
        let gapPct = current > 0 ? (target - current) / current * 100 : 0
        let expected = expectedWeeklyGainPct[experience]!
        var rate = expected, basis = ProjectionBasis.expected
        if let trend = input.trend {
            if trend.ratePctPerWeek > 0 {
                rate = Swift.min(expected * observedMaxScale, Swift.max(expected * observedMinScale, trend.ratePctPerWeek))
                basis = .observed
                if trend.ratePctPerWeek > rate {
                    notes.append("Your recent pace (\(JS.toFixed(trend.ratePctPerWeek, 1))%/week) is faster than most \(experience.rawValue) lifters sustain — the estimate assumes it settles.")
                }
            } else {
                rate = expected * flatTrendScale; basis = .tempered
                notes.append("Your est. 1RM has been flat over the last \(JS.string(JS.round(trend.spanWeeks))) weeks — the estimate assumes progress resumes at half the usual pace once the plateau breaks.")
            }
        } else {
            notes.append("Not enough recent sessions to read your own pace yet — this uses the typical rate for \(experience == .intermediate || experience == .advanced ? "an" : "a") \(experience.rawValue) lifter.")
        }
        rate *= goalRateScale[goal] ?? 1
        if goal == .fatLoss {
            notes.append("You're in a fat-loss block: strength is defended, not built, in a deficit. Plan a strength or muscle block to chase this number.")
        } else if goal == .sportSupport {
            notes.append("Your lifting is supporting another sport, so the coach holds strength rather than chasing it — expect this to take longer than a dedicated strength block.")
        }
        if current <= 0 {
            return GoalProjection(current: current, target: target, gapPct: 0, feasibility: .longShot, weeks: nil, weeksFast: nil, weeksSlow: nil, etaTs: nil,
                                  ratePctPerWeek: rate, basis: basis, notes: ["Enter a current 1RM (or log a few sessions) and the coach can estimate a timeline."])
        }
        if target <= current {
            return GoalProjection(current: current, target: target, gapPct: gapPct, feasibility: .reached, weeks: 0, weeksFast: 0, weeksSlow: 0, etaTs: now,
                                  ratePctPerWeek: rate, basis: basis, notes: ["You're already there — set a new target, or test it and log the single."])
        }
        let ratio = target / current
        let weeks = weeksAt(ratio, rate), weeksFast = weeksAt(ratio, rate * etaFast), weeksSlow = weeksAt(ratio, rate * etaSlow)
        let feasibility: GoalFeasibility
        if let w = weeks {
            if gapPct <= 3 { feasibility = .close }
            else if w <= 16 { feasibility = .realistic }
            else if w <= 40 { feasibility = .ambitious }
            else { feasibility = .longShot; notes.append("A long way out — consider a milestone on the way (the next 5–10%) so progress stays visible.") }
        } else {
            feasibility = .longShot
            notes.append("At this pace that's more than \(Int(projectionHorizonWeeks / 52)) years out. A nearer milestone keeps the goal doing its job.")
        }
        return GoalProjection(current: current, target: target, gapPct: gapPct, feasibility: feasibility, weeks: weeks, weeksFast: weeksFast, weeksSlow: weeksSlow,
                              etaTs: weeks.map { now + $0 * weekMs }, ratePctPerWeek: rate, basis: basis, notes: notes)
    }

    public static let feasibilityLabel: [GoalFeasibility: String] = [.reached: "Reached", .close: "Within reach", .realistic: "Realistic", .ambitious: "Ambitious", .longShot: "Long shot"]

    public static func etaLabel(_ p: GoalProjection) -> String {
        if p.feasibility == .reached { return "already there" }
        guard let weeks = p.weeks else { return "more than two years at this pace" }
        let fast = p.weeksFast ?? weeks, slow = p.weeksSlow ?? weeks
        let band = fast == slow ? "" : " (\(JS.string(fast))–\(JS.string(slow)))"
        return "~\(JS.string(weeks)) week\(weeks == 1 ? "" : "s")\(band)"
    }

    public static func goalProgress(_ startMax: Double, _ current: Double, _ target: Double) -> Double {
        if target <= startMax { return 1 }
        return Swift.min(1, Swift.max(0, (current - startMax) / (target - startMax)))
    }
}
