import { Fragment, useState } from 'react';
import type { Exercise } from '../data/program';
import { prescriptionLabel } from '../data/program';
import type { WeightRec, ExerciseSession, SetPlan } from '../data/recommendations';
import { unitFor } from '../data/exercises';
import { movementPatternFor } from '../data/analytics';
import { unitLabel } from '../data/taxonomy';
import type { MeasureUnit } from '../data/taxonomy';
import {
  TECHNIQUE_INFO, GRIP_INFO, extensionOptionsFor, gripOptionsFor, techniqueOptionsFor,
  isExtension, styleOf, variationKey, variationLabel,
} from '../data/variations';
import type { Grip, SetTechnique, SetVariation } from '../data/variations';
import { InfoButton } from './InstructionSheet';
import Icon from './Icon';
import { fmtWeight, fromDisplay, toDisplay, unitLabelFor } from '../data/units';
import type { ReplacementSuggestion } from '../data/substitution';
import { useInstructionSheet } from './useInstructionSheet';
import './ExerciseCard.css';

/** One logged row: load, count, and how it was done. */
export type LoggedEntry = { weight: number; reps: number; warmup?: boolean } & SetVariation;

interface Props {
  exercise: Exercise;
  sets: LoggedEntry[];
  recommendation?: WeightRec;
  /** Per-set prescription — one row per programmed working set */
  plan?: SetPlan;
  lastSession?: ExerciseSession;
  /** The lifter's stored 1RM for this exercise — prescribed loads are shown as a % of it */
  oneRepMax?: number;
  /**
   * Whether this is the exercise being worked on. One card is open at a time:
   * the open one carries the inputs and the coaching, the rest collapse to a
   * one-line status so the whole session fits on a screen.
   */
  expanded: boolean;
  onToggle: () => void;
  /**
   * How today's sets are expected to be done — the slot's prescription, or
   * last time's technique/grip. Pre-selected on the row; the prescription was
   * built from sessions done this way, so the two agree.
   */
  variation?: SetVariation;
  /** Opens the Strength screen for this lift; offered when the coach has nothing to prescribe a load from */
  onSetMax?: () => void;
  onLogSet: (entry: LoggedEntry) => void;
  onEditSet: (index: number, entry: LoggedEntry) => void;
  onDeleteSet: (index: number) => void;
  /** When provided, shows a control to remove this exercise from the workout
   *  (used for exercises added mid-session). */
  onRemove?: () => void;
  /** An easier variant to offer after repeated misses on unloaded work (audit F11) */
  regression?: ReplacementSuggestion;
  /** Accept the easier variant — WorkoutView adds it to today's session */
  onRegress?: (s: ReplacementSuggestion) => void;
  /** Open the per-exercise history sheet (the "Last time" line is the way in) */
  onViewHistory?: (exerciseId: string, name: string) => void;
}

/**
 * The row the lifter is filling in right now. A `work` row is a numbered
 * working set; an `extension` row (drop / rest-pause / partials) continues the
 * set before it and is not numbered — it doesn't consume a prescribed set.
 */
type Draft = { kind: 'work' | 'warmup' | 'extension'; weight: string; reps: string } & SetVariation;

// "100×10, 100×9, 95×8" — compressed to "100 lbs × 10, 9, 8" when the weight
// never changes, which is the common case for straight sets.
function formatLastSets(sets: ExerciseSession['sets'], unit: MeasureUnit): string {
  // A timed hold carries no meaningful load, so show the holds alone rather
  // than "0 lbs × 45".
  if (unit === 'seconds') return sets.map(s => `${s.reps}s`).join(', ');
  const uniqueWeights = new Set(sets.map(s => s.weight));
  if (uniqueWeights.size === 1) {
    return `${fmtWeight(sets[0].weight)} × ${sets.map(s => s.reps).join(', ')}`;
  }
  return sets.map(s => `${toDisplay(s.weight)}×${s.reps}`).join(', ');
}

