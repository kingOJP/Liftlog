import { useState } from 'react';
import {
  getRestDuration, saveRestDuration, REST_PRESETS,
} from '../data/settings';
import type { SyncUser } from '../data/sync';
import { formatSyncAge } from '../data/syncStatus';
import { useSyncStatus } from './useSyncStatus';
import './SettingsView.css';

interface Props {
  user: SyncUser;
  onBack: () => void;
  onViewExercises: () => void;
  onViewGlossary: () => void;
}

export default function SettingsView({ user, onBack, onViewExercises, onViewGlossary }: Props) {
  const [restSeconds, setRestSeconds] = useState(getRestDuration);
  const syncStatus = useSyncStatus();

  const lastSync = syncStatus.lastSyncAt != null
    ? `last sync ${formatSyncAge(syncStatus.lastSyncAt)}`
    : 'not synced yet';
  const syncLine =
    syncStatus.state === 'ok' ? `✓ Backed up · ${lastSync}`
    : syncStatus.state === 'offline' ? `Offline — will sync when you're back · ${lastSync}`
    : syncStatus.state === 'auth' ? `Session expired — sign in again to back up · ${lastSync}`
    : `Sync failing — retrying automatically · ${lastSync}`;

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
            <a href="/api/auth/logout" className="settings-logout">Sign out</a>
          </div>
          <p className={`settings-sync settings-sync--${syncStatus.state}`}>{syncLine}</p>
          <p className="settings-hint">
            Workouts sync to your account. Exercise muscle metadata and these settings stay on this device.
          </p>
        </section>
      </div>
    </div>
  );
}
