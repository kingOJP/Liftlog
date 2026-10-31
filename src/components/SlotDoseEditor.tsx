import { useState } from 'react';
import type { Exercise } from '../data/program';
import { parseDose } from '../data/dosage';
import './DayEditView.css';

interface Props {
  exercise: Exercise;
  /** the coach's own suggestion for this slot, used when a field is left blank */
  suggested?: { sets: number; repLow?: number; repHigh?: number } | null;
  onChange: (patch: Partial<Exercise>) => void;
}

/**
 * Sets × rep range for one program slot, plus who drives its progression.
 * Shared by the day editor and the quick-workout picker so a lifter who wants
 * 5 × 5 can say so anywhere a slot exists — before this, a slot's dose could
 * only ever come from the plan (or a brand-new exercise's create form).
 * Typed numbers go through parseDose, the one validator, and mark the slot's
 * range as the user's own (`rangeSource: 'user'`).
 */
export default function SlotDoseEditor({ exercise, suggested, onChange }: Props) {
  const [sets, setSets] = useState(String(exercise.sets));
  const [low, setLow] = useState(exercise.repLow == null ? '' : String(exercise.repLow));
  const [high, setHigh] = useState(exercise.repHigh == null ? '' : String(exercise.repHigh));
  const manual = exercise.progression === 'manual';

  function commit(nextSets = sets, nextLow = low, nextHigh = high) {
    const fallback = suggested ? { sets: suggested.sets, repLow: suggested.repLow, repHigh: suggested.repHigh } : null;
    const dose = parseDose(nextSets, nextLow, nextHigh, fallback);
    const typedRange = nextLow.trim() !== '' || nextHigh.trim() !== '';
    onChange({
      sets: dose.sets,
      repLow: dose.repLow,
      repHigh: dose.repHigh,
      ...(typedRange ? { rangeSource: 'user' as const } : {}),
    });
  }

  return (
    <div className="slot-dose">
      <div className="add-exercise-nums">
        <label className="num-label">
          <span>Sets</span>
          <input
            className="day-edit-num-input" type="number" inputMode="numeric" min={1} max={8}
            value={sets}
            onChange={e => setSets(e.target.value)}
            onBlur={() => commit()}
          />
        </label>
        <label className="num-label">
          <span>Rep low</span>
          <input
            className="day-edit-num-input" type="number" inputMode="numeric" min={1}
            value={low}
            placeholder={suggested?.repLow == null ? '—' : String(suggested.repLow)}
            onChange={e => setLow(e.target.value)}
            onBlur={() => commit()}
          />
        </label>
        <label className="num-label">
          <span>Rep high</span>
          <input
            className="day-edit-num-input" type="number" inputMode="numeric" min={1}
            value={high}
            placeholder={suggested?.repHigh == null ? '—' : String(suggested.repHigh)}
            onChange={e => setHigh(e.target.value)}
            onBlur={() => commit()}
          />
        </label>
      </div>
      <div className="slot-progression" role="radiogroup" aria-label="Who drives this slot's progression">
        <button
          type="button"
          className={`setup-chip${!manual ? ' setup-chip--active' : ''}`}
          role="radio"
          aria-checked={!manual}
          onClick={() => onChange({ progression: 'coach' })}
        >
          Coach progression
        </button>
        <button
          type="button"
          className={`setup-chip${manual ? ' setup-chip--active' : ''}`}
          role="radio"
          aria-checked={manual}
          onClick={() => onChange({ progression: 'manual' })}
        >
          My own
        </button>
      </div>
      <p className="slot-dose-hint">
        {manual
          ? 'No chip, no targets — last time’s weight is pre-filled and the rest is yours.'
          : 'The coach prescribes each set from your history and this range.'}
      </p>
    </div>
  );
}
