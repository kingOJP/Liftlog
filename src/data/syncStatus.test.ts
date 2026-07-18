import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSyncStatus, subscribeSyncStatus, reportSyncSuccess, reportSyncFailure,
  clearSyncStatus, formatSyncAge,
} from './syncStatus';

const NOW = new Date('2026-07-01T12:00:00').getTime();

beforeEach(() => {
  localStorage.clear();
  clearSyncStatus();
});

describe('sync status transitions', () => {
  it('starts ok with no last-sync timestamp', () => {
    const s = getSyncStatus();
    expect(s.state).toBe('ok');
    expect(s.lastSyncAt).toBeNull();
    expect(s.pushPending).toBe(false);
  });

  it('a successful push records the timestamp and clears pending', () => {
    reportSyncFailure('push', 'error');
    reportSyncSuccess('push', NOW);
    const s = getSyncStatus();
    expect(s.state).toBe('ok');
    expect(s.lastSyncAt).toBe(NOW);
    expect(s.pushPending).toBe(false);
  });

  it('a failed push flags pushPending and keeps the last-success timestamp', () => {
    reportSyncSuccess('push', NOW);
    reportSyncFailure('push', 'error');
    const s = getSyncStatus();
    expect(s.state).toBe('error');
    expect(s.pushPending).toBe(true);
    expect(s.lastSyncAt).toBe(NOW);
  });

  it('a successful pull does not mask a failing push', () => {
    reportSyncFailure('push', 'error');
    reportSyncSuccess('pull', NOW);
    const s = getSyncStatus();
    expect(s.state).toBe('error');       // still not healthy
    expect(s.pushPending).toBe(true);    // retry loop keeps going
    expect(s.lastSyncAt).toBe(NOW);      // but the contact is recorded
  });

  it('a failed pull does not set pushPending', () => {
    reportSyncFailure('pull', 'offline');
    const s = getSyncStatus();
    expect(s.state).toBe('offline');
    expect(s.pushPending).toBe(false);
  });

  it('distinguishes auth failures', () => {
    reportSyncFailure('push', 'auth');
    expect(getSyncStatus().state).toBe('auth');
  });

  it('persists the last-success timestamp across a reload (fresh read)', () => {
    reportSyncSuccess('push', NOW);
    expect(Number(localStorage.getItem('liftlog_last_sync'))).toBe(NOW);
  });

  it('clearSyncStatus resets state and drops the stored timestamp', () => {
    reportSyncSuccess('push', NOW);
    reportSyncFailure('push', 'error');
    clearSyncStatus();
    const s = getSyncStatus();
    expect(s).toEqual({ state: 'ok', lastSyncAt: null, pushPending: false });
    expect(localStorage.getItem('liftlog_last_sync')).toBeNull();
  });

  it('notifies subscribers on change and returns a stable snapshot', () => {
    let calls = 0;
    const unsub = subscribeSyncStatus(() => calls++);

    const before = getSyncStatus();
    reportSyncFailure('push', 'error');
    expect(calls).toBe(1);
    expect(getSyncStatus()).not.toBe(before);          // replaced on change

    const snap = getSyncStatus();
    reportSyncFailure('push', 'error');                // identical status
    expect(calls).toBe(1);                             // no spurious notify
    expect(getSyncStatus()).toBe(snap);                // same reference

    unsub();
    reportSyncSuccess('push', NOW);
    expect(calls).toBe(1);
  });
});

describe('formatSyncAge', () => {
  it('formats minutes, hours and days', () => {
    expect(formatSyncAge(NOW - 30_000, NOW)).toBe('just now');
    expect(formatSyncAge(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatSyncAge(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(formatSyncAge(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
  });
});
