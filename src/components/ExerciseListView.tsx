import { useMemo } from 'react';
import { getExerciseLibrary } from '../data/programStore';
import './ExerciseListView.css';

interface Props {
  onBack: () => void;
  onSelectExercise: (exerciseId: string, exerciseName: string) => void;
}

export default function ExerciseListView({ onBack, onSelectExercise }: Props) {
  const exercises = useMemo(
    () => getExerciseLibrary().filter(e => !e.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  return (
    <div className="exercise-list-view">
      <header className="exercise-list-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <span className="exercise-list-title">Exercises</span>
      </header>
      <div className="exercise-list-body">
        {exercises.map(ex => (
          <button
            key={ex.id}
            className="exercise-list-row"
            onClick={() => onSelectExercise(ex.id, ex.name)}
          >
            <span className="exercise-list-name">{ex.name}</span>
            <span className="exercise-list-chevron">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
