import { useState } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber } from '../data/program';
import {
  createSession,
  completeSession,
  addSetLog,
  saveExerciseDifficulty,
} from '../db/database';
import type { Difficulty } from '../db/database';
import ExerciseCard from './ExerciseCard';
import './WorkoutView.css';

interface Props {
  day: WorkoutDay;
  onBack: () => void;
  onComplete: () => void;
}

type SetEntry = { weight: number; reps: number };

export default function WorkoutView({ day, onBack, onComplete }: Props) {
  const [sets, setSets] = useState<Record<string, SetEntry[]>>({});
  const [difficulties, setDifficulties] = useState<Record<string, Difficulty>>({});
  const [finishing, setFinishing] = useState(false);

  function handleLogSet(exerciseId: string, weight: number, reps: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: [...(prev[exerciseId] ?? []), { weight, reps }],
    }));
  }

  function handleDeleteSet(exerciseId: string, index: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: (prev[exerciseId] ?? []).filter((_, i) => i !== index),
    }));
  }

  function handleRateDifficulty(exerciseId: string, difficulty: Difficulty) {
    setDifficulties(prev => ({ ...prev, [exerciseId]: difficulty }));
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);

    const sid = await createSession(day.id, getWeekNumber());

    for (const [exerciseId, exerciseSets] of Object.entries(sets)) {
      for (let i = 0; i < exerciseSets.length; i++) {
        await addSetLog(sid, exerciseId, i + 1, exerciseSets[i].weight, exerciseSets[i].reps);
      }
    }

    for (const [exerciseId, difficulty] of Object.entries(difficulties)) {
      await saveExerciseDifficulty(sid, exerciseId, difficulty);
    }

    await completeSession(sid);
    onComplete();
  }

  const totalSets = Object.values(sets).reduce((sum, s) => sum + s.length, 0);

  return (
    <div className="workout-view">
      <header className="workout-header">
        <button className="back-btn" onClick={onBack} aria-label="Back to dashboard">
          &#8592;
        </button>
        <div className="workout-title">
          <span className="workout-day-label">{day.label}</span>
          <span className="workout-muscles">{day.muscleGroups}</span>
        </div>
      </header>

      <div className="exercise-list">
        {day.exercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sets={sets[ex.id] ?? []}
            difficulty={difficulties[ex.id] ?? null}
            onLogSet={(w, r) => handleLogSet(ex.id, w, r)}
            onDeleteSet={(i) => handleDeleteSet(ex.id, i)}
            onRateDifficulty={(d) => handleRateDifficulty(ex.id, d)}
          />
        ))}
      </div>

      <div className="finish-bar">
        <button
          className="finish-btn"
          disabled={totalSets === 0 || finishing}
          onClick={handleFinish}
        >
          {finishing ? 'Saving…' : 'Finish Workout'}
        </button>
      </div>
    </div>
  );
}
