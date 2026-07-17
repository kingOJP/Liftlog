import { useState, useMemo } from 'react';
import type { Exercise, WorkoutDay } from '../data/program';
import { buildQuickWorkoutDay } from '../data/quickWorkout';
import AddExercisePanel from './AddExercisePanel';
import './DayEditView.css';
import './QuickWorkoutView.css';

interface Props {
  onBack: () => void;
  onStart: (day: WorkoutDay) => void;
}

// Build a one-off workout by picking exercises, then log it like any other
// session — no training plan or block required. The exercises join the library
// (AddExercisePanel resolves typed names to existing identities) so history
// and metrics resolve them.
export default function QuickWorkoutView({ onBack, onStart }: Props) {
  const [exercises, setExercises] = useState<Exercise[]>([]);

  const chosenIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  function handleRemove(id: string) {
    setExercises(prev => prev.filter(e => e.id !== id));
  }

  function handleStart() {
    if (exercises.length === 0) return;
    onStart(buildQuickWorkoutDay(exercises));
  }

  return (
    <div className="day-edit-view">
      <header className="day-edit-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="day-edit-title">
          <span className="day-edit-label">One-off session</span>
          <span className="day-edit-heading">Quick Workout</span>
        </div>
      </header>

      <div className="day-edit-body">
        <p className="quick-intro">
          Log a workout right now — no plan needed. Add the exercises you’re doing, then start.
          It’s saved to your history and metrics, but won’t change your program.
        </p>

        <section className="day-edit-section">
          <span className="day-edit-field-label">Exercises</span>
          <div className="exercise-edit-list">
            {exercises.map(ex => (
              <div key={ex.id} className="exercise-edit-item">
                <div className="exercise-edit-row">
                  <div className="exercise-edit-info">
                    <span className="exercise-edit-name">{ex.name}</span>
                    <span className="exercise-edit-meta">{ex.sets} sets · {ex.repLow}–{ex.repHigh} reps</span>
                  </div>
                  <button
                    className="exercise-remove-btn"
                    onClick={() => handleRemove(ex.id)}
                    aria-label={`Remove ${ex.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {exercises.length === 0 && (
              <p className="exercise-edit-empty">No exercises yet — search or create one below.</p>
            )}
          </div>

          <AddExercisePanel
            excludeIds={chosenIds}
            confirmLabel="Add"
            persistent
            onAdd={ex => setExercises(prev => [...prev, ex])}
          />
        </section>
      </div>

      <div className="day-edit-footer">
        <button className="day-edit-save-btn" onClick={handleStart} disabled={exercises.length === 0}>
          {exercises.length === 0 ? 'Add an exercise to start' : `Start Workout · ${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
