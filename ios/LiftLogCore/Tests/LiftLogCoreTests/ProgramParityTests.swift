import XCTest
@testable import LiftLogCore

func obj(_ pairs: KeyValuePairs<String, any Encodable>) -> [String: AnyEncodable] {
    var d: [String: AnyEncodable] = [:]
    for (k, v) in pairs { d[k] = AnyEncodable(v) }
    return d
}

final class ProgramParityTests: XCTestCase {
    func testProgramParity() throws {
        try Parity.run("program", [
            "seedProgram": { _ in ProgramMath.seedProgram },
            "weekMath": { c in
                let t: Double = try c.arg(0)
                let sow = ProgramMath.startOfWeek(t)
                return obj([
                    "sow": sow, "plus1": ProgramMath.addWeeks(sow, 1), "minus3": ProgramMath.addWeeks(sow, -3),
                    "plus30": ProgramMath.addWeeks(sow, 30), "between": ProgramMath.weeksBetween(sow, ProgramMath.addWeeks(sow, 9)),
                    "date": ProgramMath.toLocalDateValue(t), "short": ProgramMath.shortDateLabel(t),
                    "weekNo": ProgramMath.getWeekNumberForDate(t, programStart: JSDate.make(2026, 0, 14)),
                    "weekNoBefore": ProgramMath.getWeekNumberForDate(t, programStart: JSDate.make(2030, 0, 1)),
                ])
            },
            "labels": { c in
                let e: Exercise = try c.arg(0)
                return obj(["label": ProgramMath.prescriptionLabel(e), "detail": ProgramMath.prescriptionDetail(e)])
            },
            "rangeLabel": { c in ProgramMath.rangeLabel(try c.arg(0), try c.arg(1)) },
            "dayInPhase": { c in ProgramMath.dayInPhase(try c.arg(0), try c.arg(1)) },
            "nowWeek": { _ in obj(["range": ProgramMath.getWeekDateRange(), "week": ProgramMath.getWeekNumber(),
                                   "start": SettingsStore.getProgramStartValue()]) },
            "programStart": { _ in obj(["value": SettingsStore.getProgramStartValue(), "week": ProgramMath.getWeekNumber()]) },
            "saveProgramStart": { c in
                let ok = SettingsStore.saveProgramStart(try c.arg(0))
                return [AnyEncodable(ok), AnyEncodable(SettingsStore.getProgramStartValue())]
            },
            "restDuration": { _ in SettingsStore.getRestDuration() },
        ])
    }
}
