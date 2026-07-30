import { useState, useMemo, useEffect } from 'react';
import type { Exercise, LibraryExercise, WorkoutDay } from '../data/program';
import { prescriptionDetail } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { prescribeFor, slotFor } from '../data/prescribe';
import {
  addToExerciseLibrary, findExerciseByName, generateExerciseId, getExerciseLibrary,
} from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import { buildQuickWorkoutDay } from '../data/quickWorkout';
import './DayEditView.css';
import './QuickWorkoutView.css';

interface Props {
  onBack: () => void;
  onStart: (day: WorkoutDay) => void;
}

// Build a one-off workout by picking exercises, then log it like any other
// session — no training plan or block required. The exercises join the library
// (findExerciseByName reuses an existing identity when the name matches) so
// history and metrics resolve them.
export default function QuickWorkoutView({ onBack, onStart }: Props) {
  const [exercises, setExercises] = useState<Exercise[]>([]);

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [library, setLibrary] = useState<LibraryExercise[]>(() => getExerciseLibrary());
  const [newSets, setNewSets] = useState('3');
  const [newRepLow, setNewRepLow] = useState('');
  const [newRepHigh, setNewRepHigh] = useState('');

  // A quick workout is the one path with no plan behind it, so the history
  // fallback matters most here: with no goal to dose from, the coach reads the
  // rep range off what this lifter actually does with the movement.
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  useEffect(() => {
    loadTrainingSnapshot().then(setSnapshot).catch(() => {});
  }, []);

  const chosenIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library
      .filter(e => !e.archived && !chosenIds.has(e.id))
      .filter(e => q === '' || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [library, chosenIds, search]);

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q !== '' && library.some(e => e.name.trim().toLowerCase() === q);
  }, [library, search]);

  function addExercise(ex: Exercise) {
    addToExerciseLibrary({ id: ex.id, name: ex.name });
    setLibrary(getExerciseLibrary());
    setExercises(prev => [...prev, ex]);
    setSearch('');
    setCreating(false);
  }

  function handleAddFromLibrary(ex: LibraryExercise) {
    addExercise(slotFor(ex.id, ex.name, { snapshot }));
  }

  function handleCreateExercise() {
    const trimmed = search.trim();
    if (!trimmed) return;

    // Reuse an existing identity when the name already exists (library/catalog)
    // so history stays in one place instead of spawning a duplicate.
    const existing = findExerciseByName(trimmed);
    if (existing) {
      if (!chosenIds.has(existing.id)) handleAddFromLibrary(existing);
      else { setSearch(''); setCreating(false); }
      return;
    }

    const id = generateExerciseId(trimmed);
    const suggested = prescribeFor(id, { name: trimmed, snapshot });
    const repLow = Number(newRepLow) || suggested?.repLow;
    const repHigh = Number(newRepHigh) || suggested?.repHigh;
    addExercise({
      id,
      name: trimmed,
      sets: Number(newSets) || suggested?.sets || 3,
      ...(repLow != null && repHigh != null ? { repLow, repHigh } : {}),
    });
    setNewSets('3');
    setNewRepLow('');
    setNewRepHigh('');
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
                    <span className="exercise-edit-meta">{prescriptionDetail(ex)}</span>
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

          <div className="add-exercise-panel">
            <input
              className="day-edit-text-input"
              type="text"
              placeholder="Search exercises…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            {!creating && (
              <>
                <div className="add-search-results">
                  {searchResults.slice(0, 12).map(ex => {
                    const muscle = getExerciseMeta(ex.id).primaryMuscle;
                    return (
                      <button
                        key={ex.id}
                        className="add-search-result"
                        onClick={() => handleAddFromLibrary(ex)}
                      >
                        <span className="add-search-name">{ex.name}</span>
                        <span className="add-search-meta">
                          {[muscle].filter(Boolean).join(' · ')}
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
                    Add
                  </button>
                  <button className="add-ex-cancel-btn" onClick={() => setCreating(false)}>
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
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
