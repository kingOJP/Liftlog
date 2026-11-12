import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import {
  getRestDuration, saveRestDuration, REST_PRESETS,
} from '../data/settings';
import type { SyncUser } from '../data/sync';
import { getWeightUnit, saveWeightUnit } from '../data/units';
import type { WeightUnit } from '../data/units';
import { describeSyncStatus, getSyncStatus, subscribeSyncStatus } from '../data/syncStatus';
import { exportMyData, deleteMyAccount } from '../data/account';
import { SUPPORT_EMAIL, versionLabel } from '../data/appInfo';
import { signInAgain } from '../data/sync';
import { useDialog } from './useDialog';
import './SettingsView.css';

interface Props {
  user: SyncUser;
  onBack: () => void;
  onViewExercises: () => void;
  onViewGlossary: () => void;
  onSyncNow: () => Promise<void>;
  onViewStrength: () => void;
}

export default function SettingsView({ user, onBack, onViewExercises, onViewGlossary, onSyncNow, onViewStrength }: Props) {
  const [restSeconds, setRestSeconds] = useState(getRestDuration);
  const [unit, setUnit] = useState<WeightUnit>(getWeightUnit);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try { await onSyncNow(); } finally { setSyncing(false); }
  }

  const [exportState, setExportState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeDelete = useCallback(() => setConfirmingDelete(false), []);

  async function handleExport() {
    if (exportState === 'working') return;
    setExportState('working');
    try {
      await exportMyData();
      setExportState('done');
    } catch (err) {
      console.error(err);
      setExportState('failed');
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
            <form method="post" action="/api/auth/logout" className="settings-logout-form">
              <button type="submit" className="settings-logout">Sign out</button>
            </form>
          </div>
          <div className="settings-sync">
            <span className={`settings-sync-status${syncStatus.authExpired || (syncStatus.lastError && (syncStatus.lastSuccessAt == null || (syncStatus.lastErrorAt ?? 0) > syncStatus.lastSuccessAt)) ? ' settings-sync-status--error' : ''}`}>
              {describeSyncStatus(syncStatus)}
            </span>
            {syncStatus.authExpired ? (
              <button className="settings-sync-btn" onClick={signInAgain}>Sign in again</button>
            ) : (
              <button className="settings-sync-btn" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
          <p className="settings-hint">
            Workouts, your program, exercise metadata and your training journey sync to your account.
            The rest timer and other device preferences stay on this device.
          </p>
        </section>

        <section className="settings-section">
          <span className="settings-label">Your data</span>
          <button className="settings-nav-row" onClick={handleExport} disabled={exportState === 'working'}>
            <span className="settings-nav-text">
              <span className="settings-nav-title">
                {exportState === 'working' ? 'Preparing your export…' : 'Export my data'}
              </span>
              <span className="settings-nav-sub">
                {exportState === 'done' ? 'Export ready — check your downloads or the share sheet.'
                  : exportState === 'failed' ? 'The export could not be created. Try again.'
                  : 'Every workout, your program and your plan as one file'}
              </span>
            </span>
            <span className="settings-nav-chevron">›</span>
          </button>
          <button className="settings-nav-row settings-nav-row--danger" onClick={() => setConfirmingDelete(true)}>
            <span className="settings-nav-text">
              <span className="settings-nav-title">Delete account</span>
              <span className="settings-nav-sub">Permanently remove your account and all training data</span>
            </span>
            <span className="settings-nav-chevron">›</span>
          </button>
        </section>

        <section className="settings-section">
          <span className="settings-label">About</span>
          <div className="settings-links">
            <a className="settings-link" href="/support">Help &amp; support</a>
            {SUPPORT_EMAIL && (
              <a className="settings-link" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`LiftLog feedback — ${versionLabel()}`)}`}>
                Send feedback
              </a>
            )}
            <a className="settings-link" href="/privacy">Privacy policy</a>
            <a className="settings-link" href="/terms">Terms of use</a>
          </div>
          <p className="settings-hint settings-version">{versionLabel()}</p>
        </section>
      </div>

      {confirmingDelete && (
        <DeleteAccountDialog email={user.email} onClose={closeDelete} />
      )}
    </div>
  );
}

// Deleting an account is the one action in the app that cannot be undone or
// re-synced, so it asks for a typed confirmation rather than a second tap.
function DeleteAccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable identity: useDialog re-runs (and re-focuses) when its callback changes.
  const busyRef = useRef(false);
  const close = useCallback(() => { if (!busyRef.current) onClose(); }, [onClose]);
  const ref = useDialog<HTMLDivElement>(close);
  const armed = typed.trim().toUpperCase() === 'DELETE';

  async function handleDelete() {
    if (!armed || busy) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      // A fresh document: no state from the deleted account survives in memory.
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The account could not be deleted.');
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="settings-dialog-backdrop" onClick={close}>
      <div
        ref={ref}
        className="settings-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-detail"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="delete-account-title" className="settings-dialog-title">Delete your account?</h2>
        <p id="delete-account-detail" className="settings-dialog-text">
          This permanently deletes the account <strong>{email}</strong> and every workout, program,
          plan and setting stored for it — on our servers and on this device. It cannot be undone.
          Export your data first if you want a copy.
        </p>
        <label className="settings-dialog-label" htmlFor="delete-account-confirm">
          Type DELETE to confirm
        </label>
        <input
          id="delete-account-confirm"
          className="settings-date-input"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={busy}
        />
        {error && <p className="settings-hint settings-hint--error" role="alert">{error}</p>}
        <div className="settings-dialog-actions">
          <button className="settings-dialog-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="settings-dialog-btn settings-dialog-btn--danger"
            onClick={handleDelete}
            disabled={!armed || busy}
          >
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  );
}
