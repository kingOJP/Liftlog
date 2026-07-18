import { useState, useMemo } from 'react';
import type { Exercise, WorkoutDay } from '../data/program';
import {
  QUICK_DAY_ID, buildQuickWorkoutDay, buildQuickDayFromDraft, getResumableQuickDraft,
} from '../data/quickWorkout';
import { clearDraftForDay } from '../data/draftSession';
import AddExercisePanel from './AddExercisePanel';
import './DayEditView.css';
import './QuickWorkoutView.css';

interface Props {
  onBack: () => void;
  onStart: (day: WorkoutDay) => void;
}

// "5 sets across 2 exercises · started 3h ago"
function draftSummary(draft: { startedAt: number; sets: Record<string, unknown[]> }): string {
  const groups = Object.values(draft.sets).filter(s => s.length > 0);
  const sets = groups.reduce((n, s) => n + s.length, 0);
  const mins = Math.max(1, Math.floor((Date.now() - draft.startedAt) / 60_000));
  const age = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  return `${sets} set${sets === 1 ? '' : 's'} across ${groups.length} exercise${groups.length === 1 ? '' : 's'} · started ${age}`;
}

// Build a one-off workout by picking exercises, then log it like any other
// session — no training plan or block required. The exercises join the library
// (AddExercisePanel resolves typed names to existing identities) so history
// and metrics resolve them.
export default function QuickWorkoutView({ onBack, onStart }: Props) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  // An interrupted quick workout (app killed mid-session) left a draft with
  // logged sets behind. All quick workouts share one dayId, so the draft can't
  // auto-restore safely — offer the choice instead: resume it, or start fresh
  // (which discards it so its sets can't merge into the new session).
  const [resumable, setResumable] = useState(() => getResumableQuickDraft());

  const chosenIds = useMemo(() => new Set(exercises.map(e => e.id)), [exercises]);

  function handleRemove(id: string) {
    setExercises(prev => prev.filter(e => e.id !== id));
  }

  function handleResume() {
    if (!resumable) return;
    onStart(buildQuickDayFromDraft(resumable)); // WorkoutView restores the sets
  }

  function handleDiscardDraft() {
    clearDraftForDay(QUICK_DAY_ID);
    setResumable(null);
  }

  function handleStart() {
    if (exercises.length === 0) return;
    // Starting fresh: a leftover quick draft must not restore into (and merge
    // stale sets with) this new session.
    clearDraftForDay(QUICK_DAY_ID);
    onStart(buildQuickWorkoutDay(exercises));
  }

  return (
    <div className="day-edit-view">
      <header className="day-edit-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="day-edit-title">
          <span className="day-edit-label">One-off session</span>
          <span className="day-edit-heading">Quick Workout</span>
        </div>
      </header>

      <div className="day-edit-body">
        {resumable && (
          <div className="quick-resume-card">
            <span className="quick-resume-title">Resume your unfinished quick workout?</span>
            <span className="quick-resume-detail">{draftSummary(resumable)}</span>
            <div className="quick-resume-actions">
              <button className="quick-resume-btn" onClick={handleResume}>
                Resume workout
              </button>
              <button className="quick-resume-discard" onClick={handleDiscardDraft}>
                Discard it
              </button>
            </div>
          </div>
        )}
        <p className="quick-intro">
          Log a workout right now — no plan needed. Add the exercises you’re doing, then start.
          It’s saved to your history and metrics, but won’t change your program.
        </p>

        <section className="day-edit-section">
          <span className="day-edit-field-label">Exercises</span>
          <div className="exercise-edit-list">
            {exercises.map(ex => (
              <div key={ex.id} className="exercise-edit-item">
                <div className="exercise-edit-row">
                  <div className="exercise-edit-info">
                    <span className="exercise-edit-name">{ex.name}</span>
                    <span className="exercise-edit-meta">{ex.sets} sets · {ex.repLow}–{ex.repHigh} reps</span>
                  </div>
                  <button
                    className="exercise-remove-btn"
                    onClick={() => handleRemove(ex.id)}
                    aria-label={`Remove ${ex.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {exercises.length === 0 && (
              <p className="exercise-edit-empty">No exercises yet — search or create one below.</p>
            )}
          </div>

          <AddExercisePanel
            excludeIds={chosenIds}
            confirmLabel="Add"
            persistent
            onAdd={ex => setExercises(prev => [...prev, ex])}
          />
        </section>
      </div>

      <div className="day-edit-footer">
        <button className="day-edit-save-btn" onClick={handleStart} disabled={exercises.length === 0}>
          {exercises.length === 0 ? 'Add an exercise to start' : `Start Workout · ${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
