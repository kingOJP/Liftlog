import { useState, useMemo, useEffect, useRef } from 'react';
import type { Exercise, LibraryExercise } from '../data/program';
import {
  addToExerciseLibrary, findExerciseByName, generateExerciseId, pickableExercises,
} from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import type { TrainingSnapshot } from '../data/analytics';
import type { MuscleGroup } from '../data/taxonomy';
import { MUSCLE_GROUPS } from '../data/taxonomy';
import type { Goal, ExperienceLevel } from '../data/plan';
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
  /** Heading above the search box ("Replace Goblet Squat with…") */
  title?: string;
  /** Muscle chip to open on — a replacement starts on the slot's muscle */
  initialMuscle?: MuscleGroup | null;
  /**
   * Dose for this goal/level instead of the active plan's — the plan wizard
   * passes the goal being planned, which isn't stored until activation.
   */
  goal?: Goal | null;
  experience?: ExperienceLevel;
}

/**
 * THE search-then-create exercise picker — one implementation for the day
 * editor, the quick-workout builder, the mid-workout add flow and the plan
 * wizard's review step. It searches everything the app knows (the user's
 * library plus the whole built-in catalog), narrowable by primary muscle.
 * Resolving a typed name through findExerciseByName reuses an existing
 * identity so history stays in one place; a brand-new exercise's dose comes
 * from the typed numbers through parseDose (the one validator) or, left
 * blank, from the coach's suggestion for the plan.
 */
export default function AddExercisePanel({
  excludeIds, snapshot, onAdd, onClose, addLabel = 'Add', limit = 12,
  title, initialMuscle = null, goal, experience,
}: Props) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [muscle, setMuscle] = useState<MuscleGroup | null>(initialMuscle);
  const [pool, setPool] = useState<LibraryExercise[]>(() => pickableExercises());
  const [newSets, setNewSets] = useState('');
  const [newRepLow, setNewRepLow] = useState('');
  const [newRepHigh, setNewRepHigh] = useState('');
  const info = useInstructionSheet();
  const chipsRef = useRef<HTMLDivElement>(null);
  const doseOpts = useMemo(
    () => ({ snapshot, ...(goal !== undefined ? { goal } : {}), ...(experience ? { experience } : {}) }),
    [snapshot, goal, experience],
  );

  // One metadata read per entry per open, not per keystroke.
  const entries = useMemo(
    () => pool.map(ex => ({ ex, name: ex.name, primary: getExerciseMeta(ex.id).primaryMuscle ?? null })),
    [pool],
  );
  // Chips only for muscles something in the pool actually trains.
  const muscles = useMemo(() => {
    const present = new Set(entries.map(e => e.primary));
    return MUSCLE_GROUPS.filter(m => present.has(m));
  }, [entries]);

  // Opening on a muscle: bring its chip into view, or the filter is invisible
  // on a phone-width chip row.
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('.add-muscle-chip.active');
    if (row && chip) row.scrollLeft = chip.offsetLeft - row.offsetLeft - 8;
  }, []);

  const textMatches = useMemo(() => filterExercises(
    entries.filter(e => !excludeIds.has(e.ex.id)),
    search,
  ), [entries, excludeIds, search]);
  const searchResults = useMemo(
    () => (muscle ? textMatches.filter(e => e.primary === muscle) : textMatches),
    [textMatches, muscle],
  );
  // Matches the muscle chip is hiding — offered as a one-tap way out.
  const hiddenByMuscle = textMatches.length - searchResults.length;

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q !== '' && pool.some(e => e.name.trim().toLowerCase() === q);
  }, [pool, search]);

  const suggested = useMemo(
    () => (creating && search.trim() ? prescribeFor(generateExerciseId(search.trim()), { name: search.trim(), ...doseOpts }) : null),
    [creating, search, doseOpts],
  );

  function reset() {
    setSearch('');
    setCreating(false);
    setNewSets('');
    setNewRepLow('');
    setNewRepHigh('');
    setPool(pickableExercises());
  }

  function commit(ex: Exercise) {
    addToExerciseLibrary({ id: ex.id, name: ex.name });
    onAdd(ex);
    reset();
  }

  // The library holds identity only — dose the slot here, for the active plan.
  function handleAddFromLibrary(ex: LibraryExercise) {
    commit(slotFor(ex.id, ex.name, doseOpts));
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
      {title && <span className="add-panel-title">{title}</span>}
      <input
        className="day-edit-text-input"
        type="text"
        placeholder="Search all exercises…"
        aria-label="Search exercises"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus={!!onClose}
      />

      {!creating && muscles.length > 0 && (
        <div className="add-muscle-chips" ref={chipsRef} role="group" aria-label="Filter by muscle">
          <button className={`add-muscle-chip${muscle == null ? ' active' : ''}`}
            onClick={() => setMuscle(null)}>All</button>
          {muscles.map(m => (
            <button key={m} className={`add-muscle-chip${muscle === m ? ' active' : ''}`}
              aria-pressed={muscle === m}
              onClick={() => setMuscle(prev => (prev === m ? null : m))}>{m}</button>
          ))}
        </div>
      )}

      {!creating && (
        <>
          <div className="add-search-results">
            {searchResults.slice(0, limit).map(({ ex, primary: muscle }) => {
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
                {search.trim()
                  ? `No match for “${search.trim()}”${muscle ? ` in ${muscle}` : ''}.`
                  : muscle ? `Nothing left to add for ${muscle}.` : 'Type to search, pick a muscle, or create a new exercise below.'}
              </p>
            )}
            {searchResults.length > limit && (
              <p className="add-search-empty">
                {searchResults.length - limit} more — keep typing to narrow it down.
              </p>
            )}
            {muscle && hiddenByMuscle > 0 && (
              <button className="add-show-all" onClick={() => setMuscle(null)}>
                Show {hiddenByMuscle} more in other muscles
              </button>
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
