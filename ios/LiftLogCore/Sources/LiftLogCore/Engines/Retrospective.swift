import Foundation

// Port of src/data/retrospective.ts — the end-of-block review whose carryover
// feeds the next planning cycle.

public enum Retrospective {
    static let weekMs = 7 * 86_400_000.0

    public static func computeBlockRetrospective(_ block: TrainingBlock, _ snap: TrainingSnapshot, now: Double = LiftLogEnv.now()) -> BlockRetrospective {
        let band = Analytics.volumeTargetFor(block.focus, block.experience)
        let from = PlanMath.blockAnchor(block)
        let to = Swift.min(now, PlanMath.blockEndTs(block) ?? now)
        let include: (Session) -> Bool = { s in let ts = Analytics.sessionTimestamp(s); return ts >= from && ts <= to }
        let inWindow = snap.sessions.filter(include)
        let openEnded = block.openEnded == true
        let weeks = Swift.max(1.0 / 7, Swift.min((to - from) / weekMs, openEnded ? .infinity : Double(block.phases.count)))
        let elapsedWeeks = openEnded ? 0 : Swift.min(block.phases.count, Int((weeks - 1e-9).rounded(.up)))
        var sessionsPlanned: Int?
        if !openEnded {
            var n = 0
            for w in 0..<Swift.max(0, elapsedWeeks) { n += block.program.filter { ProgramMath.dayInPhase($0, block.phases[w]) }.count }
            sessionsPlanned = n
        }
        let adherencePct: Double? = sessionsPlanned == nil || sessionsPlanned == 0 ? nil
            : Swift.min(100, JS.round(Double(inWindow.count) / Double(sessionsPlanned!) * 100))
        let durations = inWindow.compactMap(Analytics.sessionDurationMs)
        let avgSessionMinutes: Double? = durations.isEmpty ? nil : JS.round(durations.reduce(0, +) / Double(durations.count) / 60_000)

        let phaseOf = PlanMath.blockPhaseResolver(block)
        var strength: [ExerciseOutcome] = []
        var blockPRs = 0
        let series = Progress.exercisePointSeries(snap, include: include, phaseOf: phaseOf)
        for id in seriesOrder(snap, include) where series[id] != nil {
            let points = series[id]!
            if points.count < 2 { continue }
            let a = Progress.assessExercise(id, points, block.focus, windowSize: nil)
            let hard = points.filter { !$0.easy }
            let judged = hard.isEmpty ? points : hard
            let prCount = points.reduce(0) { $0 + ($1.weightPR ? 1 : 0) + ($1.repPR ? 1 : 0) }
            blockPRs += prCount
            strength.append(ExerciseOutcome(exerciseId: id, name: ProgramStore.getExerciseName(id), startE1rm: JS.round(judged[0].bestE1rm),
                endE1rm: JS.round(judged[judged.count - 1].bestE1rm), changePct: a.e1rmChangePct ?? a.volumeChangePct ?? 0, sessions: points.count,
                status: OutcomeStatus(rawValue: a.status.rawValue), volumeChangePct: a.volumeChangePct.map { .value($0) } ?? .null, prCount: prCount))
        }
        strength = strength.jsSorted { $1.changePct - $0.changePct }
        let totals = Analytics.muscleSetTotals(snap, include: include)
        let muscles = totals.order.map { m -> MuscleOutcome in
            let ws = JS.round(totals.totals[m]! / weeks * 2) / 2
            return MuscleOutcome(muscle: m, weeklySets: ws, status: ws < band.low ? .low : ws > band.high ? .high : .optimal)
        }.jsSorted { $1.weeklySets - $0.weeklySets }
        let trended = strength.filter { $0.sessions >= Progress.minTrendSessions }
        let keep = trended.filter { $0.status == .progressing }.map(\.exerciseId)
        let reviewOutcomes = trended.filter { $0.status == .stalled || $0.status == .declining }
        var programMuscles = Set<MuscleGroup>()
        for d in block.program { for e in d.exercises { if let m = Analytics.primaryMuscleFor(e.id) { programMuscles.insert(m) } } }
        let under = muscles.filter { $0.status == .low && programMuscles.contains($0.muscle) }.map(\.muscle)
        let over = muscles.filter { $0.status == .high }.map(\.muscle)
        let summary = buildSummary(sessions: inWindow.count, sessionsPlanned: sessionsPlanned, adherencePct: adherencePct, strength: trended,
                                   muscles: muscles, underMuscles: under, reviewNames: reviewOutcomes.map(\.name), blockPRs: blockPRs,
                                   band: band, addsVolume: block.focus != .sportSupport)
        return BlockRetrospective(blockId: block.id, from: from, to: to, sessionsCompleted: inWindow.count, sessionsPlanned: sessionsPlanned,
                                  adherencePct: adherencePct, avgSessionMinutes: avgSessionMinutes, strength: strength, muscles: muscles, summary: summary,
                                  carryover: RetrospectiveCarryover(keepExerciseIds: keep, reviewExerciseIds: reviewOutcomes.map(\.exerciseId),
                                                                    underMuscles: under, overMuscles: over))
    }

