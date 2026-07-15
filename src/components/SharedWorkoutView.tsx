import { useMemo } from 'react';
import type { SharedWorkout } from '../data/share';
import { resolveSharedExercises } from '../data/share';
import './SharedWorkoutView.css';

interface Props {
  shared: SharedWorkout;
  onStart: () => void;
  onAddToProgram: () => void;
  onDismiss: () => void;
}

// Landing screen after scanning a shared-workout QR code: preview what was
// shared, then either do it once (a standalone session) or keep it as a new
// day in the program. Exercises the recipient already has are matched to
// their own library so history stays in one place.
export default function SharedWorkoutView({ shared, onStart, onAddToProgram, onDismiss }: Props) {
  const resolved = useMemo(() => resolveSharedExercises(shared), [shared]);
  const newCount = resolved.filter(r => !r.existing).length;

  return (
    <div className="shared-view">
      <header className="shared-header">
        <button className="back-btn" onClick={onDismiss} aria-label="Dismiss shared workout">&#8592;</button>
        <div className="shared-title">
          <span className="shared-eyebrow">Shared workout</span>
          <span className="shared-name">{shared.label} — {shared.muscleGroups}</span>
        </div>
      </header>

      <div className="shared-body">
        <p className="shared-blurb">
          A friend shared this workout with you. Weights aren't copied — once
          you start, LiftLog suggests loads from <em>your own</em> training
          history{newCount > 0 ? '; exercises you haven’t done before start blank' : ''}.
        </p>

        <div className="shared-exercise-list">
          {resolved.map(({ exercise, existing }) => (
            <div key={exercise.id} className="shared-exercise">
              <div className="shared-exercise-info">
                <span className="shared-exercise-name">{exercise.name}</span>
                <span className="shared-exercise-meta">
                  {exercise.sets} sets · {exercise.repLow}–{exercise.repHigh} reps
                </span>
              </div>
              <span className={`shared-badge${existing ? '' : ' shared-badge--new'}`}>
                {existing ? 'In your library' : 'New'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="shared-footer">
        <button className="shared-start-btn" onClick={onStart}>
          Start this workout
        </button>
        <button className="shared-add-btn" onClick={onAddToProgram}>
          Add to my program
        </button>
        <button className="shared-dismiss-btn" onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </div>
  );
}
