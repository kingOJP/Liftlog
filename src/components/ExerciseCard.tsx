import { useState } from 'react';
import type { Exercise } from '../data/program';
import type { Difficulty } from '../db/database';
import './ExerciseCard.css';

interface Props {
  exercise: Exercise;
  sets: Array<{ weight: number; reps: number }>;
  difficulty: Difficulty | null;
  onLogSet: (weight: number, reps: number) => void;
  onDeleteSet: (index: number) => void;
  onRateDifficulty: (d: Difficulty) => void;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export default function ExerciseCard({ exercise, sets, difficulty, onLogSet, onDeleteSet, onRateDifficulty }: Props) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');

  const isDone = difficulty !== null;
  const targetLabel = `${exercise.sets} × ${exercise.repLow}–${exercise.repHigh}`;
  const nextSetNum = sets.length + 1;

  function handleLogSet() {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!isFinite(w) || !isFinite(r) || w <= 0 || r <= 0) return;
    onLogSet(w, r);
    setReps('');
    // Keep weight pre-filled for the next set
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleLogSet();
  }

  return (
    <div className={`exercise-card${isDone ? ' ex-done' : ''}`}>
      <div className="ex-header">
        <span className="ex-name">{exercise.name}</span>
        <span className="ex-target">{targetLabel}</span>
      </div>

      {sets.length > 0 && (
        <div className="set-log">
          {sets.map((s, i) => (
            <div key={i} className="set-row">
              <span className="set-num">Set {i + 1}</span>
              <span className="set-weight">{s.weight} lbs</span>
              <span className="set-reps">{s.reps} reps</span>
              <button
                className="delete-set-btn"
                onClick={() => onDeleteSet(i)}
                aria-label={`Delete set ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!isDone && (
        <>
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
            <button
              className="log-btn"
              disabled={!weight || !reps}
              onClick={handleLogSet}
            >
              Log Set {nextSetNum}
            </button>
          </div>

          {sets.length > 0 && (
            <div className="difficulty-section">
              <span className="difficulty-label">How was that?</span>
              <div className="diff-buttons">
                {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                  <button
                    key={d}
                    className={`diff-btn diff-${d}`}
                    onClick={() => onRateDifficulty(d)}
                  >
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {isDone && (
        <div className="ex-done-row">
          <span className={`diff-badge diff-${difficulty}`}>{DIFFICULTY_LABELS[difficulty]}</span>
          <span className="ex-done-sets">{sets.length} set{sets.length !== 1 ? 's' : ''} logged</span>
        </div>
      )}
    </div>
  );
}
