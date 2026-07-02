import { useState } from 'react';
import { getWeekNumber } from '../data/program';
import {
  getProgramStartValue, saveProgramStart,
  getRestDuration, saveRestDuration, REST_PRESETS,
} from '../data/settings';
import type { SyncUser } from '../data/sync';
import './SettingsView.css';

interface Props {
  user: SyncUser;
  onBack: () => void;
}

export default function SettingsView({ user, onBack }: Props) {
  const [programStart, setProgramStart] = useState(getProgramStartValue);
  const [restSeconds, setRestSeconds] = useState(getRestDuration);
  const [startError, setStartError] = useState(false);

  function handleStartChange(value: string) {
    setProgramStart(value);
    const ok = saveProgramStart(value);
    setStartError(!ok);
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
          <span className="settings-label">Training block start</span>
          <input
            className="settings-date-input"
            type="date"
            value={programStart}
            onChange={e => handleStartChange(e.target.value)}
            aria-invalid={startError}
          />
          {startError
            ? <p className="settings-hint settings-hint--error">Pick a valid date.</p>
            : <p className="settings-hint">
                Week numbering counts from this date — you're in week {getWeekNumber()}.
                Changing it only affects how new workouts are grouped into weeks.
              </p>}
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
          <p className="settings-hint">
            Workouts sync to your account. Exercise muscle metadata and these settings stay on this device.
          </p>
        </section>
      </div>
    </div>
  );
}