// The sets still to come, in the same compressed shape as "last time":
// "190 lbs × 10, 9" — or "45s, 40s" for a hold. Loads the lifter has chosen
// today (`workingWeight`) replace the prescribed ones, in the display unit.
// Returns null when there's nothing to say (no load and no targets).
function formatUpcoming(
  sets: SetPlan['sets'], unit: MeasureUnit, weightUnit: string, workingWeight: string | null,
): string | null {
  const count = (n: number | null) => (n == null ? '—' : unit === 'seconds' ? `${n}s` : String(n));
  const counts = sets.map(s => count(s.targetReps)).join(', ');
  const hasTargets = sets.some(s => s.targetReps != null);
  if (unit === 'seconds') return hasTargets ? counts : null;
  const loads = sets.map(s => workingWeight ?? (s.weight == null ? null : String(toDisplay(s.weight))));
  // No load known yet (a first session): just the rep targets.
  if (loads.every(l => l == null)) return hasTargets ? `${counts} ${unitLabel(unit)}` : null;
  if (new Set(loads).size === 1) return `${loads[0]} ${weightUnit} × ${counts}`;
  return sets.map((s, i) => `${loads[i] ?? '—'}×${count(s.targetReps)}`).join(', ');
}

// A finished exercise, in a collapsed row: "3 sets · 190 lbs" (the day's
// working weight — most used, heaviest on a tie), "3 holds" for a timed one.
function doneLabel(sets: Array<{ weight: number; reps: number }>, timed: boolean): string {
  const n = sets.length;
  if (timed) return `${n} hold${n === 1 ? '' : 's'}`;
  const counts = new Map<number, number>();
  for (const s of sets) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return `${n} set${n === 1 ? '' : 's'}${top > 0 ? ` · ${fmtWeight(top)}` : ''}`;
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

/** The small tag after a logged row's numbers: "paused · close grip". An extension's kind is already its label. */
function rowTag(s: SetVariation): string | null {
  return variationLabel({ technique: isExtension(s.technique) ? undefined : s.technique, grip: s.grip });
}

/** "Drop" / "Rest-pause" / "Partials" — the row label for a continuation, short enough for the label column. */
function extensionShort(t: SetTechnique): string {
  const short = TECHNIQUE_INFO[t].short;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** What the variation button on the active row reads: the extension kind, or the style tag. */
function rowTagForRow(row: Draft): string | null {
  if (row.kind === 'extension') {
    const grip = row.grip ? ` · ${GRIP_INFO[row.grip].short}` : '';
    return `${TECHNIQUE_INFO[row.technique!].short}${grip}`;
  }
  return variationLabel({ technique: row.technique, grip: row.grip });
}

interface PanelProps {
  value: SetVariation;
  techniques: SetTechnique[];
  extensions: SetTechnique[];
  grips: Grip[];
  onChange: (next: SetVariation) => void;
}

/**
 * The variation picker: one compact row of chips per dimension, scrolling
 * sideways rather than wrapping so it never grows the card by more than two
 * lines. "Straight" / "Standard" are the absence of a value, not a value.
 */
function VariationPanel({ value, techniques, extensions, grips, onChange }: PanelProps) {
  const technique = value.technique ?? null;
  const grip = value.grip ?? null;
  const chip = (active: boolean, label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      key={label}
      className={`var-chip${active ? ' var-chip--on' : ''}`}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
  return (
    <div className="var-panel">
      {(techniques.length > 0 || extensions.length > 0) && (
        <div className="var-row">
          <span className="var-label">Reps</span>
          <div className="var-chips">
            {chip(technique == null, 'Straight', () => onChange({ ...value, technique: undefined }))}
            {techniques.map(t => chip(technique === t, TECHNIQUE_INFO[t].label, () => onChange({ ...value, technique: t }), TECHNIQUE_INFO[t].blurb))}
            {extensions.length > 0 && <span className="var-divider" aria-hidden="true" />}
            {extensions.map(t => chip(technique === t, TECHNIQUE_INFO[t].label, () => onChange({ ...value, technique: t }), TECHNIQUE_INFO[t].blurb))}
          </div>
        </div>
      )}
      {grips.length > 0 && (
        <div className="var-row">
          <span className="var-label">Grip</span>
          <div className="var-chips">
            {chip(grip == null, 'Standard', () => onChange({ ...value, grip: undefined }))}
            {grips.map(g => chip(grip === g, GRIP_INFO[g].label, () => onChange({ ...value, grip: g })))}
          </div>
        </div>
      )}
      {technique && <p className="var-hint">{TECHNIQUE_INFO[technique].blurb}</p>}
    </div>
  );
}

export default function ExerciseCard({
  exercise, sets, recommendation, plan, lastSession, oneRepMax, expanded, onToggle, variation, onSetMax,
  onLogSet, onEditSet, onDeleteSet, onRemove, regression, onRegress, onViewHistory,
}: Props) {
  const info = useInstructionSheet();
  // A draft overrides the prescribed row — set when the lifter edits the
  // pre-filled numbers, adds a warm-up, or adds a set beyond the plan.
  const [draft, setDraft] = useState<Draft | null>(null);
  // The load actually being used today. Once the lifter logs set 1 at a weight
  // of their own, the remaining prescribed sets follow them there rather than
  // snapping back to the recommendation.
  const [workingWeight, setWorkingWeight] = useState<string | null>(null);
  // The technique/grip in force for the numbered sets — pre-selected from the
  // expected variation, then whatever the lifter last chose. One tap to
  // change, and it stays changed for the rest of the exercise.
  const [sticky, setSticky] = useState<SetVariation>(() => styleOf(variation ?? {}));
  const [showVariation, setShowVariation] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWarmup, setEditWarmup] = useState(false);
  const [editVariation, setEditVariation] = useState<SetVariation>({});
  const [editShowVariation, setEditShowVariation] = useState(false);
  // The coach's reasoning (why this load, what earns the next one) sits behind
  // the recommendation chip — the number is what the lifter needs mid-set.
  const [showWhy, setShowWhy] = useState(false);

  // The prescription arrives asynchronously (it needs a history read) — drop a
  // stale working weight when a DIFFERENT plan lands, per the React "adjusting
  // state when a prop changes" pattern. Compared by content, not identity:
  // the plan object is rebuilt whenever anything in the workout changes
  // (an exercise added mid-session, a background program refresh), and
  // resetting on every rebuild snapped the lifter's chosen weight back to the
  // recommendation so the next one-tap log recorded the wrong load.
  const signature = plan ? plan.sets.map(s => `${s.weight ?? ''}:${s.targetReps ?? ''}`).join('|') : '';
  const [appliedSignature, setAppliedSignature] = useState(signature);
  if (signature !== appliedSignature) {
    setAppliedSignature(signature);
    setWorkingWeight(null);
  }
  // Same pattern for the expected variation, which arrives with the plan.
  // Only adopted while nothing has been logged — once the lifter has chosen a
  // way to do the sets, a rebuilt plan must not override it.
  const variationSig = variationKey(styleOf(variation ?? {}));
  const [appliedVariation, setAppliedVariation] = useState(variationSig);
  if (variationSig !== appliedVariation) {
    setAppliedVariation(variationSig);
    if (sets.length === 0) setSticky(styleOf(variation ?? {}));
  }

  // Isometric holds and carries are counted in seconds, not reps: the logger,
  // the target line, the prescribed rows and the history all have to say so, or
  // a 45-second plank reads as 45 repetitions.
  const unit = unitFor(exercise.id);
  const timed = unit === 'seconds';
  const countLabel = unitLabel(unit);
  const targetLabel = timed
    ? `${prescriptionLabel(exercise)}s`
    : prescriptionLabel(exercise);
  // Which variations make sense for this movement — grips only where grip is
  // a variable, deficit only where a block changes the lift, nothing for holds.
  const pattern = movementPatternFor(exercise.id);
  const techniqueOptions = techniqueOptionsFor(pattern, unit);
  const extensionOptions = extensionOptionsFor(unit);
  const gripOptions = gripOptionsFor(pattern);
  const canVary = techniqueOptions.length > 0 || gripOptions.length > 0 || extensionOptions.length > 0;

  // Working sets are numbered on their own; warm-ups and extensions carry a
  // label, not a number, so "Set 1" always means the first real work set and
  // a drop never eats a prescribed set.
  const setLabels: string[] = [];
  let workingSoFar = 0;
  for (const s of sets) {
    if (s.warmup) setLabels.push('Warm-up');
    else if (isExtension(s.technique)) setLabels.push(`↳ ${extensionShort(s.technique!)}`);
    else { workingSoFar += 1; setLabels.push(`Set ${workingSoFar}`); }
  }
  const lastWork = [...sets].reverse().find(s => !s.warmup);

  // Prescribed sets not yet logged. The first is the one being worked on now;
  // the rest are previewed so the whole session is visible up front.
  const remaining = plan ? plan.sets.slice(workingSoFar) : [];
  const activePrescription = draft === null ? remaining[0] : undefined;
  const upcoming = activePrescription ? remaining.slice(1) : remaining;

  // Prescribed loads are stored in lbs; the inputs show the user's unit.
  const prescribedWeight = (w: number | null) =>
    workingWeight ?? (w == null ? '' : String(toDisplay(w)));
  const weightUnit = unitLabelFor();

  // The active input row: the draft, else the next prescribed set, else (no
  // plan at all — e.g. editing a past session) a blank row.
  const row: Draft | null =
    draft ??
    (activePrescription
      ? {
          kind: 'work',
          ...sticky,
          weight: prescribedWeight(activePrescription.weight),
          reps: activePrescription.targetReps == null ? '' : String(activePrescription.targetReps),
        }
      : plan
        ? null
        : { kind: 'work', ...sticky, weight: workingWeight ?? '', reps: '' });

  const nextSetNum = workingSoFar + 1;

  function updateRow(patch: Partial<Draft>) {
    if (!row) return;
    setDraft({ ...row, ...patch });
  }

  /**
   * Change how the active row is done. An extension turns the row into a
   * continuation of the last set (unnumbered, load left to the lifter for a
   * drop, same load for rest-pause/partials); a rep style or grip sticks for
   * every numbered set from here on.
   */
  function setRowVariation(next: SetVariation) {
    if (!row) return;
    if (isExtension(next.technique)) {
      const sameLoad = next.technique !== 'drop' || (lastWork?.weight ?? 0) === 0;
      setDraft({
        kind: 'extension',
        technique: next.technique,
        ...(next.grip ? { grip: next.grip } : {}),
        weight: lastWork && sameLoad ? (workingWeight ?? String(toDisplay(lastWork.weight))) : '',
        reps: '',
      });
      return;
    }
    const style = styleOf(next);
    setSticky(style);
    if (row.kind === 'extension') {
      // Back to a numbered set: the next prescribed row if one is left, else a
      // free extra set at today's load.
      if (remaining[0]) setDraft(null);
      else setDraft({ kind: 'work', ...style, weight: workingWeight ?? (lastWork ? String(toDisplay(lastWork.weight)) : ''), reps: '' });
    } else if (draft) {
      setDraft({ ...draft, technique: style.technique, grip: style.grip });
    }
  }

  function handleLogSet() {
    if (!row) return;
    const w = timed ? 0 : fromDisplay(parseFloat(row.weight));
    const r = parseInt(row.reps, 10);
    // Weight of 0 is valid (bodyweight exercises); reps must be positive.
    if (!isFinite(w) || !isFinite(r) || w < 0 || r <= 0) return;
    const warmup = row.kind === 'warmup';
    onLogSet({
      weight: w, reps: r,
      ...(warmup ? { warmup: true } : {}),
      ...(!warmup && row.technique ? { technique: row.technique } : {}),
      ...(!warmup && row.grip ? { grip: row.grip } : {}),
    });
    // Working sets set the day's load; warm-ups and drops deliberately don't.
    if (row.kind === 'work') setWorkingWeight(row.weight);
    setDraft(null);
    setShowVariation(false);
  }

  function addWarmup() {
    setShowVariation(false);
    setDraft({ kind: 'warmup', weight: '', reps: '' });
  }

  // One tap for the common case: a drop set (rest-pause on unloaded work,
  // where there is no lighter weight to drop to). The panel offers the rest.
  function addExtension() {
    setShowVariation(false);
    setRowVariation({ technique: (lastWork?.weight ?? 0) === 0 ? 'rest-pause' : 'drop', grip: sticky.grip });
  }

  function addExtraSet() {
    setDraft({
      kind: 'work',
      ...sticky,
      weight: workingWeight ?? (lastWork ? String(toDisplay(lastWork.weight)) : ''),
      reps: lastWork ? String(lastWork.reps) : '',
    });
  }

  function startEdit(index: number) {
    const s = sets[index];
    setEditingIndex(index);
    setEditWeight(String(toDisplay(s.weight)));
    setEditReps(String(s.reps));
    setEditWarmup(!!s.warmup);
    setEditVariation({ ...(s.technique ? { technique: s.technique } : {}), ...(s.grip ? { grip: s.grip } : {}) });
    setEditShowVariation(false);
  }

  function confirmEdit() {
    if (editingIndex === null) return;
    const w = timed ? 0 : fromDisplay(parseFloat(editWeight));
    const r = parseInt(editReps, 10);
    if (isFinite(w) && isFinite(r) && w >= 0 && r > 0) {
      onEditSet(editingIndex, {
        weight: w, reps: r,
        ...(editWarmup ? { warmup: true } : {}),
        // A warm-up has no technique (it isn't a working set to pause or drop)
        ...(!editWarmup && editVariation.technique ? { technique: editVariation.technique } : {}),
        ...(editVariation.grip ? { grip: editVariation.grip } : {}),
      });
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

  const canLog = !!row && (timed || row.weight !== '') && row.reps !== '';
  const planComplete = !!plan && remaining.length === 0;
  // Without a plan (editing a past session) "done" is simply "has sets".
  const done = plan ? planComplete : sets.length > 0;
  const started = sets.length > 0;
  // The numbered sets — what "3 sets · 190 lbs" counts (a drop is not a fourth set)
  const workingSets = sets.filter(s => !s.warmup && !isExtension(s.technique));
  const rowLabel = row ? rowTagForRow(row) : null;
  const logLabel = !row ? '' :
    row.kind === 'warmup' ? 'Log warm-up' :
    row.kind === 'extension' ? `Log ${TECHNIQUE_INFO[row.technique!].label.toLowerCase()}` :
    `Log set ${nextSetNum}`;

  // The prescribed load as a share of the lifter's max — what "200 lbs" means.
  const pctLabel = oneRepMax && recommendation && recommendation.weight > 0 && recommendation.targetReps == null
    ? `${Math.round((recommendation.weight / oneRepMax) * 100)}% of 1RM`
    : null;
  // Nothing to prescribe a load from: no history and no max. The 1RM is the one
  // input that turns "find a weight" into a number, so offer it right here.
  const offerMax = !!onSetMax && !!plan && plan.rec == null && !lastSession && !timed
    && exercise.repLow != null && sets.length === 0;

  const upcomingLabel = upcoming.length > 0 ? formatUpcoming(upcoming, unit, weightUnit, workingWeight) : null;

  const recLabel = recommendation
    ? `${DIRECTION_ICON[recommendation.direction]} ${
        recommendation.targetReps != null
          ? `${recommendation.targetReps} ${timed ? 'sec' : 'reps'}`
          : fmtWeight(recommendation.weight)
      }`
    : null;
  const recTone = recommendation
    ? recommendation.kind === 'reanchor' ? 'reanchor' : recommendation.direction
    : null;

  // What a collapsed card says about itself: done (with today's numbers),
  // in progress (sets logged of planned), or waiting (the coach's load + the
  // target), so the session can be read top to bottom without opening anything.
  const summary = done ? (
    <span className="ex-summary ex-summary--done">
      <Icon name="check" size={14} strokeWidth={2.5} />
      {doneLabel(workingSets.length > 0 ? workingSets : sets, timed)}
    </span>
  ) : started ? (
    <span className="ex-summary">
      <span className="ex-progress">{workingSoFar} / {plan ? plan.sets.length : exercise.sets}</span>
    </span>
  ) : (
    <span className="ex-summary">
      {recLabel && <span className={`ex-summary-rec ex-summary-rec--${recTone}`}>{recLabel}</span>}
      <span className="ex-summary-target">{targetLabel}</span>
    </span>
  );

  return (
    <div
      className={`exercise-card${expanded ? ' exercise-card--open' : ''}${done ? ' exercise-card--done' : ''}`}
      data-exercise-id={exercise.id}
    >
      <div className="ex-header">
        <button
          type="button"
          className="ex-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${exercise.name}${expanded ? '' : ' — open'}`}
        >
          <span className="ex-name">{exercise.name}</span>
          {expanded ? (
            <span className="ex-target">{targetLabel}</span>
          ) : (
            <>
              {summary}
              <span className="ex-chevron" aria-hidden="true">
                <Icon name="chevron-right" size={15} strokeWidth={2} />
              </span>
            </>
          )}
        </button>
        {expanded && (
          <InfoButton name={exercise.name} onClick={() => info.open(exercise.id, exercise.name)} />
        )}
      </div>

      {expanded && (
        <div className="ex-body">
          {/* The coach's number and the lifter's last numbers on one line; the
              reasoning behind them is a tap away rather than a paragraph. */}
          {(recommendation || lastSession || offerMax) && (
            <div className="ex-coach">
              {recommendation && recLabel && (
                <button
                  type="button"
                  className={`ex-rec ex-rec--${recTone}${showWhy ? ' ex-rec--open' : ''}`}
                  onClick={() => setShowWhy(v => !v)}
                  aria-expanded={showWhy}
                  aria-label={`${recLabel} — why?`}
                >
                  <span className="ex-rec-weight">{recLabel}</span>
                  <span className="ex-rec-why" aria-hidden="true">why</span>
                </button>
              )}
              {offerMax && (
                <button type="button" className="ex-max-offer" onClick={onSetMax}>
                  Know your 1RM? ›
                </button>
              )}
              {lastSession && (
                <button
                  type="button"
                  className="ex-last"
                  onClick={() => onViewHistory?.(exercise.id, exercise.name)}
                  aria-label={`History for ${exercise.name}`}
                  disabled={!onViewHistory}
                >
                  <span className="ex-last-label">Last · {lastSessionLabel(lastSession.completedAt)}</span>
                  <span className="ex-last-sets">{formatLastSets(lastSession.sets, unit)}{onViewHistory ? ' ›' : ''}</span>
                </button>
              )}
            </div>
          )}

          {/* Re-anchoring a load to a new rep range is a correction, not a
              verdict on the last session — the chip is coloured neutrally so a
              block that moves to higher reps doesn't read as a punishment. */}
          {recommendation && showWhy && (
            <div className={`ex-why ex-why--${recTone}`}>
              <p className="ex-why-reason">
                {recommendation.reason}
                {pctLabel && <span className="ex-rec-pct">{pctLabel}</span>}
              </p>
              {plan && <p className="ex-why-goal">{plan.goal}</p>}
            </div>
          )}
          {/* With nothing to recommend from, the goal line is the only guidance
              ("find a working weight") — it stays in view. */}
          {!recommendation && plan && <p className="ex-goal">{plan.goal}</p>}

          {regression && onRegress && (
            <div className="ex-regress">
              <span className="ex-regress-text">
                Three sessions short of the range. <strong>{regression.exercise.name}</strong> trains the
                same muscle with a way to start lighter — build strength there and come back to this.
              </span>
              <button className="ex-regress-btn" onClick={() => onRegress(regression)}>
                Add {regression.exercise.name} today
              </button>
            </div>
          )}

          {sets.length > 0 && (
            <div className="set-log">
              {sets.map((s, i) =>
                editingIndex === i ? (
                  <Fragment key={i}>
                  <div className={`set-row editing${s.warmup ? ' set-row--warmup' : ''}`}>
                    <span className="set-num">{setLabels[i]}</span>
                    {!timed && (
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
                        <span className="inline-unit">{weightUnit}</span>
                      </div>
                    )}
                    <div className="inline-field">
                      <input
                        className="inline-input"
                        type="number"
                        inputMode="numeric"
                        value={editReps}
                        onChange={e => setEditReps(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        autoFocus={timed}
                      />
                      <span className="inline-unit">{timed ? 'sec' : 'rp'}</span>
                    </div>
                    <button
                      className={`warmup-chip${editWarmup ? ' warmup-chip--on' : ''}`}
                      onClick={() => setEditWarmup(v => !v)}
                      aria-pressed={editWarmup}
                      title="Tag as warm-up"
                    >
                      W
                    </button>
                    {canVary && !editWarmup && (
                      <button
                        type="button"
                        className={`var-btn var-btn--sm${editVariation.technique || editVariation.grip ? ' var-btn--on' : ''}`}
                        onClick={() => setEditShowVariation(v => !v)}
                        aria-expanded={editShowVariation}
                        aria-label="How this set was done"
                        title="How this set was done"
                      >
                        <Icon name="sliders" size={14} />
                      </button>
                    )}
                    <button className="edit-confirm-btn" onClick={confirmEdit}>✓</button>
                    <button className="edit-cancel-btn" onClick={cancelEdit}>✗</button>
                  </div>
                  {editShowVariation && !editWarmup && (
                    <VariationPanel
                      value={editVariation}
                      techniques={techniqueOptions}
                      // A row can only continue a set that came before it
                      extensions={i > 0 ? extensionOptions : []}
                      grips={gripOptions}
                      onChange={setEditVariation}
                    />
                  )}
                  </Fragment>
                ) : (
                  <div
                    key={i}
                    className={`set-row set-row--done${s.warmup ? ' set-row--warmup' : ''}${isExtension(s.technique) ? ' set-row--ext' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit ${setLabels[i]}`}
                    onClick={() => startEdit(i)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(i); } }}
                  >
                    <span className="set-num">{setLabels[i]}</span>
                    {!timed && <span className="set-weight">{fmtWeight(s.weight)}</span>}
                    <span className="set-reps">{s.reps} {countLabel}</span>
                    {rowTag(s) && <span className="set-tag">{rowTag(s)}</span>}
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
            <div className={`set-inputs${row.kind === 'warmup' ? ' set-inputs--warmup' : ''}${row.kind === 'extension' ? ' set-inputs--ext' : ''}`}>
              <div className="input-row">
                <span className="set-num set-num--active">
                  {row.kind === 'warmup' ? 'Warm-up'
                    : row.kind === 'extension' ? `↳ ${extensionShort(row.technique!)}`
                    : `Set ${nextSetNum}`}
                </span>
                {!timed && (
                  <div className="weight-wrap">
                    <input
                      className="num-input"
                      type="number"
                      inputMode="decimal"
                      placeholder="Weight"
                      aria-label={`Weight for ${row.kind === 'warmup' ? 'warm-up' : row.kind === 'extension' ? TECHNIQUE_INFO[row.technique!].label.toLowerCase() : `set ${nextSetNum}`}`}
                      value={row.weight}
                      onChange={e => updateRow({ weight: e.target.value })}
                      onKeyDown={handleKeyDown}
                    />
                    <span className="input-unit">{weightUnit}</span>
                  </div>
                )}
                <div className={`reps-wrap${timed ? ' reps-wrap--solo' : ''}`}>
                  <input
                    className="num-input"
                    type="number"
                    inputMode="numeric"
                    placeholder={timed ? 'Seconds' : 'Reps'}
                    aria-label={`${timed ? 'Seconds' : 'Reps'} for ${row.kind === 'warmup' ? 'warm-up' : row.kind === 'extension' ? TECHNIQUE_INFO[row.technique!].label.toLowerCase() : `set ${nextSetNum}`}`}
                    value={row.reps}
                    onChange={e => updateRow({ reps: e.target.value })}
                    onKeyDown={handleKeyDown}
                  />
                  <span className="input-unit">{countLabel}</span>
                </div>
              </div>
              {showVariation && row.kind !== 'warmup' && (
                <VariationPanel
                  value={{ technique: row.technique, grip: row.grip }}
                  techniques={techniqueOptions}
                  extensions={lastWork ? extensionOptions : []}
                  grips={gripOptions}
                  onChange={setRowVariation}
                />
              )}
              <div className="log-actions">
                {draft !== null && (
                  <button type="button" className="draft-cancel-btn" onClick={() => { setDraft(null); setShowVariation(false); }}>
                    Cancel
                  </button>
                )}
                {canVary && row.kind !== 'warmup' && (
                  <button
                    type="button"
                    className={`var-btn${rowLabel ? ' var-btn--on' : ''}`}
                    onClick={() => setShowVariation(v => !v)}
                    aria-expanded={showVariation}
                    aria-label="How this set is done — rep style and grip"
                    title="Rep style and grip"
                  >
                    {rowLabel ?? <Icon name="sliders" size={16} />}
                  </button>
                )}
                <button className="log-btn" disabled={!canLog} onClick={handleLogSet}>
                  {logLabel}
                </button>
              </div>
            </div>
          )}

          {/* The rest of today's prescription in one line — enough to see the
              whole session without a row per set. */}
          {upcomingLabel && (
            <p className="ex-upcoming">
              <span className="ex-upcoming-label">Then</span>
              {upcomingLabel}
            </p>
          )}

          {/* Quiet, contextual actions: a warm-up only makes sense before the
              working sets start, an extra set only once the plan is done, and
              an exercise added mid-session can be taken out again. */}
          {draft === null && (workingSoFar === 0 || lastWork || planComplete || onRemove) && (
            <div className="ex-actions">
              {workingSoFar === 0 && (
                <button type="button" className="ex-action-btn" onClick={addWarmup}>
                  ＋ Warm-up
                </button>
              )}
              {lastWork && extensionOptions.length > 0 && (
                <button type="button" className="ex-action-btn" onClick={addExtension}>
                  {(lastWork.weight ?? 0) === 0 ? '＋ Rest-pause' : '＋ Drop set'}
                </button>
              )}
              {planComplete && (
                <button type="button" className="ex-action-btn" onClick={addExtraSet}>
                  ＋ Extra set
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="ex-action-btn ex-action-btn--remove"
                  onClick={onRemove}
                  aria-label={`Remove ${exercise.name} from this workout`}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {info.sheet}
    </div>
  );
}
