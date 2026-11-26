import XCTest
@testable import LiftLogCore


final class CatalogParityTests: XCTestCase {
    func testCatalogParity() throws {
        try Parity.run("catalog", [
            "catalogIds": { _ in Catalog.exercises.map(\.id) },
            "lookup": { c in
                let id: String = try c.arg(0)
                return obj([
                    "def": Catalog.catalogDefFor(id).json, "difficulty": Catalog.difficultyFor(id).rawValue,
                    "hasDifficulty": Catalog.hasCatalogDifficulty(id), "unit": Catalog.unitFor(id).rawValue,
                    "timed": Catalog.isTimedExercise(id), "prereqs": Catalog.prerequisitesFor(id),
                    "heads": Catalog.headsFor(id), "meta": Catalog.getExerciseMeta(id),
                ])
            },
            "regionFor": { c in Taxonomy.regionFor(try c.arg(0)).rawValue },
            "patternCategoryFor": { c in Taxonomy.patternCategoryFor(try c.arg(0)).rawValue },
            "unitLabels": { _ in [Taxonomy.unitLabel(.reps), Taxonomy.unitLabel(.reps, plural: false),
                                  Taxonomy.unitLabel(.seconds), Taxonomy.unitLabel(.seconds, plural: false)] },
            "getExerciseMeta": { c in Catalog.getExerciseMeta(try c.arg(0)) },
            "getAllExerciseMeta": { _ in Catalog.getAllExerciseMeta() },
            "saveExerciseMeta": { c in
                Catalog.saveExerciseMeta(try c.arg(0), try c.arg(1), now: try c.arg(2)); return Catalog.getAllExerciseMeta()
            },
            "deleteExerciseMeta": { c in Catalog.deleteExerciseMeta(try c.arg(0)); return Catalog.getAllExerciseMeta() },
            "mergeExerciseMeta": { c in Catalog.mergeExerciseMeta(try c.arg(0)); return Catalog.getAllExerciseMeta() },
        ])
    }

    func testVariationsParity() throws {
        try Parity.run("variations", [
            "info": { _ in
                obj([
                    "technique": Dictionary(uniqueKeysWithValues: SetTechnique.allCases.map { ($0.rawValue, Variations.techniqueInfo($0)) }),
                    "grip": Dictionary(uniqueKeysWithValues: Grip.allCases.map { ($0.rawValue, Variations.gripInfo($0)) }),
                ])
            },
            "technique": { c in
                let raw: String? = try c.arg(0)
                let t = raw.flatMap(SetTechnique.init(rawValue:))
                return obj(["isExtension": Variations.isExtension(t), "isRepStyle": Variations.isRepStyle(t),
                            "setCredit": Variations.setCredit(raw), "countsForStrength": Variations.countsForStrength(raw)])
            },
            "variation": { c in
                let v: SetVariation? = try c.arg(0)
                return obj(["key": Variations.variationKey(v), "style": Variations.styleOf(v ?? SetVariation()),
                            "has": Variations.hasVariation(v), "label": Variations.variationLabel(v).json])
            },
            "styleOfRaw": { c in
                let raw: [String: String] = try c.arg(0)
                return Variations.styleOf(technique: raw["technique"], grip: raw["grip"])
            },
            "sameVariation": { c in Variations.sameVariation(try c.arg(0), try c.arg(1)) },
            "options": { c in
                let p: MovementPattern? = try c.arg(0)
                return obj(["grips": Variations.gripOptionsFor(p), "techniques": Variations.techniqueOptionsFor(p),
                            "timedTechniques": Variations.techniqueOptionsFor(p, unit: .seconds)])
            },
            "extensionOptions": { _ in [Variations.extensionOptionsFor(), Variations.extensionOptionsFor(unit: .seconds)] },
            "adjustInvolvement": { c in Variations.adjustInvolvement(try c.arg(0), try c.arg(1), try c.arg(2)) },
        ])
    }
}
