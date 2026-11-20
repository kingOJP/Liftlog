import { useState, useEffect, useMemo, useRef } from 'react';
import type { WorkoutDay } from '../data/program';
import { loadTrainingSnapshot, volumeTargetFor } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { computeMetrics, computeRangeSummary } from '../data/metrics';
import type { Metrics } from '../data/metrics';
import { computeCoaching } from '../data/insights';
import type { Coaching, Insight, InsightKind } from '../data/insights';
import {
  computeMuscleHeat, dateInputValue, defaultHeatRange, HEAT_PRESETS, presetCopy, previousWindow, rangeWindow,
} from '../data/heatmap';
import type { HeatPreset, HeatRange } from '../data/heatmap';
import { getActivePhase, getTrainingGoal, getPhaseResolver, getProfileOrDefault, getCoachDecisions, getOneRepMax } from '../data/planStore';
import { STATUS_INFO } from '../data/progress';
import { goalLabel } from '../data/plan';
import { BarChart, LineChart } from './charts';
import { toDisplay, unitLabelFor } from '../data/units';
import ExerciseHistorySheet from './ExerciseHistorySheet';
import HeatmapSheet from './HeatmapSheet';
import MuscleHeatmap from './MuscleHeatmap';
import Segmented from './Segmented';
import Icon from './Icon';
import type { IconName } from './Icon';
import './MetricsView.css';

interface Props {
  program: WorkoutDay[];
  onBack: () => void;
  /** open the Strength screen (1RM + goal) for a lift */
  onViewStrength: (exerciseId: string) => void;
}

type Tab = 'coach' | 'progress' | 'prs';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'coach', label: 'Coach' },
  { id: 'progress', label: 'Progress' },
  { id: 'prs', label: 'PRs' },
];

const INSIGHT_ICON: Record<InsightKind, IconName> = {
  'pr': 'trophy',
  'trend-up': 'trend-up',
  'volume-up': 'chart',
  'consistency': 'calendar',
  'trend-down': 'trend-down',
  'plateau': 'trend-flat',
  'volume-high': 'flame',
  'program-gap': 'target',
};

const PROGRESS_LIMIT = 5;
const PROGRESS_WINDOW_MS = 60 * 86_400_000;
const PR_LIMIT = 20;

/** Whole numbers with separators; a seven-figure total is abbreviated so it
 *  still fits a half-width tile on a phone. */
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return v.toLocaleString('en-US');
}

