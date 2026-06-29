import { useState, useEffect } from 'react';
import { computeMetrics } from '../data/metrics';
import type { Metrics } from '../data/metrics';
import { BarChart, LineChart } from './charts';
import './MetricsView.css';

interface Props {
  onBack: () => void;
}

// Hypertrophy research suggests ~10–20 hard sets per muscle per week
const SETS_TARGET_LOW = 10;
const SETS_TARGET_HIGH = 20;

function formatVolume(v: number): string {
  return v.toLocaleString('en-US');
}

export default function MetricsView({ onBack }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string>('');

  useEffect(() => {
    computeMetrics().then(m => {
      setMetrics(m);
      if (m.exercises.length > 0) setSelectedExercise(m.exercises[0].exerciseId);
    });
  }, []);

  const selected = metrics?.exercises.find(e => e.exerciseId === selectedExercise);
  const maxMuscleSets = Math.max(...(metrics?.muscleSets.map(m => m.sets) ?? [0]), SETS_TARGET_HIGH);

  return (
    <div className="metrics-view">
      <header className="metrics-header">
        <button className="back-btn" onClick={onBack} aria-label="Back to dashboard">&#8592;</button>
        <span className="metrics-title">Metrics</span>
      </header>

      <div className="metrics-body">
        {!metrics && <p className="metrics-empty">Loading…</p>}

        {metrics && !metrics.hasData && (
          <p className="metrics-empty">No workouts logged yet. Complete a workout to see your metrics.</p>
        )}

        {metrics && metrics.hasData && (
          <>
            {/* ── Summary stats ── */}
            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-value">{metrics.summary.totalWorkouts}</span>
                <span className="stat-label">Workouts</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{formatVolume(metrics.summary.totalVolume)}</span>
                <span className="stat-label">Total lbs lifted</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{formatVolume(metrics.summary.thisWeekVolume)}</span>
                <span className="stat-label">This week (lbs)</span>
              </div>
              <div className="stat-card">
                <span className={`stat-value ${deltaClass(metrics.summary.deltaPct)}`}>
                  {formatDelta(metrics.summary.deltaPct)}
                </span>
                <span className="stat-label">vs last week</span>
              </div>
            </div>

            {/* ── Weekly volume ── */}
            <section className="metric-section">
              <h2 className="metric-heading">Weekly Volume</h2>
              <p className="metric-sub">Total weight × reps lifted each week — your progressive-overload signal.</p>
              {metrics.weeklyVolume.length > 0
                ? <BarChart data={metrics.weeklyVolume} />
                : <p className="metrics-empty">Not enough data yet.</p>}
            </section>

            {/* ── Estimated 1RM ── */}
            <section className="metric-section">
              <h2 className="metric-heading">Estimated 1RM</h2>
              <p className="metric-sub">Best-set strength estimate (Epley) over time — are you getting stronger?</p>
              {metrics.exercises.length > 0 && (
                <select
                  className="metric-select"
                  value={selectedExercise}
                  onChange={e => setSelectedExercise(e.target.value)}
                >
                  {metrics.exercises.map(ex => (
                    <option key={ex.exerciseId} value={ex.exerciseId}>{ex.name}</option>
                  ))}
                </select>
              )}
              {selected && selected.points.length >= 2
                ? <LineChart data={selected.points} unit="lbs" />
                : <p className="metrics-empty">Log this exercise at least twice to see a trend.</p>}
            </section>

            {/* ── Sets per muscle group ── */}
            <section className="metric-section">
              <h2 className="metric-heading">Sets per Muscle Group</h2>
              <p className="metric-sub">
                {metrics.muscleWeekLabel} · aim for {SETS_TARGET_LOW}–{SETS_TARGET_HIGH} hard sets per muscle weekly.
              </p>
              {metrics.muscleSets.length > 0 ? (
                <div className="muscle-list">
                  {metrics.muscleSets.map(m => (
                    <div className="muscle-row" key={m.muscle}>
                      <span className="muscle-name">{m.muscle}</span>
                      <div className="muscle-bar-track">
                        <div
                          className={`muscle-bar-fill${m.sets >= SETS_TARGET_LOW ? ' in-range' : ''}`}
                          style={{ width: `${(m.sets / maxMuscleSets) * 100}%` }}
                        />
                      </div>
                      <span className="muscle-count">{m.sets}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="metrics-empty">No sets logged this week yet.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function formatDelta(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function deltaClass(pct: number | null): string {
  if (pct === null || pct === 0) return '';
  return pct > 0 ? 'delta-up' : 'delta-down';
}
