import XCTest
@testable import LiftLogCore

final class MetricsParityTests: XCTestCase {
    private static func snap(_ c: ParityCase) throws -> TrainingSnapshot { Analytics.buildSnapshot(try c.arg(0), try c.arg(1)) }
    private static func heatJSON(_ h: HeatmapData) -> AnyEncodable {
        AnyEncodable(HeatJSON(weeks: h.weeks, byMuscle: Dictionary(uniqueKeysWithValues: h.byMuscle.map { ($0.key.rawValue, $0.value) })))
    }
    private struct HeatJSON: Encodable { var weeks: Double; var byMuscle: [String: MuscleHeat] }
    private struct SplitJSON: Encodable { var insight: SplitInsight?; var alone: SplitInsight?; var split: [String: Double]? }

    func testMetricsParity() throws {
        try Parity.run("metrics", [
            "computeMetrics": { c in Metrics.computeMetrics(try Self.snap(c), now: try c.arg(2)) },
            "computeRangeSummary": { c in Metrics.computeRangeSummary(try Self.snap(c), try c.arg(2), try c.arg(3)) },
            "computeMuscleHeat": { c in Self.heatJSON(Heatmap.computeMuscleHeat(try Self.snap(c), try c.arg(2), try c.arg(3))) },
            "splitInsight": { c in
                let s = try Self.snap(c), a: Double = try c.arg(2), b: Double = try c.arg(3)
                let prev = Heatmap.previousWindow(TimeWindow(from: a, to: b))
                let cur = Heatmap.computeMuscleHeat(s, a, b)
                return SplitJSON(insight: Heatmap.splitInsight(cur, Heatmap.computeMuscleHeat(s, prev.from, prev.to)),
                                 alone: Heatmap.splitInsight(cur, nil),
                                 split: Heatmap.volumeSplit(cur).map { Dictionary(uniqueKeysWithValues: $0.map { ($0.key.rawValue, $0.value) }) })
            },
            "heatColor": { c in Heatmap.heatColor(try c.arg(0), (try c.arg(1) as VolumeTarget?) ?? Analytics.defaultVolumeTarget) },
            "heatLabel": { c in Heatmap.heatLabel(try c.arg(0), (try c.arg(1) as VolumeTarget?) ?? Analytics.defaultVolumeTarget) },
            "rangeWindow": { c in Heatmap.rangeWindow(try c.arg(0)) },
            "mesocycleWindow": { _ in Heatmap.mesocycleWindow() },
            "defaultHeatRange": { _ in Heatmap.defaultHeatRange() },
            "dateInputValue": { c in Heatmap.dateInputValue(try c.arg(0)) },
            "presetCopy": { c in Heatmap.presetCopy(try c.arg(0)) },
            "bodyHalfFor": { c in Heatmap.bodyHalfFor(try c.arg(0)) },
        ])
    }
}
