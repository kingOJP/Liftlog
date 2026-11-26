import Foundation

// Port of src/data/progress.ts.

public enum ProgressStatus: String, Codable, Hashable, Sendable { case progressing, steady, stalled, declining }

public struct WeightReps: Codable, Hashable, Sendable { public var weight: Double; public var reps: Double }

public struct ExercisePoint: Codable, Hashable, Sendable {
    public var ts: Double
    public var sessionId: Int
    public var bestE1rm: Double
    public var validE1rm: Double
    public var tonnage: Double
    public var totalReps: Double
    public var maxWeight: Double
    public var workingWeight: Double
    public var sets: [WeightReps]
    public var position: Int?
    public var weightPR: Bool
    public var repPR: Bool
    public var prLabels: [String]
    public var easy: Bool
    public var style: String
}

public struct DatedLabel: Codable, Hashable, Sendable { public var ts: Double; public var label: String }

public struct ExerciseProgress: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var name: String
    public var status: ProgressStatus
    public var score: Double
    public var sessions: Int
    public var totalSessions: Int
    public var lastTs: Double
    public var e1rmChangePct: Double?
    public var volumeChangePct: Double?
    public var weightPRs: Int
    public var repPRs: Int
    public var positionShifted: Bool
    public var evidence: [String]
    public var recentPRs: [DatedLabel]
}

public struct CategoryProgress: Codable, Hashable, Sendable {
    public var category: MovementCategory
    public var exerciseCount = 0, progressing = 0, steady = 0, stalled = 0, declining = 0
}

public enum Progress {
    static let pctLoadPerRep = 3.0
    static let e1rmValidReps = 12.0
    public static let trendWindowSessions = 4
    public static let minTrendSessions = 3
    static let positionShiftSlots = 2
    public static let statusLabel: [ProgressStatus: String] = [.progressing: "Progressing", .steady: "Steady", .stalled: "Stalled", .declining: "Declining"]

    static func dominantStyle(_ sets: [SetLog]) -> String {
        var order: [String] = [], counts: [String: Int] = [:]
        for s in sets {
            let k = Variations.variationKey(Variations.styleOf(s))
            if counts[k] == nil { order.append(k) }
            counts[k, default: 0] += 1
        }
        var best = "", bestCount = -1
        for k in order where counts[k]! > bestCount { best = k; bestCount = counts[k]! }
        return best
    }

    public static func exercisePointSeries(_ snap: TrainingSnapshot, include: (Session) -> Bool = { _ in true },
                                           phaseOf: PlanMath.PhaseResolver? = nil) -> [String: [ExercisePoint]] {
        let positions = snapshotPositions(snap)
        let chronological = snap.sessions.jsSorted { Analytics.sessionTimestamp($0) - Analytics.sessionTimestamp($1) }
        var series: [String: [ExercisePoint]] = [:]
        var bestWeight: [String: Double] = [:]
        var bestRepsAtWeight: [String: [Double: Double]] = [:]
        for session in chronological where include(session) {
            let logs = snap.setsBySession[session.id ?? -1] ?? []
            if logs.isEmpty { continue }
            let ts = Analytics.sessionTimestamp(session)
            let posMap = session.id.flatMap { positions[$0] }
            let easy = PlanMath.isEasyPhase(phaseOf?(ts) ?? nil)
            var exOrder: [String] = [], byExercise: [String: [SetLog]] = [:]
            for log in logs where !Variations.isExtension(log.technique) {
                if byExercise[log.exerciseId] == nil { exOrder.append(log.exerciseId) }
                byExercise[log.exerciseId, default: []].append(log)
            }
            for exerciseId in exOrder {
                let sets = byExercise[exerciseId]!
                let style = dominantStyle(sets)
                let prKey = "\(exerciseId)|\(style)"
                var bestE1rm = 0.0, validE1rm = 0.0, tonnage = 0.0, totalReps = 0.0, maxWeight = 0.0
                var weightCounts: [Double: Int] = [:]
                for s in sets {
                    bestE1rm = Swift.max(bestE1rm, Analytics.epley1RM(s.weight, s.reps))
                    if s.reps <= e1rmValidReps { validE1rm = Swift.max(validE1rm, Analytics.epley1RM(s.weight, s.reps)) }
                    tonnage += s.weight * s.reps
                    totalReps += s.reps
                    maxWeight = Swift.max(maxWeight, s.weight)
                    weightCounts[s.weight, default: 0] += 1
                }
                var workingWeight = sets[0].weight, workingCount = 0
                for (w, c) in weightCounts where c > workingCount || (c == workingCount && w > workingWeight) {
                    workingWeight = w; workingCount = c
                }
                var prLabels: [String] = []
                let prevBest = bestWeight[prKey]
                let weightPR = !easy && prevBest != nil && maxWeight > prevBest!
                if weightPR { prLabels.append("Weight PR — \(Units.fmtWeight(maxWeight))") }
                bestWeight[prKey] = Swift.max(prevBest ?? 0, maxWeight)
                var repPR = false
                var repMap = bestRepsAtWeight[prKey] ?? [:]
                var wOrder: [Double] = [], sessionBest: [Double: Double] = [:]
                for s in sets {
                    if sessionBest[s.weight] == nil { wOrder.append(s.weight) }
                    sessionBest[s.weight] = Swift.max(sessionBest[s.weight] ?? 0, s.reps)
                }
                for weight in wOrder {
                    let reps = sessionBest[weight]!
                    let prev = repMap[weight]
                    if !easy, let prev, reps > prev {
                        repPR = true
                        prLabels.append(weight > 0 ? "Rep PR — \(JS.string(reps)) × \(Units.fmtWeight(weight))" : "Rep PR — \(JS.string(reps)) bodyweight reps")
                    }
                    repMap[weight] = Swift.max(prev ?? 0, reps)
                }
                bestRepsAtWeight[prKey] = repMap
                var seen = Set<String>()
                let labels = Array(prLabels.filter { seen.insert($0).inserted }.prefix(2))
                series[exerciseId, default: []].append(ExercisePoint(
                    ts: ts, sessionId: session.id ?? 0, bestE1rm: bestE1rm, validE1rm: validE1rm, tonnage: tonnage,
                    totalReps: totalReps, maxWeight: maxWeight, workingWeight: workingWeight,
                    sets: sets.map { WeightReps(weight: $0.weight, reps: $0.reps) }, position: posMap?[exerciseId],
                    weightPR: weightPR, repPR: repPR, prLabels: labels, easy: easy, style: style))
            }
        }
        return series
    }

