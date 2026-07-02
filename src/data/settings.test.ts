import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProgramStartValue, saveProgramStart, DEFAULT_PROGRAM_START,
  getRestDuration, saveRestDuration, DEFAULT_REST_SECONDS,
} from './settings';
import { getWeekNumberForDate } from './program';

beforeEach(() => localStorage.clear());

describe('program start setting', () => {
  it('falls back to the default when unset or corrupt', () => {
    expect(getProgramStartValue()).toBe(DEFAULT_PROGRAM_START);
    localStorage.setItem('liftlog_settings', 'not json');
    expect(getProgramStartValue()).toBe(DEFAULT_PROGRAM_START);
  });

  it('round-trips a saved date', () => {
    expect(saveProgramStart('2026-01-05')).toBe(true);
    expect(getProgramStartValue()).toBe('2026-01-05');
  });

  it('rejects invalid dates', () => {
    expect(saveProgramStart('garbage')).toBe(false);
    expect(saveProgramStart('2026-13-40')).toBe(false);
    expect(getProgramStartValue()).toBe(DEFAULT_PROGRAM_START);
  });
});

describe('getWeekNumberForDate', () => {
  const start = new Date(2026, 0, 5); // Mon Jan 5 2026, local time

  it('is week 1 on the start date and through the first Sunday', () => {
    expect(getWeekNumberForDate(new Date(2026, 0, 5), start)).toBe(1);
    expect(getWeekNumberForDate(new Date(2026, 0, 11, 23, 59), start)).toBe(1);
  });

  it('rolls to week 2 the following Monday', () => {
    expect(getWeekNumberForDate(new Date(2026, 0, 12), start)).toBe(2);
  });

  it('clamps dates before the start to week 1', () => {
    expect(getWeekNumberForDate(new Date(2025, 11, 25), start)).toBe(1);
  });

  it('uses the saved program start by default', () => {
    saveProgramStart('2026-01-05');
    expect(getWeekNumberForDate(new Date(2026, 0, 12))).toBe(2);
  });
});

describe('rest duration setting', () => {
  it('defaults when unset or invalid', () => {
    expect(getRestDuration()).toBe(DEFAULT_REST_SECONDS);
    localStorage.setItem('liftlog_rest_seconds', '999');
    expect(getRestDuration()).toBe(DEFAULT_REST_SECONDS);
  });

  it('round-trips a preset', () => {
    saveRestDuration(90);
    expect(getRestDuration()).toBe(90);
  });
});
