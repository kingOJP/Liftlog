import { useState, useEffect, useRef } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekNumberForDate } from '../data/program';
import { computeProgramPlan, applyPlanToDay } from '../data/coach';
import type { PlanChange } from '../data/coach';
import {
  createSession,
  completeSession,
  touchSession,
  addSetLog,
  getSetLogsForSession,
  deleteSetLogsForSession,
  getSession,
  updateSessionDate,
} from '../db/database';
import { loadTrainingSnapshot, sessionTimestamp } from '../data/analytics';
import { calculateRecommendation } from '../data/recommendations';
import type { WeightRec, ExerciseSession } from '../data/recommendations';
import { getExerciseMeta } from '../data/exercises';
import { getActivePhase } from '../data/planStore';
import { PHASE_INFO } from '../data/plan';
import { snapshotPositions } from '../data/progress';
import { getResumableDraft, saveDraftSession, clearDraftSession, draftHasSets } from '../data/draftSession';
import ExerciseCard from './ExerciseCard';
import RestTimer from './RestTimer';
import ShareWorkoutModal from './ShareWorkoutModal';
import './WorkoutView.css';

interface Props {
  day: WorkoutDay;
  /** Full program — the coach plans volume holistically across every day */
  program: WorkoutDay[];
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

export default function WorkoutView({ day, program, existingSessionId, onBack, onComplete }: Props) {
  const isEditMode = existingSessionId !== undefined;
  // The training-block phase governing this week — planned deload/recovery
  // weeks flip the engines into back-off mode. Editing history ignores phase.
  const [phase] = useState(() => (existingSessionId !== undefined ? null : getActivePhase()));
  // An interrupted workout (app killed mid-session) left a draft behind —
  // restore it so no logged set is ever lost. Edit mode never drafts.
  const [restoredDraft, setRestoredDraft] = useState(() =>
    isEditMode ? null : getResumableDraft(day.id),
  );
  const [sets, setSets] = useState<Record<string, SetEntry[]>>(() => restoredDraft?.sets ?? {});
  // Exercise ids in the order they were first trained this session — stored on
  // every set log so the progress engine can tell "benched 4th" from
  // "benched 1st" when reading trends.
  const exerciseOrderRef = useRef<string[]>(restoredDraft?.order ?? []);
  const [recommendations, setRecommendations] = useState<Record<string, WeightRec>>({});
  // Per exercise: the most recent session it appeared in (for the "last time" line)
  const [lastSessions, setLastSessions] = useState<Record<string, ExerciseSession>>({});
  // The day as the coach adjusted it (set counts), plus what changed and why
  const [effectiveDay, setEffectiveDay] = useState<WorkoutDay>(day);
  const [planChanges, setPlanChanges] = useState<PlanChange[]>([]);
  const [planDismissed, setPlanDismissed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Share-this-workout QR overlay (gym buddy scans it with their camera)
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  // Increments on every logged set to (re)start the rest timer. Edit mode skips it.
  const [restRunId, setRestRunId] = useState(0);
  // Duration tracking: the workout starts when the view opens (or when the
  // restored draft's workout originally started); the session ends at the
  // final logged set. completedAt − startedAt is the workout duration.
  const [sessionStart, setSessionStart] = useState(() => restoredDraft?.startedAt ?? Date.now());
  const lastSetAtRef = useRef<number | null>(null);
  // The finish bar only appears once the user has scrolled to the bottom of
  // the workout — it sits where "Log Set" muscle memory expects a button, so
  // keeping it off-screen mid-workout prevents accidental early saves.
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    const check = () => {
      const doc = document.documentElement;
      const scrollBottom = window.innerHeight + window.scrollY;
      setAtBottom(scrollBottom >= doc.scrollHeight - 24);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // Content height changes without a scroll event (sets logged, banners
  // dismissed, coach adjustments loaded) — re-check whether we're at the bottom.
  // Deferred to a frame so the measurement reads the committed layout (and so
  // it isn't a synchronous setState during the effect's commit).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const doc = document.documentElement;
      setAtBottom(window.innerHeight + window.scrollY >= doc.scrollHeight - 24);
    });
    return () => cancelAnimationFrame(raf);
  }, [sets, effectiveDay, planDismissed, restRunId, loading]);

  // Stamp the time of the most recent set activity — completedAt uses it so
  // the session duration reflects training time, not phone-in-hand time.
  const totalSets = Object.values(sets).reduce((sum, s) => sum + s.length, 0);
  useEffect(() => {
    if (totalSets > 0) lastSetAtRef.current = Date.now();
  }, [sets, totalSets]);

  // Persist the in-progress workout locally from the moment it starts (view
  // open) and on every set change, so an app kill or tab eviction can't lose
  // anything — not even the start time before the first set is logged.
  // Cleared at Finish (or when the draft is discarded).
  useEffect(() => {
    if (isEditMode) return;
    saveDraftSession({
      dayId: day.id, startedAt: sessionStart, savedAt: Date.now(), sets,
      order: exerciseOrderRef.current,
    });
  }, [sets, isEditMode, day.id, sessionStart]);

  function handleDiscardDraft() {
    clearDraftSession();
    setSets({});
    exerciseOrderRef.current = [];
    setSessionStart(Date.now());
    setRestoredDraft(null);
  }
  // Edit mode only: the session's original completedAt + the (editable) date.
  const [originalCompletedAt, setOriginalCompletedAt] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState('');
  const [maxDate] = useState(() => toDateInputValue(Date.now())); // can't re-date into the future

  // Build each exercise's recent history (across all days it appears in, not
  // just this one) to drive recommendations and the "last time" context line.
  // The coach's program plan is overlaid first so recommendations target the
  // adjusted set counts.
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    loadTrainingSnapshot().then(snapshot => {
      if (cancelled) return;

      const plan = computeProgramPlan(program, snapshot, Date.now(), phase);
      const adjusted = applyPlanToDay(day, plan);
      setEffectiveDay(adjusted);
      setPlanChanges(plan.days.get(day.id)?.changes ?? []);

      const recs: Record<string, WeightRec> = {};
      const lasts: Record<string, ExerciseSession> = {};
      // Where each exercise sat within each past workout — freshness context
      // for the recommendation engine.
      const positions = snapshotPositions(snapshot);

      for (const ex of adjusted.exercises) {
        const history: ExerciseSession[] = [];
        for (const session of snapshot.sessions) { // newest first
          const exSets = (snapshot.setsBySession.get(session.id!) ?? [])
            .filter(s => s.exerciseId === ex.id)
            .sort((a, b) => a.setNumber - b.setNumber)
            .map(s => ({ weight: s.weight, reps: s.reps }));
          if (exSets.length > 0) {
            history.push({
              completedAt: sessionTimestamp(session),
              sets: exSets,
              position: positions.get(session.id!)?.get(ex.id) ?? null,
            });
          }
          if (history.length >= 4) break;
        }
        if (history.length === 0) continue;
        lasts[ex.id] = history[0];
        const rec = calculateRecommendation(history, ex, getExerciseMeta(ex.id).weightType, phase);
        if (rec != null) recs[ex.id] = rec;
      }
      setRecommendations(recs);
      setLastSessions(lasts);
    });
    return () => { cancelled = true; };
  }, [day, program, isEditMode, phase]);

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
      // Preserve the session's original exercise order through the rewrite
      exerciseOrderRef.current = Object.keys(groupedSets);
      setLoading(false);
    });
  }, [existingSessionId]);

  function handleLogSet(exerciseId: string, weight: number, reps: number) {
    if (!exerciseOrderRef.current.includes(exerciseId)) {
      exerciseOrderRef.current = [...exerciseOrderRef.current, exerciseId];
    }
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

    const startedAt = sessionStart;
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
      const orderIdx = exerciseOrderRef.current.indexOf(exerciseId);
      const order = orderIdx >= 0 ? orderIdx : undefined;
      for (let i = 0; i < exerciseSets.length; i++) {
        await addSetLog(sid, exerciseId, i + 1, exerciseSets[i].weight, exerciseSets[i].reps, order);
      }
    }

    if (isEditMode) {
      // Mark the session as freshly edited so merge sync propagates this copy
      await touchSession(sid);
    } else {
      // The session ends at the final logged set, not the "Finish" tap — the
      // duration engine needs the training window, not phone-in-hand time.
      const completedAt = Math.max(lastSetAtRef.current ?? Date.now(), startedAt);
      await completeSession(sid, completedAt);
      clearDraftSession();
    }
    onComplete();
  }

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
        {!isEditMode && (
          <button
            className="workout-share-btn"
            onClick={() => setSharing(true)}
            aria-label="Share this workout"
          >
            ⇱
          </button>
        )}
      </header>

      {sharing && <ShareWorkoutModal day={day} onClose={() => setSharing(false)} />}

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
        {draftHasSets(restoredDraft) && (
          <div className="draft-banner">
            <span className="draft-banner-text">
              Restored your in-progress workout — keep logging or discard it
            </span>
            <button className="draft-banner-discard" onClick={handleDiscardDraft}>
              Discard
            </button>
          </div>
        )}
        {!isEditMode && (phase === 'deload' || phase === 'recovery') && (
          <div className="phase-banner">
            <span className="phase-banner-title">{PHASE_INFO[phase].label} week</span>
            <span className="phase-banner-detail">{PHASE_INFO[phase].blurb} — the lighter targets are the plan working, not you slacking.</span>
          </div>
        )}
        {!isEditMode && planChanges.length > 0 && !planDismissed && (
          <div className="coach-plan-banner">
            <div className="coach-plan-head">
              <span className="coach-plan-title">Coach adjusted today's workout</span>
              <button
                className="coach-plan-dismiss"
                onClick={() => setPlanDismissed(true)}
                aria-label="Dismiss coach adjustments"
              >
                ×
              </button>
            </div>
            {planChanges.map(c => (
              <div className="coach-plan-change" key={c.exerciseId}>
                <span className="coach-plan-what">
                  {c.exerciseName}: {c.fromSets} → {c.toSets} sets
                </span>
                <span className="coach-plan-why">{c.reason}</span>
              </div>
            ))}
          </div>
        )}
        {effectiveDay.exercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sets={sets[ex.id] ?? []}
            recommendation={recommendations[ex.id]}
            lastSession={lastSessions[ex.id]}
            onLogSet={(w, r) => handleLogSet(ex.id, w, r)}
            onEditSet={(i, w, r) => handleEditSet(ex.id, i, w, r)}
            onDeleteSet={i => handleDeleteSet(ex.id, i)}
          />
        ))}
      </div>

      {!isEditMode && <RestTimer runId={restRunId} onDismiss={() => setRestRunId(0)} />}

      <div className={`finish-bar${atBottom ? '' : ' finish-bar--hidden'}`}>
        <button
          className="finish-btn"
          tabIndex={atBottom ? 0 : -1}
          disabled={totalSets === 0 || finishing}
          onClick={handleFinish}
        >
          {finishing ? 'Saving…' : isEditMode ? 'Save Changes' : 'Finish Workout'}
        </button>
      </div>
    </div>
  );
}
