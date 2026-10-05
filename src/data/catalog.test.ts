// Catalog invariants.
//
// The compiled exercise catalog (exercises.ts) is data that several engines
// index by id: the planner, substitution, the difficulty gate, the head
// vocabulary, the legacy-id remap and the seed PROGRAM. Each table is edited
// by hand, so each can drift from the others — a prerequisite pointing at an
// id that was renamed, a head assigned from the wrong muscle's vocabulary, a
// duplicate name that two ids now share. None of that is a type error. The
// October 2026 audit checked these by script; this file makes the check
// permanent. taxonomy.test.ts owns the option-array ordering for muscles and
// movement patterns; this file covers the rest.

import { describe, it, expect } from 'vitest';
import {
  EXERCISES, EXERCISE_MAP, DIFFICULTY, PREREQUISITES, PRIMARY_HEADS, MUSCLE_HEADS,
  DIFFICULTY_RANK, difficultyFor, prerequisitesFor, headsFor,
} from './exercises';
import {
  MUSCLE_GROUPS, MUSCLE_REGIONS, MOVEMENT_PATTERNS, MOVEMENT_CATEGORIES,
  EQUIPMENT_OPTIONS, WEIGHT_TYPES, MEASURE_UNITS, regionFor, patternCategoryFor,
} from './taxonomy';
import { LEGACY_ID_MAP } from './legacyIds';
import { PROGRAM } from './program';

const ids = EXERCISES.map(e => e.id);

describe('catalog identity', () => {
  it('has a unique slug id per exercise', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, 'ids are lowercase slugs').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // A trailing run of ≥10 digits is how generateExerciseId stamps custom
      // entries; a catalog id must never look like one or catalogDefFor will
      // strip it.
      expect(id).not.toMatch(/-\d{10,}$/);
    }
  });

  it('has a unique name per exercise, ignoring case and whitespace', () => {
    const names = EXERCISES.map(e => e.name.trim().toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const e of EXERCISES) expect(e.name.trim()).toBe(e.name);
  });

  it('EXERCISE_MAP indexes every entry', () => {
    expect(EXERCISE_MAP.size).toBe(EXERCISES.length);
    for (const e of EXERCISES) expect(EXERCISE_MAP.get(e.id)).toBe(e);
  });
});

describe('catalog classification', () => {
  const muscles = new Set<string>(MUSCLE_GROUPS);
  const patterns = new Set<string>(MOVEMENT_PATTERNS);
  const equipment = new Set<string>(EQUIPMENT_OPTIONS);
  const weightTypes = new Set<string>(WEIGHT_TYPES);
  const units = new Set<string>(MEASURE_UNITS);

  it('gives every exercise a primary muscle from the vocabulary', () => {
    for (const e of EXERCISES) {
      expect(e.primaryMuscle, e.id).not.toBeNull();
      expect(muscles.has(e.primaryMuscle!), `${e.id}: ${e.primaryMuscle}`).toBe(true);
    }
  });

  it('lists secondaries as a 3-slot tuple of distinct muscles that exclude the primary', () => {
    for (const e of EXERCISES) {
      expect(e.secondaryMuscles, e.id).toHaveLength(3);
      const named = e.secondaryMuscles.filter((m): m is NonNullable<typeof m> => m != null);
      for (const m of named) expect(muscles.has(m), `${e.id}: ${m}`).toBe(true);
      expect(new Set(named).size, `${e.id} repeats a secondary`).toBe(named.length);
      expect(named, `${e.id} lists its primary as a secondary`).not.toContain(e.primaryMuscle);
    }
  });

  it('uses only vocabulary values for pattern, equipment, weight type and unit', () => {
    for (const e of EXERCISES) {
      expect(e.workoutType, e.id).not.toBeNull();
      expect(patterns.has(e.workoutType!), `${e.id}: ${e.workoutType}`).toBe(true);
      expect(e.equipment, e.id).not.toBeNull();
      expect(equipment.has(e.equipment!), `${e.id}: ${e.equipment}`).toBe(true);
      expect(e.weightType, e.id).not.toBeNull();
      expect(weightTypes.has(e.weightType!), `${e.id}: ${e.weightType}`).toBe(true);
      if (e.unit != null) expect(units.has(e.unit), `${e.id}: ${e.unit}`).toBe(true);
    }
  });

  it('maps every muscle to a region and every pattern to a category', () => {
    for (const m of MUSCLE_GROUPS) expect(MUSCLE_REGIONS).toContain(regionFor(m));
    for (const p of MOVEMENT_PATTERNS) expect(MOVEMENT_CATEGORIES).toContain(patternCategoryFor(p));
  });

  it('keeps the remaining option arrays alphabetical (they render as dropdowns)', () => {
    expect(EQUIPMENT_OPTIONS).toEqual([...EQUIPMENT_OPTIONS].sort());
    expect(WEIGHT_TYPES).toEqual([...WEIGHT_TYPES].sort());
    expect(MUSCLE_REGIONS).toEqual([...MUSCLE_REGIONS].sort());
  });
});

