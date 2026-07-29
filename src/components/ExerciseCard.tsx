import { useState } from 'react';
import type { Exercise } from '../data/program';
import type { WeightRec, ExerciseSession, SetPlan } from '../data/recommendations';
import './ExerciseCard.css';

interface Props {
  exercise: Exercise;
  sets: Array<{ weight: number; reps: number; warmup?: boolean }>;
  recommendation?: WeightRec;
  /** Per-set prescription — one row per programmed working set */
  plan?: SetPlan;
  lastSession?: ExerciseSession;
  onLogSet: (weight: number, reps: number, warmup: boolean) => void;
  onEditSet: (index: number, weight: number, reps: number, warmup: boolean) => void;
  onDeleteSet: (index: number) => void;
  /** When provided, shows a control to remove this exercise from the workout
   *  (used for exercises added mid-session). */
  onRemove?: () => void;
}

/** The row the lifter is filling in right now. */
type Draft = { kind: 'work' | 'warmup'; weight: string; reps: string };

// "100×10, 100×9, 95×8" — compressed to "100 lbs × 10, 9, 8" when the weight
// never changes, which is the common case for straight sets.
function formatLastSets(sets: ExerciseSession['sets']): string {
  const uniqueWeights = new Set(sets.map(s => s.weight));
  if (uniqueWeights.size === 1) {
    return `${sets[0].weight} lbs × ${sets.map(s => s.reps).join(', ')}`;
  }
  return sets.map(s => `${s.weight}×${s.reps}`).join(', ');
}

