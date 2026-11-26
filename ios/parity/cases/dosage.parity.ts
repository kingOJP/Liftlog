// dosage.ts + substitution.profileFor — sets × reps resolution.
import { it } from 'vitest';
import { Fixture } from '../harness';
import {
  parseDose, isHeavyAxial, dosage, rangeFromHistory, resolvePrescription, backoffFactor, strengthMainSlot, phaseRange,
  applyPhaseRanges, topSetScheme,
} from '../../../src/data/dosage';
import type { RepPrescription, DosageHistorySession } from '../../../src/data/dosage';
import { profileFor } from '../../../src/data/substitution';
import type { ExerciseProfile } from '../../../src/data/substitution';
import { EXERCISES } from '../../../src/data/exercises';
import type { Goal, ExperienceLevel, PhaseKind } from '../../../src/data/plan';
import type { Exercise, WorkoutDay } from '../../../src/data/program';
import type { WeightType } from '../../../src/data/taxonomy';

const GOALS: Goal[] = ['hypertrophy', 'strength', 'fat-loss', 'athletic', 'general', 'sport-support'];
const EXPS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const PHASES: (PhaseKind | null)[] = [null, 'accumulation', 'intensification', 'peak', 'deload', 'intro'];
const storage = { liftlog_library_v3: '1', liftlog_exercises: [{ id: 'my-rdl-1782325116469', name: 'Romanian Deadlifts' }] };

it('dosage fixture', () => {
  const f = new Fixture('dosage');
  const ids = [...EXERCISES.map(e => e.id), 'my-rdl-1782325116469', 'unknown-lift'];
  for (const id of ids) f.record(`profile ${id}`, 'profileFor', [id], (x: string) => profileFor(x), { storage });
  f.record('profile named', 'profileFor', ['x-1782325116469', 'Barbell Squat'], profileFor, { storage });

  const seen = new Set<string>();
  const reps: ExerciseProfile[] = [];
  for (const id of ids) {
    const p = profileFor(id);
    const k = `${p.workoutType}|${p.weightType}|${p.unit}|${p.mechanics}`;
    if (!seen.has(k)) { seen.add(k); reps.push(p); }
  }
  for (const p of reps) {
    f.record(`axial ${p.id}`, 'isHeavyAxial', [p], isHeavyAxial);
    for (const g of GOALS) for (const x of EXPS) for (const main of [false, true]) {
      f.record(`dose ${p.id} ${g} ${x} ${main}`, 'dosage', [g, { main }, p, x], dosage);
    }
  }
  const fb: RepPrescription = { sets: 4, repLow: 6, repHigh: 8 };
  const DOSES: [string | number, string | number, string | number, RepPrescription | null][] = [
    ['3', '8', '12', null], [4, 10, 6, null], ['', '', '', fb], ['', '', '', null], ['-3', '2.5', '', fb], ['9', '', '7', null],
    [' 2 ', ' 5', '', { sets: 7 }], ['abc', '0', '-1', { sets: 2, repLow: 3 }], [3.0, '12.0', '15', null], ['1e1', '', '', null],
  ];
  DOSES.forEach((d, i) => f.record(`parse ${i}`, 'parseDose', d, parseDose));
  const H: DosageHistorySession[][] = [
    [], [{ sets: [] }], [{ sets: [{ reps: 10 }, { reps: 9 }, { reps: 8 }] }],
    [{ sets: [{ reps: 5 }] }, { sets: [] }, { sets: [{ reps: 6 }, { reps: 6 }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 4 }, { reps: 4 }] }, { sets: [{ reps: 12 }] }, { sets: [{ reps: 30 }] }],
    [{ sets: [{ reps: 1 }, { reps: 2 }] }, { sets: [{ reps: 2 }, { reps: 1 }] }],
  ];
  H.forEach((h, i) => {
    f.record(`history ${i}`, 'rangeFromHistory', [h], rangeFromHistory);
    for (const g of [null, 'strength'] as (Goal | null)[]) {
      f.record(`resolve ${i} ${g}`, 'resolvePrescription', [profileFor('barbell-bench-press'), g, h], (p: ExerciseProfile, goal: Goal | null, hh: DosageHistorySession[]) =>
        resolvePrescription({ profile: p, goal, experience: 'intermediate', history: hh }));
    }
  });
  for (const p of PHASES) f.record(`backoff ${p}`, 'backoffFactor', [p], backoffFactor);
  const SLOTS: Exercise[] = [
    { id: 'a', name: 'A', sets: 4, main: true, repLow: 4, repHigh: 6 }, { id: 'b', name: 'B', sets: 4, main: true, repLow: 3, repHigh: 5, rangeSource: 'plan' },
    { id: 'c', name: 'C', sets: 4, main: true, repLow: 1, repHigh: 2 }, { id: 'd', name: 'D', sets: 3, main: true, repLow: 6, repHigh: 10 },
    { id: 'e', name: 'E', sets: 4, main: true, repLow: 4, repHigh: 6, rangeSource: 'user' }, { id: 'f', name: 'F', sets: 4, main: true, repLow: 4, repHigh: 6, rangeSource: 'history' },
    { id: 'g', name: 'G', sets: 4, main: true, repLow: 4, repHigh: 6, progression: 'manual' }, { id: 'h', name: 'H', sets: 4, repLow: 4, repHigh: 6 },
    { id: 'i', name: 'I', sets: 4, main: true }, { id: 'j', name: 'J', sets: 4, main: true, repLow: 2, repHigh: 3 },
  ];
  for (const s of SLOTS) for (const g of [null, 'strength', 'hypertrophy'] as (Goal | null)[]) {
    f.record(`main ${s.id} ${g}`, 'strengthMainSlot', [s, g], strengthMainSlot);
    for (const p of PHASES) f.record(`range ${s.id} ${g} ${p}`, 'phaseRange', [s, g, p], phaseRange);
    for (const x of EXPS) for (const w of ['Barbell', 'Bodyweight', null] as (WeightType | null)[]) {
      f.record(`top ${s.id} ${g} ${x} ${w}`, 'topSetScheme', [s, g, x, w], topSetScheme);
    }
  }
  const day: WorkoutDay = { id: 1, label: 'Heavy', muscleGroups: 'All', exercises: SLOTS };
  for (const p of PHASES) f.record(`apply ${p}`, 'applyPhaseRanges', [day, 'strength', p], applyPhaseRanges);
  f.write();
});
