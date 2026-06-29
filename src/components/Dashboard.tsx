import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekDateRange } from '../data/program';
import { getCompletedSessionsForWeek } from '../db/database';
import DayCard from './DayCard';
import './Dashboard.css';

interface Props {
  program: WorkoutDay[];
  onStartWorkout: (dayId: number) => void;
  onEditDay: (dayId: number) => void;
  onViewHistory: () => void;
  onViewExercises: () => void;
  onViewMetrics: () => void;
}

export default function Dashboard({ program, onStartWorkout, onEditDay, onViewHistory, onViewExercises, onViewMetrics }: Props) {
  const weekNumber = getWeekNumber();
  const [completedDayIds, setCompletedDayIds] = useState<number[]>([]);

  useEffect(() => {
    getCompletedSessionsForWeek(weekNumber).then(sessions => {
      setCompletedDayIds(sessions.map(s => s.dayId));
    });
  }, [weekNumber]);

  return (
    <div className="dashboard">
      <div className="week-header">
        <span className="week-label">{getWeekDateRange()}</span>
        <span className="week-progress">{completedDayIds.length} of 4 done</span>
      </div>
      <div className="day-list">
        {program.map(day => (
          <DayCard
            key={day.id}
            day={day}
            done={completedDayIds.includes(day.id)}
            onClick={() => onStartWorkout(day.id)}
            onEdit={() => onEditDay(day.id)}
          />
        ))}
      </div>
      <button className="history-btn" onClick={onViewMetrics}>
        Metrics
      </button>
      <button className="history-btn" onClick={onViewHistory}>
        View History
      </button>
      <button className="history-btn" onClick={onViewExercises}>
        Exercise List
      </button>
    </div>
  );
}
