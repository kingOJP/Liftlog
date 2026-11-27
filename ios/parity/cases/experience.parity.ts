// experience.ts — training-age inference and the level-up nudge.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { inferExperience, effectiveExperience, experienceSuggestion, experienceSuggestionText } from '../../../src/data/experience';
import { buildSnapshot } from '../../../src/data/analytics';
import { defaultTrainingProfile } from '../../../src/data/plan';
import type { ExperienceLevel } from '../../../src/data/plan';
import type { Session, SetLog } from '../../../src/db/database';

const DAY = 86_400_000;
const history = (count: number, spanDays: number, ids: string[]) => {
  const sessions: Session[] = [], logs: SetLog[] = [];
  for (let i = 0; i < count; i++) {
    const t = DEFAULT_NOW - spanDays * DAY + (count > 1 ? (i * spanDays * DAY) / (count - 1) : 0);
    sessions.push({ id: i + 1, guid: `g${i}`, dayId: 1, weekNumber: 1, startedAt: t, completedAt: t + 3_600_000 });
    ids.forEach((ex, j) => logs.push({ id: i * 10 + j + 1, sessionId: i + 1, exerciseId: ex, setNumber: 1, weight: 100, reps: 8 }));
  }
  return [sessions, logs] as const;
};
const ADV = ['barbell-squat', 'romanian-deadlifts', 'barbell-bench-press', 'pull-ups', 'my-custom-1782325116469'];
const CASES: [string, number, number, string[]][] = [
  ['empty', 0, 0, []], ['one', 1, 0, ['leg-press']], ['ten weeks', 30, 70, ADV], ['intermediate', 45, 200, ['leg-press']],
  ['advanced span', 130, 560, ['leg-press']], ['mastery', 85, 380, ADV], ['two years', 200, 800, ['leg-press']], ['almost', 39, 190, ADV],
];

it('experience fixture', () => {
  const f = new Fixture('experience');
  for (const [name, count, span, ids] of CASES) {
    const [s, l] = history(count, span, ids);
    f.record(`infer ${name}`, 'inferExperience', [s, l], (ss: Session[], ll: SetLog[]) => inferExperience(buildSnapshot(ss, ll), DEFAULT_NOW));
    for (const x of ['beginner', 'intermediate', 'advanced'] as ExperienceLevel[]) {
      f.record(`suggest ${name} ${x}`, 'experienceSuggestion', [s, l, x], (ss: Session[], ll: SetLog[], lvl: ExperienceLevel) => {
        const profile = { ...defaultTrainingProfile(), experience: lvl };
        const sug = experienceSuggestion(profile, buildSnapshot(ss, ll), DEFAULT_NOW);
        return { sug, text: sug ? experienceSuggestionText(sug) : null, effective: effectiveExperience(profile, null) };
      });
    }
  }
  f.record('suggest no snapshot', 'experienceSuggestion', [null, null, 'beginner'], (_s: null, _l: null, lvl: string) => ({ sug: experienceSuggestion({ ...defaultTrainingProfile(), experience: lvl as ExperienceLevel }, null), text: null, effective: lvl }));
  f.write();
});
