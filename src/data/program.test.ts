// src/data/program.ts — the domain types plus the app's calendar-week math.
//
// The week helpers were covered indirectly (settings.test.ts drives
// getWeekNumberForDate through the stored anchor); what had nothing on it were
// the prescription label helpers and getWeekDateRange. The labels matter more
// than their size suggests: they are the last line of defence against an
// unprescribed slot rendering as "3 × undefined–undefined", which is the exact
// failure the optional rep range introduced.

import { describe, it, expect } from 'vitest';
import {
  prescriptionLabel, prescriptionDetail, getExerciseName,
  startOfWeek, addWeeks, weeksBetween, weekStartLabel, getWeekDateRange,
  dayInPhase,
} from './program';
import type { WorkoutDay } from './program';

describe('prescription labels', () => {
  it('renders a full prescription', () => {
    expect(prescriptionLabel({ sets: 3, repLow: 8, repHigh: 12 })).toBe('3 × 8–12');
    expect(prescriptionDetail({ sets: 3, repLow: 8, repHigh: 12 })).toBe('3 sets · 8–12 reps');
  });

  // An unprescribed slot is a real state (no plan, no history), not a bug —
  // it must read as a set count, never as an invented or undefined range.
  it('drops the range entirely when there is nothing to prescribe', () => {
    expect(prescriptionLabel({ sets: 3 })).toBe('3 sets');
    expect(prescriptionDetail({ sets: 3 })).toBe('3 sets');
  });

  it('never prints undefined when only one bound is present', () => {
    expect(prescriptionLabel({ sets: 3, repLow: 8 })).toBe('3 sets');
    expect(prescriptionLabel({ sets: 3, repHigh: 12 })).toBe('3 sets');
  });

  it('gets the singular right for a one-set slot', () => {
    expect(prescriptionLabel({ sets: 1 })).toBe('1 set');
    expect(prescriptionDetail({ sets: 1 })).toBe('1 set');
  });
});

describe('getExerciseName', () => {
  it('resolves a catalog id to its name', () => {
    expect(getExerciseName('face-pulls')).toBe('Face Pulls');
  });

  it('falls back to the id rather than rendering nothing', () => {
    expect(getExerciseName('not-in-the-catalog')).toBe('not-in-the-catalog');
  });
});

// Every week-bucketed analytic groups on this, so a Monday anchor that drifted
// would silently re-shuffle the whole metrics screen.
describe('Monday-anchored week math', () => {
  const wednesday = new Date(2026, 6, 29, 15, 30).getTime(); // Wed 29 Jul 2026

  it('snaps back to the Monday at midnight', () => {
    const monday = new Date(startOfWeek(wednesday));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(27);
    expect([monday.getHours(), monday.getMinutes(), monday.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('treats Sunday as the end of the week it closes, not the start of the next', () => {
    const sunday = new Date(2026, 7, 2, 12).getTime(); // Sun 2 Aug 2026
    expect(startOfWeek(sunday)).toBe(startOfWeek(wednesday));
  });

  it('is idempotent', () => {
    expect(startOfWeek(startOfWeek(wednesday))).toBe(startOfWeek(wednesday));
  });

  it('addWeeks and weeksBetween are inverses', () => {
    const start = startOfWeek(wednesday);
    expect(weeksBetween(start, addWeeks(start, 6))).toBe(6);
    expect(weeksBetween(addWeeks(start, 6), start)).toBe(-6);
  });

  it('survives a daylight-saving boundary', () => {
    // Late October in the northern hemisphere: the clocks move, the week
    // boundary must not. Six weeks on from a July Monday is still a Monday.
    const later = new Date(addWeeks(startOfWeek(wednesday), 13));
    expect(later.getDay()).toBe(1);
    expect(later.getHours()).toBe(0);
  });

  // It labels a week start; it does not snap to one. Callers pass the output
  // of startOfWeek (sessionWeekStart does), which is what the chart's bars are
  // already keyed on.
  it('labels a week start as its Monday date', () => {
    expect(weekStartLabel(startOfWeek(wednesday))).toBe('7/27');
  });

  it('formats the current week as a date range', () => {
    // Same month and spanning two months both have to read sensibly.
    expect(getWeekDateRange()).toMatch(/^[A-Z][a-z]+ \d+–([A-Z][a-z]+ )?\d+$/);
  });
});

describe('dayInPhase — per-day block-phase gating', () => {
  const day = (phases?: string[]): WorkoutDay => ({
    id: 1, label: 'Day 1', muscleGroups: 'Legs', exercises: [],
    ...(phases ? { phases } : {}),
  } as WorkoutDay);

  it('schedules an ungated day in every phase', () => {
    expect(dayInPhase(day(), 'accumulation')).toBe(true);
    expect(dayInPhase(day(), 'deload')).toBe(true);
    expect(dayInPhase(day(), null)).toBe(true);
  });

  // This is how the sport-support lifting taper is enforced rather than merely
  // described: the power day simply does not exist in a deload week.
  it('drops a gated day outside the phases it names', () => {
    const buildOnly = day(['accumulation', 'intensification']);
    expect(dayInPhase(buildOnly, 'accumulation')).toBe(true);
    expect(dayInPhase(buildOnly, 'deload')).toBe(false);
  });

  it('schedules a gated day when the phase is unknown, rather than losing the workout', () => {
    expect(dayInPhase(day(['accumulation']), null)).toBe(true);
  });
});
