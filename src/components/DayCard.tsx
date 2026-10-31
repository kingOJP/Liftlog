import type { WorkoutDay } from '../data/program';
import { estimatedMinutesFor } from '../data/coach';
import Icon from './Icon';
import './DayCard.css';

interface Props {
  day: WorkoutDay;
  done: boolean;
  onClick: () => void;
  onEdit: () => void;
}

// Two real buttons side by side — the card body starts the workout, Edit edits
// the day — rather than a role="button" container with a button inside it,
// which screen readers announce as one control and keyboards can't separate.
export default function DayCard({ day, done, onClick, onEdit }: Props) {
  const minutes = estimatedMinutesFor(day);
  return (
    <div className={`day-card${done ? ' done' : ''}`}>
      <button
        type="button"
        className="day-card-body"
        aria-label={`Start ${day.label}: ${day.muscleGroups}`}
        onClick={onClick}
      >
        <div className="day-number">{day.label}</div>
        <div className="day-muscles">{day.muscleGroups}</div>
        <div className="day-count">
          <span className="day-meta">
            <Icon name="dumbbell" size={15} />
            {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
          </span>
          {minutes > 0 && (
            <span className="day-meta">
              <Icon name="clock" size={14} />
              ~{minutes} min
            </span>
          )}
        </div>
      </button>
      <div className="day-card-right">
        <button
          type="button"
          className="edit-day-btn"
          onClick={onEdit}
          aria-label={`Edit ${day.label}`}
        >
          Edit
        </button>
        {done && (
          <span className="done-badge">
            <Icon name="check" size={12} strokeWidth={3} />
            Done
          </span>
        )}
      </div>
    </div>
  );
}
