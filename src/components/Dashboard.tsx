import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekDateRange } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import { computeCoaching } from '../data/insights';
import type { Coaching } from '../data/insights';
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
}: Props) {
  const weekNumber = getWeekNumber();
  const [completedDayIds, setCompletedDayIds] = useState<Set<number>>(new Set());
  const [coaching, setCoaching] = useState<Coaching | null>(null);

  // One snapshot read powers both the week progress and the coach card
  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(snapshot => {
      if (cancelled) return;
      setCompletedDayIds(new Set(
        snapshot.sessions.filter(s => s.weekNumber === weekNumber).map(s => s.dayId),
      ));
      setCoaching(computeCoaching(program, snapshot));
    });
    return () => { cancelled = true; };
  }, [program, weekNumber]);

  const topInsight = coaching?.insights[0];
  const nextDay = coaching?.nextDay;

  return (
    <div className="dashboard">
      <div className="week-header">
        <span className="week-label">{getWeekDateRange()}</span>
        <span className="week-progress">{completedDayIds.size} of {program.length} done</span>
      </div>

      {nextDay && (
        <button className="coach-card" onClick={() => onStartWorkout(nextDay.dayId)}>
          <div className="coach-eyebrow">Next up · {lastTrainedLabel(nextDay.lastTrained)}</div>
          <div className="coach-day">{nextDay.label} — {nextDay.muscleGroups}</div>
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
