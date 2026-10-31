import { useMemo, useState } from 'react';
import { getExerciseLibrary } from '../data/programStore';
import { getExerciseMeta } from '../data/exercises';
import { filterExercises } from '../data/search';
import './ExerciseListView.css';

interface Props {
  onBack: () => void;
  onSelectExercise: (exerciseId: string, exerciseName: string) => void;
}

export default function ExerciseListView({ onBack, onSelectExercise }: Props) {
  const [query, setQuery] = useState('');
  const exercises = useMemo(
    () => getExerciseLibrary().filter(e => !e.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  // Same matcher as the add-exercise picker, so the two never disagree.
  const shown = useMemo(() => filterExercises(exercises, query), [exercises, query]);

  return (
    <div className="exercise-list-view">
      <header className="exercise-list-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <span className="exercise-list-title">Exercises</span>
      </header>
      <div className="exercise-list-search">
        <input
          className="exercise-list-search-input"
          type="search"
          placeholder={`Search ${exercises.length} exercises…`}
          aria-label="Search exercises"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="exercise-list-body">
        {shown.map(ex => {
          const muscle = getExerciseMeta(ex.id).primaryMuscle;
          return (
            <button
              key={ex.id}
              className="exercise-list-row"
              onClick={() => onSelectExercise(ex.id, ex.name)}
            >
              <span className="exercise-list-text">
                <span className="exercise-list-name">{ex.name}</span>
                {muscle && <span className="exercise-list-muscle">{muscle}</span>}
              </span>
              <span className="exercise-list-chevron">›</span>
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="exercise-list-empty">No exercise matches “{query.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
