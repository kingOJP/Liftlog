import { useState, useEffect, useSyncExternalStore } from 'react';
import type { WorkoutDay } from '../data/program';
import { getUnfinishedWorkout, draftSetCount } from '../data/draftSession';
import type { DraftSession } from '../data/draftSession';
import { getSyncStatus, subscribeSyncStatus } from '../data/syncStatus';
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
  onViewJourney, onPlanSetup, onQuickWorkout, onResumeWorkout, onAddDay,
}: Props) {
  const weekNumber = getWeekNumber();
  // An interrupted or abandoned-for-now workout, offered for resumption. Read
  // on every render (cheap localStorage) so finishing or discarding it updates.
  const unfinished = getUnfinishedWorkout();
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const syncTrouble = !syncStatus.authExpired && syncStatus.lastError != null
    && (syncStatus.lastSuccessAt == null || (syncStatus.lastErrorAt ?? 0) > syncStatus.lastSuccessAt);
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

  // Journey strip: where the user is in their block, or the invitation to plan
  let journeyCard: React.ReactNode;
  if (journey) {
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

  return (
    <div className="dashboard">
      <div className="week-header">
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
      </div>

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

      {journeyCard}

      {syncTrouble && (
        <p className="sync-badge" role="status">
          Not syncing right now — your workouts are safe on this phone and will upload when the connection is back.
        </p>
      )}

      {nextDay && (
        <button className="coach-card" onClick={() => onStartWorkout(nextDay.dayId)}>
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
      )}

      {program.length === 0 ? (
        <div className="day-list-empty">
          <span className="day-list-empty-title">No workouts yet</span>
          <span className="day-list-empty-detail">
            Tell the coach your goal above and it designs your program with you —
            every workout, explained, and yours to adjust before it starts.
          </span>
          <div className="empty-quick-cta">
            <span className="empty-quick-or">or</span>
            <button className="quick-workout-btn" onClick={onAddDay}>
              ＋ Build my own program
            </button>
            <button className="quick-workout-btn" onClick={onQuickWorkout}>
              ＋ Log a quick workout
            </button>
            <span className="empty-quick-hint">
              Know what you want to run? Add your own days and sets. Just want to train today? Log a one-off session.
            </span>
          </div>
        </div>
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
    </div>
  );
}
