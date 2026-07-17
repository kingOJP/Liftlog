import { useState, useEffect, useMemo } from 'react';
import type { WorkoutDay, Exercise } from '../data/program';
import { addToExerciseLibrary } from '../data/programStore';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { suggestReplacements, profileFor } from '../data/substitution';
import type { ReplacementSuggestion } from '../data/substitution';
import AddExercisePanel from './AddExercisePanel';
import './DayEditView.css';

interface Props {
  day: WorkoutDay;
  onBack: () => void;
  onSave: (updated: WorkoutDay) => void;
}

export default function DayEditView({ day, onBack, onSave }: Props) {
  const [muscleGroups, setMuscleGroups] = useState(day.muscleGroups);
  const [exercises, setExercises] = useState<Exercise[]>(day.exercises);

  // Add-exercise flow: the shared AddExercisePanel searches the library first;
  // only when nothing matches does the user fall through to creating one.
  const [showAdd, setShowAdd] = useState(false);

  // Replacement suggestions personalize on training history (familiarity,
  // strength trends, weekly volume balance) — loaded once, used lazily.
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);

  useEffect(() => {
    loadTrainingSnapshot().then(setSnapshot).catch(() => {});
  }, []);

  const swapTarget = exercises.find(e => e.id === swapTargetId) ?? null;
  const suggestions = useMemo<ReplacementSuggestion[]>(() => {
    if (!swapTarget) return [];
    return suggestReplacements(swapTarget, { ...day, exercises }, snapshot);
  }, [swapTarget, exercises, snapshot, day]);
  const swapTargetHasMeta =
    swapTarget != null && profileFor(swapTarget.id, swapTarget.name).primaryMuscle != null;

  // Exercises already in this day can't be added again (id is the row key).
  const dayExerciseIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  function handleReplace(oldEx: Exercise, s: ReplacementSuggestion) {
    // The accepted exercise becomes first-class: it joins the library (lifting
    // any tombstone) so history, metrics and metadata editing all resolve it.
    addToExerciseLibrary({
      id: s.exercise.id,
      name: s.exercise.name,
      sets: oldEx.sets,
      repLow: oldEx.repLow,
      repHigh: oldEx.repHigh,
    });
    // Swap in place, preserving the slot's programming (sets, rep range, order)
    setExercises(prev => prev.map(e =>
      e.id === oldEx.id ? { ...e, id: s.exercise.id, name: s.exercise.name } : e,
    ));
    setSwapTargetId(null);
  }

  function handleMove(id: string, dir: -1 | 1) {
    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function handleRemove(id: string) {
    setExercises(prev => prev.filter(e => e.id !== id));
  }

  function handleSave() {
    onSave({ ...day, muscleGroups, exercises });
  }

  return (
    <div className="day-edit-view">
      <header className="day-edit-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="day-edit-title">
          <span className="day-edit-label">{day.label}</span>
          <span className="day-edit-heading">Edit Day</span>
        </div>
      </header>

      <div className="day-edit-body">
        <section className="day-edit-section">
          <label className="day-edit-field-label" htmlFor="muscle-input">Muscle Group</label>
          <input
            id="muscle-input"
            className="day-edit-text-input"
            type="text"
            value={muscleGroups}
            onChange={e => setMuscleGroups(e.target.value)}
            placeholder="e.g. Chest / Tris / Shoulders"
          />
        </section>

        <section className="day-edit-section">
          <span className="day-edit-field-label">Exercises</span>
          <div className="exercise-edit-list">
            {exercises.map((ex, idx) => (
              <div key={ex.id} className="exercise-edit-block">
                <div className="exercise-edit-item">
                  <div className="exercise-edit-row">
                    <div className="exercise-edit-info">
                      <span className="exercise-edit-name">{ex.name}</span>
                      <span className="exercise-edit-meta">{ex.sets} sets · {ex.repLow}–{ex.repHigh} reps</span>
                    </div>
                    <button
                      className={`exercise-swap-btn${swapTargetId === ex.id ? ' active' : ''}`}
                      onClick={() => setSwapTargetId(prev => (prev === ex.id ? null : ex.id))}
                      aria-label={`Find replacement for ${ex.name}`}
                    >
                      ⇄
                    </button>
                    <button
                      className="exercise-remove-btn"
                      onClick={() => handleRemove(ex.id)}
                      aria-label={`Remove ${ex.name}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="exercise-reorder-btns">
                    <button
                      className="exercise-reorder-btn"
                      onClick={() => handleMove(ex.id, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${ex.name} up`}
                    >▲</button>
                    <button
                      className="exercise-reorder-btn"
                      onClick={() => handleMove(ex.id, 1)}
                      disabled={idx === exercises.length - 1}
                      aria-label={`Move ${ex.name} down`}
                    >▼</button>
                  </div>
                </div>

                {swapTargetId === ex.id && (
                  <div className="swap-panel">
                    <span className="swap-panel-title">Replacements for {ex.name}</span>
                    {suggestions.length === 0 && (
                      <p className="swap-empty">
                        {swapTargetHasMeta
                          ? 'No good replacement found in the exercise library.'
                          : 'Set this exercise’s muscle groups (Exercises screen) to get replacement suggestions.'}
                      </p>
                    )}
                    {suggestions.map(s => (
                      <div key={s.exercise.id} className="swap-card">
                        <div className="swap-card-top">
                          <div className="swap-card-info">
                            <span className="swap-card-name">{s.exercise.name}</span>
                            <span className="swap-card-meta">
                              {[s.exercise.primaryMuscle, s.exercise.workoutType, s.exercise.equipment]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </div>
                          <button className="swap-card-btn" onClick={() => handleReplace(ex, s)}>
                            Swap in
                          </button>
                        </div>
                        <ul className="swap-card-notes">
                          {s.reasons.map(r => <li key={r}>{r}</li>)}
                          {s.cautions.map(c => <li key={c} className="swap-caution">{c}</li>)}
                        </ul>
                        <span className="swap-card-keep">
                          Keeps your {ex.sets} sets × {ex.repLow}–{ex.repHigh} reps
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {exercises.length === 0 && (
              <p className="exercise-edit-empty">No exercises — add one below.</p>
            )}
          </div>

          {!showAdd && (
            <button className="add-exercise-trigger" onClick={() => setShowAdd(true)}>
              + Add Exercise
            </button>
          )}

          {showAdd && (
            <AddExercisePanel
              excludeIds={dayExerciseIds}
              confirmLabel="Add to Day"
              onAdd={ex => {
                setExercises(prev => [...prev, ex]);
                setShowAdd(false);
              }}
              onClose={() => setShowAdd(false)}
            />
          )}
        </section>
      </div>

      <div className="day-edit-footer">
        <button className="day-edit-save-btn" onClick={handleSave}>
          Save Changes
        </button>
      </div>
    </div>
  );
}
