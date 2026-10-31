import type { WorkoutDay } from '../data/program';
import { estimatedMinutesFor } from '../data/coach';
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
          {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
          {minutes > 0 ? ` · ~${minutes} min` : ''}
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
        {done && <span className="done-badge">DONE</span>}
      </div>
    </div>
  );
}
