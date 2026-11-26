import Foundation

// Port of src/data/metrics.ts — summary totals, calendar-week volume and
// per-exercise e1RM/volume series for the Metrics page.

public struct MetricsSummary: Codable, Hashable, Sendable {
    public var totalWorkouts: Int
    public var totalVolume: Double
    public var thisWeekVolume: Double
    public var lastWeekVolume: Double
    public var deltaPct: Double?
}

public struct WeeklyVolumePoint: Codable, Hashable, Sendable {
    public var weekStart: Double
    public var label: String
    public var value: Double
    public var isCurrent: Bool
}

public struct SeriesPoint: Codable, Hashable, Sendable { public var label: String; public var value: Double }

public struct ExerciseSeries: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var name: String
    public var points: [SeriesPoint]
    public var volumePoints: [SeriesPoint]
}

public struct MetricsData: Codable, Hashable, Sendable {
    public var hasData: Bool
    public var summary: MetricsSummary
    public var weeklyVolume: [WeeklyVolumePoint]
    public var exercises: [ExerciseSeries]
    public var unclassifiedExercises: [String]
}

public struct RangeSummary: Codable, Hashable, Sendable {
    public var workouts: Int
    public var volume: Double
    public var prevVolume: Double
    public var deltaPct: Double?
}

public enum Metrics {
    public static let volumeWeeks = 8

    private static func sessionVolume(_ logs: [SetLog]) -> Double { logs.reduce(0) { $0 + $1.weight * $1.reps } }

    public static func computeRangeSummary(_ snap: TrainingSnapshot, _ from: Double, _ to: Double) -> RangeSummary {
        let prevFrom = from - (to - from)
        var workouts = 0, volume = 0.0, prevVolume = 0.0
        for session in snap.sessions {
            let logs = snap.setsBySession[session.id ?? -1] ?? []
            if logs.isEmpty { continue }
            let ts = Analytics.sessionTimestamp(session), v = sessionVolume(logs)
            if ts >= from && ts <= to { workouts += 1; volume += v }
            else if ts >= prevFrom && ts < from { prevVolume += v }
        }
        return RangeSummary(workouts: workouts, volume: JS.round(volume), prevVolume: JS.round(prevVolume),
                            deltaPct: prevVolume > 0 ? JS.round((volume - prevVolume) / prevVolume * 100) : nil)
    }

    public static func computeMetrics(_ snap: TrainingSnapshot, now: Double = LiftLogEnv.now()) -> MetricsData {
        let currentWeekStart = ProgramMath.startOfWeek(now)
        if snap.sessions.isEmpty || snap.setsBySession.isEmpty {
            return MetricsData(hasData: false, summary: MetricsSummary(totalWorkouts: 0, totalVolume: 0, thisWeekVolume: 0, lastWeekVolume: 0, deltaPct: nil),
                               weeklyVolume: [], exercises: [], unclassifiedExercises: [])
        }
        var weekBuckets: [Double: Double] = [:]
        var totalVolume = 0.0
        for session in snap.sessions {
            let logs = snap.setsBySession[session.id ?? -1] ?? []
            if logs.isEmpty { continue }
            let v = sessionVolume(logs)
            totalVolume += v
            weekBuckets[Analytics.sessionWeekStart(session), default: 0] += v
        }
        let trained = weekBuckets.keys.filter { $0 <= currentWeekStart }
        let earliest = trained.min() ?? currentWeekStart
        let windowStart = Swift.max(earliest, ProgramMath.addWeeks(currentWeekStart, -(volumeWeeks - 1)))
        var weekly: [WeeklyVolumePoint] = []
        let span = ProgramMath.weeksBetween(windowStart, currentWeekStart)
        if span >= 0 {
            for i in 0...span {
                let ws = ProgramMath.addWeeks(windowStart, i)
                weekly.append(WeeklyVolumePoint(weekStart: ws, label: ProgramMath.weekStartLabel(ws),
                                                value: JS.round(weekBuckets[ws] ?? 0), isCurrent: ws == currentWeekStart))
            }
        }
        let thisWeek = JS.round(weekBuckets[currentWeekStart] ?? 0)
        let lastWeek = JS.round(weekBuckets[ProgramMath.addWeeks(currentWeekStart, -1)] ?? 0)
        let deltaPct: Double? = lastWeek > 0 ? JS.round((thisWeek - lastWeek) / lastWeek * 100) : nil

        var volumeSeries: [String: [(ts: Double, value: Double)]] = [:]
        for session in snap.sessions {
            let logs = snap.setsBySession[session.id ?? -1] ?? []
            if logs.isEmpty { continue }
            let ts = Analytics.sessionTimestamp(session)
            var byEx = OrderedDict<String, Double>()
            for l in logs { byEx[l.exerciseId] = (byEx[l.exerciseId] ?? 0) + l.weight * l.reps }
            for id in byEx.keys { volumeSeries[id, default: []].append((ts, byEx[id]!)) }
        }
        for k in volumeSeries.keys { volumeSeries[k] = JS.sorted(volumeSeries[k]!) { $0.ts - $1.ts } }
        let exercises = Analytics.e1rmSeries(snap).map { id, pts in
            ExerciseSeries(exerciseId: id, name: ProgramStore.getExerciseName(id),
                           points: pts.map { SeriesPoint(label: ProgramMath.shortDateLabel($0.ts), value: JS.round($0.value)) },
                           volumePoints: (volumeSeries[id] ?? []).map { SeriesPoint(label: ProgramMath.shortDateLabel($0.ts), value: JS.round($0.value)) })
        }.sorted { a, b in
            a.points.count != b.points.count ? a.points.count > b.points.count
                : JS.localeCompare(a.name, b.name) != 0 ? JS.localeCompare(a.name, b.name) < 0 : a.exerciseId < b.exerciseId
        }
        let unclassified = Analytics.muscleSetTotals(snap).unmappedExerciseIds.map(ProgramStore.getExerciseName).jsSorted(JS.localeCompare)
        return MetricsData(hasData: true,
                           summary: MetricsSummary(totalWorkouts: snap.sessions.count, totalVolume: JS.round(totalVolume),
                                                   thisWeekVolume: thisWeek, lastWeekVolume: lastWeek, deltaPct: deltaPct),
                           weeklyVolume: weekly, exercises: exercises, unclassifiedExercises: unclassified)
    }
}
