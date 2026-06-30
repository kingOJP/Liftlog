import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekNumberForDate } from '../data/program';
import {
  createSession,
  completeSession,
  addSetLog,
  getSetLogsForSession,
  deleteSetLogsForSession,
  getLastCompletedSessionForDay,
  getSession,
  updateSessionDate,
} from '../db/database';
import { calculateRecommendation } from '../data/recommendations';
import type { WeightRec } from '../data/recommendations';
import { savePendingSession } from '../data/pendingSessions';
import ExerciseCard from './ExerciseCard';
import RestTimer from './RestTimer';
import './WorkoutView.css';

interface Props {
  day: WorkoutDay;
  existingSessionId?: number;
  onBack: () => void;
  onComplete: () => void;
}

type SetEntry = { weight: number; reps: number };

// Local-time yyyy-mm-dd for an <input type="date"> value
function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Combine a yyyy-mm-dd value with the original session's time-of-day, so re-dating
// a workout keeps its clock time (and within-day ordering) intact.
function dateInputToTimestamp(value: string, originalTs: number): number {
  const [y, m, d] = value.split('-').map(Number);
  const orig = new Date(originalTs);
  return new Date(
    y, m - 1, d,
    orig.getHours(), orig.getMinutes(), orig.getSeconds(), orig.getMilliseconds(),
  ).getTime();
}

export default function WorkoutView({ day, existingSessionId, onBack, onComplete }: Props) {
  const isEditMode = existingSessionId !== undefined;
  const [sets, setSets] = useState<Record<string, SetEntry[]>>({});
  const [recommendations, setRecommendations] = useState<Record<string, WeightRec>>({});
  const [finishing, setFinishing] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  // Increments on every logged set to (re)start the rest timer. Edit mode skips it.
  const [restRunId, setRestRunId] = useState(0);
  // Edit mode only: the session's original completedAt + the (editable) date.
  const [originalCompletedAt, setOriginalCompletedAt] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState('');
  const [maxDate] = useState(() => toDateInputValue(Date.now())); // can't re-date into the future

  useEffect(() => {
    if (isEditMode) return;
    getLastCompletedSessionForDay(day.id).then(async session => {
      if (!session?.id) return;
      const setLogs = await getSetLogsForSession(session.id);
      const recs: Record<string, WeightRec> = {};
      for (const ex of day.exercises) {
        const exSets = setLogs.filter(s => s.exerciseId === ex.id);
        const rec = calculateRecommendation(exSets, ex);
        if (rec != null) recs[ex.id] = rec;
      }
      setRecommendations(recs);
    });
  }, [day.id, isEditMode]);

  useEffect(() => {
    if (!existingSessionId) return;
    getSession(existingSessionId).then(session => {
      const ts = session?.completedAt ?? session?.startedAt ?? Date.now();
      setOriginalCompletedAt(ts);
      setDateInput(toDateInputValue(ts));
    });
    getSetLogsForSession(existingSessionId).then(setLogs => {
      const groupedSets: Record<string, SetEntry[]> = {};
      for (const sl of setLogs) {
        (groupedSets[sl.exerciseId] ??= []).push({ weight: sl.weight, reps: sl.reps });
      }
      setSets(groupedSets);
      setLoading(false);
    });
  }, [existingSessionId]);

  function handleLogSet(exerciseId: string, weight: number, reps: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: [...(prev[exerciseId] ?? []), { weight, reps }],
    }));
    if (!isEditMode) setRestRunId(id => id + 1);
  }

  function handleEditSet(exerciseId: string, index: number, weight: number, reps: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: (prev[exerciseId] ?? []).map((s, i) =>
        i === index ? { weight, reps } : s
      ),
    }));
  }

  function handleDeleteSet(exerciseId: string, index: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: (prev[exerciseId] ?? []).filter((_, i) => i !== index),
    }));
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);

    const startedAt = Date.now();
    const sid = isEditMode
      ? existingSessionId
      : await createSession(day.id, getWeekNumber(), startedAt);

    if (isEditMode) {
      await deleteSetLogsForSession(sid);
      // Persist a re-dated session if the date was changed
      if (dateInput && originalCompletedAt != null) {
        const newCompletedAt = dateInputToTimestamp(dateInput, originalCompletedAt);
        if (newCompletedAt !== originalCompletedAt) {
          await updateSessionDate(sid, newCompletedAt, getWeekNumberForDate(new Date(newCompletedAt)));
        }
      }
    }

    for (const [exerciseId, exerciseSets] of Object.entries(sets)) {
      for (let i = 0; i < exerciseSets.length; i++) {
        await addSetLog(sid, exerciseId, i + 1, exerciseSets[i].weight, exerciseSets[i].reps);
      }
    }

    if (!isEditMode) {
      const completedAt = Date.now();
      await completeSession(sid, completedAt);
      savePendingSession({
        startedAt,
        completedAt,
        dayId: day.id,
        weekNumber: getWeekNumber(),
        setLogs: Object.entries(sets).flatMap(([exerciseId, exerciseSets]) =>
          exerciseSets.map((s, i) => ({ exerciseId, setNumber: i + 1, weight: s.weight, reps: s.reps }))
        ),
      });
    }
    onComplete();
  }

  const totalSets = Object.values(sets).reduce((sum, s) => sum + s.length, 0);

  if (loading) {
    return (
      <div className="workout-view">
        <header className="workout-header">
          <button className="back-btn" onClick={onBack}>&#8592;</button>
          <div className="workout-title">
            <span className="workout-day-label">{day.label}</span>
            <span className="workout-muscles">{day.muscleGroups}</span>
          </div>
        </header>
        <div className="workout-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="workout-view">
      <header className="workout-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="workout-title">
          <span className="workout-day-label">{day.label}</span>
          <span className="workout-muscles">{day.muscleGroups}</span>
        </div>
      </header>

      <div
        className="exercise-list"
        style={restRunId > 0 ? { paddingBottom: 'calc(160px + env(safe-area-inset-bottom))' } : undefined}
      >
        {isEditMode && dateInput && (
          <div className="workout-date-field">
            <label className="workout-date-label" htmlFor="workout-date">Workout date</label>
            <input
              id="workout-date"
              className="workout-date-input"
              type="date"
              value={dateInput}
              max={maxDate}
              onChange={e => setDateInput(e.target.value)}
            />
          </div>
        )}
        {day.exercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sets={sets[ex.id] ?? []}
            recommendation={recommendations[ex.id]}
            onLogSet={(w, r) => handleLogSet(ex.id, w, r)}
            onEditSet={(i, w, r) => handleEditSet(ex.id, i, w, r)}
            onDeleteSet={i => handleDeleteSet(ex.id, i)}
          />
        ))}
      </div>

      {!isEditMode && <RestTimer runId={restRunId} onDismiss={() => setRestRunId(0)} />}

      <div className="finish-bar">
        <button
          className="finish-btn"
          disabled={totalSets === 0 || finishing}
          onClick={handleFinish}
        >
          {finishing ? 'Saving…' : isEditMode ? 'Save Changes' : 'Finish Workout'}
        </button>
      </div>
    </div>
  );
}
