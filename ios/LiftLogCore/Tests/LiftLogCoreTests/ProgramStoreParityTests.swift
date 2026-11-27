import XCTest
@testable import LiftLogCore

private func snapshot() -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    for k in ["liftlog_program", "liftlog_program_updated", "liftlog_exercises", "liftlog_deleted_exercises", "liftlog_restored_exercises", "liftlog_library_v3"] {
        guard let raw = LiftLogEnv.store.getItem(k) else { out[k] = .null; continue }
        out[k] = (try? JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8))) ?? .string(raw)
    }
    return out
}

final class ProgramStoreParityTests: XCTestCase {
    func testProgramStoreParity() throws {
        try Parity.run("programStore", [
            "getStoredProgram": { _ in
                obj(["program": ProgramStore.getStoredProgram(), "clock": ProgramStore.getProgramUpdatedAt(), "after": snapshot()])
            },
            "library": { _ in
                let lib = ProgramStore.getExerciseLibrary()
                return obj(["lib": lib, "deleted": ProgramStore.readIdList(StorageKey.deletedExercises), "after": snapshot()])
            },
            "mergeExerciseLibrary": { c in obj(["result": ProgramStore.mergeExerciseLibrary(try c.arg(0)), "after": snapshot()]) },
            "pickableExercises": { _ in ProgramStore.pickableExercises() },
            "ensureProgramExercisesInLibrary": { c in ProgramStore.ensureProgramExercisesInLibrary(try c.arg(0)); return snapshot() },
            "getExerciseName": { c in ProgramStore.getExerciseName(try c.arg(0)) },
            "findExerciseByName": { c in ProgramStore.findExerciseByName(try c.arg(0)).json },
            "generateExerciseId": { c in ProgramStore.generateExerciseId(try c.arg(0)) },
            "archiveExercise": { c in ProgramStore.archiveExercise(try c.arg(0), now: try c.arg(1)); return snapshot() },
            "deleteExerciseFromLibrary": { c in ProgramStore.deleteExerciseFromLibrary(try c.arg(0)); return snapshot() },
            "addToExerciseLibrary": { c in
                ProgramStore.addToExerciseLibrary(try c.arg(0), now: try c.arg(1)); let a = snapshot()
                ProgramStore.clearRestoredExerciseIds(["squat"])
                return obj(["a": a, "b": snapshot(), "restored": ProgramStore.readIdList(StorageKey.restoredExercises)])
            },
            "liftExerciseTombstones": { c in ProgramStore.liftExerciseTombstones(try c.arg(0)); return snapshot() },
            "removeExerciseFromProgram": { c in
                obj(["out": ProgramStore.removeExerciseFromProgram(try c.arg(0), try c.arg(1)), "after": snapshot()])
            },
        ])
    }
}