function lastSessionLabel(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DIRECTION_ICON: Record<WeightRec['direction'], string> = {
  up: '↑',
  down: '↓',
  hold: '→',
};

export default function ExerciseCard({
  exercise, sets, recommendation, plan, lastSession,
  onLogSet, onEditSet, onDeleteSet, onRemove,
}: Props) {
  // A draft overrides the prescribed row — set when the lifter edits the
  // pre-filled numbers, adds a warm-up, or adds a set beyond the plan.
  const [draft, setDraft] = useState<Draft | null>(null);
  // The load actually being used today. Once the lifter logs set 1 at a weight
  // of their own, the remaining prescribed sets follow them there rather than
  // snapping back to the recommendation.
  const [workingWeight, setWorkingWeight] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWarmup, setEditWarmup] = useState(false);

  // The prescription arrives asynchronously (it needs a history read) — drop a
  // stale working weight when a new plan lands, per the React "adjusting state
  // when a prop changes" pattern.
  const [appliedPlan, setAppliedPlan] = useState<SetPlan | undefined>(undefined);
  if (plan !== appliedPlan) {
    setAppliedPlan(plan);
    setWorkingWeight(null);
  }

  const targetLabel = `${exercise.sets} × ${exercise.repLow}–${exercise.repHigh}`;
  // Working sets are numbered on their own; warm-ups carry a label, not a
  // number, so "Set 1" always means the first real work set.
  const setLabels: string[] = [];
  let workingSoFar = 0;
  for (const s of sets) {
    if (s.warmup) setLabels.push('Warm-up');
    else { workingSoFar += 1; setLabels.push(`Set ${workingSoFar}`); }
  }

  // Prescribed sets not yet logged. The first is the one being worked on now;
  // the rest are previewed so the whole session is visible up front.
  const remaining = plan ? plan.sets.slice(workingSoFar) : [];
  const activePrescription = draft === null ? remaining[0] : undefined;
  const upcoming = activePrescription ? remaining.slice(1) : remaining;

  const prescribedWeight = (w: number | null) =>
    workingWeight ?? (w == null ? '' : String(w));

  // The active input row: the draft, else the next prescribed set, else (no
  // plan at all — e.g. editing a past session) a blank row.
  const row: Draft | null =
    draft ??
    (activePrescription
      ? {
          kind: 'work',
          weight: prescribedWeight(activePrescription.weight),
          reps: String(activePrescription.targetReps),
        }
      : plan
        ? null
        : { kind: 'work', weight: workingWeight ?? '', reps: '' });

  const nextSetNum = workingSoFar + 1;

  function updateRow(patch: Partial<Draft>) {
    if (!row) return;
    setDraft({ ...row, ...patch });
  }

  function handleLogSet() {
    if (!row) return;
    const w = parseFloat(row.weight);
    const r = parseInt(row.reps, 10);
    // Weight of 0 is valid (bodyweight exercises); reps must be positive.
    if (!isFinite(w) || !isFinite(r) || w < 0 || r <= 0) return;
    onLogSet(w, r, row.kind === 'warmup');
    // Working sets set the day's load; warm-ups deliberately don't.
    if (row.kind === 'work') setWorkingWeight(row.weight);
    setDraft(null);
  }

  function addWarmup() {
    setDraft({ kind: 'warmup', weight: '', reps: '' });
  }

  function addExtraSet() {
    const lastWork = [...sets].reverse().find(s => !s.warmup);
    setDraft({
      kind: 'work',
      weight: workingWeight ?? (lastWork ? String(lastWork.weight) : ''),
      reps: lastWork ? String(lastWork.reps) : '',
    });
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditWeight(String(sets[index].weight));
    setEditReps(String(sets[index].reps));
    setEditWarmup(!!sets[index].warmup);
  }

  function confirmEdit() {
    if (editingIndex === null) return;
    const w = parseFloat(editWeight);
    const r = parseInt(editReps, 10);
    if (isFinite(w) && isFinite(r) && w >= 0 && r > 0) {
      onEditSet(editingIndex, w, r, editWarmup);
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

  const canLog = !!row && row.weight !== '' && row.reps !== '';
  const planComplete = !!plan && remaining.length === 0;

  return (
    <div className="exercise-card">
      <div className="ex-header">
        <span className="ex-name">{exercise.name}</span>
        <span className="ex-target">{targetLabel}</span>
        {onRemove && (
          <button
            className="ex-remove-btn"
            onClick={onRemove}
            aria-label={`Remove ${exercise.name} from this workout`}
          >
            ×
          </button>
        )}
      </div>

      {recommendation && (
        <div className={`ex-rec ex-rec--${recommendation.direction}`}>
          <span className="ex-rec-weight">
            {DIRECTION_ICON[recommendation.direction]}{' '}
            {recommendation.targetReps != null
              ? `${recommendation.targetReps} reps`
              : `${recommendation.weight} lbs`}
          </span>
          <span className="ex-rec-reason">{recommendation.reason}</span>
        </div>
      )}

      {lastSession && (
        <div className="ex-last">
          <span className="ex-last-label">Last time · {lastSessionLabel(lastSession.completedAt)}</span>
          <span className="ex-last-sets">{formatLastSets(lastSession.sets)}</span>
        </div>
      )}

      {plan && <p className="ex-goal">{plan.goal}</p>}

      {sets.length > 0 && (
        <div className="set-log">
          {sets.map((s, i) =>
            editingIndex === i ? (
              <div key={i} className={`set-row editing${s.warmup ? ' set-row--warmup' : ''}`}>
                <span className="set-num">{setLabels[i]}</span>
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
                <button
                  className={`warmup-chip${editWarmup ? ' warmup-chip--on' : ''}`}
                  onClick={() => setEditWarmup(v => !v)}
                  aria-pressed={editWarmup}
                  title="Tag as warm-up"
                >
                  W
                </button>
                <button className="edit-confirm-btn" onClick={confirmEdit}>✓</button>
                <button className="edit-cancel-btn" onClick={cancelEdit}>✗</button>
              </div>
            ) : (
              <div key={i} className={`set-row set-row--done${s.warmup ? ' set-row--warmup' : ''}`} onClick={() => startEdit(i)}>
                <span className="set-num">{setLabels[i]}</span>
                <span className="set-weight">{s.weight} lbs</span>
                <span className="set-reps">{s.reps} reps</span>
                <button
                  className="delete-set-btn"
                  onClick={e => { e.stopPropagation(); onDeleteSet(i); }}
                  aria-label={`Delete ${setLabels[i]}`}
                >
                  ×
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* ── The set being logged right now, pre-filled from the prescription ── */}
      {row && (
        <div className={`set-inputs${row.kind === 'warmup' ? ' set-inputs--warmup' : ''}`}>
          <div className="input-row">
            <span className="set-num set-num--active">
              {row.kind === 'warmup' ? 'Warm-up' : `Set ${nextSetNum}`}
            </span>
            <div className="weight-wrap">
              <input
                className="num-input"
                type="number"
                inputMode="decimal"
                placeholder="Weight"
                aria-label={`Weight for ${row.kind === 'warmup' ? 'warm-up' : `set ${nextSetNum}`}`}
                value={row.weight}
                onChange={e => updateRow({ weight: e.target.value })}
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
                aria-label={`Reps for ${row.kind === 'warmup' ? 'warm-up' : `set ${nextSetNum}`}`}
                value={row.reps}
                onChange={e => updateRow({ reps: e.target.value })}
                onKeyDown={handleKeyDown}
              />
              <span className="input-unit">reps</span>
            </div>
          </div>
          <div className="log-actions">
            {draft !== null && (
              <button type="button" className="draft-cancel-btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
            )}
            <button className="log-btn" disabled={!canLog} onClick={handleLogSet}>
              {row.kind === 'warmup' ? 'Log warm-up' : `Log set ${nextSetNum}`}
            </button>
          </div>
        </div>
      )}

      {/* ── The rest of today's prescription, so the session is visible up front ── */}
      {upcoming.length > 0 && (
        <div className="set-plan">
          {upcoming.map(p => (
            <div className="set-row set-row--planned" key={p.setNumber}>
              <span className="set-num">Set {p.setNumber}</span>
              <span className="set-weight">
                {(workingWeight ?? (p.weight == null ? null : String(p.weight))) ?? '—'} lbs
              </span>
              <span className="set-reps">{p.targetReps} reps</span>
            </div>
          ))}
        </div>
      )}

      {/* Warm-ups are an explicit addition rather than a mode on the working
          set — the prescribed sets stay pre-filled and ready to log. */}
      {draft === null && (
        <div className="ex-actions">
          <button type="button" className="ex-action-btn" onClick={addWarmup}>
            ＋ Warm-up set
          </button>
          {planComplete && (
            <button type="button" className="ex-action-btn" onClick={addExtraSet}>
              ＋ Extra set
            </button>
          )}
        </div>
      )}
    </div>
  );
}
