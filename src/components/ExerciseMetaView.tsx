import { useEffect, useRef, useState } from 'react';
import {
  MUSCLE_GROUPS, MOVEMENT_PATTERNS, EQUIPMENT_OPTIONS, WEIGHT_TYPES,
  type MuscleGroup, type MovementPattern, type Equipment, type WeightType,
} from '../data/taxonomy';
import { getExerciseMeta, saveExerciseMeta } from '../data/exercises';
import { archiveExercise, deleteExerciseFromLibrary, getExerciseLibrary } from '../data/programStore';
import { hasSetLogsForExercise, deleteSetLogsByExerciseId } from '../db/database';
import { getUserRole } from '../data/sync';
import { getExerciseMerges, saveExerciseMerges, applyExerciseMerges } from '../data/merges';
import { instructionsFor } from '../data/instructions';
import { useInstructionSheet } from './useInstructionSheet';
import { useDialog } from './useDialog';
import ExerciseHistorySheet from './ExerciseHistorySheet';
import './ExerciseMetaView.css';

interface Props {
  exerciseId: string;
  exerciseName: string;
  onBack: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

type Modal = 'confirm-delete' | 'confirm-history' | 'confirm-merge';

export default function ExerciseMetaView({ exerciseId, exerciseName, onBack, onSaved, onDeleted }: Props) {
  const initial = getExerciseMeta(exerciseId);

  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | ''>(initial.primaryMuscle ?? '');
  const [secondary1, setSecondary1] = useState<MuscleGroup | ''>(initial.secondaryMuscle1 ?? '');
  const [secondary2, setSecondary2] = useState<MuscleGroup | ''>(initial.secondaryMuscle2 ?? '');
  const [secondary3, setSecondary3] = useState<MuscleGroup | ''>(initial.secondaryMuscle3 ?? '');
  const [workoutType, setWorkoutType] = useState<MovementPattern | ''>(initial.workoutType ?? '');
  const [equipment, setEquipment] = useState<Equipment | ''>(initial.equipment ?? '');
  const [weightType, setWeightType] = useState<WeightType | ''>(initial.weightType ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [working, setWorking] = useState(false);
  const info = useInstructionSheet();
  const hasInstructions = instructionsFor(exerciseId) != null;
  const [showHistory, setShowHistory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The "Saved!" flash timer is cleared on unmount — it used to fire setState
  // on an unmounted screen when the user navigated away inside two seconds.
  const savedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (savedTimer.current != null) window.clearTimeout(savedTimer.current); }, []);
  const closeModal = () => setModal(null);
  const dialogRef = useDialog<HTMLDivElement>(closeModal);

  // Admin-only: merge this exercise into another. The server records the
  // from→to mapping (audited) and serves it to every client on pull; each
  // client folds the merged exercise's history into the survivor.
  const isAdmin = getUserRole() === 'admin';
  const [mergeTargets] = useState(() =>
    isAdmin
      ? getExerciseLibrary()
          .filter(e => e.id !== exerciseId && !e.archived)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeTarget = mergeTargets.find(e => e.id === mergeTargetId) ?? null;

  async function handleMerge() {
    if (!mergeTarget || !mergeReason.trim() || working) return;
    setWorking(true);
    setMergeError(null);
    try {
      const res = await fetch('/api/admin/merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId: exerciseId, toId: mergeTarget.id, reason: mergeReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(err?.error ?? `Merge failed (${res.status})`);
      }
      // Apply locally right away — other devices pick the mapping up on pull
      saveExerciseMerges({ ...getExerciseMerges(), [exerciseId]: mergeTarget.id });
      await applyExerciseMerges();
      onDeleted?.(); // the merged-away exercise no longer exists — leave the screen
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed');
      setModal(null);
      setWorking(false);
    }
  }

  function handleSave() {
    if (saving) return;
    setSaving(true);
    saveExerciseMeta(exerciseId, {
      primaryMuscle:    primaryMuscle || null,
      secondaryMuscle1: secondary1   || null,
      secondaryMuscle2: secondary2   || null,
      secondaryMuscle3: secondary3   || null,
      workoutType:      workoutType  || null,
      equipment:        equipment    || null,
      weightType:       weightType   || null,
    });
    setSaving(false);
    setSaved(true);
    onSaved?.();
    if (savedTimer.current != null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
  }

  async function handleDeletePressed() {
    const hasHistory = await hasSetLogsForExercise(exerciseId);
    setModal(hasHistory ? 'confirm-history' : 'confirm-delete');
  }

  // Each destructive action clears its busy flag on failure instead of
  // leaving the modal stuck on "…" with no way out.
  async function handleArchive() {
    setWorking(true);
    setActionError(null);
    try {
      archiveExercise(exerciseId);
      onDeleted?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not archive');
      setWorking(false);
    }
  }

  async function handleDelete() {
    setWorking(true);
    setActionError(null);
    try {
      await deleteSetLogsByExerciseId(exerciseId);
      deleteExerciseFromLibrary(exerciseId);
      onDeleted?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete');
      setWorking(false);
    }
  }

  return (
    <div className="exercise-meta-view">
      <header className="exercise-meta-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="exercise-meta-title-group">
          <span className="exercise-meta-eyebrow">Exercise</span>
          <span className="exercise-meta-name">{exerciseName}</span>
        </div>
      </header>

      <div className="exercise-meta-body">
        <button className="meta-howto" onClick={() => info.open(exerciseId, exerciseName)}>
          <span className="meta-howto-text">
            <span className="meta-howto-title">How to do it</span>
            <span className="meta-howto-sub">
              {hasInstructions ? 'Setup, cues and the faults to watch for' : 'No instructions yet for this custom exercise'}
            </span>
          </span>
          <span className="meta-howto-chevron">›</span>
        </button>
        <button className="meta-howto meta-howto--history" onClick={() => setShowHistory(true)}>
          <span className="meta-howto-text">
            <span className="meta-howto-title">History</span>
            <span className="meta-howto-sub">Every session, your bests, and how it is trending</span>
          </span>
          <span className="meta-howto-chevron">›</span>
        </button>

        <section className="meta-section">
          <label className="meta-label" htmlFor="meta-pattern">Movement Pattern</label>
          <select
            id="meta-pattern"
            className="meta-select"
            value={workoutType}
            onChange={e => setWorkoutType(e.target.value as MovementPattern | '')}
          >
            <option value="">— Not set —</option>
            {MOVEMENT_PATTERNS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <label className="meta-label" htmlFor="meta-equipment">Equipment</label>
          <select
            id="meta-equipment"
            className="meta-select"
            value={equipment}
            onChange={e => setEquipment(e.target.value as Equipment | '')}
          >
            <option value="">— Not set —</option>
            {EQUIPMENT_OPTIONS.map(eq => <option key={eq} value={eq}>{eq}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <label className="meta-label" htmlFor="meta-weight-type">Weight Type</label>
          <select
            id="meta-weight-type"
            className="meta-select"
            value={weightType}
            onChange={e => setWeightType(e.target.value as WeightType | '')}
          >
            <option value="">— Not set —</option>
            {WEIGHT_TYPES.map(wt => <option key={wt} value={wt}>{wt}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <label className="meta-label" htmlFor="meta-primary">Primary Muscle</label>
          <select
            id="meta-primary"
            className="meta-select"
            value={primaryMuscle}
            onChange={e => setPrimaryMuscle(e.target.value as MuscleGroup | '')}
          >
            <option value="">— Not set —</option>
            {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <span className="meta-label" id="meta-secondary-label">Secondary Muscles</span>
          <div className="secondary-muscles">
            <select
              className="meta-select"
              aria-label="Secondary muscle 1"
              value={secondary1}
              onChange={e => setSecondary1(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              className="meta-select"
              aria-label="Secondary muscle 2"
              value={secondary2}
              onChange={e => setSecondary2(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              className="meta-select"
              aria-label="Secondary muscle 3"
              value={secondary3}
              onChange={e => setSecondary3(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </section>

        {isAdmin && (
          <section className="meta-section meta-merge-section">
            <span className="meta-label">Merge into another exercise (admin)</span>
            <p className="meta-merge-hint">
              Folds this exercise — including everyone's logged history — into the
              one you pick. Use it to clean up duplicates. This cannot be undone.
            </p>
            <select
              className="meta-select"
              value={mergeTargetId}
              onChange={e => { setMergeTargetId(e.target.value); setMergeError(null); }}
            >
              <option value="">— Pick the surviving exercise —</option>
              {mergeTargets.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input
              className="meta-merge-reason"
              type="text"
              placeholder="Reason (required, audited)"
              value={mergeReason}
              onChange={e => setMergeReason(e.target.value)}
            />
            {mergeError && <p className="meta-merge-error">{mergeError}</p>}
            <button
              className="meta-merge-btn"
              disabled={!mergeTarget || !mergeReason.trim() || working}
              onClick={() => setModal('confirm-merge')}
            >
              Merge…
            </button>
          </section>
        )}

        <button className="meta-delete-btn" onClick={handleDeletePressed}>
          Delete Exercise
        </button>
      </div>

      <div className="exercise-meta-footer">
        <button
          className="meta-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* ── First confirmation (no history) ── */}
      {modal === 'confirm-delete' && (
        <div className="meta-modal-overlay" onClick={closeModal}>
          <div className="meta-modal" role="dialog" aria-modal="true" aria-labelledby="meta-modal-title" ref={dialogRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
            <p className="meta-modal-title" id="meta-modal-title">Delete "{exerciseName}"?</p>
            <p className="meta-modal-body">This exercise will be permanently removed.</p>
            {actionError && <p className="meta-modal-error" role="alert">{actionError}</p>}
            <div className="meta-modal-actions">
              <button className="meta-modal-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="meta-modal-danger" onClick={handleDelete} disabled={working}>
                {working ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Merge confirmation (admin) ── */}
      {modal === 'confirm-merge' && mergeTarget && (
        <div className="meta-modal-overlay" onClick={closeModal}>
          <div className="meta-modal" role="dialog" aria-modal="true" aria-labelledby="meta-modal-title" ref={dialogRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
            <p className="meta-modal-title" id="meta-modal-title">Merge "{exerciseName}" into "{mergeTarget.name}"?</p>
            <p className="meta-modal-body">
              All history logged under "{exerciseName}" — for every user — will count
              as "{mergeTarget.name}" from now on. This cannot be undone.
            </p>
            <div className="meta-modal-actions">
              <button className="meta-modal-cancel" onClick={() => setModal(null)} disabled={working}>Cancel</button>
              <button className="meta-modal-danger" onClick={handleMerge} disabled={working}>
                {working ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Second confirmation (has history) ── */}
      {modal === 'confirm-history' && (
        <div className="meta-modal-overlay" onClick={closeModal}>
          <div className="meta-modal" role="dialog" aria-modal="true" aria-labelledby="meta-modal-title" ref={dialogRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
            <p className="meta-modal-title" id="meta-modal-title">"{exerciseName}" has workout history</p>
            <p className="meta-modal-body">
              <strong>Archive</strong> keeps it in your history but hides it from the exercise list.<br /><br />
              <strong>Delete</strong> permanently removes it and all associated history.
            </p>
            {actionError && <p className="meta-modal-error" role="alert">{actionError}</p>}
            <div className="meta-modal-actions meta-modal-actions--three">
              <button className="meta-modal-cancel" onClick={() => setModal(null)} disabled={working}>Cancel</button>
              <button className="meta-modal-archive" onClick={handleArchive} disabled={working}>
                {working ? '…' : 'Archive'}
              </button>
              <button className="meta-modal-danger" onClick={handleDelete} disabled={working}>
                {working ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {info.sheet}
      {showHistory && (
        <ExerciseHistorySheet exerciseId={exerciseId} exerciseName={exerciseName} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
