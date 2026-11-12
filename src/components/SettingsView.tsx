import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getRestDuration, saveRestDuration, REST_PRESETS,
} from '../data/settings';
import type { SyncUser } from '../data/sync';
import { getWeightUnit, saveWeightUnit } from '../data/units';
import type { WeightUnit } from '../data/units';
import { describeSyncStatus, getSyncStatus, subscribeSyncStatus } from '../data/syncStatus';
import { countUnbackedSessions } from '../data/backup';
import { saveBackupFile, restoreBackupFile } from './backupFile';
import './SettingsView.css';

interface Props {
  user: SyncUser;
  onBack: () => void;
  onViewExercises: () => void;
  onViewGlossary: () => void;
  onSyncNow: () => Promise<void>;
  onViewStrength: () => void;
  /** A backup was merged in — refresh app state and upload it */
  onRestored: () => Promise<void>;
}

export default function SettingsView({ user, onBack, onViewExercises, onViewGlossary, onSyncNow, onViewStrength, onRestored }: Props) {
  const [restSeconds, setRestSeconds] = useState(getRestDuration);
  const [unit, setUnit] = useState<WeightUnit>(getWeightUnit);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try { await onSyncNow(); } finally { setSyncing(false); }
  }

  // Workouts the server has not acknowledged — shown beside the sync line and
  // checked before signing out.
  const [unbacked, setUnbacked] = useState(0);
  useEffect(() => {
    let live = true;
    countUnbackedSessions().then(n => { if (live) setUnbacked(n); }).catch(() => {});
    return () => { live = false; };
  }, [syncStatus]);

  // Signing out itself keeps local data, but it is the first step of the two
  // ways to lose it (another account signing in here; reinstalling) — so it
  // asks first when this device holds the only copy of something.
  function confirmSignOut(e: React.FormEvent) {
    if (unbacked === 0) return;
    const ok = window.confirm(
      `${unbacked === 1 ? '1 workout on this device hasn\'t' : `${unbacked} workouts on this device haven't`} been uploaded yet.\n\n` +
      'Try "Sync now" or save a backup file first. Sign out anyway?',
    );
    if (!ok) e.preventDefault();
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const [backupNote, setBackupNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function handleSaveBackup() {
    try {
      await saveBackupFile(user.email);
    } catch {
      setBackupNote({ text: "Couldn't create the backup file.", error: true });
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await restoreBackupFile(file, user.email);
      const parts = [
        `${r.sessionsRestored} workout${r.sessionsRestored === 1 ? '' : 's'} restored`,
        ...(r.programRestored ? ['program restored'] : []),
        ...(r.planRestored ? ['training plan restored'] : []),
      ];
      setBackupNote({
        text: r.sessionsRestored === 0 && !r.programRestored && !r.planRestored
          ? 'Nothing to restore — this device already has everything in that backup.'
          : `${parts.join(', ')}.`,
      });
      await onRestored();
    } catch (err) {
      setBackupNote({ text: err instanceof Error ? err.message : 'Restore failed.', error: true });
    }
  }

  function handleRestChange(seconds: number) {
    setRestSeconds(seconds);
    saveRestDuration(seconds);
  }

  return (
    <div className="settings-view">
      <header className="settings-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <span className="settings-title">Settings</span>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <span className="settings-label">Library</span>
          <button className="settings-nav-row" onClick={onViewExercises}>
            <span className="settings-nav-icon">📋</span>
            <span className="settings-nav-text">
              <span className="settings-nav-title">Exercises</span>
              <span className="settings-nav-sub">Browse the library and edit muscle groups &amp; equipment</span>
            </span>
            <span className="settings-nav-chevron">›</span>
          </button>
          <button className="settings-nav-row" onClick={onViewStrength}>
            <span className="settings-nav-icon">🏋️</span>
            <span className="settings-nav-text">
              <span className="settings-nav-title">1RMs &amp; goals</span>
              <span className="settings-nav-sub">Enter your maxes for %-based loading; set a target and see how long it'll take</span>
            </span>
            <span className="settings-nav-chevron">›</span>
          </button>
          <button className="settings-nav-row" onClick={onViewGlossary}>
            <span className="settings-nav-icon">📖</span>
            <span className="settings-nav-text">
              <span className="settings-nav-title">Glossary of terms</span>
              <span className="settings-nav-sub">What e1RM, hard sets, deloads and blocks mean</span>
            </span>
            <span className="settings-nav-chevron">›</span>
          </button>
        </section>

        <section className="settings-section">
          <span className="settings-label">Weights in</span>
          <div className="settings-rest-presets" role="radiogroup" aria-label="Weight unit">
            {(['lb', 'kg'] as const).map(u => (
              <button
                key={u}
                className={`settings-rest-preset${unit === u ? ' active' : ''}`}
                role="radio"
                aria-checked={unit === u}
                onClick={() => { setUnit(u); saveWeightUnit(u); }}
              >
                {u === 'lb' ? 'Pounds (lbs)' : 'Kilograms (kg)'}
              </button>
            ))}
          </div>
          <p className="settings-hint">
            Display and entry only — every weight is stored in pounds, so switching back and forth loses nothing.
            Plate increments stay in pounds and show converted.
          </p>
        </section>

        <section className="settings-section">
          <span className="settings-label">Default rest timer</span>
          <div className="settings-rest-presets">
            {REST_PRESETS.map(p => (
              <button
                key={p}
                className={`settings-rest-preset${restSeconds === p ? ' active' : ''}`}
                onClick={() => handleRestChange(p)}
              >
                {p < 60 ? `${p}s` : `${p / 60} min`}
              </button>
            ))}
          </div>
          <p className="settings-hint">Starts automatically each time you log a set.</p>
        </section>

        <section className="settings-section">
          <span className="settings-label">Account</span>
          <div className="settings-account">
            <div className="settings-account-info">
              <span className="settings-account-name">{user.name}</span>
              <span className="settings-account-email">{user.email}</span>
            </div>
            {/* POST, not a link: a GET sign-out can be fired by a prefetch or a hostile page */}
            <form method="post" action="/api/auth/logout" className="settings-logout-form" onSubmit={confirmSignOut}>
              <button type="submit" className="settings-logout">Sign out</button>
            </form>
          </div>
          <div className="settings-sync">
            <span className={`settings-sync-status${syncStatus.authExpired || (syncStatus.lastError && (syncStatus.lastSuccessAt == null || (syncStatus.lastErrorAt ?? 0) > syncStatus.lastSuccessAt)) ? ' settings-sync-status--error' : ''}`}>
              {describeSyncStatus(syncStatus)}
            </span>
            {syncStatus.authExpired ? (
              <a href="/api/auth/google" className="settings-sync-btn">Sign in again</a>
            ) : (
              <button className="settings-sync-btn" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
          {unbacked > 0 && (
            <p className="settings-hint settings-hint--error" role="status">
              {unbacked === 1 ? '1 workout is' : `${unbacked} workouts are`} only on this device until the next successful sync.
            </p>
          )}
          <p className="settings-hint">
            Workouts, your program, exercise metadata and your training journey sync to your account.
            The rest timer and other device preferences stay on this device.
          </p>
        </section>

        <section className="settings-section">
          <span className="settings-label">Backup</span>
          <div className="settings-backup">
            <button className="settings-sync-btn" onClick={handleSaveBackup}>Save a backup file</button>
            <button className="settings-sync-btn" onClick={() => fileInput.current?.click()}>Restore from a file</button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="settings-backup-input"
              onChange={handleRestoreFile}
              aria-label="Choose a LiftLog backup file"
            />
          </div>
          {backupNote && (
            <p className={`settings-hint${backupNote.error ? ' settings-hint--error' : ''}`} role="status">{backupNote.text}</p>
          )}
          <p className="settings-hint">
            A backup is a copy of your workouts, program and plan that doesn't depend on sync.
            Restoring only adds what this device is missing — it never replaces newer data.
          </p>
        </section>
      </div>
    </div>
  );
}
