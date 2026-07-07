import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { computeMetrics } from '../data/metrics';
import type { Metrics } from '../data/metrics';
import { computeCoaching, SETS_TARGET_LOW, SETS_TARGET_HIGH } from '../data/insights';
import type { Coaching, Insight } from '../data/insights';
import { getWeekNumber } from '../data/program';
import { getActivePhase } from '../data/planStore';
import { BarChart, LineChart } from './charts';
import MuscleHeatmap from './MuscleHeatmap';
import './MetricsView.css';

interface Props {
  program: WorkoutDay[];
  onBack: () => void;
}

function formatVolume(v: number): string {
  return v.toLocaleString('en-US');
}

export default function MetricsView({ program, onBack }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(snap => {
      if (cancelled) return;
      const m = computeMetrics(snap);
      setMetrics(m);
      setSnapshot(snap);
      if (m.exercises.length > 0) setSelectedExercise(m.exercises[0].exerciseId);
      setCoaching(computeCoaching(program, snap, getWeekNumber(), Date.now(), getActivePhase()));
    });
    return () => { cancelled = true; };
  }, [program]);

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
            {/* ── Coach ── */}
            {coaching && (coaching.highlights.length > 0 || coaching.opportunities.length > 0 || coaching.plan.changes.length > 0) && (
              <section className="metric-section">
                <h2 className="metric-heading">Coach</h2>
                <p className="metric-sub">Read from your training data · {coaching.weekLabel}.</p>

                {coaching.highlights.length > 0 && (
                  <>
                    <h3 className="coach-subhead coach-subhead--good">What's working</h3>
                    <InsightList insights={coaching.highlights} />
                  </>
                )}

                {coaching.opportunities.length > 0 && (
                  <>
                    <h3 className="coach-subhead coach-subhead--opportunity">Biggest opportunities</h3>
                    <InsightList insights={coaching.opportunities} />
                  </>
                )}

                {coaching.plan.changes.length > 0 && (
                  <>
                    <h3 className="coach-subhead coach-subhead--plan">Program adjustments</h3>
                    <p className="metric-sub">
                      Applied automatically to your next workouts — you'll see them explained when you open the day.
                    </p>
                    <div className="coach-insight-list">
                      {coaching.plan.changes.map((c, i) => (
                        <div key={i} className="coach-insight-item coach-insight--plan">
                          <span className="coach-insight-title">
                            {c.dayLabel} · {c.exerciseName}: {c.fromSets} → {c.toSets} sets
                          </span>
                          <span className="coach-insight-detail">{c.reason}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ── Muscle heatmap ── */}
            {snapshot && (
              <section className="metric-section">
                <h2 className="metric-heading">Training Heatmap</h2>
                <p className="metric-sub">Where your training volume is landing — per muscle, per week.</p>
                <MuscleHeatmap snapshot={snapshot} />
              </section>
            )}

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

            {/* ── Unclassified-exercise notice ── */}
            {metrics.unclassifiedExercises.length > 0 && (
              <div className="metric-warning">
                <span className="metric-warning-title">
                  ⚠ {metrics.unclassifiedExercises.length} exercise{metrics.unclassifiedExercises.length !== 1 ? 's' : ''} missing a primary muscle
                </span>
                <span className="metric-warning-body">
                  These show under “Other” in the muscle breakdown. Set a primary muscle from the Exercise list to include them:
                </span>
                <span className="metric-warning-list">{metrics.unclassifiedExercises.join(', ')}</span>
              </div>
            )}

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

function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <div className="coach-insight-list">
      {insights.map((ins, i) => (
        <div key={i} className={`coach-insight-item coach-insight--${ins.kind}`}>
          <span className="coach-insight-title">{ins.title}</span>
          <span className="coach-insight-detail">{ins.detail}</span>
        </div>
      ))}
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
