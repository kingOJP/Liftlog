import { useState, useEffect, useSyncExternalStore } from 'react';
import type { WorkoutDay } from '../data/program';
import { getUnfinishedWorkout, draftSetCount } from '../data/draftSession';
import type { DraftSession } from '../data/draftSession';
import { getSyncStatus, subscribeSyncStatus, accountNotLoaded, backupOverdue } from '../data/syncStatus';
import { countUnbackedSessions } from '../data/backup';
import { getLoggedInUser } from '../data/sync';
import { saveBackupFile } from './backupFile';
import { getWeekNumber, getWeekDateRange } from '../data/program';
import { loadTrainingSnapshot, sessionTimestamp } from '../data/analytics';
import { computeCoaching } from '../data/insights';
import type { Coaching } from '../data/insights';
import {
  getPlanState, getActiveBlockInfo, getActivePhase, getPendingActivation, getTrainingGoal,
  getPhaseResolver, getProfileOrDefault, getCoachDecisions, planHasChosenGoal, getStrengthState,
} from '../data/planStore';
import { PHASE_INFO, blockEnded, blockWeekIndex, goalLabel, mondayOf } from '../data/plan';
import { bestLoggedMax, currentMax, etaLabel, projectGoal, strengthTrend } from '../data/strength';
import { effectiveExperience } from '../data/experience';
import { getExerciseLibrary, getExerciseName } from '../data/programStore';
import { fmtWeight, toDisplay } from '../data/units';
import { dayInPhase } from '../data/program';
import DayCard from './DayCard';
import Icon from './Icon';
import './Dashboard.css';

interface Props {
  program: WorkoutDay[];
  onStartWorkout: (dayId: number) => void;
  onEditDay: (dayId: number) => void;
  onViewHistory: () => void;
  onViewMetrics: () => void;
  onViewSettings: () => void;
  onViewJourney: () => void;
  onPlanSetup: () => void;
  onQuickWorkout: () => void;
  onResumeWorkout: (draft: DraftSession) => void;
  onAddDay: () => void;
  /** Re-run the account load (pull → settle → push) after a failed first load */
  onRetrySync: () => Promise<void>;
}

