import Foundation

// Port of src/data/programStore.ts + src/data/legacyIds.ts — the stored
// program, the per-user exercise library and its deletion/restore tombstones.

public enum ProgramStore {
    public static let legacyIdMap: [String: String] = [
        "cable-lateral-raises-d1": "cable-lateral-raises", "face-pulls-d2": "face-pulls", "face-pulls-d4": "face-pulls",
        "lat-pulldown-d2": "lat-pull-down", "cable-pull-down-d2": "straight-arm-pulldowns",
        "tricep-pushdowns-d4": "tricep-cable-pushdown",
    ]
    public static func canonicalizeId(_ id: String) -> String { legacyIdMap[id] ?? id }

    static var store: KeyValueStore { LiftLogEnv.store }

    // MARK: program

    public static func getStoredProgram() -> [WorkoutDay] {
        guard let stored = store.getJSON([WorkoutDay].self, StorageKey.program) else { return [] }
        let (program, changed) = canonicalizeProgram(stored)
        if changed { saveStoredProgram(program) }
        return program
    }

    static func canonicalizeProgram(_ program: [WorkoutDay]) -> ([WorkoutDay], Bool) {
        var changed = false
        let next = program.map { day -> WorkoutDay in
            var seen = Set<String>()
            var exercises: [Exercise] = []
            for ex in day.exercises {
                let id = canonicalizeId(ex.id)
                if id != ex.id { changed = true }
                if seen.contains(id) { changed = true; continue }
                seen.insert(id)
                if id == ex.id { exercises.append(ex) } else {
                    var e = ex; e.id = id; e.name = Catalog.exerciseMap[id]?.name ?? ex.name
                    exercises.append(e)
                }
            }
            var d = day; d.exercises = exercises
            return d
        }
        return (next, changed)
    }

    public static func saveStoredProgram(_ program: [WorkoutDay], now: Double = LiftLogEnv.now()) {
        store.setJSON(program, StorageKey.program)
        store.setItem(StorageKey.programUpdated, JS.string(now))
    }

    public static func getProgramUpdatedAt() -> Double {
        guard let raw = store.getItem(StorageKey.programUpdated), let n = Double(raw), n.isFinite, n > 0 else { return 0 }
        return n
    }

    public static func clearStoredProgram() {
        store.removeItem(StorageKey.program); store.removeItem(StorageKey.programUpdated)
    }

    public static func clearExerciseLibraryData() {
        store.removeItem(StorageKey.exercises); store.removeItem(StorageKey.deletedExercises)
        store.removeItem(StorageKey.restoredExercises)
    }

    // MARK: tombstones (ordered like a JS Set)