    /// Keys of `exercisePointSeries` in TS Map insertion order (first chronological appearance).
    static func seriesOrder(_ snap: TrainingSnapshot, _ include: (Session) -> Bool) -> [String] {
        var order: [String] = [], seen = Set<String>()
        for s in snap.sessions.jsSorted({ Analytics.sessionTimestamp($0) - Analytics.sessionTimestamp($1) }) where include(s) {
            for l in snap.setsBySession[s.id ?? -1] ?? [] where !Variations.isExtension(l.technique) && !seen.contains(l.exerciseId) {
                seen.insert(l.exerciseId); order.append(l.exerciseId)
            }
        }
        return order
    }

    static func buildSummary(sessions: Int, sessionsPlanned: Int?, adherencePct: Double?, strength: [ExerciseOutcome], muscles: [MuscleOutcome],
                             underMuscles: [MuscleGroup], reviewNames: [String], blockPRs: Int, band: VolumeTarget, addsVolume: Bool) -> [String] {
        var out: [String] = []
        if sessions == 0 {
            return ["No workouts were logged during this block, so there's nothing to evaluate — the next plan starts from your earlier history."]
        }
        let planned = sessionsPlanned.map(String.init) ?? "null"
        if let a = adherencePct {
            if a >= 90 { out.append("Adherence was excellent — \(sessions) of \(planned) planned sessions. Consistency like this is doing more for you than any programming tweak could.") }
            else if a >= 70 { out.append("Adherence was solid — \(sessions) of \(planned) planned sessions. A few misses don't dent a block; keep the streak going.") }
            else { out.append("Adherence was the limiter — \(sessions) of \(planned) planned sessions. Before changing the program, it's worth asking whether the schedule fits your life; the best plan is the one that happens.") }
        } else {
            out.append("You logged \(sessions) workout\(sessions == 1 ? "" : "s") across this block.")
        }
        if !strength.isEmpty {
            let avg = strength.reduce(0) { $0 + $1.changePct } / Double(strength.count)
            let best = strength[0]
            let decliners = strength.filter { $0.status == .declining }
            let prLine = blockPRs > 0 ? " You set \(blockPRs) PR\(blockPRs == 1 ? "" : "s") (weight and rep records) along the way." : ""
            let progressing = strength.filter { $0.status == .progressing }.count
            let signed = "\(avg >= 0 ? "+" : "")\(JS.toFixed(avg, 1))%"
            if avg >= 3 {
                out.append("Strength moved the right way: estimated 1RMs averaged \(signed) across \(strength.count) tracked lifts, led by \(best.name) at +\(JS.toFixed(best.changePct, 1))%.\(prLine)")
            } else if avg > 0 {
                out.append("Strength inched forward — \(signed) on average across \(strength.count) tracked lifts, with \(progressing) of them progressing.\(prLine) Slow blocks happen; volume quality and sleep are the usual levers.")
            } else if avg > -3 {
                out.append(Double(progressing) > Double(strength.count) / 2
                    ? "Strength held: \(progressing) of \(strength.count) tracked lifts progressed on reps or volume while estimated 1RMs stayed level (\(signed) on average).\(prLine)"
                    : "Strength held level (\(signed) average across \(strength.count) lifts).\(prLine) Holding through a block is a base to build on, not a setback.")
            } else {
                out.append("Strength moved back (\(signed) average across \(strength.count) lifts) — a sign of accumulated fatigue or life stress. The next block opens easier on purpose.")
            }
            if !decliners.isEmpty && avg >= 3 {
                out.append("Not everything cooperated: \(decliners.prefix(3).map(\.name).joined(separator: ", ")) lost ground and \(decliners.count == 1 ? "is" : "are") flagged for rotation.")
            }
        }
        let optimal = muscles.filter { $0.status == .optimal }.count
        if !muscles.isEmpty {
            var line = "\(optimal) of \(muscles.count) trained muscles landed in the \(JS.string(band.low))–\(JS.string(band.high)) weekly-set band."
            if !underMuscles.isEmpty {
                let names = underMuscles.prefix(3).map(\.rawValue).joined(separator: ", ")
                line += addsVolume ? " \(names) came in under target — the next block adds a set there."
                    : " \(names) came in under target, which is fine on a sport-support dose — the sport has the prior claim on that recovery."
            }
            out.append(line)
        }
        if !reviewNames.isEmpty {
            out.append("Up for rotation next block: \(reviewNames.prefix(3).joined(separator: ", ")) — stalled lifts respond to a movement change better than to stubbornness.")
        }
        return out
    }
}