    /// exerciseId → 0-based position within the workout. Prefers the stored
    /// `order`, else set-log insertion order (ids).
    public static func sessionExercisePositions(_ logs: [SetLog]) -> [String: Int] {
        var order: [String] = [], rank: [String: Double] = [:]
        for log in logs {
            let r = log.order.map(Double.init) ?? (log.id.map { Double($0) + 1_000_000 } ?? 9_007_199_254_740_991)
            if let prev = rank[log.exerciseId] { if r < prev { rank[log.exerciseId] = r } } else { order.append(log.exerciseId); rank[log.exerciseId] = r }
        }
        let sorted = order.jsSorted { rank[$0]! - rank[$1]! }
        return Dictionary(uniqueKeysWithValues: sorted.enumerated().map { ($1, $0) })
    }

    public static func snapshotPositions(_ snap: TrainingSnapshot) -> [Int: [String: Int]] {
        snap.setsBySession.mapValues(sessionExercisePositions)
    }

    static func normalizedReps(_ p: ExercisePoint, _ ref: Double) -> Double {
        if ref <= 0 { return p.totalReps }
        return p.sets.reduce(0) { $0 + Swift.max(0, $1.reps + ((($1.weight - ref) / ref) * 100) / pctLoadPerRep) }
    }

    static func median(_ v: [Double]) -> Double? {
        if v.isEmpty { return nil }
        let s = v.jsSorted { $0 - $1 }
        return s[s.count / 2]
    }

    static func styleLabel(_ style: String) -> String {
        let parts = style.components(separatedBy: "|")
        let v = Variations.styleOf(technique: parts[0], grip: parts.count > 1 ? parts[1] : nil)
        return Variations.variationLabel(v) ?? "straight sets"
    }

