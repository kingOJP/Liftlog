import { useState, useMemo } from 'react';
import type { Exercise } from '../data/program';
import {
  addToExerciseLibrary, findExerciseByName, generateExerciseId, getExerciseLibrary,
} from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import './DayEditView.css';

interface Props {
  /** Exercises already present — hidden from results and never re-added */
  excludeIds: Set<string>;
  onAdd: (ex: Exercise) => void;
  onClose: () => void;
}

// Search-the-library-then-create exercise picker, shared by the workout view's
// "add exercise mid-workout" flow. Resolving a typed name through
// findExerciseByName reuses an existing identity so history stays in one place.
export default function AddExercisePanel({ excludeIds, onAdd, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [library] = useState<Exercise[]>(() => getExerciseLibrary());
  const [newSets, setNewSets] = useState('3');
  const [newRepLow, setNewRepLow] = useState('8');
  const [newRepHigh, setNewRepHigh] = useState('12');

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library
      .filter(e => !e.archived && !excludeIds.has(e.id))
      .filter(e => q === '' || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [library, excludeIds, search]);

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q !== '' && library.some(e => e.name.trim().toLowerCase() === q);
  }, [library, search]);

  function commit(ex: Exercise) {
    addToExerciseLibrary(ex);
    onAdd(ex);
  }

  function handleAddFromLibrary(ex: Exercise) {
    commit({ id: ex.id, name: ex.name, sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh });
  }

  function handleCreate() {
    const trimmed = search.trim();
    if (!trimmed) return;
    const existing = findExerciseByName(trimmed);
    if (existing) {
      if (!excludeIds.has(existing.id)) handleAddFromLibrary(existing);
      else onClose();
      return;
    }
    commit({
      id: generateExerciseId(trimmed),
      name: trimmed,
      sets: Number(newSets) || 3,
      repLow: Number(newRepLow) || 8,
      repHigh: Number(newRepHigh) || 12,
    });
  }

  return (
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
            {searchResults.slice(0, 12).map(ex => {
              const muscle = getExerciseMeta(ex.id).primaryMuscle;
              return (
                <button key={ex.id} className="add-search-result" onClick={() => handleAddFromLibrary(ex)}>
                  <span className="add-search-name">{ex.name}</span>
                  <span className="add-search-meta">
                    {[muscle, `${ex.sets} × ${ex.repLow}–${ex.repHigh}`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              );
            })}
            {searchResults.length === 0 && (
              <p className="add-search-empty">
                {search.trim() ? 'No matching exercise in your library.' : 'Type to search, or create a new exercise below.'}
              </p>
            )}
          </div>

          {search.trim() && !exactMatch && (
            <button className="add-create-trigger" onClick={() => setCreating(true)}>
              + Create “{search.trim()}”
            </button>
          )}

          <button className="add-panel-cancel" onClick={onClose}>Cancel</button>
        </>
      )}

      {creating && (
        <>
          <span className="add-create-name">New exercise: {search.trim()}</span>
          <div className="add-exercise-nums">
            <label className="num-label">
              <span>Sets</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1}
                value={newSets} onChange={e => setNewSets(e.target.value)} />
            </label>
            <label className="num-label">
              <span>Rep Low</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1}
                value={newRepLow} onChange={e => setNewRepLow(e.target.value)} />
            </label>
            <label className="num-label">
              <span>Rep High</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1}
                value={newRepHigh} onChange={e => setNewRepHigh(e.target.value)} />
            </label>
          </div>
          <div className="add-exercise-actions">
            <button className="add-ex-confirm-btn" onClick={handleCreate} disabled={!search.trim()}>
              Add to Workout
            </button>
            <button className="add-ex-cancel-btn" onClick={() => setCreating(false)}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}
