// program.ts week math + labels, settings.ts program start / rest duration.
import { it } from 'vitest';
import { Fixture } from '../harness';
import {
  PROGRAM, dayInPhase, prescriptionLabel, prescriptionDetail, rangeLabel, startOfWeek, addWeeks, weeksBetween,
  toLocalDateValue, shortDateLabel, getWeekNumberForDate, getWeekNumber, getWeekDateRange,
} from '../../../src/data/program';
import type { Exercise, WorkoutDay } from '../../../src/data/program';
import type { PhaseKind } from '../../../src/data/plan';
import { getProgramStartValue, saveProgramStart, getRestDuration } from '../../../src/data/settings';

// Chicago: DST starts 2026-03-08, ends 2026-11-01; plus year boundaries.
const STAMPS = [
  Date.UTC(2026, 2, 7, 18), Date.UTC(2026, 2, 8, 7, 30), Date.UTC(2026, 2, 8, 9), Date.UTC(2026, 2, 9, 5, 59),
  Date.UTC(2026, 9, 31, 23), Date.UTC(2026, 10, 1, 6, 30), Date.UTC(2026, 10, 1, 7, 30), Date.UTC(2026, 10, 2, 5),
  Date.UTC(2025, 11, 31, 12), Date.UTC(2026, 0, 1, 5, 59), Date.UTC(2024, 1, 29, 15), 1773846000000, 0,
];

it('program fixture', () => {
  const f = new Fixture('program');
  f.record('seed program', 'seedProgram', [], () => PROGRAM);
  for (const ts of STAMPS) {
    f.record(`week math ${ts}`, 'weekMath', [ts], (t: number) => {
      const sow = startOfWeek(t);
      return {
        sow, plus1: addWeeks(sow, 1), minus3: addWeeks(sow, -3), plus30: addWeeks(sow, 30), between: weeksBetween(sow, addWeeks(sow, 9)),
        date: toLocalDateValue(t), short: shortDateLabel(t),
        weekNo: getWeekNumberForDate(new Date(t), new Date(2026, 0, 14)), weekNoBefore: getWeekNumberForDate(new Date(t), new Date(2030, 0, 1)),
      };
    });
  }
  const exs: Exercise[] = [
    { id: 'a', name: 'A', sets: 3, repLow: 8, repHigh: 12 }, { id: 'b', name: 'B', sets: 1 }, { id: 'c', name: 'C', sets: 4, repLow: 5, repHigh: 5 },
    { id: 'd', name: 'D', sets: 4, repLow: 3, repHigh: 5, technique: 'paused', grip: 'close' }, { id: 'e', name: 'E', sets: 2, progression: 'manual', grip: 'wide' },
    { id: 'f', name: 'F', sets: 1, repLow: 10, repHigh: 15, technique: 'drop', progression: 'coach' },
  ];
  for (const ex of exs) f.record(`labels ${ex.id}`, 'labels', [ex], (e: Exercise) => ({ label: prescriptionLabel(e), detail: prescriptionDetail(e) }));
  f.record('rangeLabel', 'rangeLabel', [6, 6], rangeLabel);
  const day = (phases?: PhaseKind[]): WorkoutDay => ({ id: 1, label: 'D', muscleGroups: '', exercises: [], ...(phases ? { phases } : {}) });
  for (const [d, p] of [[day(), 'accumulation'], [day([]), 'deload'], [day(['accumulation', 'maintenance']), null], [day(['accumulation']), 'deload'], [day(['accumulation', 'race-week']), 'race-week']] as const) {
    f.record(`dayInPhase ${JSON.stringify(d.phases)} ${p}`, 'dayInPhase', [d, p], dayInPhase);
  }
  // now-dependent + settings-backed
  for (const now of [1773846000000, Date.UTC(2026, 10, 30, 12), Date.UTC(2026, 11, 29, 12), Date.UTC(2026, 2, 8, 12)]) {
    f.record(`range ${now}`, 'nowWeek', [], () => ({ range: getWeekDateRange(), week: getWeekNumber(), start: getProgramStartValue() }),
      { now, storage: { liftlog_settings: { programStart: '2026-01-05' } } });
  }
  for (const start of [undefined, 'garbage', '2026-02-30', '2026-13-01', '2025-12-31']) {
    f.record(`program start ${start}`, 'programStart', [], () => ({ value: getProgramStartValue(), week: getWeekNumber() }),
      { storage: start === undefined ? {} : { liftlog_settings: { programStart: start } } });
  }
  for (const v of ['2026-04-06', '2026-4-6', '2026-02-29']) f.record(`save start ${v}`, 'saveProgramStart', [v], (x: string) => [saveProgramStart(x), getProgramStartValue()]);
  for (const raw of [undefined, '180', '90', 'abc', ' 300 ', '60.0']) {
    f.record(`rest ${raw}`, 'restDuration', [], getRestDuration, { storage: raw === undefined ? {} : { liftlog_rest_seconds: raw } });
  }
  f.write();
});