    static func readIdList(_ key: String) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for id in store.getJSON([String].self, key) ?? [] where seen.insert(id).inserted { out.append(id) }
        return out
    }

    public static func getDeletedExerciseIds() -> Set<String> { Set(readIdList(StorageKey.deletedExercises)) }
    public static func getRestoredExerciseIds() -> Set<String> { Set(readIdList(StorageKey.restoredExercises)) }

    public static func addDeletedExerciseIds(_ ids: [String]) {
        if ids.isEmpty { return }
        var list = readIdList(StorageKey.deletedExercises)
        for id in ids where !list.contains(id) { list.append(id) }
        store.setJSON(list, StorageKey.deletedExercises)
    }

    static func saveRestored(_ list: [String]) {
        if list.isEmpty { store.removeItem(StorageKey.restoredExercises) } else { store.setJSON(list, StorageKey.restoredExercises) }
    }

    public static func liftExerciseTombstones(_ ids: [String]) {
        var deleted = readIdList(StorageKey.deletedExercises)
        var lifted: [String] = []
        for id in ids { if let i = deleted.firstIndex(of: id) { deleted.remove(at: i); lifted.append(id) } }
        if lifted.isEmpty { return }
        store.setJSON(deleted, StorageKey.deletedExercises)
        var restored = readIdList(StorageKey.restoredExercises)
        for id in lifted where !restored.contains(id) { restored.append(id) }
        saveRestored(restored)
    }

    public static func clearRestoredExerciseIds(_ ids: [String]) {
        var restored = readIdList(StorageKey.restoredExercises)
        var changed = false
        for id in ids { if let i = restored.firstIndex(of: id) { restored.remove(at: i); changed = true } }
        if changed { saveRestored(restored) }
    }

    // MARK: library

    static func buildDefaultLibrary() -> [LibraryExercise] { Catalog.exercises.map { LibraryExercise(id: $0.id, name: $0.name) } }

    static func migrateLibraryIfNeeded() {
        if let v = store.getItem(StorageKey.libraryV3), !v.isEmpty { return }
        let existing = store.getJSON([LibraryExercise].self, StorageKey.exercises) ?? []
        let master = Set(Catalog.exercises.map(\.id))
        let custom = existing.filter { !master.contains($0.id) && legacyIdMap[$0.id] == nil }
        saveExerciseLibrary(buildDefaultLibrary() + custom)
        store.setItem(StorageKey.libraryV2, "1")
        store.setItem(StorageKey.libraryV3, "1")
    }

    public static func getExerciseLibrary() -> [LibraryExercise] {
        migrateLibraryIfNeeded()
        let deleted = getDeletedExerciseIds()
        if let lib = store.getJSON([LibraryExercise].self, StorageKey.exercises) { return lib.filter { !deleted.contains($0.id) } }
        return buildDefaultLibrary().filter { !deleted.contains($0.id) }
    }

    public static func saveExerciseLibrary(_ exercises: [LibraryExercise]) { store.setJSON(exercises, StorageKey.exercises) }

    public static func addToExerciseLibrary(_ exercise: LibraryExercise, now: Double = LiftLogEnv.now()) {
        liftExerciseTombstones([exercise.id])
        let lib = getExerciseLibrary()
        if !lib.contains(where: { $0.id == exercise.id }) {
            var e = exercise; e.updatedAt = exercise.updatedAt ?? now
            saveExerciseLibrary(lib + [e])
        }
    }

    @discardableResult
    public static func mergeExerciseLibrary(_ incoming: [LibraryExercise]) -> [LibraryExercise] {
        let deleted = getDeletedExerciseIds()
        let local = getExerciseLibrary()
        var localById: [String: LibraryExercise] = [:]
        for e in local { localById[e.id] = e }
        let incomingIds = Set(incoming.map(\.id))
        let merged = incoming.map { inc -> LibraryExercise in
            if let loc = localById[inc.id], (loc.updatedAt ?? 0) > (inc.updatedAt ?? 0) { return loc }
            return inc
        }
        let result = (merged + local.filter { !incomingIds.contains($0.id) }).filter { !deleted.contains($0.id) }
        saveExerciseLibrary(result)
        return result
    }

    public static func pickableExercises() -> [LibraryExercise] {
        let deleted = getDeletedExerciseIds()
        var out: [LibraryExercise] = [], seenIds = Set<String>(), seenNames = Set<String>()
        for ex in getExerciseLibrary() where ex.archived != true {
            seenIds.insert(ex.id); seenNames.insert(slugify(ex.name))
            out.append(LibraryExercise(id: ex.id, name: ex.name))
        }
        for def in Catalog.exercises {
            if deleted.contains(def.id) || seenIds.contains(def.id) || seenNames.contains(slugify(def.name)) { continue }
            out.append(LibraryExercise(id: def.id, name: def.name))
        }
        return out.jsSorted { JS.localeCompare($0.name, $1.name) }
    }

    public static func ensureProgramExercisesInLibrary(_ program: [WorkoutDay]) {
        let deleted = getDeletedExerciseIds()
        let lib = getExerciseLibrary()
        var known = Set(lib.map(\.id))
        var missing: [LibraryExercise] = []
        for day in program {
            for ex in day.exercises where !known.contains(ex.id) && !deleted.contains(ex.id) {
                known.insert(ex.id)
                missing.append(LibraryExercise(id: ex.id, name: ex.name, updatedAt: LiftLogEnv.now()))
            }
        }
        if !missing.isEmpty { saveExerciseLibrary(lib + missing) }
    }

    public static func getExerciseName(_ id: String) -> String {
        Catalog.exerciseMap[id]?.name
            ?? getExerciseLibrary().first(where: { $0.id == id })?.name
            ?? Catalog.catalogDefFor(id)?.name
            ?? humanizeExerciseId(id)
    }

    static func humanizeExerciseId(_ id: String) -> String {
        let slug = id.replacingOccurrences(of: "-\\d{10,}$", with: "", options: .regularExpression)
        let out = slug.split(separator: "-").map { w in w.prefix(1).uppercased() + w.dropFirst() }.joined(separator: " ")
        return out.isEmpty ? id : out
    }

    public static func slugify(_ name: String) -> String {
        name.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "^-|-$", with: "", options: .regularExpression)
    }

    public static func generateExerciseId(_ name: String) -> String { "\(slugify(name))-\(JS.string(LiftLogEnv.now()))" }

    public static func findExerciseByName(_ name: String) -> LibraryExercise? {
        let slug = slugify(name)
        if slug.isEmpty { return nil }
        if let lib = getExerciseLibrary().first(where: { slugify($0.name) == slug }) { return lib }
        if let def = Catalog.exercises.first(where: { $0.id == slug || slugify($0.name) == slug }) {
            return LibraryExercise(id: def.id, name: def.name)
        }
        return nil
    }

    public static func archiveExercise(_ id: String, now: Double = LiftLogEnv.now()) {
        saveExerciseLibrary(getExerciseLibrary().map { e in
            guard e.id == id else { return e }
            var x = e; x.archived = true; x.updatedAt = now; return x
        })
    }

    public static func deleteExerciseFromLibrary(_ id: String) {
        addDeletedExerciseIds([id])
        saveExerciseLibrary(getExerciseLibrary().filter { $0.id != id })
        Catalog.deleteExerciseMeta(id)
    }

    @discardableResult
    public static func removeExerciseFromProgram(_ id: String, _ program: [WorkoutDay]) -> [WorkoutDay] {
        let updated = program.map { d -> WorkoutDay in var x = d; x.exercises = d.exercises.filter { $0.id != id }; return x }
        saveStoredProgram(updated)
        return updated
    }
}