export default function MetricsView({ program, onBack, onViewStrength }: Props) {
  const [tab, setTab] = useState<Tab>('coach');
  const [showAllProgress, setShowAllProgress] = useState(false);
  // Per-exercise history sheet, opened from any row that is about one lift
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  // Captured once at mount — the clock must not be read during render.
  const [now] = useState(() => Date.now());
  // ONE time range for the page: the heatmap, its detail sheet and the range
  // stats all read it, whichever control changed it.
  const [range, setRange] = useState<HeatRange>(() => defaultHeatRange());
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  // Which bar of the weekly chart is read out; null = the current week
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const heatmapCard = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(snap => {
      if (cancelled) return;
      const m = computeMetrics(snap);
      setMetrics(m);
      setSnapshot(snap);
      if (m.exercises.length > 0) setSelectedExercise(m.exercises[0].exerciseId);
      setCoaching(computeCoaching(program, snap, Date.now(), getActivePhase(), getTrainingGoal(), getPhaseResolver(), getProfileOrDefault().experience, getCoachDecisions()));
    });
    return () => { cancelled = true; };
  }, [program]);

  const goal = getTrainingGoal();
  // The weekly set band the heatmap judges against belongs to the active goal.
  const band = volumeTargetFor(goal, getProfileOrDefault().experience);
  const unit = unitLabelFor();
  const maxDate = dateInputValue(now);
  const copy = presetCopy(range.preset);

  const ranged = useMemo(() => {
    if (!snapshot) return null;
    const win = rangeWindow(range, now);
    const prev = previousWindow(win);
    return {
      heat: computeMuscleHeat(snapshot, win.from, win.to),
      prevHeat: computeMuscleHeat(snapshot, prev.from, prev.to),
      summary: computeRangeSummary(snapshot, win.from, win.to),
    };
  }, [snapshot, range, now]);

  function changeTab(next: Tab) {
    setTab(next);
    // A tab is a page of its own: start it at the top, not wherever the last one was left.
    window.scrollTo({ top: 0 });
  }

  function changePreset(preset: HeatPreset) {
    setRange(r => ({ ...r, preset }));
    // The custom dates live in the heatmap card — bring them to the thumb.
    if (preset === 'custom') {
      requestAnimationFrame(() => heatmapCard.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  }

  const openHistory = (id: string, name: string) => setHistoryFor({ id, name });

  // Progress report: every lift trained recently, not just the current
  // program's — a quick-workout lifter has no program, and a lift the last
  // replan rotated out is exactly the one worth comparing. Attention items
  // (declining, stalled) first so the tab leads with what needs action;
  // program lifts sort first within a status.
  const programIds = new Set(program.flatMap(d => d.exercises.map(e => e.id)));
  const statusRank = { declining: 0, stalled: 1, progressing: 2, steady: 3 } as const;
  const progressAll = (coaching?.progress ?? [])
    .filter(p => programIds.has(p.exerciseId) || now - p.lastTs <= PROGRESS_WINDOW_MS)
    .sort((a, b) => statusRank[a.status] - statusRank[b.status]
      || Number(programIds.has(b.exerciseId)) - Number(programIds.has(a.exerciseId))
      || b.totalSessions - a.totalSessions);
  const progressReport = showAllProgress ? progressAll : progressAll.slice(0, PROGRESS_LIMIT);

  // PR timeline: every PR event in the recent assessment windows, newest first.
  const recentPRs = (coaching?.progress ?? [])
    .flatMap(p => p.recentPRs.map(pr => ({ ...pr, name: p.name, exerciseId: p.exerciseId })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, PR_LIMIT);

  const selected = metrics?.exercises.find(e => e.exerciseId === selectedExercise);
  const hasData = !!metrics?.hasData;

  // Weekly chart, in the display unit. The readout follows the tapped bar.
  const weeks = (metrics?.weeklyVolume ?? []).map(w => ({ ...w, value: Math.round(toDisplay(w.value)) }));
  const currentWeekIndex = weeks.findIndex(w => w.isCurrent);
  const weekIndex = selectedWeek !== null && selectedWeek < weeks.length ? selectedWeek : currentWeekIndex;
  const week = weeks[weekIndex];
  const weekBefore = weekIndex > 0 ? weeks[weekIndex - 1] : undefined;
  // A week still in progress isn't compared with a finished one — it reads as
  // a drop every Monday.
  const weekDelta = week && !week.isCurrent && weekBefore && weekBefore.value > 0
    ? Math.round(((week.value - weekBefore.value) / weekBefore.value) * 100)
    : null;

  return (
    <div className="metrics-view">
      <header className="metrics-header">
        <div className="metrics-header-row">
          <button className="back-btn" onClick={onBack} aria-label="Back to dashboard">&#8592;</button>
          <h1 className="metrics-title">Metrics</h1>
          {hasData && tab === 'coach' && (
            <label className="metrics-range">
              <span className="metrics-range-label">{copy.menu}</span>
              <Icon name="chevron-down" size={14} strokeWidth={2.2} />
              <select
                aria-label="Time range"
                value={range.preset}
                onChange={e => changePreset(e.target.value as HeatPreset)}
              >
                {HEAT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.menu}</option>)}
              </select>
            </label>
          )}
        </div>
        {hasData && (
          <Segmented variant="tabs" label="Metrics sections" idBase="metrics" options={TABS} value={tab} onChange={changeTab} />
        )}
      </header>

      <div className="metrics-body">
        {!metrics && <p className="metrics-empty">Loading…</p>}

        {metrics && !metrics.hasData && (
          <div className="metrics-blank">
            <span className="metrics-blank-icon"><Icon name="chart" size={26} /></span>
            <p className="metrics-blank-title">No workouts logged yet</p>
            <p className="metrics-blank-text">Finish a workout and your coaching, heatmap and trends show up here.</p>
          </div>
        )}

        {/* ── Coach: the overview ── */}
        {metrics && hasData && tab === 'coach' && (
          <div className="metrics-panel" role="tabpanel" id="metrics-panel-coach" aria-labelledby="metrics-tab-coach">
            {coaching && coaching.highlights.length > 0 && (
              <section className="insight-group">
                <h2 className="group-label group-label--good"><Icon name="trend-up" size={16} strokeWidth={2} />What's working</h2>
                {coaching.highlights.map((ins, i) => <InsightRow key={i} insight={ins} onOpen={openHistory} />)}
              </section>
            )}

            {coaching && coaching.opportunities.length > 0 && (
              <section className="insight-group">
                <h2 className="group-label group-label--watch"><Icon name="target" size={16} strokeWidth={2} />Biggest opportunities</h2>
                {coaching.opportunities.map((ins, i) => <InsightRow key={i} insight={ins} onOpen={openHistory} />)}
              </section>
            )}

            {coaching && coaching.plan.changes.length > 0 && (
              <section className="insight-group">
                <h2 className="group-label group-label--plan"><Icon name="sliders" size={16} strokeWidth={2} />Program adjustments</h2>
                {coaching.plan.changes.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    className="insight-row insight-row--plan"
                    onClick={() => openHistory(c.exerciseId, c.exerciseName)}
                  >
                    <span className="insight-icon"><Icon name="bulb" size={20} /></span>
                    <span className="insight-text">
                      <span className="insight-title">{c.dayLabel} · {c.exerciseName}: {c.fromSets} → {c.toSets} sets</span>
                      <span className="insight-detail">{c.reason}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="insight-go" />
                  </button>
                ))}
                <p className="group-note">Applied to your next workouts — each is explained again when you open the day.</p>
              </section>
            )}

            {ranged && (
              <section className="metric-card" ref={heatmapCard}>
                <div className="metric-card-head">
                  <span className="metric-card-icon"><Icon name="flame" size={18} /></span>
                  <h2 className="metric-heading">Training Heatmap</h2>
                  <button type="button" className="metric-card-link" onClick={() => setHeatmapOpen(true)}>
                    Details <Icon name="chevron-right" size={14} strokeWidth={2.2} />
                  </button>
                </div>
                <p className="metric-sub">Where you're putting in the work — over {copy.phrase}.</p>
                <MuscleHeatmap
                  heat={ranged.heat}
                  band={band}
                  range={range}
                  onChange={setRange}
                  maxDate={maxDate}
                  onOpenDetails={() => setHeatmapOpen(true)}
                />
              </section>
            )}

            <div className="stat-grid">
              <StatTile icon="dumbbell" value={formatVolume(metrics.summary.totalWorkouts)} label="Total workouts" />
              <StatTile icon="calendar" value={formatVolume(Math.round(toDisplay(metrics.summary.totalVolume)))} label={`Total ${unit} lifted`} />
              <StatTile icon="chart" value={ranged ? formatVolume(Math.round(toDisplay(ranged.summary.volume))) : '—'} label={`${copy.menu} (${unit})`} />
              <StatTile
                icon={ranged?.summary.deltaPct != null && ranged.summary.deltaPct < 0 ? 'trend-down' : 'trend-up'}
                value={formatDelta(ranged?.summary.deltaPct ?? null)}
                label={copy.vsLabel}
                tone={deltaTone(ranged?.summary.deltaPct ?? null)}
              />
            </div>

            {metrics.unclassifiedExercises.length > 0 && (
              <div className="metric-warning">
                <button
                  type="button"
                  className="metric-warning-head"
                  aria-expanded={warningOpen}
                  onClick={() => setWarningOpen(o => !o)}
                >
                  <span className="metric-warning-icon"><Icon name="alert" size={20} /></span>
                  <span className="insight-text">
                    <span className="insight-title">
                      {metrics.unclassifiedExercises.length === 1
                        ? '1 exercise is missing a primary muscle'
                        : `${metrics.unclassifiedExercises.length} exercises are missing a primary muscle`}
                    </span>
                    <span className="insight-detail">Its sets can't be placed on the heatmap.</span>
                  </span>
                  <Icon name="chevron-down" size={16} className={`insight-go${warningOpen ? ' is-open' : ''}`} />
                </button>
                {warningOpen && (
                  <p className="metric-warning-body">
                    Set a primary muscle in Settings → Exercises to include{' '}
                    <strong>{metrics.unclassifiedExercises.join(', ')}</strong>.
                  </p>
                )}
              </div>
            )}

            {week && (
              <section className="metric-card">
                <div className="metric-card-head">
                  <span className="metric-card-icon"><Icon name="chart" size={18} /></span>
                  <h2 className="metric-heading">Weekly Volume</h2>
                </div>
                <p className="metric-sub">Weight × reps each week, Monday to Sunday. Tap a bar to read it.</p>
                <div className="week-readout" aria-live="polite">
                  <span className="week-readout-value">
                    {formatVolume(week.value)}<span className="week-readout-unit"> {unit}</span>
                  </span>
                  <span className="week-readout-meta">
                    {week.isCurrent ? 'This week so far' : `Week of ${week.label}`}
                    {weekDelta !== null && (
                      <span className={`delta-chip delta-chip--${deltaTone(weekDelta)}`}>
                        {formatDelta(weekDelta)} on the week before
                      </span>
                    )}
                  </span>
                </div>
                <BarChart
                  data={weeks}
                  highlightIndex={currentWeekIndex}
                  selectedIndex={weekIndex}
                  onSelect={setSelectedWeek}
                  describe={w => `Week of ${w.label}: ${formatVolume(w.value)} ${unit}`}
                />
              </section>
            )}
          </div>
        )}

        {/* ── Progress: lift by lift ── */}
        {metrics && hasData && tab === 'progress' && (
          <div className="metrics-panel" role="tabpanel" id="metrics-panel-progress" aria-labelledby="metrics-tab-progress">
            {progressReport.length > 0 ? (
              <section className="insight-group">
                <p className="panel-intro">
                  Each lift judged on strength trend, volume trend and PRs — weighted for your{' '}
                  {goalLabel(goal).toLowerCase()} goal. A lift trained later in a workout than usual isn't
                  marked down for it.
                </p>
                {progressReport.map(p => (
                  <button
                    type="button"
                    className="progress-row"
                    key={p.exerciseId}
                    aria-label={`History for ${p.name}, ${STATUS_INFO[p.status].label}`}
                    onClick={() => openHistory(p.exerciseId, p.name)}
                  >
                    <span className="progress-row-head">
                      <span className="progress-name">{p.name}</span>
                      <span className={`progress-badge progress-badge--${p.status}`}>
                        {STATUS_INFO[p.status].label}
                      </span>
                      <Icon name="chevron-right" size={16} className="insight-go" />
                    </span>
                    <span className="progress-signals">
                      {p.e1rmChangePct != null && (
                        <span className={signalClass(p.e1rmChangePct)}>e1RM {fmtPct(p.e1rmChangePct)}</span>
                      )}
                      {p.volumeChangePct != null && (
                        <span className={signalClass(p.volumeChangePct)}>volume {fmtPct(p.volumeChangePct)}</span>
                      )}
                      {p.weightPRs + p.repPRs > 0 && (
                        <span className="signal signal-up">{p.weightPRs + p.repPRs} PR{p.weightPRs + p.repPRs > 1 ? 's' : ''}</span>
                      )}
                    </span>
                    <span className="progress-evidence">{p.evidence[0]}</span>
                  </button>
                ))}
                {progressAll.length > PROGRESS_LIMIT && !showAllProgress && (
                  <button type="button" className="panel-more" onClick={() => setShowAllProgress(true)}>
                    Showing the {PROGRESS_LIMIT} that need attention most — show all {progressAll.length}
                  </button>
                )}
              </section>
            ) : (
              <p className="metrics-empty">A lift gets a verdict after three hard sessions — keep logging.</p>
            )}

            <section className="metric-card">
              <div className="metric-card-head">
                <span className="metric-card-icon"><Icon name="trend-up" size={18} /></span>
                <h2 className="metric-heading">Exercise Trends</h2>
              </div>
              <p className="metric-sub">Strength (est. 1RM) and work capacity (volume) per session — two different kinds of progress.</p>
              {metrics.exercises.length > 0 && (
                <label className="metric-select">
                  <select
                    aria-label="Exercise"
                    value={selectedExercise}
                    onChange={e => setSelectedExercise(e.target.value)}
                  >
                    {metrics.exercises.map(ex => (
                      <option key={ex.exerciseId} value={ex.exerciseId}>{ex.name}</option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size={16} strokeWidth={2} />
                </label>
              )}
              {selected && selected.points.length >= 2 ? (
                <>
                  <h3 className="chart-subhead">Estimated 1RM</h3>
                  <LineChart key={`e1rm-${selected.exerciseId}`} data={selected.points.map(pt => ({ ...pt, value: Math.round(toDisplay(pt.value)) }))} unit={unit} />
                  {selected.volumePoints.length >= 2 && selected.volumePoints.some(p => p.value > 0) && (
                    <>
                      <h3 className="chart-subhead">Volume load per session</h3>
                      <LineChart key={`vol-${selected.exerciseId}`} data={selected.volumePoints.map(pt => ({ ...pt, value: Math.round(toDisplay(pt.value)) }))} unit={unit} />
                    </>
                  )}
                </>
              ) : (
                <p className="metrics-empty">Log this exercise at least twice to see a trend.</p>
              )}
              {selected && (
                <button type="button" className="panel-more" onClick={() => onViewStrength(selected.exerciseId)}>
                  {getOneRepMax(selected.exerciseId) ? 'Your 1RM & goal for this lift' : 'Set a 1RM or a goal for this lift'}
                  <Icon name="chevron-right" size={14} strokeWidth={2.2} />
                </button>
              )}
            </section>
          </div>
        )}

        {/* ── PRs ── */}
        {metrics && hasData && tab === 'prs' && (
          <div className="metrics-panel" role="tabpanel" id="metrics-panel-prs" aria-labelledby="metrics-tab-prs">
            {recentPRs.length > 0 ? (
              <section className="insight-group">
                <p className="panel-intro">Weight and rep records — every one is progress banked.</p>
                {recentPRs.map((pr, i) => (
                  <button
                    type="button"
                    className="insight-row insight-row--good"
                    key={i}
                    onClick={() => openHistory(pr.exerciseId, pr.name)}
                  >
                    <span className="insight-icon"><Icon name="trophy" size={20} /></span>
                    <span className="insight-text">
                      <span className="insight-title">{pr.name}</span>
                      <span className="insight-detail">{pr.label}</span>
                    </span>
                    <span className="pr-date">
                      {new Date(pr.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                ))}
              </section>
            ) : (
              <div className="metrics-blank">
                <span className="metrics-blank-icon"><Icon name="trophy" size={26} /></span>
                <p className="metrics-blank-title">No recent PRs</p>
                <p className="metrics-blank-text">Beat your heaviest weight, or your most reps at a weight, and it lands here.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {heatmapOpen && ranged && (
        <HeatmapSheet
          heat={ranged.heat}
          prevHeat={ranged.prevHeat}
          band={band}
          range={range}
          onChange={setRange}
          maxDate={maxDate}
          onClose={() => setHeatmapOpen(false)}
        />
      )}
      {historyFor && (
        <ExerciseHistorySheet exerciseId={historyFor.id} exerciseName={historyFor.name} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

/** A coach insight. One about a specific lift opens that lift's history. */
function InsightRow({ insight, onOpen }: { insight: Insight; onOpen: (id: string, name: string) => void }) {
  const body = (
    <>
      <span className="insight-icon"><Icon name={INSIGHT_ICON[insight.kind]} size={20} /></span>
      <span className="insight-text">
        <span className="insight-title">{insight.title}</span>
        <span className="insight-detail">{insight.detail}</span>
      </span>
    </>
  );
  const cls = `insight-row insight-row--${insight.kind}`;
  const { exerciseId, exerciseName } = insight;
  if (!exerciseId) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={() => onOpen(exerciseId, exerciseName ?? insight.title)}>
      {body}
      <Icon name="chevron-right" size={16} className="insight-go" />
    </button>
  );
}

function StatTile({ icon, value, label, tone }: { icon: IconName; value: string; label: string; tone?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="stat-card">
      <span className="stat-icon"><Icon name={icon} size={20} /></span>
      <span className="stat-text">
        <span className={`stat-value${tone && tone !== 'flat' ? ` delta-${tone}` : ''}`}>{value}</span>
        <span className="stat-label">{label}</span>
      </span>
    </div>
  );
}

function formatDelta(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function deltaTone(pct: number | null): 'up' | 'down' | 'flat' {
  if (pct === null || pct === 0) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

function fmtPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function signalClass(pct: number): string {
  return `signal${pct > 1 ? ' signal-up' : pct < -1 ? ' signal-down' : ''}`;
}
