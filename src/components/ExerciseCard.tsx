import { useState, useEffect } from 'react';
import type { Exercise } from '../data/program';
import './ExerciseCard.css';

interface Props {
  exercise: Exercise;
  sets: Array<{ weight: number; reps: number }>;
  recommendedWeight?: number;
  onLogSet: (weight: number, reps: number) => void;
  onEditSet: (index: number, weight: number, reps: number) => void;
  onDeleteSet: (index: number) => void;
}

export default function ExerciseCard({
  exercise, sets, recommendedWeight,
  onLogSet, onEditSet, onDeleteSet,
}: Props) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');

  // Pre-populate weight input once the recommendation loads (only if field is still empty)
  useEffect(() => {
    if (recommendedWeight != null && weight === '') {
      setWeight(String(recommendedWeight));
    }
  }, [recommendedWeight]);

  const targetLabel = `${exercise.sets} × ${exercise.repLow}–${exercise.repHigh}`;
  const nextSetNum = sets.length + 1;

  function handleLogSet() {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!isFinite(w) || !isFinite(r) || w <= 0 || r <= 0) return;
    onLogSet(w, r);
    setReps('');
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditWeight(String(sets[index].weight));
    setEditReps(String(sets[index].reps));
  }

  function confirmEdit() {
    if (editingIndex === null) return;
    const w = parseFloat(editWeight);
    const r = parseInt(editReps, 10);
    if (isFinite(w) && isFinite(r) && w > 0 && r > 0) {
      onEditSet(editingIndex, w, r);
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

      {sets.length > 0 && (
        <div className="set-log">
          {sets.map((s, i) =>
            editingIndex === i ? (
              <div key={i} className="set-row editing">
                <span className="set-num">Set {i + 1}</span>
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
                <button className="edit-confirm-btn" onClick={confirmEdit}>✓</button>
                <button className="edit-cancel-btn" onClick={cancelEdit}>✗</button>
              </div>
            ) : (
              <div key={i} className="set-row" onClick={() => startEdit(i)}>
                <span className="set-num">Set {i + 1}</span>
                <span className="set-weight">{s.weight} lbs</span>
                <span className="set-reps">{s.reps} reps</span>
                <button
                  className="delete-set-btn"
                  onClick={e => { e.stopPropagation(); onDeleteSet(i); }}
                  aria-label={`Delete set ${i + 1}`}
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
              placeholder="Reps"
              value={reps}
              onChange={e => setReps(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        {reps !== '' && (
          <button className="log-btn" disabled={!weight || !reps} onClick={handleLogSet}>
            Log Set {nextSetNum}
          </button>
        )}
      </div>

    </div>
  );
}
