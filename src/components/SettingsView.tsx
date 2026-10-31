import { useState, useSyncExternalStore } from 'react';
import {
  getRestDuration, saveRestDuration, REST_PRESETS,
} from '../data/settings';
import type { SyncUser } from '../data/sync';
import { describeSyncStatus, getSyncStatus, subscribeSyncStatus } from '../data/syncStatus';
import './SettingsView.css';

interface Props {
  user: SyncUser;
  onBack: () => void;
  onViewExercises: () => void;
  onViewGlossary: () => void;
  onSyncNow: () => Promise<void>;
}

export default function SettingsView({ user, onBack, onViewExercises, onViewGlossary, onSyncNow }: Props) {
  const [restSeconds, setRestSeconds] = useState(getRestDuration);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try { await onSyncNow(); } finally { setSyncing(false); }
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
              <a href="/api/auth/google" className="settings-sync-btn">Sign in again</a>
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
      </div>
    </div>
  );
}