    public static func assessExercise(_ exerciseId: String, _ points: [ExercisePoint], _ goal: Goal,
                                      name: String? = nil, windowSize: Int? = trendWindowSessions) -> ExerciseProgress {
        let window = windowSize.map { Array(points.suffix($0)) } ?? points
        let last = window.last
        let hardWindow = window.filter { !$0.easy }
        let hardOrAll = hardWindow.isEmpty ? window : hardWindow
        let latestStyle = hardOrAll.last?.style ?? ""
        let likeForLike = hardOrAll.filter { $0.style == latestStyle }
        let styleChanged = likeForLike.count < hardOrAll.count
        let judged = likeForLike.isEmpty ? hardOrAll : likeForLike
        let lastHard = judged.last
        let typicalPos = median(points.dropLast().compactMap { $0.position.map(Double.init) })
        var positionShifted = false
        if let lp = lastHard?.position, let tp = typicalPos { positionShifted = Double(lp) >= tp + Double(positionShiftSlots) }
        let trendWindow = positionShifted && judged.count > 1 ? Array(judged.dropLast()) : judged
        let first = trendWindow.first, end = trendWindow.last
        let bodyweight = points.allSatisfy { $0.maxWeight == 0 }
        var e1rmChangePct: Double? = nil
        if !bodyweight, let first, let end, first.validE1rm > 0, end.validE1rm > 0 {
            e1rmChangePct = Progression.deadband(Progression.pctChange(first.validE1rm, end.validE1rm))
        }
        var volumeChangePct: Double? = nil
        if let first, let end {
            volumeChangePct = bodyweight
                ? Progression.deadband(Progression.pctChange(first.totalReps, end.totalReps))
                : Progression.deadband(Progression.pctChange(normalizedReps(first, first.workingWeight), normalizedReps(end, first.workingWeight)))
        }
        let weightPRs = judged.filter(\.weightPR).count, repPRs = judged.filter(\.repPR).count
        let recentPRs = judged.flatMap { p in p.prLabels.map { DatedLabel(ts: p.ts, label: $0) } }.jsSorted { $1.ts - $0.ts }
        let prs = weightPRs + repPRs
        let score = Progression.compositeScore(ProgressSignals(e1rmChangePct: e1rmChangePct, volumeChangePct: volumeChangePct, prEvents: Double(prs)), goal)
        let status: ProgressStatus
        if points.count < minTrendSessions || judged.count < minTrendSessions { status = .steady }
        else if score >= Progression.progressScore { status = .progressing }
        else if score <= Progression.declineScore && prs == 0 { status = .declining }
        else if prs > 0 || score > Progression.stallScore { status = .steady }
        else { status = .stalled }

        var evidence: [String] = []
        func fmt(_ v: Double) -> String { "\(v > 0 ? "+" : "")\(JS.toFixed(v, 1))%" }
        if prs > 0 { evidence.append(recentPRs[0].label + (prs > 1 ? " (+\(prs - 1) more PR\(prs > 2 ? "s" : ""))" : "")) }
        if let e = e1rmChangePct { evidence.append("est. 1RM \(fmt(e)) over \(trendWindow.count) sessions") }
        if let v = volumeChangePct { evidence.append("\(bodyweight ? "total reps" : "volume load") \(fmt(v))") }
        if goal == .fatLoss, let e = e1rmChangePct, abs(e) <= 2, e > -2 { evidence.append("holding strength in a deficit — that's a win") }
        if positionShifted { evidence.append("trained later in the workout than usual last time — that session isn't counted against you") }
        if !hardWindow.isEmpty && hardWindow.count < window.count { evidence.append("planned easy-week sessions are left out of the trend") }
        if styleChanged {
            evidence.append(judged.count < minTrendSessions
                ? "switched to \(styleLabel(latestStyle)) — the trend restarts from there, no verdict yet"
                : "judged on \(styleLabel(latestStyle)) sessions only — a technique change resets the comparison")
        }
        if points.count < minTrendSessions { evidence.append("still building a baseline — log a few more sessions for a verdict") }
        else if judged.count < minTrendSessions && !styleChanged { evidence.append("only a couple of hard sessions since the easy week — no verdict yet") }
        return ExerciseProgress(
            exerciseId: exerciseId, name: name ?? ProgramStore.getExerciseName(exerciseId), status: status,
            score: JS.round(score * 100) / 100, sessions: window.count, totalSessions: points.count, lastTs: last?.ts ?? 0,
            e1rmChangePct: e1rmChangePct.map { JS.round($0 * 10) / 10 }, volumeChangePct: volumeChangePct.map { JS.round($0 * 10) / 10 },
            weightPRs: weightPRs, repPRs: repPRs, positionShifted: positionShifted, evidence: evidence, recentPRs: recentPRs)
    }

    public static func assessSnapshot(_ snap: TrainingSnapshot, _ goal: Goal, include: (Session) -> Bool = { _ in true },
                                      phaseOf: PlanMath.PhaseResolver? = nil) -> [String: ExerciseProgress] {
        var out: [String: ExerciseProgress] = [:]
        for (id, points) in exercisePointSeries(snap, include: include, phaseOf: phaseOf) where points.count >= 2 {
            out[id] = assessExercise(id, points, goal)
        }
        return out
    }

    public static func progressDirections(_ a: [String: ExerciseProgress]) -> (up: Set<String>, down: Set<String>, stalled: Set<String>) {
        var up = Set<String>(), down = Set<String>(), stalled = Set<String>()
        for (id, p) in a {
            switch p.status { case .progressing: up.insert(id); case .declining: down.insert(id); case .stalled: stalled.insert(id); case .steady: break }
        }
        return (up, down, stalled)
    }

    /// Rolled up by movement category; sorted by category for a stable order.
    public static func categoryProgress(_ snap: TrainingSnapshot, _ goal: Goal) -> [CategoryProgress] {
        var by: [MovementCategory: CategoryProgress] = [:]
        for (id, p) in assessSnapshot(snap, goal) {
            guard let pattern = Analytics.movementPatternFor(id) else { continue }
            let cat = Taxonomy.patternCategoryFor(pattern)
            var b = by[cat] ?? CategoryProgress(category: cat)
            b.exerciseCount += 1
            switch p.status { case .progressing: b.progressing += 1; case .steady: b.steady += 1; case .stalled: b.stalled += 1; case .declining: b.declining += 1 }
            by[cat] = b
        }
        return by.values.sorted { $0.category.rawValue < $1.category.rawValue }
    }
}
