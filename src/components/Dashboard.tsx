import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekDateRange } from '../data/program';
import { loadTrainingSnapshot, sessionTimestamp } from '../data/analytics';
import { computeCoaching } from '../data/insights';
import type { Coaching } from '../data/insights';
import { getPlanState, getActiveBlockInfo, getActivePhase } from '../data/planStore';
import { PHASE_INFO, blockEnded, blockWeekIndex, goalLabel, mondayOf } from '../data/plan';
import DayCard from './DayCard';
import './Dashboard.css';

interface Props {
  program: WorkoutDay[];
  onStartWorkout: (dayId: number) => void;
  onEditDay: (dayId: number) => void;
  onViewHistory: () => void;
  onViewExercises: () => void;
  onViewMetrics: () => void;
  onViewSettings: () => void;
  onViewJourney: () => void;
  onPlanSetup: () => void;
}

function lastTrainedLabel(ts: number | null): string {
  if (ts == null) return 'not trained yet';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'trained today';
  if (days === 1) return 'trained yesterday';
  return `trained ${days} days ago`;
}

export default function Dashboard({
  program, onStartWorkout, onEditDay, onViewHistory, onViewExercises, onViewMetrics, onViewSettings,
  onViewJourney, onPlanSetup,
}: Props) {
  const weekNumber = getWeekNumber();
  const [completedDayIds, setCompletedDayIds] = useState<Set<number>>(new Set());
  const [coaching, setCoaching] = useState<Coaching | null>(null);

  // Training-journey context (sync localStorage reads — cheap per render)
  const journey = getActiveBlockInfo();
  const hasPlans = getPlanState().plans.length > 0;
  const phase = getActivePhase();

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
      setCoaching(computeCoaching(program, snapshot, weekNumber, Date.now(), phase));
    });
    return () => { cancelled = true; };
  }, [program, weekNumber, phase]);

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
    // the goal when the name doesn't say it.
    const eyebrow = block.name.includes(goalLabel(plan.goal))
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
        <span className="week-label">{getWeekDateRange()}</span>
        <span className="week-progress">{completedDayIds.size} of {program.length} done</span>
      </div>

      {journeyCard}

      {nextDay && (
        <button className="coach-card" onClick={() => onStartWorkout(nextDay.dayId)}>
          <div className="coach-eyebrow">Next up · {lastTrainedLabel(nextDay.lastTrained)}</div>
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

      <div className="day-list">
        {program.map(day => (
          <DayCard
            key={day.id}
            day={day}
            done={completedDayIds.has(day.id)}
            onClick={() => onStartWorkout(day.id)}
            onEdit={() => onEditDay(day.id)}
          />
        ))}
      </div>

      <nav className="dash-nav">
        <button className="dash-nav-btn" onClick={onViewMetrics}>
          <span className="dash-nav-icon">📊</span>
          <span>Metrics</span>
        </button>
        <button className="dash-nav-btn" onClick={onViewHistory}>
          <span className="dash-nav-icon">🗓️</span>
          <span>History</span>
        </button>
        <button className="dash-nav-btn" onClick={onViewExercises}>
          <span className="dash-nav-icon">📋</span>
          <span>Exercises</span>
        </button>
        <button className="dash-nav-btn" onClick={onViewSettings}>
          <span className="dash-nav-icon">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
