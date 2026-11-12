import { useState, useEffect, useRef, useMemo } from 'react';
import { useWakeLock } from '../data/wakeLock';
import { haptic } from '../data/native';
import type { WorkoutDay, Exercise } from '../data/program';
import { getWeekNumber, getWeekNumberForDate, toLocalDateValue } from '../data/program';
import { computeProgramPlan, applyPlanToDay } from '../data/coach';
import type { PlanChange } from '../data/coach';
import {
  saveWorkout,
  rewriteSessionSets,
  getSetLogsForSession,
  getSession,
} from '../db/database';
import type { SetInput } from '../db/database';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { expectedVariation, exerciseHistory } from '../data/sessionHistory';
import type { SetVariation } from '../data/variations';
import { isExtension, variationLabel } from '../data/variations';
import { buildSetPlan, historyDepthFor, needsRegression } from '../data/recommendations';
import type { WeightRec, ExerciseSession, SetPlan, PrescriptionContext } from '../data/recommendations';
import { getExerciseMeta, unitFor } from '../data/exercises';
import { getActivePhase, getPhaseResolver, getProfileOrDefault, getTrainingGoal, getCoachDecisions, recordCoachDecision, getOneRepMax } from '../data/planStore';
import { effectiveExperience } from '../data/experience';
import { PHASE_INFO, isEasyPhase } from '../data/plan';
import { snapshotPositions } from '../data/progress';
import { getExerciseLibrary, getExerciseName } from '../data/programStore';
import { slotFor } from '../data/prescribe';
import { applyPhaseRanges, topSetScheme } from '../data/dosage';
import { suggestReplacements } from '../data/substitution';
import type { ReplacementSuggestion } from '../data/substitution';
import {
  getResumableDraft, saveDraftSession, clearDraftSession, draftHasSets, conflictingDraft, draftSetCount,
} from '../data/draftSession';
import type { DraftOrigin, DraftSession } from '../data/draftSession';
import ExerciseCard from './ExerciseCard';
import AddExercisePanel from './AddExercisePanel';
import RestTimer from './RestTimer';
import ShareWorkoutModal from './ShareWorkoutModal';
import ExerciseHistorySheet from './ExerciseHistorySheet';
import './WorkoutView.css';

interface Props {
  day: WorkoutDay;
  /** Full program — the coach plans volume holistically across every day */
  program: WorkoutDay[];
  existingSessionId?: number;
  /** where `day` came from — stored on the draft so a resume can re-open it */
  origin?: DraftOrigin;
  onBack: () => void;
  onComplete: () => void;
  /** the user chose to resume a different day's unfinished workout instead */
  onResumeDraft?: (draft: DraftSession) => void;
  /** open the Strength screen for a lift (the in-progress workout is drafted and restored on return) */
  onSetMax?: (exerciseId: string) => void;
}

/** One row of the in-progress log — what ExerciseCard emits and the draft stores. */
export type SetEntry = { weight: number; reps: number; warmup?: boolean } & SetVariation;

/** How many NUMBERED working sets a list holds — warm-ups and extension rows (drops etc.) don't count toward the plan. */
function numberedSets(list: SetEntry[] | undefined): number {
  return (list ?? []).filter(s => !s.warmup && !isExtension(s.technique)).length;
}

/** Drop the undefined/false optional fields so the draft and the save stay compact. */
function compactEntry(e: SetEntry): SetEntry {
  return {
    weight: e.weight, reps: e.reps,
    ...(e.warmup ? { warmup: true } : {}),
    ...(e.technique ? { technique: e.technique } : {}),
    ...(e.grip ? { grip: e.grip } : {}),
  };
}

// Local-time yyyy-mm-dd for an <input type="date"> value
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

// Build an Exercise for an id logged in the session but not part of the day's
// design. The prescription is resolved for the active plan (data/prescribe.ts),
// so an exercise added mid-workout is dosed like any other — and when there is
// nothing to dose it from, it carries no rep range rather than a made-up one.
function exerciseFromId(id: string, snapshot: TrainingSnapshot | null): Exercise {
  const name = getExerciseLibrary().find(e => e.id === id)?.name ?? getExerciseName(id);
  return slotFor(id, name, { snapshot });
}

