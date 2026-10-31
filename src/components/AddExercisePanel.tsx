import { useState, useMemo } from 'react';
import type { Exercise, LibraryExercise } from '../data/program';
import {
  addToExerciseLibrary, findExerciseByName, generateExerciseId, getExerciseLibrary,
} from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import type { TrainingSnapshot } from '../data/analytics';
import { prescribeFor, slotFor } from '../data/prescribe';
import { parseDose } from '../data/dosage';
import { filterExercises } from '../data/search';
import { InfoButton } from './InstructionSheet';
import { useInstructionSheet } from './useInstructionSheet';
import './DayEditView.css';

interface Props {
  /** Exercises already present — hidden from results and never re-added */
  excludeIds: Set<string>;
  /** The caller's loaded history — lets an added exercise be dosed from it */
  snapshot?: TrainingSnapshot | null;
  onAdd: (ex: Exercise) => void;
  /** Absent → the panel is always open (quick workout) and shows no Cancel */
  onClose?: () => void;
  /** The confirm button's label on the create form */
  addLabel?: string;
  /** How many search results to show before the user has to narrow */
  limit?: number;
}

/**
 * THE search-the-library-then-create exercise picker — one implementation for
 * the day editor, the quick-workout builder and the mid-workout add flow.
 * Resolving a typed name through findExerciseByName reuses an existing
 * identity so history stays in one place; a brand-new exercise's dose comes
 * from the typed numbers through parseDose (the one validator) or, left
 * blank, from the coach's suggestion for the active plan.
 */
export default function AddExercisePanel({
  excludeIds, snapshot, onAdd, onClose, addLabel = 'Add', limit = 12,
}: Props) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [library, setLibrary] = useState<LibraryExercise[]>(() => getExerciseLibrary());
  const [newSets, setNewSets] = useState('');
  const [newRepLow, setNewRepLow] = useState('');
  const [newRepHigh, setNewRepHigh] = useState('');
  const info = useInstructionSheet();

  const searchResults = useMemo(() => filterExercises(
    library.filter(e => !e.archived && !excludeIds.has(e.id)),
    search,
  ).sort((a, b) => a.name.localeCompare(b.name)), [library, excludeIds, search]);

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q !== '' && library.some(e => e.name.trim().toLowerCase() === q);
  }, [library, search]);

  const suggested = useMemo(
    () => (creating && search.trim() ? prescribeFor(generateExerciseId(search.trim()), { name: search.trim(), snapshot }) : null),
    [creating, search, snapshot],
  );

  function reset() {
    setSearch('');
    setCreating(false);
    setNewSets('');
    setNewRepLow('');
    setNewRepHigh('');
    setLibrary(getExerciseLibrary());
  }

  function commit(ex: Exercise) {
    addToExerciseLibrary({ id: ex.id, name: ex.name });
    onAdd(ex);
    reset();
  }

  // The library holds identity only — dose the slot here, for the active plan.
  function handleAddFromLibrary(ex: LibraryExercise) {
    commit(slotFor(ex.id, ex.name, { snapshot }));
  }

  function handleCreate() {
    const trimmed = search.trim();
    if (!trimmed) return;
    const existing = findExerciseByName(trimmed);
    if (existing) {
      if (!excludeIds.has(existing.id)) handleAddFromLibrary(existing);
      else if (onClose) onClose();
      else reset();
      return;
    }
    const id = generateExerciseId(trimmed);
    const dose = parseDose(newSets, newRepLow, newRepHigh, suggested);
    const typedRange = newRepLow.trim() !== '' || newRepHigh.trim() !== '';
    commit({
      id,
      name: trimmed,
      sets: dose.sets,
      ...(dose.repLow != null && dose.repHigh != null ? { repLow: dose.repLow, repHigh: dose.repHigh } : {}),
      ...(typedRange ? { rangeSource: 'user' } : suggested?.source ? { rangeSource: suggested.source } : {}),
    });
  }

  return (
    <div className="add-exercise-panel">
      <input
        className="day-edit-text-input"
        type="text"
        placeholder="Search exercises…"
        aria-label="Search exercises"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus={!!onClose}
      />

      {!creating && (
        <>
          <div className="add-search-results">
            {searchResults.slice(0, limit).map(ex => {
              const muscle = getExerciseMeta(ex.id).primaryMuscle;
              return (
                <div key={ex.id} className="add-search-result" role="button" tabIndex={0}
                  onClick={() => handleAddFromLibrary(ex)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAddFromLibrary(ex); } }}>
                  <div className="add-search-text">
                    <span className="add-search-name">{ex.name}</span>
                    <span className="add-search-meta">
                      {[muscle].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <InfoButton name={ex.name} onClick={() => info.open(ex.id, ex.name)} />
                </div>
              );
            })}
            {searchResults.length === 0 && (
              <p className="add-search-empty">
                {search.trim() ? 'No matching exercise in your library.' : 'Type to search, or create a new exercise below.'}
              </p>
            )}
            {searchResults.length > limit && (
              <p className="add-search-empty">
                {searchResults.length - limit} more — keep typing to narrow it down.
              </p>
            )}
          </div>

          {search.trim() && !exactMatch && (
            <button className="add-create-trigger" onClick={() => setCreating(true)}>
              + Create “{search.trim()}”
            </button>
          )}

          {onClose && (
            <button className="add-panel-cancel" onClick={onClose}>Cancel</button>
          )}
        </>
      )}

      {creating && (
        <>
          <span className="add-create-name">New exercise: {search.trim()}</span>
          <p className="slot-dose-hint">
            {suggested?.repLow != null
              ? `Leave the numbers blank for the coach's suggestion (${suggested.sets} × ${suggested.repLow}–${suggested.repHigh}), or set your own.`
              : 'Set your own numbers, or leave them blank to log freely with no target.'}
          </p>
          <div className="add-exercise-nums">
            <label className="num-label">
              <span>Sets</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1} max={8}
                placeholder={String(suggested?.sets ?? 3)}
                value={newSets} onChange={e => setNewSets(e.target.value)} />
            </label>
            <label className="num-label">
              <span>Rep low</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1}
                placeholder={suggested?.repLow == null ? '—' : String(suggested.repLow)}
                value={newRepLow} onChange={e => setNewRepLow(e.target.value)} />
            </label>
            <label className="num-label">
              <span>Rep high</span>
              <input className="day-edit-num-input" type="number" inputMode="numeric" min={1}
                placeholder={suggested?.repHigh == null ? '—' : String(suggested.repHigh)}
                value={newRepHigh} onChange={e => setNewRepHigh(e.target.value)} />
            </label>
          </div>
          <div className="add-exercise-actions">
            <button className="add-ex-confirm-btn" onClick={handleCreate} disabled={!search.trim()}>
              {addLabel}
            </button>
            <button className="add-ex-cancel-btn" onClick={() => setCreating(false)}>Back</button>
          </div>
        </>
      )}
      {info.sheet}
    </div>
  );
}
