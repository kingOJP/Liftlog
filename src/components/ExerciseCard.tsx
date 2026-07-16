import { useState } from 'react';
import type { Exercise } from '../data/program';
import type { WeightRec, ExerciseSession } from '../data/recommendations';
import './ExerciseCard.css';

interface Props {
  exercise: Exercise;
  sets: Array<{ weight: number; reps: number; warmup?: boolean }>;
  recommendation?: WeightRec;
  lastSession?: ExerciseSession;
  onLogSet: (weight: number, reps: number, warmup: boolean) => void;
  onEditSet: (index: number, weight: number, reps: number, warmup: boolean) => void;
  onDeleteSet: (index: number) => void;
}

// "100×10, 100×9, 95×8" — compressed to "100 lbs × 10, 9, 8" when the weight
// never changes, which is the common case for straight sets.
function formatLastSets(sets: ExerciseSession['sets']): string {
  const uniqueWeights = new Set(sets.map(s => s.weight));
  if (uniqueWeights.size === 1) {
    return `${sets[0].weight} lbs × ${sets.map(s => s.reps).join(', ')}`;
  }
  return sets.map(s => `${s.weight}×${s.reps}`).join(', ');
}

function lastSessionLabel(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DIRECTION_ICON: Record<WeightRec['direction'], string> = {
  up: '↑',
  down: '↓',
  hold: '→',
};

export default function ExerciseCard({
  exercise, sets, recommendation, lastSession,
  onLogSet, onEditSet, onDeleteSet,
}: Props) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  // When on, the next logged set is tagged as a warm-up (counted for display,
  // never for metrics). Stays on across logs so a lifter can bang out several
  // warm-up sets, then toggle off for their working sets.
  const [warmupNext, setWarmupNext] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWarmup, setEditWarmup] = useState(false);

  // Pre-populate the weight input when a recommendation arrives (async, after
  // mount) — but only if the field is still untouched. Guarded state
  // adjustment during render, per the React "adjusting state when a prop
  // changes" pattern.
  const [appliedRec, setAppliedRec] = useState<WeightRec | undefined>(undefined);
  if (recommendation !== appliedRec) {
    setAppliedRec(recommendation);
    if (recommendation != null && weight === '') {
      setWeight(String(recommendation.weight));
    }
  }

  const targetLabel = `${exercise.sets} × ${exercise.repLow}–${exercise.repHigh}`;
  // Working sets are numbered on their own; warm-ups carry a label, not a
  // number, so "Set 1" always means the first real work set.
  const setLabels: string[] = [];
  let workingSoFar = 0;
  for (const s of sets) {
    if (s.warmup) setLabels.push('Warm-up');
    else { workingSoFar += 1; setLabels.push(`Set ${workingSoFar}`); }
  }
  const nextSetNum = workingSoFar + 1;

  function handleLogSet() {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    // Weight of 0 is valid (bodyweight exercises); reps must be positive.
    if (!isFinite(w) || !isFinite(r) || w < 0 || r <= 0) return;
    onLogSet(w, r, warmupNext);
    setReps('');
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditWeight(String(sets[index].weight));
    setEditReps(String(sets[index].reps));
    setEditWarmup(!!sets[index].warmup);
  }

  function confirmEdit() {
    if (editingIndex === null) return;
    const w = parseFloat(editWeight);
    const r = parseInt(editReps, 10);
    if (isFinite(w) && isFinite(r) && w >= 0 && r > 0) {
      onEditSet(editingIndex, w, r, editWarmup);
    }
    setEditingIndex(null);
  }

  function cancelEdit() {
    setEditingIndex(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleLogSet();
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') confirmEdit();
    if (e.key === 'Escape') cancelEdit();
  }

  return (
    <div className="exercise-card">
      <div className="ex-header">
        <span className="ex-name">{exercise.name}</span>
        <span className="ex-target">{targetLabel}</span>
      </div>

      {recommendation && (
        <div className={`ex-rec ex-rec--${recommendation.direction}`}>
          <span className="ex-rec-weight">
            {DIRECTION_ICON[recommendation.direction]}{' '}
            {recommendation.targetReps != null
              ? `${recommendation.targetReps} reps`
              : `${recommendation.weight} lbs`}
          </span>
          <span className="ex-rec-reason">{recommendation.reason}</span>
        </div>
      )}

      {lastSession && (
        <div className="ex-last">
          <span className="ex-last-label">Last time · {lastSessionLabel(lastSession.completedAt)}</span>
          <span className="ex-last-sets">{formatLastSets(lastSession.sets)}</span>
        </div>
      )}

      {sets.length > 0 && (
        <div className="set-log">
          {sets.map((s, i) =>
            editingIndex === i ? (
              <div key={i} className={`set-row editing${s.warmup ? ' set-row--warmup' : ''}`}>
                <span className="set-num">{setLabels[i]}</span>
                <div className="inline-field">
                  <input
                    className="inline-input"
                    type="number"
                    inputMode="decimal"
                    value={editWeight}
                    onChange={e => setEditWeight(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    autoFocus
                  />
                  <span className="inline-unit">lbs</span>
                </div>
                <div className="inline-field">
                  <input
                    className="inline-input"
                    type="number"
                    inputMode="numeric"
                    value={editReps}
                    onChange={e => setEditReps(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                  />
                  <span className="inline-unit">rp</span>
                </div>
                <button
                  className={`warmup-chip${editWarmup ? ' warmup-chip--on' : ''}`}
                  onClick={() => setEditWarmup(v => !v)}
                  aria-pressed={editWarmup}
                  title="Tag as warm-up"
                >
                  W
                </button>
                <button className="edit-confirm-btn" onClick={confirmEdit}>✓</button>
                <button className="edit-cancel-btn" onClick={cancelEdit}>✗</button>
              </div>
            ) : (
              <div key={i} className={`set-row${s.warmup ? ' set-row--warmup' : ''}`} onClick={() => startEdit(i)}>
                <span className="set-num">{setLabels[i]}</span>
                <span className="set-weight">{s.weight} lbs</span>
                <span className="set-reps">{s.reps} reps</span>
                <button
                  className="delete-set-btn"
                  onClick={e => { e.stopPropagation(); onDeleteSet(i); }}
                  aria-label={`Delete ${setLabels[i]}`}
                >
                  ×
                </button>
              </div>
            )
          )}
        </div>
      )}

      <div className="set-inputs">
        <div className="input-row">
          <div className="weight-wrap">
            <input
              className="num-input"
              type="number"
              inputMode="decimal"
              placeholder="Weight"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <span className="input-unit">lbs</span>
          </div>
          <div className="reps-wrap">
            <input
              className="num-input"
              type="number"
              inputMode="numeric"
              placeholder={`${exercise.repLow}–${exercise.repHigh} reps`}
              value={reps}
              onChange={e => setReps(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className="log-actions">
          <button
            type="button"
            className={`warmup-toggle${warmupNext ? ' warmup-toggle--on' : ''}`}
            onClick={() => setWarmupNext(v => !v)}
            aria-pressed={warmupNext}
          >
            {warmupNext ? '✓ Warm-up' : 'Warm-up'}
          </button>
          {reps !== '' && (
            <button className="log-btn" disabled={!weight || !reps} onClick={handleLogSet}>
              {warmupNext ? 'Log Warm-up' : `Log Set ${nextSetNum}`}
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