// Per-set prescription + "last time" context for one exercise, from a snapshot.
// Every exercise gets a plan — one without history still prescribes the rep
// range, it just leaves the load for the lifter to pick.
function contextForExercise(
  ex: Exercise,
  snapshot: TrainingSnapshot,
  positions: ReturnType<typeof snapshotPositions>,
  ctx: PrescriptionContext,
): { plan: SetPlan; rec?: WeightRec; last?: ExerciseSession; history: ExerciseSession[]; oneRepMax?: number; variation: SetVariation } {
  // Enough sessions for the athlete's stall window plus a dropped late-slot
  // one — a flat cap of four switched stall detection off for advanced lifters.
  const depth = historyDepthFor(ctx.experience);
  // The way today's sets are expected to be done (the slot's prescription, or
  // last time's), and the sessions done that way — the engine compares like
  // with like, and extension rows (drops, partials) never reach it.
  const variation = expectedVariation(ex, snapshot);
  const { history, borrowed } = exerciseHistory(snapshot, ex.id, depth, positions, variation);
  const weightType = getExerciseMeta(ex.id).weightType;
  // A known 1RM anchors the load where the log can't: a first session, or a
  // max entered since the last one.
  const max = getOneRepMax(ex.id);
  const plan = buildSetPlan(history, ex, {
    ...ctx,
    weightType,
    // Timed holds are prescribed and progressed in seconds, not reps.
    unit: unitFor(ex.id),
    // A strength block's main lifts: one top set, judged, plus back-offs.
    scheme: topSetScheme(ex, ctx.goal, ctx.experience, weightType) ? 'top-set' : 'straight',
    oneRepMax: max ? { weight: max.weight, updatedAt: max.updatedAt } : null,
  });
  if (borrowed) {
    // Prescribed from sets done a different way — say so instead of letting the
    // number pose as earned under this style.
    plan.goal = `First time logging this ${variationLabel(variation)} — the load comes from your other sets, so expect fewer reps. ${plan.goal}`;
  }
  return { plan, last: history[0], rec: plan.rec ?? undefined, history, oneRepMax: max?.weight, variation };
}

