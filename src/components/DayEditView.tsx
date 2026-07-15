import { useState, useEffect, useMemo } from 'react';
import type { WorkoutDay, Exercise } from '../data/program';
import { addToExerciseLibrary, findExerciseByName, generateExerciseId, getExerciseLibrary } from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { suggestReplacements, profileFor } from '../data/substitution';
import type { ReplacementSuggestion } from '../data/substitution';
import './DayEditView.css';

interface Props {
  day: WorkoutDay;
  onBack: () => void;
  onSave: (updated: WorkoutDay) => void;
}

export default function DayEditView({ day, onBack, onSave }: Props) {
  const [muscleGroups, setMuscleGroups] = useState(day.muscleGroups);
  const [exercises, setExercises] = useState<Exercise[]>(day.exercises);

  // Add-exercise flow: a search box filters the existing library first; only
  // when nothing matches does the user fall through to creating a new exercise.
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [newSets, setNewSets] = useState('3');
  const [newRepLow, setNewRepLow] = useState('8');
  const [newRepHigh, setNewRepHigh] = useState('12');

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

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library
      .filter(e => !e.archived && !dayExerciseIds.has(e.id))
      .filter(e => q === '' || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [library, dayExerciseIds, search]);

  // Only offer "create new" when the typed name isn't already a library entry
  // (regardless of day membership), so we never spawn a duplicate name.
  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q !== '' && library.some(e => e.name.trim().toLowerCase() === q);
  }, [library, search]);

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

  function openAdd() {
    setLibrary(getExerciseLibrary());
    setSearch('');
    setCreating(false);
    setShowAdd(true);
  }

  function closeAdd() {
    setShowAdd(false);
    setSearch('');
    setCreating(false);
    setNewSets('3');
    setNewRepLow('8');
    setNewRepHigh('12');
  }

  // Pick an existing library exercise: reuse its id (so history resolves) and
  // its stored sets/rep range. addToExerciseLibrary lifts any deletion tombstone.
  function handleAddFromLibrary(ex: Exercise) {
    addToExerciseLibrary(ex);
    setExercises(prev => [...prev, {
      id: ex.id,
      name: ex.name,
      sets: ex.sets,
      repLow: ex.repLow,
      repHigh: ex.repHigh,
    }]);
    closeAdd();
  }

  function handleCreateExercise() {
    const trimmed = search.trim();
    if (!trimmed) return;

    // Never mint a new id for a name that already exists (library or catalog,
    // slug-compared) — reusing the existing id keeps history in one place
    // instead of spawning a duplicate exercise.
    const existing = findExerciseByName(trimmed);
    if (existing) {
      if (!dayExerciseIds.has(existing.id)) handleAddFromLibrary(existing);
      else closeAdd();
      return;
    }

    const exercise: Exercise = {
      id: generateExerciseId(trimmed),
      name: trimmed,
      sets: Number(newSets) || 3,
      repLow: Number(newRepLow) || 8,
      repHigh: Number(newRepHigh) || 12,
    };

    addToExerciseLibrary(exercise);
    setExercises(prev => [...prev, exercise]);
    closeAdd();
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
            <button className="add-exercise-trigger" onClick={openAdd}>
              + Add Exercise
            </button>
          )}

          {showAdd && (
            <div className="add-exercise-panel">
              <input
                className="day-edit-text-input"
                type="text"
                placeholder="Search exercises…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />

              {!creating && (
                <>
                  <div className="add-search-results">
                    {searchResults.map(ex => {
                      const muscle = getExerciseMeta(ex.id).primaryMuscle;
                      return (
                        <button
                          key={ex.id}
                          className="add-search-result"
                          onClick={() => handleAddFromLibrary(ex)}
                        >
                          <span className="add-search-name">{ex.name}</span>
                          <span className="add-search-meta">
                            {[muscle, `${ex.sets} × ${ex.repLow}–${ex.repHigh}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                      );
                    })}
                    {searchResults.length === 0 && (
                      <p className="add-search-empty">
                        {search.trim()
                          ? 'No matching exercise in your library.'
                          : 'Type to search, or create a new exercise below.'}
                      </p>
                    )}
                  </div>

                  {search.trim() && !exactMatch && (
                    <button className="add-create-trigger" onClick={() => setCreating(true)}>
                      + Create “{search.trim()}”
                    </button>
                  )}

                  <button className="add-panel-cancel" onClick={closeAdd}>
                    Cancel
                  </button>
                </>
              )}

              {creating && (
                <>
                  <span className="add-create-name">New exercise: {search.trim()}</span>
                  <div className="add-exercise-nums">
                    <label className="num-label">
                      <span>Sets</span>
                      <input
                        className="day-edit-num-input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={newSets}
                        onChange={e => setNewSets(e.target.value)}
                      />
                    </label>
                    <label className="num-label">
                      <span>Rep Low</span>
                      <input
                        className="day-edit-num-input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={newRepLow}
                        onChange={e => setNewRepLow(e.target.value)}
                      />
                    </label>
                    <label className="num-label">
                      <span>Rep High</span>
                      <input
                        className="day-edit-num-input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={newRepHigh}
                        onChange={e => setNewRepHigh(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="add-exercise-actions">
                    <button
                      className="add-ex-confirm-btn"
                      onClick={handleCreateExercise}
                      disabled={!search.trim()}
                    >
                      Add to Day
                    </button>
                    <button
                      className="add-ex-cancel-btn"
                      onClick={() => setCreating(false)}
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>
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