function startLabel(startDate: string): string {
  return new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function lastTrainedLabel(ts: number | null): string {
  if (ts == null) return 'not trained yet';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'trained today';
  if (days === 1) return 'trained yesterday';
  return `trained ${days} days ago`;
}

export default function Dashboard({
  program, onStartWorkout, onEditDay, onViewHistory, onViewMetrics, onViewSettings,
  onViewJourney, onPlanSetup, onQuickWorkout, onResumeWorkout, onAddDay, onRetrySync,
}: Props) {
  const weekNumber = getWeekNumber();
  // An interrupted or abandoned-for-now workout, offered for resumption. Read
  // on every render (cheap localStorage) so finishing or discarding it updates.
  const unfinished = getUnfinishedWorkout();
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const syncTrouble = !syncStatus.authExpired && syncStatus.lastError != null
    && (syncStatus.lastSuccessAt == null || (syncStatus.lastErrorAt ?? 0) > syncStatus.lastSuccessAt);
  // Signed in, but this device has never managed to download the account. An
  // empty program here is not a blank slate — offering "design your plan"
  // would tell the user their training is gone, and a plan made here would
  // outrank the real one (newer clock) the moment sync recovered.
  const notLoaded = program.length === 0 && accountNotLoaded(syncStatus);
  const [retrying, setRetrying] = useState(false);
  async function retryLoad() {
    setRetrying(true);
    try { await onRetrySync(); } finally { setRetrying(false); }
  }
  // Workouts the server has not acknowledged. Counted whenever sync state or
  // the program reference changes (App hands down a fresh one after every
  // workout and every pull).
  const [unbacked, setUnbacked] = useState(0);
  useEffect(() => {
    let live = true;
    countUnbackedSessions().then(n => { if (live) setUnbacked(n); }).catch(() => {});
    return () => { live = false; };
  }, [program, syncStatus]);
  // Uploads have failed for long enough, with real workouts at stake, that a
  // quiet footnote is the wrong volume. This is the state that went unnoticed
  // for two weeks behind "Not syncing right now".
  const atRisk = unbacked > 0 && backupOverdue(syncStatus);
  const failingSince = syncStatus.pushFailingSince == null ? ''
    : new Date(syncStatus.pushFailingSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const [completedDayIds, setCompletedDayIds] = useState<Set<number>>(new Set());
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  // The first 1RM goal, with its live estimate — one line on the journey card
  const [goalLine, setGoalLine] = useState<string | null>(null);

  // Training-journey context (sync localStorage reads — cheap per render)
  const journey = getActiveBlockInfo();
  const hasPlans = getPlanState().plans.length > 0;
  const phase = getActivePhase();
  const pending = getPendingActivation();
  const goal = getTrainingGoal();

  // Days can be gated to specific block phases — a sport-support block programs
  // three sessions in its build weeks and drops to one through the taper. The
  // dashboard shows this week's workouts; the rest of the block's days are still
  // in the program, just not scheduled now.
  const scheduled = program.filter(day => dayInPhase(day, phase));
  const gatedOut = program.length - scheduled.length;

  // One snapshot read powers both the week progress and the coach card
  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(snapshot => {
      if (cancelled) return;
      // "Done this week" is time-windowed (Mon–Sun), not weekNumber-matched:
      // activating a new block re-anchors week numbering, and old sessions
      // sharing a week number must not mark this week's days as done.
      const weekStart = mondayOf(new Date()).getTime();
      setCompletedDayIds(new Set(
        snapshot.sessions.filter(s => sessionTimestamp(s) >= weekStart).map(s => s.dayId),
      ));
      setCoaching(computeCoaching(program, snapshot, Date.now(), phase, goal, getPhaseResolver(), getProfileOrDefault().experience, getCoachDecisions()));

      const strength = getStrengthState();
      const target = strength.goals[0];
      if (!target) { setGoalLine(null); return; }
      const stored = strength.maxes.find(m => m.exerciseId === target.exerciseId) ?? null;
      const current = currentMax(stored, bestLoggedMax(snapshot, target.exerciseId));
      const name = getExerciseLibrary().find(e => e.id === target.exerciseId)?.name ?? getExerciseName(target.exerciseId);
      if (!current) { setGoalLine(`${name} goal: ${fmtWeight(target.targetWeight)} — enter a 1RM for an estimate`); return; }
      const projection = projectGoal({
        current: current.value, target: target.targetWeight,
        experience: effectiveExperience(getProfileOrDefault(), snapshot), goal,
        trend: strengthTrend(snapshot, target.exerciseId),
      });
      setGoalLine(`${name}: ${toDisplay(current.value)} → ${fmtWeight(target.targetWeight)} · ${etaLabel(projection)}${strength.goals.length > 1 ? ` · +${strength.goals.length - 1} more` : ''}`);
    });
    return () => { cancelled = true; };
  }, [program, weekNumber, phase, goal]);

  // Lead with the biggest opportunity; fall back to the best highlight.
  const topInsight = coaching?.opportunities[0] ?? coaching?.highlights[0];
  const nextDay = coaching?.nextDay;
  const nextDayAdjustments = nextDay ? coaching?.plan.days.get(nextDay.dayId)?.changes.length ?? 0 : 0;

  // With no program yet, the invitation to plan lives inside the start card
  // next to the other two ways in, rather than as a separate strip above it.
  const offerPlan = program.length === 0 && !journey && !pending;

  // Journey strip: where the user is in their block, or the invitation to plan
  let journeyCard: React.ReactNode;
  if (offerPlan) {
    journeyCard = null;
  } else if (journey) {
    const { plan, block } = journey;
    const rawWeek = blockWeekIndex(block);
    const week = Math.max(0, rawWeek) + 1;
    const ended = blockEnded(block);
    const phaseLabel = phase ? PHASE_INFO[phase].label : null;
    // Block names already carry the goal ("Block 2 · Strength") — only prefix
    // the goal when the name doesn't say it. A migrated plan whose goal the
    // user never chose is "your training so far", not "Muscle Growth".
    const eyebrow = !planHasChosenGoal(plan)
      ? 'Your training so far'
      : block.name.includes(goalLabel(plan.goal))
        ? block.name
        : `${goalLabel(plan.goal)} · ${block.name}`;
    journeyCard = (
      <button className="journey-card" onClick={onViewJourney}>
        <div className="journey-eyebrow">{eyebrow}</div>
        {ended ? (
          <div className="journey-status journey-status--done">
            Block complete — review your results and plan the next one ›
          </div>
        ) : block.openEnded ? (
          <div className="journey-status">
            Week {week} · tap to plan your first structured block ›
          </div>
        ) : rawWeek < 0 ? (
          <div className="journey-status">
            Starts {new Date(`${block.startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {block.phases.length} weeks planned
          </div>
        ) : (
          <>
            <div className="journey-status">
              Week {week} of {block.phases.length}{phaseLabel ? ` · ${phaseLabel}` : ''}
              {phase === 'deload' || phase === 'recovery' ? ' — planned easy week' : ''}
            </div>
            <div className="journey-track">
              {block.phases.map((p, i) => (
                <span
                  key={i}
                  className={`journey-seg journey-seg--${p}${i === week - 1 ? ' journey-seg--now' : ''}${i < week - 1 ? ' journey-seg--past' : ''}`}
                />
              ))}
            </div>
          </>
        )}
        {pending && (
          <div className="journey-pending">
            Next: {goalLabel(pending.goal)} block starts {startLabel(pending.block.startDate)} — the new workouts appear then
          </div>
        )}
        {goalLine && <div className="journey-goal-line">🎯 {goalLine}</div>}
      </button>
    );
  } else if (pending) {
    // Nothing running, but a new block is queued for its start date
    journeyCard = (
      <button className="journey-card" onClick={onViewJourney}>
        <div className="journey-eyebrow">Training journey</div>
        <div className="journey-status">
          {goalLabel(pending.goal)} block starts {startLabel(pending.block.startDate)} ›
        </div>
      </button>
    );
  } else if (!hasPlans) {
    journeyCard = (
      <button className="journey-card journey-card--cta" onClick={onPlanSetup}>
        <div className="journey-eyebrow">Training journey</div>
        <div className="journey-status">Set a goal and let the coach design your plan ›</div>
      </button>
    );
  } else {
    // Plans exist but nothing is active (block wrapped up, next not started)
    journeyCard = (
      <button className="journey-card journey-card--cta" onClick={onViewJourney}>
        <div className="journey-eyebrow">Training journey</div>
        <div className="journey-status">No active block — plan your next one ›</div>
      </button>
    );
  }

  // The week at a glance — tops the Next up card, or stands alone without one
  const weekSummary = (
    <>
      <span className="week-icon"><Icon name="calendar" size={22} /></span>
      <div className="week-text">
        <span className="week-label">{getWeekDateRange()}</span>
        <span className="week-sub">This week</span>
      </div>
      {scheduled.length > 0 && (
        <span className={`week-progress${completedDayIds.size >= scheduled.length ? ' week-progress--done' : ''}`}>
          <span className="tabular">{completedDayIds.size} of {scheduled.length}</span> done
        </span>
      )}
    </>
  );

  return (
    <div className="dashboard">
      {/* This week + Next up share one card: the week at a glance, then the
          one tap that starts the next workout. Without a next day the week
          header stands alone. */}
      {nextDay ? (
        <section className="coach-card" aria-label="This week">
          <div className="week-header week-header--inline">
            {weekSummary}
          </div>
          <button className="coach-next" onClick={() => onStartWorkout(nextDay.dayId)}>
            <span className="coach-go" aria-hidden="true"><Icon name="chevron-right" size={18} strokeWidth={2.2} /></span>
            <div className="coach-eyebrow">
              <Icon name="bolt" size={14} strokeWidth={2} />
              Next up · {lastTrainedLabel(nextDay.lastTrained)}
            </div>
            <div className="coach-day">{nextDay.label} — {nextDay.muscleGroups}</div>
            {nextDayAdjustments > 0 && (
              <div className="coach-adjusted">
                ✦ Coach adjusted this workout — open it to see what changed and why
              </div>
            )}
            {topInsight && (
              <div className={`coach-insight coach-insight--${topInsight.kind}`}>
                <span className="coach-insight-title">{topInsight.title}</span>
                <span className="coach-insight-detail">{topInsight.detail}</span>
              </div>
            )}
          </button>
        </section>
      ) : (
        <div className="week-header">
          {weekSummary}
        </div>
      )}

      {unfinished && (
        <button className="resume-card" onClick={() => onResumeWorkout(unfinished)}>
          <div className="resume-eyebrow">Unfinished workout</div>
          <div className="resume-title">
            Resume {unfinished.day?.label ?? (unfinished.dayId < 0 ? 'quick workout' : `Day ${unfinished.dayId}`)} ›
          </div>
          <div className="resume-detail">
            {draftSetCount(unfinished)} set{draftSetCount(unfinished) === 1 ? '' : 's'} logged · started {lastTrainedLabel(unfinished.startedAt).replace('trained ', '')}
          </div>
        </button>
      )}

      {atRisk && (
        <section className="start-card start-card--problem" aria-labelledby="at-risk-title" role="alert">
          <div className="start-eyebrow">Not backed up</div>
          <h2 id="at-risk-title" className="start-title">
            {unbacked === 1 ? '1 workout is' : `${unbacked} workouts are`} only on this device
          </h2>
          <p className="start-problem-text">
            {syncStatus.authExpired
              ? 'You were signed out, so nothing has uploaded'
              : 'Uploads have been failing'} since {failingSince}. Your workouts are safe here, but
            this is the only copy — don't sign out, clear browser data or delete the app until
            this is gone.
          </p>
          <div className="start-problem-actions">
            {syncStatus.authExpired ? (
              <a className="start-retry" href="/api/auth/google">Sign in again</a>
            ) : (
              <button className="start-retry" onClick={retryLoad} disabled={retrying}>
                {retrying ? 'Uploading…' : 'Try again'}
              </button>
            )}
            <button className="start-backup" onClick={() => { saveBackupFile(getLoggedInUser()?.email ?? null).catch(() => {}); }}>
              Save a backup file
            </button>
          </div>
        </section>
      )}

      {notLoaded ? (
        <section className="start-card start-card--problem" aria-labelledby="load-failed-title" role="alert">
          <div className="start-eyebrow">Couldn't load your account</div>
          <h2 id="load-failed-title" className="start-title">Your training isn't on this device yet</h2>
          <p className="start-problem-text">
            You're signed in, but LiftLog couldn't download your plan and workouts, so this
            screen looks empty. Nothing has been deleted. Please don't start a new plan
            here — try again in a moment.
          </p>
          <button className="start-retry" onClick={retryLoad} disabled={retrying}>
            {retrying ? 'Loading…' : 'Try again'}
          </button>
        </section>
      ) : program.length === 0 ? (
        <section className="start-card" aria-labelledby="start-card-title">
          <div className="start-eyebrow">Get started</div>
          <h2 id="start-card-title" className="start-title">How do you want to train?</h2>

          {offerPlan && (
            <button className="start-option start-option--primary" onClick={hasPlans ? onViewJourney : onPlanSetup}>
              <span className="start-option-icon"><Icon name="target" size={22} /></span>
              <span className="start-option-text">
                <span className="start-badge">Recommended</span>
                <span className="start-option-title">
                  {hasPlans ? 'Plan your next block' : 'Let the coach design your plan'}
                </span>
                <span className="start-option-detail">
                  Answer a few questions — get every workout planned and explained.
                </span>
              </span>
              <Icon name="chevron-right" size={18} className="start-option-go" />
            </button>
          )}

          <div className="start-secondary">
            <button className="start-option" onClick={onAddDay}>
              <span className="start-option-icon"><Icon name="dumbbell" size={20} /></span>
              <span className="start-option-text">
                <span className="start-option-title">Build my own program</span>
                <span className="start-option-detail">Pick your own days, exercises and sets.</span>
              </span>
              <Icon name="chevron-right" size={18} className="start-option-go" />
            </button>
            <button className="start-option" onClick={onQuickWorkout}>
              <span className="start-option-icon"><Icon name="bolt" size={20} /></span>
              <span className="start-option-text">
                <span className="start-option-title">Log a quick workout</span>
                <span className="start-option-detail">Just training today? Log a one-off session.</span>
              </span>
              <Icon name="chevron-right" size={18} className="start-option-go" />
            </button>
          </div>
        </section>
      ) : (
        <>
          <h2 className="dash-section-title">Your workouts</h2>
          <div className="day-list">
            {scheduled.map(day => (
              <DayCard
                key={day.id}
                day={day}
                done={completedDayIds.has(day.id)}
                onClick={() => onStartWorkout(day.id)}
                onEdit={() => onEditDay(day.id)}
              />
            ))}
          </div>
          {gatedOut > 0 && phase && (
            <p className="day-list-note">
              Not scheduled this week: {gatedOut === 1 ? '1 other session' : `${gatedOut} other sessions`}.
              {' '}{PHASE_INFO[phase].blurb}.
            </p>
          )}
          <div className="day-list-actions">
            <button className="quick-workout-btn quick-workout-btn--inline" onClick={onAddDay}>
              <Icon name="plus" size={16} strokeWidth={2} /> Add a day
            </button>
            <button className="quick-workout-btn quick-workout-btn--inline" onClick={onQuickWorkout}>
              <Icon name="plus" size={16} strokeWidth={2} /> One-off workout
            </button>
          </div>
        </>
      )}

      {journeyCard}

      <nav className="dash-nav">
        <button className="dash-nav-btn" onClick={onViewMetrics}>
          <Icon name="chart" size={22} className="dash-nav-icon" />
          <span>Metrics</span>
        </button>
        <button className="dash-nav-btn" onClick={onViewHistory}>
          <Icon name="history" size={22} className="dash-nav-icon" />
          <span>History</span>
        </button>
        <button className="dash-nav-btn" onClick={onViewSettings}>
          <Icon name="settings" size={22} className="dash-nav-icon" />
          <span>Settings</span>
        </button>
      </nav>

      {syncTrouble && !notLoaded && !atRisk && (
        <p className="sync-badge" role="status">
          Not syncing right now — {unbacked > 0
            ? `${unbacked === 1 ? '1 workout is' : `${unbacked} workouts are`} saved on this phone and will upload`
            : 'your workouts are safe on this phone and will upload'} when the connection is back.
        </p>
      )}
    </div>
  );
}
