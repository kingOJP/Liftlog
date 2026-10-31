import { describe, it, expect, beforeEach } from 'vitest';
import { getWeightUnit, saveWeightUnit, toDisplay, fromDisplay, fmtWeight, unitLabelFor } from './units';

beforeEach(() => localStorage.clear());

describe('weight unit preference (decision D8)', () => {
  it('defaults to pounds and leaves pound values untouched', () => {
    expect(getWeightUnit()).toBe('lb');
    expect(toDisplay(185)).toBe(185);
    expect(fromDisplay(185)).toBe(185);
    expect(fmtWeight(185)).toBe('185 lbs');
  });

  it('displays kilograms to one decimal and converts typed kilograms back to stored pounds', () => {
    saveWeightUnit('kg');
    expect(getWeightUnit()).toBe('kg');
    expect(toDisplay(185)).toBe(83.9);
    expect(fmtWeight(100)).toBe('45.4 kg');
    expect(unitLabelFor()).toBe('kg');
    expect(fromDisplay(60)).toBe(132.25); // nearest quarter pound to 132.28
  });

  it('round-trips a kg entry within display precision', () => {
    saveWeightUnit('kg');
    const stored = fromDisplay(62.5);
    expect(toDisplay(stored)).toBe(62.5);
  });

  it('re-logging a prescribed load shown in kg stores the original pounds exactly', () => {
    saveWeightUnit('kg');
    for (const lbs of [185, 227.5, 45, 102.5, 315]) {
      expect(fromDisplay(toDisplay(lbs))).toBe(lbs);
    }
  });

  it('never changes what is stored: the same pounds read differently in each unit', () => {
    const lbs = 225;
    expect(toDisplay(lbs, 'lb')).toBe(225);
    expect(toDisplay(lbs, 'kg')).toBe(102.1);
  });
});
