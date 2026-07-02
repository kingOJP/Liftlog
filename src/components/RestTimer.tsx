import { useState, useEffect } from 'react';
import { getRestDuration, saveRestDuration, REST_PRESETS } from '../data/settings';
import './RestTimer.css';

// Wall-clock read, kept at module scope so it stays outside React's purity model.
const clockNow = () => Date.now();

interface Props {
  // Increment this (e.g. a logged-set counter) to (re)start the countdown.
  runId: number;
  onDismiss: () => void;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function RestTimer({ runId, onDismiss }: Props) {
  const [duration, setDuration] = useState(getRestDuration);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState(false);
  // Wall-clock deadline the countdown ticks toward (survives tab throttling)
  const [endAt, setEndAt] = useState(0);

  // (Re)start whenever runId changes (a new set was logged). Guarded state
  // adjustment during render — the React pattern for resetting state when a
  // prop changes.
  const [lastRunId, setLastRunId] = useState(0);
  if (runId !== lastRunId) {
    setLastRunId(runId);
    if (runId !== 0) {
      setEndAt(clockNow() + duration * 1000);
      setRemaining(duration);
      setDone(false);
    }
  }

  // Tick against the wall-clock deadline
  useEffect(() => {
    if (runId === 0 || done || endAt === 0) return;
    const id = setInterval(() => {
      const left = Math.round((endAt - clockNow()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        setDone(true);
        if ('vibrate' in navigator) navigator.vibrate([120, 60, 120]);
        clearInterval(id);
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [runId, done, endAt]);

  if (runId === 0) return null;

  function adjust(delta: number) {
    const next = Math.max(clockNow(), endAt + delta * 1000);
    setEndAt(next);
    const left = Math.max(0, Math.round((next - clockNow()) / 1000));
    setRemaining(left);
    if (left > 0) setDone(false);
  }

  function pickPreset(sec: number) {
    setDuration(sec);
    saveRestDuration(sec);
    setEndAt(clockNow() + sec * 1000);
    setRemaining(sec);
    setDone(false);
  }

  const pct = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;

  return (
    <div className={`rest-timer${done ? ' done' : ''}`}>
      <div className="rest-progress" style={{ width: `${pct * 100}%` }} />
      <div className="rest-row">
        <div className="rest-readout">
          <span className="rest-label">{done ? 'Rest done' : 'Rest'}</span>
          <span className="rest-clock">{fmt(remaining)}</span>
        </div>

        <div className="rest-presets">
          {REST_PRESETS.map(p => (
            <button
              key={p}
              className={`rest-preset${duration === p ? ' active' : ''}`}
              onClick={() => pickPreset(p)}
            >
              {p < 60 ? `${p}s` : `${p / 60}m`}
            </button>
          ))}
        </div>

        <div className="rest-controls">
          <button className="rest-adjust" onClick={() => adjust(-15)} aria-label="Minus 15 seconds">−15</button>
          <button className="rest-adjust" onClick={() => adjust(15)} aria-label="Plus 15 seconds">+15</button>
          <button className="rest-skip" onClick={onDismiss} aria-label="Skip rest">Skip</button>
        </div>
      </div>
    </div>
  );
}