export default function WorkoutView({
  day: dayProp, program: programProp, existingSessionId, origin = 'program', onBack, onComplete, onResumeDraft, onSetMax,
}: Props) {
  const isEditMode = existingSessionId !== undefined;
  // The day and program are FROZEN for the lifetime of the workout. A
  // background pull can replace the live program (a pending block starting, a
  // sync from another device) while a workout is open; the session being
  // logged must keep the exercises it started with — the user is holding a
  // dumbbell, not reading release notes. The coach overlay and prescriptions
  // are built from these snapshots too.
  const [day] = useState(dayProp);
  const [program] = useState(programProp);
  // The training-block phase governing this week — planned deload/recovery
  // weeks flip the engines into back-off mode. Editing history ignores phase.
  const [phase] = useState(() => (existingSessionId !== undefined ? null : getActivePhase()));
  // A draft with logged sets for a DIFFERENT day would be overwritten by this
  // workout's first draft save. Hold everything until the user decides.
  const [conflict, setConflict] = useState<DraftSession | null>(() =>
    isEditMode || !onResumeDraft ? null : conflictingDraft(dayProp.id),
  );
  // An interrupted workout (app killed mid-session) left a draft behind —
  // restore it so no logged set is ever lost. Edit mode never drafts.
  const [restoredDraft, setRestoredDraft] = useState(() =>
    isEditMode ? null : getResumableDraft(dayProp.id),
  );
  // A free-text note for the session ("how did it go?") — drafted with the
  // sets, saved on the session document, synced like anything else on it.
  const [note, setNote] = useState(() => restoredDraft?.note ?? '');
  // Per-exercise history sheet, opened from a card's "Last time" line
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [sets, setSets] = useState<Record<string, SetEntry[]>>(() => restoredDraft?.sets ?? {});
  // Exercise ids in the order they were first trained this session — stored on
  // every set log so the progress engine can tell "benched 4th" from
  // "benched 1st" when reading trends.
  const exerciseOrderRef = useRef<string[]>(restoredDraft?.order ?? []);
  // Exercises added on the fly during the workout (or, in edit mode, ones the
  // logged session has that the day's design no longer lists). They're appended
  // after the day's exercises and logged like any other. Restored from a draft.
  const [addedExercises, setAddedExercises] = useState<Exercise[]>(() => {
    if (isEditMode || !restoredDraft) return [];
    if (restoredDraft.added) return restoredDraft.added;
    const dayIds = new Set(day.exercises.map(e => e.id));
    return Object.keys(restoredDraft.sets).filter(id => !dayIds.has(id)).map(id => exerciseFromId(id, null));
  });
  const [showAddPanel, setShowAddPanel] = useState(false);
  // The exercise being worked on — the one card that's open. Everything else
  // collapses to a one-line status so a whole session fits on a screen. Starts
  // on the first exercise with nothing logged (a restored draft resumes where
  // it left off).
  const [activeId, setActiveId] = useState<string | null>(() => {
    const logged = restoredDraft?.sets ?? {};
    const open = day.exercises.find(e => numberedSets(logged[e.id]) < e.sets);
    return (open ?? day.exercises[0])?.id ?? null;
  });
  // The note field is out of the way until there's something to say.
  const [noteOpen, setNoteOpen] = useState(() => !!restoredDraft?.note);
  // The loaded snapshot — kept so context for a mid-workout exercise can be
  // computed without another IndexedDB read.
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  // The day as the coach adjusted it (set counts), plus what changed and why
  const [effectiveDay, setEffectiveDay] = useState<WorkoutDay>(day);
  const [planChanges, setPlanChanges] = useState<PlanChange[]>([]);
  const [planDismissed, setPlanDismissed] = useState(false);
  // The user's standing answers to this block's coach adjustments. Accepted
  // ones keep applying quietly; declined ones are no longer proposed.
  const [coachDecisions, setCoachDecisions] = useState(() => (isEditMode ? [] : getCoachDecisions()));
  const [finishing, setFinishing] = useState(false);
  // A failed save (IndexedDB quota, a thrown error) is shown, not swallowed —
  // the button comes back and the draft is kept until the save succeeds.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Share-this-workout QR overlay (gym buddy scans it with their camera)
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  // Increments on every logged set to (re)start the rest timer. Edit mode skips it.
  const [restRunId, setRestRunId] = useState(0);
  // Keep the screen on while logging a live workout (not while editing history)
  useWakeLock(!isEditMode);
  // Duration tracking: the workout starts when the view opens (or when the
  // restored draft's workout originally started); the session ends at the
  // final logged set. completedAt − startedAt is the workout duration.
  const [sessionStart, setSessionStart] = useState(() => restoredDraft?.startedAt ?? Date.now());
  const lastSetAtRef = useRef<number | null>(null);
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
    if (isEditMode || conflict) return;
    saveDraftSession({
      dayId: day.id, startedAt: sessionStart, savedAt: Date.now(), sets,
      order: exerciseOrderRef.current,
      day, origin, added: addedExercises,
      ...(note ? { note } : {}),
    });
  }, [sets, isEditMode, day, origin, sessionStart, conflict, addedExercises, note]);

  // Leaving a workout with logged sets: nothing is lost (the draft persists
  // and the Dashboard offers to resume it), but an accidental Back tap
  // shouldn't silently end a session either.
  function handleBack() {
    if (!isEditMode && totalSets > 0) {
      const ok = window.confirm(
        `Leave this workout? Your ${totalSets} logged set${totalSets === 1 ? '' : 's'} are saved — you can resume from the dashboard.`,
      );
      if (!ok) return;
    }
    onBack();
  }

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
  const [maxDate] = useState(() => toLocalDateValue(Date.now())); // can't re-date into the future

  // Load the snapshot once and overlay the coach's program plan (adjusted set
  // counts). The snapshot is kept in state so a mid-workout exercise can be
  // given the same context without another read.
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    loadTrainingSnapshot().then(snap => {
      if (cancelled) return;
      setSnapshot(snap);
      const plan = computeProgramPlan(
        program, snap, Date.now(), phase, getTrainingGoal(), getPhaseResolver(),
        getProfileOrDefault().experience, coachDecisions,
      );
      // The coach's set counts, then this week's rep ranges: a strength
      // block's main lifts tighten as the block advances (dosage.phaseRange).
      const adjusted = applyPhaseRanges(applyPlanToDay(day, plan), getTrainingGoal(), phase);
      setEffectiveDay(adjusted);
      setPlanChanges(plan.days.get(day.id)?.changes ?? []);
    });
    return () => { cancelled = true; };
  }, [day, program, isEditMode, phase, coachDecisions]);

  function decideCoachChange(key: string, accepted: boolean) {
    recordCoachDecision(key, accepted);
    setCoachDecisions(getCoachDecisions());
  }
  // Changes still awaiting an answer are what the banner shows
  const openChanges = planChanges.filter(c => !coachDecisions.some(d => d.key === c.key));

  // Recommendations + "last time" context for every rendered exercise (the
  // day's plus any added mid-workout), derived from the snapshot. Recomputes
  // when an exercise is added so a newcomer gets its history-driven rec too.
  const { recommendations, lastSessions, setPlans, regressions, maxes, variations } = useMemo(() => {
    const recs: Record<string, WeightRec> = {};
    const lasts: Record<string, ExerciseSession> = {};
    const plans: Record<string, SetPlan> = {};
    const easier: Record<string, ReplacementSuggestion> = {};
    const maxes: Record<string, number> = {};
    const variations: Record<string, SetVariation> = {};
    if (snapshot) {
      const positions = snapshotPositions(snapshot);
      // The prescription reads the athlete as well as the lift: the plan's goal
      // decides how stalls and misses are handled, and the effective training
      // age (self-report vs what the log shows) sets the weekly climb rate.
      const ctx: PrescriptionContext = {
        phase,
        goal: getTrainingGoal(),
        experience: effectiveExperience(getProfileOrDefault(), snapshot),
        phaseOf: getPhaseResolver(),
      };
      const present = new Set([...effectiveDay.exercises, ...addedExercises].map(e => e.id));
      for (const ex of [...effectiveDay.exercises, ...addedExercises]) {
        const { plan, rec, last, history, oneRepMax, variation } = contextForExercise(ex, snapshot, positions, ctx);
        plans[ex.id] = plan;
        variations[ex.id] = variation;
        if (last) lasts[ex.id] = last;
        if (rec) recs[ex.id] = rec;
        if (oneRepMax) maxes[ex.id] = oneRepMax;
        // Three sessions under the range on unloaded work: offer an easier
        // way to train the same muscle (audit F11) — unless it's already here.
        if (!isEditMode && needsRegression(history, ex)) {
          const [best] = suggestReplacements(ex, effectiveDay, snapshot, 1, sessionStart, ctx.goal, { regression: true });
          if (best && !present.has(best.exercise.id)) easier[ex.id] = best;
        }
      }
    }
    return { recommendations: recs, lastSessions: lasts, setPlans: plans, regressions: easier, maxes, variations };
  }, [snapshot, effectiveDay, addedExercises, phase, isEditMode, sessionStart]);

  useEffect(() => {
    if (!existingSessionId) return;
    getSession(existingSessionId).then(session => {
      const ts = session?.completedAt ?? session?.startedAt ?? Date.now();
      setOriginalCompletedAt(ts);
      setDateInput(toLocalDateValue(ts));
      setNote(session?.note ?? '');
      if (session?.note) setNoteOpen(true);
    });
    getSetLogsForSession(existingSessionId).then(setLogs => {
      const groupedSets: Record<string, SetEntry[]> = {};
      for (const sl of setLogs) {
        (groupedSets[sl.exerciseId] ??= []).push(compactEntry({
          weight: sl.weight, reps: sl.reps, warmup: sl.warmup, technique: sl.technique, grip: sl.grip,
        }));
      }
      setSets(groupedSets);
      // Preserve the session's original exercise order through the rewrite
      exerciseOrderRef.current = Object.keys(groupedSets);
      // Any logged exercise the day's design no longer lists still needs to
      // render (and stay editable) — surface it as an "added" exercise.
      const dayIds = new Set(day.exercises.map(e => e.id));
      const extras = Object.keys(groupedSets).filter(id => !dayIds.has(id));
      if (extras.length > 0) setAddedExercises(extras.map(id => exerciseFromId(id, null)));
      setLoading(false);
    });
    // `day` is frozen state, so this runs exactly once per session being
    // edited — it used to re-run on every program refresh and wipe the edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSessionId]);

  function handleLogSet(exerciseId: string, entry: SetEntry) {
    if (!exerciseOrderRef.current.includes(exerciseId)) {
      exerciseOrderRef.current = [...exerciseOrderRef.current, exerciseId];
    }
    setSets(prev => ({
      ...prev,
      [exerciseId]: [...(prev[exerciseId] ?? []), compactEntry(entry)],
    }));
    // Warm-up sets don't start the rest timer — you're not resting between them.
    // (A drop or rest-pause row does: it's logged once the extended set is over.)
    if (!isEditMode) haptic('light');
    if (!isEditMode && !entry.warmup) setRestRunId(id => id + 1);
    // That was the last prescribed set: move on to the next unfinished
    // exercise so the lifter is looking at what comes next while they rest.
    // The finished card stays a tap away for an extra set, a drop or an edit.
    // Only a NUMBERED working set counts toward the plan — a warm-up or an
    // extension row (drop / rest-pause / partials) never advances.
    const counts = !entry.warmup && !isExtension(entry.technique);
    const plan = setPlans[exerciseId];
    const working = numberedSets(sets[exerciseId]) + (counts ? 1 : 0);
    if (counts && plan && working >= plan.sets.length) advanceFrom(exerciseId);
  }

  // Open the next exercise (after this one, then wrapping round) that still
  // has prescribed sets to log; stay put when everything is done.
  function advanceFrom(exerciseId: string) {
    const order = [...effectiveDay.exercises, ...addedExercises].map(e => e.id);
    const from = order.indexOf(exerciseId);
    const incomplete = (id: string) => {
      const plan = setPlans[id];
      if (!plan) return false;
      const working = numberedSets(sets[id]) + (id === exerciseId ? 1 : 0);
      return working < plan.sets.length;
    };
    const next = [...order.slice(from + 1), ...order.slice(0, from)].find(incomplete);
    if (!next) return;
    setActiveId(next);
    requestAnimationFrame(() => {
      document.querySelector(`[data-exercise-id="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function handleEditSet(exerciseId: string, index: number, entry: SetEntry) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: (prev[exerciseId] ?? []).map((s, i) => (i === index ? compactEntry(entry) : s)),
    }));
  }

  function handleDeleteSet(exerciseId: string, index: number) {
    setSets(prev => ({
      ...prev,
      [exerciseId]: (prev[exerciseId] ?? []).filter((_, i) => i !== index),
    }));
  }

  // Append an exercise picked mid-workout. Its identity/library membership is
  // already settled by AddExercisePanel; here we just render it (deduped) and
  // the context effect gives it a recommendation.
  function handleAddExercise(ex: Exercise) {
    setShowAddPanel(false);
    const present = new Set([...effectiveDay.exercises, ...addedExercises].map(e => e.id));
    if (present.has(ex.id)) return;
    setAddedExercises(prev => [...prev, ex]);
    setActiveId(ex.id);
  }

  // Remove a mid-workout exercise (and any sets logged under it). Only exercises
  // added this session are removable here — the day's own exercises are edited
  // from the day editor.
  function handleRemoveAdded(exerciseId: string) {
    setAddedExercises(prev => prev.filter(e => e.id !== exerciseId));
    setSets(prev => {
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });
    exerciseOrderRef.current = exerciseOrderRef.current.filter(id => id !== exerciseId);
    setActiveId(prev => (prev === exerciseId ? null : prev));
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    setSaveError(null);

    const startedAt = sessionStart;
    const setInputs: SetInput[] = [];
    // The prescription in force is recorded on every set, so a later range
    // change can be told apart from a missed session.
    const slots = new Map([...effectiveDay.exercises, ...addedExercises].map(e => [e.id, e]));
    for (const [exerciseId, exerciseSets] of Object.entries(sets)) {
      const orderIdx = exerciseOrderRef.current.indexOf(exerciseId);
      const order = orderIdx >= 0 ? orderIdx : undefined;
      const slot = slots.get(exerciseId);
      const range = slot?.repLow != null && slot.repHigh != null ? { repLow: slot.repLow, repHigh: slot.repHigh } : {};
      exerciseSets.forEach((set, i) => {
        setInputs.push({
          exerciseId, setNumber: i + 1, weight: set.weight, reps: set.reps, order,
          ...(set.warmup ? { warmup: true } : {}),
          ...(set.technique ? { technique: set.technique } : {}),
          ...(set.grip ? { grip: set.grip } : {}),
          ...range,
        });
      });
    }

    try {
      if (isEditMode) {
        // Old logs out, new logs in, updatedAt bumped — one transaction, so an
        // interruption can never leave the session empty (and purge-able).
        let redate: { completedAt: number; weekNumber: number } | undefined;
        if (dateInput && originalCompletedAt != null) {
          const newCompletedAt = dateInputToTimestamp(dateInput, originalCompletedAt);
          if (Number.isFinite(newCompletedAt) && newCompletedAt !== originalCompletedAt) {
            redate = { completedAt: newCompletedAt, weekNumber: getWeekNumberForDate(new Date(newCompletedAt)) };
          }
        }
        await rewriteSessionSets(existingSessionId, setInputs, redate, note.trim() || null);
      } else {
        // The session ends at the final logged set, not the "Finish" tap — the
        // duration engine needs the training window, not phone-in-hand time.
        // Session row and sets land together: no window in which a ghost purge
        // could see (and tombstone) a workout with no sets.
        const completedAt = Math.max(lastSetAtRef.current ?? Date.now(), startedAt);
        await saveWorkout({ dayId: day.id, weekNumber: getWeekNumber(), startedAt, completedAt, sets: setInputs, note: note.trim() || undefined });
        clearDraftSession();
      }
    } catch (err) {
      console.error('Saving the workout failed', err);
      setSaveError(err instanceof Error ? err.message : 'Could not save the workout');
      setFinishing(false);
      return;
    }
    setFinishing(false);
    onComplete();
  }

  if (conflict && onResumeDraft) {
    const count = draftSetCount(conflict);
    const label = conflict.day?.label ?? (conflict.dayId < 0 ? 'Quick workout' : `Day ${conflict.dayId}`);
    return (
      <div className="workout-view">
        <header className="workout-header">
          <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
          <div className="workout-title">
            <span className="workout-day-label">Unfinished workout</span>
          </div>
        </header>
        <div className="draft-conflict">
          <p className="draft-conflict-title">You have an unfinished {label} workout</p>
          <p className="draft-conflict-detail">
            {count === 1 ? '1 logged set from earlier is' : `${count} logged sets from earlier are`} waiting. Starting {day.label} now would replace {count === 1 ? 'it' : 'them'}.
          </p>
          <button className="draft-conflict-primary" onClick={() => onResumeDraft(conflict)}>
            Resume {label}
          </button>
          <button
            className="draft-conflict-secondary"
            onClick={() => { clearDraftSession(); setConflict(null); }}
          >
            Discard it and start {day.label}
          </button>
        </div>
      </div>
    );
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
        <button className="back-btn" onClick={handleBack} aria-label="Back">&#8592;</button>
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
        style={restRunId > 0 ? { paddingBottom: 'calc(140px + env(safe-area-inset-bottom))' } : undefined}
      >
        {isEditMode && originalCompletedAt != null && (
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
        {!isEditMode && phase && isEasyPhase(phase) && (
          <div className="phase-banner">
            <span className="phase-banner-title">{PHASE_INFO[phase].label} week</span>
            <span className="phase-banner-detail">
              {PHASE_INFO[phase].blurb}
              {phase === 'intro'
                ? ' — easy loads on purpose. A first-time lift keeps the weight you pick; a known one sits well under your working weight.'
                : ' — the lighter targets are the plan working, not you slacking.'}
            </span>
          </div>
        )}
        {!isEditMode && openChanges.length > 0 && !planDismissed && (
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
            {openChanges.map(c => (
              <div className="coach-plan-change" key={c.key}>
                <span className="coach-plan-what">
                  {c.exerciseName}: {c.fromSets} → {c.toSets} sets
                </span>
                <span className="coach-plan-why">{c.reason}</span>
                <div className="coach-plan-actions">
                  <button className="coach-plan-btn coach-plan-btn--keep" onClick={() => decideCoachChange(c.key, true)}>
                    Keep it for this block
                  </button>
                  <button className="coach-plan-btn" onClick={() => decideCoachChange(c.key, false)}>
                    Not this block
                  </button>
                </div>
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
            plan={setPlans[ex.id]}
            lastSession={lastSessions[ex.id]}
            expanded={activeId === ex.id}
            onToggle={() => setActiveId(prev => (prev === ex.id ? null : ex.id))}
            regression={regressions[ex.id]}
            onRegress={s => handleAddExercise(slotFor(s.exercise.id, s.exercise.name, { snapshot }))}
            onViewHistory={(id, name) => setHistoryFor({ id, name })}
            oneRepMax={maxes[ex.id]}
            onSetMax={onSetMax && !isEditMode ? () => onSetMax(ex.id) : undefined}
            variation={variations[ex.id]}
            onLogSet={entry => handleLogSet(ex.id, entry)}
            onEditSet={(i, entry) => handleEditSet(ex.id, i, entry)}
            onDeleteSet={i => handleDeleteSet(ex.id, i)}
          />
        ))}
        {addedExercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sets={sets[ex.id] ?? []}
            recommendation={recommendations[ex.id]}
            plan={setPlans[ex.id]}
            lastSession={lastSessions[ex.id]}
            expanded={activeId === ex.id}
            onToggle={() => setActiveId(prev => (prev === ex.id ? null : ex.id))}
            onViewHistory={(id, name) => setHistoryFor({ id, name })}
            oneRepMax={maxes[ex.id]}
            onSetMax={onSetMax && !isEditMode ? () => onSetMax(ex.id) : undefined}
            variation={variations[ex.id]}
            onLogSet={entry => handleLogSet(ex.id, entry)}
            onEditSet={(i, entry) => handleEditSet(ex.id, i, entry)}
            onDeleteSet={i => handleDeleteSet(ex.id, i)}
            onRemove={() => handleRemoveAdded(ex.id)}
          />
        ))}

        {showAddPanel ? (
          <AddExercisePanel
            excludeIds={new Set([...effectiveDay.exercises, ...addedExercises].map(e => e.id))}
            snapshot={snapshot}
            onAdd={handleAddExercise}
            onClose={() => setShowAddPanel(false)}
          />
        ) : (
          <button className="add-exercise-mid-btn" onClick={() => setShowAddPanel(true)}>
            ＋ Add exercise
          </button>
        )}

        {noteOpen ? (
          <div className="session-note">
            <label className="session-note-label" htmlFor="session-note">Session notes</label>
            <textarea
              id="session-note"
              className="session-note-input"
              rows={2}
              maxLength={2000}
              placeholder="How did it go? Sleep, soreness, a cue that clicked…"
              value={note}
              onChange={e => setNote(e.target.value)}
              autoFocus={!note}
            />
          </div>
        ) : (
          <button type="button" className="session-note-add" onClick={() => setNoteOpen(true)}>
            ＋ Add a note
          </button>
        )}

        {/* Finish lives at the end of the page, in the flow, not in a fixed
            bar: the per-set "Log" button is inside the open card, so the two
            can't be confused, and the session's own length is what puts the
            button under the last exercise. */}
        <div className="finish-section">
          {saveError && (
            <p className="finish-error" role="alert">
              Couldn't save: {saveError}. Your sets are still here — try again.
            </p>
          )}
          <button
            className="finish-btn"
            disabled={totalSets === 0 || finishing}
            onClick={handleFinish}
          >
            {finishing ? 'Saving…' : isEditMode ? 'Save Changes' : 'Finish Workout'}
          </button>
        </div>
      </div>

      {historyFor && (
        <ExerciseHistorySheet exerciseId={historyFor.id} exerciseName={historyFor.name} onClose={() => setHistoryFor(null)} />
      )}

      {!isEditMode && <RestTimer runId={restRunId} onDismiss={() => setRestRunId(0)} />}
    </div>
  );
}