describe('difficulty and prerequisites', () => {
  it('only tags ids that exist in the catalog', () => {
    for (const id of Object.keys(DIFFICULTY)) expect(EXERCISE_MAP.has(id), id).toBe(true);
    for (const id of Object.keys(PREREQUISITES)) expect(EXERCISE_MAP.has(id), id).toBe(true);
  });

  it('resolves every prerequisite to a real, easier, different exercise', () => {
    for (const [id, prereqs] of Object.entries(PREREQUISITES)) {
      expect(prereqs.length, `${id} has an empty prerequisite list`).toBeGreaterThan(0);
      for (const p of prereqs) {
        expect(EXERCISE_MAP.has(p), `${id} → ${p}`).toBe(true);
        expect(p, `${id} is its own prerequisite`).not.toBe(id);
        expect(DIFFICULTY_RANK[difficultyFor(p)], `${id} → ${p} is not easier`)
          .toBeLessThan(DIFFICULTY_RANK[difficultyFor(id)]);
      }
    }
  });

  it('gates every advanced lift behind at least one prerequisite', () => {
    // The planner hides advanced lifts from beginners until a prerequisite has
    // been trained; an advanced lift with no prerequisite is hidden forever.
    for (const e of EXERCISES) {
      if (difficultyFor(e.id) !== 'advanced') continue;
      expect(prerequisitesFor(e.id).length, `${e.id} is advanced with no way to earn it`).toBeGreaterThan(0);
    }
  });
});

describe('muscle heads', () => {
  it('uses only MuscleGroup keys with non-empty vocabularies', () => {
    for (const [muscle, heads] of Object.entries(MUSCLE_HEADS)) {
      expect(MUSCLE_GROUPS).toContain(muscle);
      expect(heads!.length, muscle).toBeGreaterThan(0);
      expect(new Set(heads).size, `${muscle} repeats a head`).toBe(heads!.length);
    }
  });

  it("assigns each exercise's heads from its own primary muscle's vocabulary", () => {
    for (const [id, heads] of Object.entries(PRIMARY_HEADS)) {
      const def = EXERCISE_MAP.get(id);
      expect(def, `${id} has heads but is not in the catalog`).toBeDefined();
      const vocab = MUSCLE_HEADS[def!.primaryMuscle!] ?? [];
      expect(heads.length, `${id} has an empty head list`).toBeGreaterThan(0);
      for (const h of heads) expect(vocab, `${id} (${def!.primaryMuscle}) → ${h}`).toContain(h);
      expect(headsFor(id)).toEqual(heads);
    }
  });
});

describe('references into the catalog', () => {
  it('remaps every legacy id onto a current catalog id', () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_ID_MAP)) {
      expect(EXERCISE_MAP.has(canonical), `${legacy} → ${canonical}`).toBe(true);
      expect(EXERCISE_MAP.has(legacy), `${legacy} is both legacy and current`).toBe(false);
    }
  });

  it('seeds PROGRAM only from catalog exercises', () => {
    for (const day of PROGRAM) {
      for (const ex of day.exercises) {
        expect(EXERCISE_MAP.has(ex.id), `${day.label}: ${ex.id}`).toBe(true);
        expect(EXERCISE_MAP.get(ex.id)!.name).toBe(ex.name);
      }
    }
  });
});
