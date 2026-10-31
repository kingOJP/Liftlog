import { useEffect, useMemo, useState } from 'react';
import type { WorkoutDay } from '../data/program';
import { prescriptionLabel } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { getExerciseLibrary, getExerciseName } from '../data/programStore';
import { getExerciseMeta, unitFor } from '../data/exercises';
import {
  getOneRepMax, getProfileOrDefault, getStrengthGoal, getStrengthState, getTrainingGoal,
  removeOneRepMax, removeStrengthGoal, saveOneRepMax, saveStrengthGoal,
} from '../data/planStore';
import { effectiveExperience } from '../data/experience';
import { toPlanDate } from '../data/plan';
import {
  FEASIBILITY_LABEL, bestLoggedMax, currentMax, etaLabel, goalProgress, pctOfMax,
  programLoadsFor, projectGoal, strengthTrend,
} from '../data/strength';
import type { MaxSource, OneRepMax, StrengthGoal } from '../data/strength';
import { fmtWeight, fromDisplay, toDisplay, unitLabelFor } from '../data/units';
import './StrengthView.css';

interface Props {
  program: WorkoutDay[];
  /** open straight into one exercise's editor */
  exerciseId?: string;
  onBack: () => void;
  /** launch the plan wizard seeded to build a block around this lift */
  onPlanAround: (exerciseId: string) => void;
  /** called after any stored change (so the app can push a sync) */
  onChanged: () => void;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function nameFor(id: string): string {
  return getExerciseLibrary().find(e => e.id === id)?.name ?? getExerciseName(id);
}

/** Exercises with a load to have a max on — timed holds and bodyweight-only work are excluded. */
function loadableExercises(): { id: string; name: string }[] {
  return getExerciseLibrary()
    .filter(e => !e.archived && unitFor(e.id) !== 'seconds' && getExerciseMeta(e.id).weightType !== 'Bodyweight')
    .map(e => ({ id: e.id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function StrengthView({ program, exerciseId, onBack, onPlanAround, onChanged }: Props) {
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [editing, setEditing] = useState<string | null>(exerciseId ?? null);
  const [refresh, setRefresh] = useState(0);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(s => { if (!cancelled) setSnapshot(s); });
    return () => { cancelled = true; };
  }, []);

  const state = useMemo(() => getStrengthState(), [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { setRefresh(r => r + 1); onChanged(); };

  // Every lift with a record or a goal, plus the program's loaded lifts so the
  // list is useful before anything has been entered.
  const trackedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of state.maxes) ids.add(m.exerciseId);
    for (const g of state.goals) ids.add(g.exerciseId);
    return [...ids].sort((a, b) => nameFor(a).localeCompare(nameFor(b)));
  }, [state]);

  const back = () => {
    if (editing && !exerciseId) { setEditing(null); setPicking(false); return; }
    onBack();
  };

  if (editing) {
    return (
      <div className="strength-view">
        <header className="strength-header">
          <button className="back-btn" onClick={back} aria-label="Back">&#8592;</button>
          <div className="strength-title-group">
            <span className="strength-eyebrow">1RM &amp; goal</span>
            <span className="strength-title">{nameFor(editing)}</span>
          </div>
        </header>
        <div className="strength-body">
          <LiftEditor
            key={`${editing}:${refresh}`}
            exerciseId={editing}
            program={program}
            snapshot={snapshot}
            onChanged={changed}
            onPlanAround={() => onPlanAround(editing)}
          />
        </div>
      </div>
    );
  }

  const pickable = loadableExercises().filter(e => !trackedIds.includes(e.id));

  return (
    <div className="strength-view">
      <header className="strength-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="strength-title-group">
          <span className="strength-eyebrow">Strength</span>
          <span className="strength-title">1RMs &amp; goals</span>
        </div>
      </header>

      <div className="strength-body">
        <p className="strength-intro">
          Enter a one-rep max and the coach prescribes your working weights as a percentage of it —
          including the first time you ever log the lift. Set a target and it estimates how long the
          climb will take.
        </p>

        {trackedIds.length > 0 && (
          <section className="strength-section">
            <span className="strength-label">Your lifts</span>
            <div className="lift-list">
              {trackedIds.map(id => (
                <LiftRow
                  key={id}
                  exerciseId={id}
                  max={state.maxes.find(m => m.exerciseId === id) ?? null}
                  goal={state.goals.find(g => g.exerciseId === id) ?? null}
                  snapshot={snapshot}
                  onClick={() => setEditing(id)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="strength-section">
          {picking ? (
            <>
              <span className="strength-label">Which lift?</span>
              <select
                className="strength-select"
                defaultValue=""
                autoFocus
                onChange={e => { if (e.target.value) { setEditing(e.target.value); setPicking(false); } }}
              >
                <option value="" disabled>Pick an exercise…</option>
                {pickable.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button className="strength-text-btn" onClick={() => setPicking(false)}>Cancel</button>
            </>
          ) : (
            <button className="strength-primary-btn" onClick={() => setPicking(true)}>
              ＋ Add a lift
            </button>
          )}
          {trackedIds.length === 0 && (
            <p className="strength-hint">
              Start with the lifts you know your numbers for — a tested single, or a confident estimate.
              The coach treats a tested max as a measurement and a guess as a guess.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── One lift in the list ──────────────────────────────────────────────────────

function LiftRow({ exerciseId, max, goal, snapshot, onClick }: {
  exerciseId: string;
  max: OneRepMax | null;
  goal: StrengthGoal | null;
  snapshot: TrainingSnapshot | null;
  onClick: () => void;
}) {
  const logged = snapshot ? bestLoggedMax(snapshot, exerciseId) : null;
  const current = currentMax(max, logged);
  const projection = goal && current
    ? projectGoal({
        current: current.value, target: goal.targetWeight,
        experience: effectiveExperience(getProfileOrDefault(), snapshot),
        goal: getTrainingGoal(),
        trend: snapshot ? strengthTrend(snapshot, exerciseId) : null,
      })
    : null;
  const progress = goal && current ? goalProgress(max?.weight ?? current.value, current.value, goal.targetWeight) : null;

  return (
    <button className="lift-row" onClick={onClick}>
      <div className="lift-row-head">
        <span className="lift-row-name">{nameFor(exerciseId)}</span>
        <span className="lift-row-max">
          {current ? fmtWeight(current.value) : '—'}
          {current && (
            <span className="lift-row-basis">
              {current.basis === 'log' ? (current.logExceedsStored ? ' · log, up from test' : ' · from your log')
                : current.basis === 'tested' ? ' · tested' : ' · estimate'}
            </span>
          )}
        </span>
      </div>
      {goal && (
        <div className="lift-row-goal">
          <div className="lift-progress-track">
            <div className="lift-progress-fill" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <span className="lift-row-goal-text">
            Goal {fmtWeight(goal.targetWeight)}
            {projection ? ` · ${etaLabel(projection)}` : ''}
          </span>
        </div>
      )}
    </button>
  );
}

// ── The editor for one lift ───────────────────────────────────────────────────

function LiftEditor({ exerciseId, program, snapshot, onChanged, onPlanAround }: {
  exerciseId: string;
  program: WorkoutDay[];
  snapshot: TrainingSnapshot | null;
  onChanged: () => void;
  onPlanAround: () => void;
}) {
  const stored = getOneRepMax(exerciseId);
  const storedGoal = getStrengthGoal(exerciseId);
  const weightType = getExerciseMeta(exerciseId).weightType;

  const unit = unitLabelFor();
  const [weight, setWeight] = useState(stored ? String(toDisplay(stored.weight)) : '');
  const [source, setSource] = useState<MaxSource>(stored?.source ?? 'tested');
  const [date, setDate] = useState(stored?.date ?? toPlanDate(new Date()));
  const [target, setTarget] = useState(storedGoal ? String(toDisplay(storedGoal.targetWeight)) : '');
  const [savedFlash, setSavedFlash] = useState<'max' | 'goal' | null>(null);
  // A value being typed is "as of now" — fresher than anything in the log.
  const [openedAt] = useState(() => Date.now());

  const logged = snapshot ? bestLoggedMax(snapshot, exerciseId) : null;
  const trend = snapshot ? strengthTrend(snapshot, exerciseId) : null;
  const experience = effectiveExperience(getProfileOrDefault(), snapshot);
  const trainingGoal = getTrainingGoal();

  const typedMax = fromDisplay(parseFloat(weight));
  const maxValid = isFinite(typedMax) && typedMax > 0;
  const maxDirty = !stored || stored.weight !== typedMax || stored.source !== source || stored.date !== date;

  // What the coach currently believes — the typed value previews live, so the
  // percent table and projection respond as the lifter types.
  const preview: OneRepMax | null = maxValid
    ? { exerciseId, weight: typedMax, source, date, updatedAt: maxDirty ? openedAt : stored!.updatedAt }
    : stored;
  const current = currentMax(preview, logged);

  const slots = current ? programLoadsFor(exerciseId, current.value, program, weightType) : [];
  const inProgram = program.some(d => d.exercises.some(e => e.id === exerciseId));

  const typedTarget = fromDisplay(parseFloat(target));
  const targetValid = isFinite(typedTarget) && typedTarget > 0;
  const goalDirty = !storedGoal || storedGoal.targetWeight !== typedTarget;
  const projection = targetValid
    ? projectGoal({ current: current?.value ?? 0, target: typedTarget, experience, goal: trainingGoal, trend })
    : null;

  function flash(kind: 'max' | 'goal') {
    setSavedFlash(kind);
    setTimeout(() => setSavedFlash(null), 1500);
  }

  function saveMax() {
    if (!maxValid) return;
    saveOneRepMax({ exerciseId, weight: typedMax, source, date });
    flash('max');
    onChanged();
  }

  function adoptLogged() {
    if (!logged) return;
    setWeight(String(toDisplay(Math.round(logged.e1rm))));
    setSource(logged.reps === 1 ? 'tested' : 'estimated');
    setDate(toPlanDate(new Date(logged.ts)));
  }

  function saveGoal() {
    if (!targetValid) return;
    saveStrengthGoal(exerciseId, typedTarget);
    flash('goal');
    onChanged();
  }

  const logSuggestsHigher = logged != null && stored != null && logged.ts > stored.updatedAt && logged.e1rm > stored.weight;

  return (
    <>
      {/* ── The max ── */}
      <section className="strength-section">
        <span className="strength-label">One-rep max</span>
        <div className="max-input-row">
          <div className="max-weight-wrap">
            <input
              className="strength-input"
              type="number"
              inputMode="decimal"
              placeholder={unit === 'kg' ? 'e.g. 110' : 'e.g. 245'}
              aria-label={`One-rep max in ${unit}`}
              value={weight}
              onChange={e => setWeight(e.target.value)}
            />
            <span className="strength-input-unit">{unit}</span>
          </div>
          <div className="source-toggle" role="radiogroup" aria-label="How do you know this?">
            {(['tested', 'estimated'] as MaxSource[]).map(s => (
              <button
                key={s}
                role="radio"
                aria-checked={source === s}
                className={`source-chip${source === s ? ' source-chip--on' : ''}`}
                onClick={() => setSource(s)}
              >
                {s === 'tested' ? 'Tested' : 'Estimate'}
              </button>
            ))}
          </div>
        </div>
        <label className="strength-date-label">
          <span>As of</span>
          <input
            className="strength-date"
            type="date"
            value={date}
            max={toPlanDate(new Date())}
            onChange={e => setDate(e.target.value)}
          />
        </label>

        {logged && (
          <div className={`evidence${logSuggestsHigher ? ' evidence--up' : ''}`}>
            <span className="evidence-text">
              {logSuggestsHigher
                ? `Your log says you've got stronger since: ~${Math.round(toDisplay(logged.e1rm))} ${unit} from ${toDisplay(logged.weight)} × ${logged.reps} on ${fmtDate(logged.ts)}.`
                : `Your log estimates ~${Math.round(toDisplay(logged.e1rm))} ${unit} (${toDisplay(logged.weight)} × ${logged.reps} on ${fmtDate(logged.ts)}).`}
            </span>
            <button className="strength-text-btn" onClick={adoptLogged}>Use this</button>
          </div>
        )}
        {!logged && !stored && (
          <p className="strength-hint">
            Nothing logged for this lift yet — an entered max is what lets the coach prescribe a real
            starting weight instead of asking you to find one.
          </p>
        )}

        <div className="strength-actions">
          <button className="strength-primary-btn" disabled={!maxValid || (!maxDirty && savedFlash !== 'max')} onClick={saveMax}>
            {savedFlash === 'max' ? 'Saved' : stored ? 'Update max' : 'Save max'}
          </button>
          {stored && (
            <button className="strength-text-btn strength-text-btn--danger" onClick={() => { removeOneRepMax(exerciseId); onChanged(); }}>
              Remove
            </button>
          )}
        </div>
      </section>

      {/* ── What it means in the plan ── */}
      {current && (
        <section className="strength-section">
          <span className="strength-label">In your plan · % of {fmtWeight(current.value)}</span>
          {slots.length > 0 ? (
            <div className="pct-table">
              {slots.map(({ day, slot, band }, i) => (
                <div className="pct-row" key={`${day.id}:${i}`}>
                  <div className="pct-row-main">
                    <span className="pct-row-day">{day.label}</span>
                    <span className="pct-row-dose">{prescriptionLabel(slot)}</span>
                  </div>
                  {band ? (
                    <div className="pct-row-load">
                      <span className="pct-row-weight">{fmtWeight(band.working)}</span>
                      <span className="pct-row-pct">{band.pct.low}–{band.pct.high}% · up to ~{Math.round(toDisplay(band.top))}</span>
                    </div>
                  ) : (
                    <span className="pct-row-pct">no rep range set</span>
                  )}
                </div>
              ))}
              <p className="strength-hint">
                The working weight is where the top of each rep range is about your limit, shaded 5% so
                every set is completable. The coach starts there and progresses from what you actually lift.
              </p>
            </div>
          ) : (
            <p className="strength-hint">
              {nameFor(exerciseId)} isn't in your current program. Add it to a day, or have the coach
              design the next block around it.
            </p>
          )}
        </section>
      )}

      {/* ── The goal ── */}
      <section className="strength-section">
        <span className="strength-label">1RM goal</span>
        <div className="max-weight-wrap">
          <input
            className="strength-input"
            type="number"
            inputMode="decimal"
            placeholder={current ? `e.g. ${toDisplay(Math.round(current.value * 1.1 / 5) * 5)}` : 'Target 1RM'}
            aria-label={`Target one-rep max in ${unit}`}
            value={target}
            onChange={e => setTarget(e.target.value)}
          />
          <span className="strength-input-unit">{unit}</span>
        </div>

        {projection && (
          <div className={`projection projection--${projection.feasibility}`}>
            <div className="projection-head">
              <span className="projection-range">
                {projection.current > 0 ? `${toDisplay(projection.current)} → ${fmtWeight(projection.target)}` : `→ ${fmtWeight(projection.target)}`}
                {projection.current > 0 && projection.gapPct > 0 && (
                  <span className="projection-gap"> · +{Math.round(projection.gapPct)}%</span>
                )}
              </span>
              <span className="projection-badge">{FEASIBILITY_LABEL[projection.feasibility]}</span>
            </div>
            {projection.current > 0 && projection.feasibility !== 'reached' && (
              <div className="projection-eta">
                <span className="projection-eta-main">{etaLabel(projection)}</span>
                {projection.etaTs && (
                  <span className="projection-eta-date">
                    around {new Date(projection.etaTs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
            )}
            {projection.current > 0 && projection.feasibility !== 'reached' && (
              <p className="projection-rate">
                Assumes ~{projection.ratePctPerWeek.toFixed(2)}% a week
                {projection.basis === 'observed' ? ' — your own recent pace on this lift' : projection.basis === 'tempered' ? ' — tempered for a flat trend' : ` — typical for ${experience === 'intermediate' || experience === 'advanced' ? 'an' : 'a'} ${experience} lifter`}
                {current?.basis === 'log' ? ', from the max your log implies' : ''}.
              </p>
            )}
            {projection.notes.map((n, i) => <p className="projection-note" key={i}>{n}</p>)}
          </div>
        )}

        <div className="strength-actions">
          <button className="strength-primary-btn" disabled={!targetValid || (!goalDirty && savedFlash !== 'goal')} onClick={saveGoal}>
            {savedFlash === 'goal' ? 'Added to your plan' : storedGoal ? 'Update goal' : 'Add to my plan'}
          </button>
          {storedGoal && (
            <button className="strength-text-btn strength-text-btn--danger" onClick={() => { removeStrengthGoal(exerciseId); onChanged(); }}>
              Remove goal
            </button>
          )}
        </div>
        <p className="strength-hint">
          {inProgram
            ? 'Adding the goal keeps it on your Journey with a live estimate; the lift is already in your program, so the coach simply keeps progressing it. Or have the coach design a block around it — a strength block with this lift leading its day.'
            : 'Adding the goal keeps it on your Journey with a live estimate — but this lift isn\'t in your program yet, so nothing is training it. Have the coach design a block around it: a strength block with this lift leading its day.'}
        </p>
        <button
          className="strength-secondary-btn"
          onClick={() => {
            // The goal rides along into the plan even if they didn't tap Add first.
            if (targetValid && goalDirty) saveStrengthGoal(exerciseId, typedTarget);
            if (maxValid && maxDirty) saveOneRepMax({ exerciseId, weight: typedMax, source, date });
            onPlanAround();
          }}
        >
          Design a block around this lift
        </button>
      </section>

      {trend && (
        <p className="strength-footnote">
          Recent trend: est. 1RM {trend.ratePctPerWeek >= 0 ? 'up' : 'down'} {Math.abs(trend.ratePctPerWeek).toFixed(1)}% a week
          across {trend.points} sessions.{current && stored ? ` Working weights are prescribed as % of ${fmtWeight(current.value)} (${pctOfMax(current.value * 0.68, current.value)}–${pctOfMax(current.value * 0.86, current.value)}% depending on the rep range).` : ''}
        </p>
      )}
    </>
  );
}
