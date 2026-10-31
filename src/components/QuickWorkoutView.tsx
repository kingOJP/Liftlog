import { useState, useMemo, useEffect } from 'react';
import type { Exercise, WorkoutDay } from '../data/program';
import { prescriptionDetail } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { prescribeFor } from '../data/prescribe';
import { buildQuickWorkoutDay } from '../data/quickWorkout';
import AddExercisePanel from './AddExercisePanel';
import SlotDoseEditor from './SlotDoseEditor';
import { InfoButton } from './InstructionSheet';
import { useInstructionSheet } from './useInstructionSheet';
import './DayEditView.css';
import './QuickWorkoutView.css';

interface Props {
  onBack: () => void;
  onStart: (day: WorkoutDay) => void;
}

// Build a one-off workout by picking exercises, then log it like any other
// session — no training plan or block required. The exercises join the library
// (findExerciseByName reuses an existing identity when the name matches) so
// history and metrics resolve them. Each slot's sets × reps are the lifter's
// to set: with no plan behind it, the coach pre-fills from what they last did
// with the movement, and a 5×5 lifter can simply say 5×5.
export default function QuickWorkoutView({ onBack, onStart }: Props) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const info = useInstructionSheet();

  // A quick workout is the one path with no plan behind it, so the history
  // fallback matters most here: with no goal to dose from, the coach reads the
  // rep range (and the set count) off what this lifter actually does.
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  useEffect(() => {
    loadTrainingSnapshot().then(setSnapshot).catch(() => {});
  }, []);

  const chosenIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  function handleAdd(ex: Exercise) {
    setExercises(prev => (prev.some(e => e.id === ex.id) ? prev : [...prev, ex]));
  }

  function handlePatch(id: string, patch: Partial<Exercise>) {
    setExercises(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }

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
          It’s saved to your history and metrics, and you can keep it as a program day afterwards.
        </p>

        <section className="day-edit-section">
          <span className="day-edit-field-label">Exercises</span>
          <div className="exercise-edit-list">
            {exercises.map(ex => (
              <div key={ex.id} className="exercise-edit-block">
                <div className="exercise-edit-item">
                  <div className="exercise-edit-row">
                    <button
                      className="exercise-edit-info exercise-edit-info--btn"
                      onClick={() => setEditingId(prev => (prev === ex.id ? null : ex.id))}
                      aria-expanded={editingId === ex.id}
                      aria-label={`Edit sets and reps for ${ex.name}`}
                    >
                      <span className="exercise-edit-name">{ex.name}</span>
                      <span className="exercise-edit-meta">{prescriptionDetail(ex)} ✎</span>
                    </button>
                    <InfoButton name={ex.name} onClick={() => info.open(ex.id, ex.name)} />
                    <button
                      className="exercise-remove-btn"
                      onClick={() => handleRemove(ex.id)}
                      aria-label={`Remove ${ex.name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {editingId === ex.id && (
                  <SlotDoseEditor
                    exercise={ex}
                    suggested={prescribeFor(ex.id, { name: ex.name, snapshot })}
                    onChange={patch => handlePatch(ex.id, patch)}
                  />
                )}
              </div>
            ))}
            {exercises.length === 0 && (
              <p className="exercise-edit-empty">No exercises yet — search or create one below.</p>
            )}
          </div>

          <AddExercisePanel excludeIds={chosenIds} snapshot={snapshot} onAdd={handleAdd} addLabel="Add" />
        </section>
      </div>

      {info.sheet}
      <div className="day-edit-footer">
        <button className="day-edit-save-btn" onClick={handleStart} disabled={exercises.length === 0}>
          {exercises.length === 0 ? 'Add an exercise to start' : `Start Workout · ${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
