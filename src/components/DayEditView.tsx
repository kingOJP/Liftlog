import { useState, useEffect, useMemo } from 'react';
import type { WorkoutDay, Exercise } from '../data/program';
import { prescriptionDetail } from '../data/program';
import { addToExerciseLibrary } from '../data/programStore';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { suggestReplacements, profileFor } from '../data/substitution';
import { prescribeFor } from '../data/prescribe';
import { getTrainingGoal } from '../data/planStore';
import type { ReplacementSuggestion } from '../data/substitution';
import AddExercisePanel from './AddExercisePanel';
import SlotDoseEditor from './SlotDoseEditor';
import { InfoButton } from './InstructionSheet';
import { useInstructionSheet } from './useInstructionSheet';
import './DayEditView.css';

interface Props {
  day: WorkoutDay;
  /** a day being created — nothing exists until Save */
  isNew?: boolean;
  /** position controls, when the day is part of a program with neighbours */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (dir: -1 | 1) => void;
  onDelete?: () => void;
  onBack: () => void;
  onSave: (updated: WorkoutDay) => void;
}

/**
 * Edit one program day: its name and muscle-group line, its exercises (add,
 * remove, reorder, swap with explained suggestions), and — new — each slot's
 * sets × rep range and who drives its progression. Together with "Add a day"
 * on the dashboard this is how a lifter builds a program by hand instead of
 * only through the wizard.
 */
export default function DayEditView({
  day, isNew = false, canMoveUp = false, canMoveDown = false, onMove, onDelete, onBack, onSave,
}: Props) {
  const [label, setLabel] = useState(day.label);
  const [muscleGroups, setMuscleGroups] = useState(day.muscleGroups);
  const [exercises, setExercises] = useState<Exercise[]>(day.exercises);
  const [showAdd, setShowAdd] = useState(false);
  /** the slot whose dose editor is open */
  const [editingId, setEditingId] = useState<string | null>(null);
  const info = useInstructionSheet();

  // Replacement suggestions personalize on training history (familiarity,
  // strength trends, weekly volume balance) — loaded once, used lazily.
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  // "Now" is captured once at mount: reading the clock during render makes
  // the memoized suggestions drift across renders (react-hooks/purity).
  const [now] = useState(() => Date.now());

  useEffect(() => {
    loadTrainingSnapshot().then(setSnapshot).catch(() => {});
  }, []);

  const swapTarget = exercises.find(e => e.id === swapTargetId) ?? null;
  const suggestions = useMemo<ReplacementSuggestion[]>(() => {
    if (!swapTarget) return [];
    return suggestReplacements(swapTarget, { ...day, exercises }, snapshot, 3, now, getTrainingGoal());
  }, [swapTarget, exercises, snapshot, day, now]);
  const swapTargetHasMeta =
    swapTarget != null && profileFor(swapTarget.id, swapTarget.name).primaryMuscle != null;

  // Exercises already in this day can't be added again (id is the row key).
  const dayExerciseIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  function handleReplace(oldEx: Exercise, s: ReplacementSuggestion) {
    // The accepted exercise becomes first-class: it joins the library (lifting
    // any tombstone) so history, metrics and metadata editing all resolve it.
    addToExerciseLibrary({ id: s.exercise.id, name: s.exercise.name });
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

  function handlePatch(id: string, patch: Partial<Exercise>) {
    setExercises(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }

  function handleAdd(ex: Exercise) {
    setExercises(prev => (prev.some(e => e.id === ex.id) ? prev : [...prev, ex]));
    setShowAdd(false);
  }

  function handleSave() {
    onSave({ ...day, label: label.trim() || day.label, muscleGroups, exercises });
  }

  function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm(`Remove ${day.label} from your program? Logged workouts are kept.`)) return;
    onDelete();
  }

  return (
    <div className="day-edit-view">
      <header className="day-edit-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="day-edit-title">
          <span className="day-edit-label">{isNew ? 'New day' : day.label}</span>
          <span className="day-edit-heading">{isNew ? 'Build a workout' : 'Edit Day'}</span>
        </div>
      </header>

      <div className="day-edit-body">
        <section className="day-edit-section">
          <label className="day-edit-field-label" htmlFor="label-input">Name</label>
          <input
            id="label-input"
            className="day-edit-text-input"
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Day 1, Push, Heavy lower"
          />
        </section>

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
          <p className="slot-dose-hint">Tap a line like “3 sets · 8–12 reps” to change the sets, the rep range, or to run your own progression.</p>
          <div className="exercise-edit-list">
            {exercises.map((ex, idx) => (
              <div key={ex.id} className="exercise-edit-block">
                <div className="exercise-edit-item">
                  <div className="exercise-edit-row">
                    <button
                      className="exercise-edit-info exercise-edit-info--btn"
                      onClick={() => setEditingId(prev => (prev === ex.id ? null : ex.id))}
                      aria-expanded={editingId === ex.id}
                      aria-label={`Edit sets and reps for ${ex.name}`}
                    >
                      <span className="exercise-edit-name">{ex.name}{ex.main ? <span className="exercise-main-tag">main</span> : null}</span>
                      <span className="exercise-edit-meta">{prescriptionDetail(ex)} ✎</span>
                    </button>
                    <InfoButton name={ex.name} onClick={() => info.open(ex.id, ex.name)} />
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

                {editingId === ex.id && (
                  <SlotDoseEditor
                    key={ex.id}
                    exercise={ex}
                    suggested={prescribeFor(ex.id, { name: ex.name, snapshot })}
                    onChange={patch => handlePatch(ex.id, patch)}
                  />
                )}

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
                          <InfoButton name={s.exercise.name} onClick={() => info.open(s.exercise.id, s.exercise.name)} />
                          <button className="swap-card-btn" onClick={() => handleReplace(ex, s)}>
                            Swap in
                          </button>
                        </div>
                        <ul className="swap-card-notes">
                          {s.reasons.map(r => <li key={r}>{r}</li>)}
                          {s.cautions.map(c => <li key={c} className="swap-caution">{c}</li>)}
                        </ul>
                        <span className="swap-card-keep">
                          Keeps your {prescriptionDetail(ex)}
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
              snapshot={snapshot}
              onAdd={handleAdd}
              onClose={() => setShowAdd(false)}
              addLabel="Add to Day"
            />
          )}
        </section>

        {!isNew && (onMove || onDelete) && (
          <section className="day-edit-section day-actions">
            <span className="day-edit-field-label">This day</span>
            <div className="day-actions-row">
              {onMove && (
                <>
                  <button className="day-action-btn" onClick={() => onMove(-1)} disabled={!canMoveUp}>▲ Move earlier</button>
                  <button className="day-action-btn" onClick={() => onMove(1)} disabled={!canMoveDown}>▼ Move later</button>
                </>
              )}
              {onDelete && (
                <button className="day-action-btn day-action-btn--danger" onClick={handleDelete}>Remove day</button>
              )}
            </div>
          </section>
        )}
      </div>

      {info.sheet}
      <div className="day-edit-footer">
        <button
          className="day-edit-save-btn"
          onClick={handleSave}
          disabled={isNew && exercises.length === 0}
        >
          {isNew ? (exercises.length === 0 ? 'Add an exercise to save' : 'Add to program') : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
