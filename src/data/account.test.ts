// Export and account deletion — the two "it's your data" promises the privacy
// policy makes. The export has to be complete and readable; deletion has to
// be impossible to trigger halfway (local data wiped, server copy intact, or
// the reverse).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { buildDataExport, shapeExport, deleteMyAccount } from './account';
import { saveWorkout, clearIDB, dumpIDB } from '../db/database';
import { saveStoredProgram, getStoredProgram } from './programStore';

beforeEach(async () => {
  // The suite runs on `node`; the export reads the signed-in account's cookie.
  vi.stubGlobal('document', { cookie: `liftlog_user=${encodeURIComponent(JSON.stringify({ email: 'me@example.com', name: 'Me' }))}` });
  localStorage.clear();
  await clearIDB();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function logWorkout(startedAt: number, note?: string) {
  await saveWorkout({
    dayId: 1, weekNumber: 1, startedAt, completedAt: startedAt + 3_600_000, note,
    sets: [
      { exerciseId: 'bench-press', setNumber: 1, weight: 45, reps: 10, order: 0, warmup: true },
      { exerciseId: 'bench-press', setNumber: 1, weight: 185, reps: 8, order: 0, grip: 'close' },
      { exerciseId: 'chin-ups', setNumber: 1, weight: 0, reps: 9, order: 1 },
    ],
  });
}

describe('the data export', () => {
  it('holds every workout, oldest first, with exercise names a person can read', async () => {
    await logWorkout(Date.UTC(2026, 9, 12, 17), 'felt strong');
    await logWorkout(Date.UTC(2026, 9, 5, 17));
    const data = await buildDataExport(Date.UTC(2026, 10, 1));

    expect(data.exportedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(data.account).toEqual({ email: 'me@example.com', name: 'Me' });
    expect(data.sessions.map(s => s.startedAt)).toEqual(['2026-10-05T17:00:00.000Z', '2026-10-12T17:00:00.000Z']);
    expect(data.sessions[1].note).toBe('felt strong');
    expect(data.sessions[1].completedAt).toBe('2026-10-12T18:00:00.000Z');
    expect(data.sessions[1].sets).toEqual([
      { exerciseId: 'bench-press', exercise: 'Bench Press', set: 1, weightLbs: 45, reps: 10, warmup: true },
      { exerciseId: 'bench-press', exercise: 'Bench Press', set: 1, weightLbs: 185, reps: 8, grip: 'close' },
      { exerciseId: 'chin-ups', exercise: 'Chin Ups', set: 1, weightLbs: 0, reps: 9 },
    ]);
  });

  it('says which unit the weights are in, whatever the display preference', async () => {
    localStorage.setItem('liftlog_weight_unit', 'kg');
    expect((await buildDataExport()).weightUnit).toBe('lb');
  });

  it('includes the program and the journey, not just the log', async () => {
    saveStoredProgram([{ id: 1, label: 'Day 1', muscleGroups: 'Push', exercises: [] }], 1);
    const data = await buildDataExport();
    expect(data.program).toEqual([{ id: 1, label: 'Day 1', muscleGroups: 'Push', exercises: [] }]);
    expect(data.trainingJourney).toBeTruthy();
    expect(Array.isArray(data.exerciseLibrary)).toBe(true);
  });

  it('is an empty but valid file for a brand-new account', async () => {
    const data = await buildDataExport();
    expect(data.sessions).toEqual([]);
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it('keeps a session whose sets are missing rather than dropping it', () => {
    const out = shapeExport([{ id: 7, dayId: 2, weekNumber: 1, startedAt: 1000 }], [], id => id, 5000);
    expect(out).toEqual([{ id: 'legacy-1000', dayId: 2, startedAt: '1970-01-01T00:00:01.000Z', completedAt: null, sets: [] }]);
  });
});

describe('deleting the account', () => {
  async function seedLocal() {
    await logWorkout(Date.UTC(2026, 9, 12, 17));
    saveStoredProgram([{ id: 1, label: 'Day 1', muscleGroups: 'Push', exercises: [] }], 1);
    localStorage.setItem('liftlog_data_owner', 'me@example.com');
  }

  it('asks the server with an explicit confirmation, then wipes this device', async () => {
    await seedLocal();
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteMyAccount();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/account');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ confirm: 'DELETE' });
    expect((await dumpIDB()).sessions).toEqual([]);
    expect(getStoredProgram()).toEqual([]);
    // The next account on this device is not mistaken for a "switch".
    expect(localStorage.getItem('liftlog_data_owner')).toBeNull();
  });

  it.each([
    ['the server refuses', async () => new Response('nope', { status: 500 })],
    ['the session expired', async () => new Response('nope', { status: 401 })],
    ['the phone is offline', async () => { throw new TypeError('Failed to fetch'); }],
  ])('keeps everything on the device when %s', async (_label, respond) => {
    await seedLocal();
    vi.stubGlobal('fetch', vi.fn(respond));
    await expect(deleteMyAccount()).rejects.toThrow();
    expect((await dumpIDB()).sessions).toHaveLength(1);
    expect(getStoredProgram()).toHaveLength(1);
    expect(localStorage.getItem('liftlog_data_owner')).toBe('me@example.com');
  });
});
