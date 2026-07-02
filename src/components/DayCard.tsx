import type { WorkoutDay } from '../data/program';
import './DayCard.css';

interface Props {
  day: WorkoutDay;
  done: boolean;
  onClick: () => void;
  onEdit: () => void;
}

export default function DayCard({ day, done, onClick, onEdit }: Props) {
  return (
    <div
      className={`day-card${done ? ' done' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Start ${day.label}: ${day.muscleGroups}`}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
    >
      <div className="day-card-body">
        <div className="day-number">{day.label}</div>
        <div className="day-muscles">{day.muscleGroups}</div>
        <div className="day-count">{day.exercises.length} exercises</div>
      </div>
      <div className="day-card-right">
        <button
          className="edit-day-btn"
          onClick={e => { e.stopPropagation(); onEdit(); }}
          aria-label={`Edit ${day.label}`}
        >
          Edit
        </button>
        {done && <span className="done-badge">DONE</span>}
      </div>
    </div>
  );
}
