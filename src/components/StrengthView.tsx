import { useEffect, useMemo, useState } from 'react';
import type { WorkoutDay } from '../data/program';
import { prescriptionLabel } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { getExerciseLibrary, getExerciseName } from '../data/programStore';
import { getExerciseMeta, unitFor } from '../data/exercises';
import {
  getActiveBlockInfo, getOneRepMax, getProfileOrDefault, getStrengthGoal, getStrengthState,
  getTrainingGoal, removeOneRepMax, removeStrengthGoal, saveOneRepMax, saveStrengthGoal,
} from '../data/planStore';
import { effectiveExperience } from '../data/experience';
import { blockWeekIndex, productiveWeeks, toPlanDate } from '../data/plan';
import {
  bestLoggedMax, currentMax, goalProgress, pctOfMax, programLoadsFor, projectBlock,
  strengthTrend, supportingDays, techniqueRead, variationsFor, whatItTakes,
} from '../data/strength';
import type { BlockProjection, MaxSource, OneRepMax, StrengthGoal } from '../data/strength';
import { getStoredProgram, saveStoredProgram } from '../data/programStore';
import { slotFor } from '../data/prescribe';
import { fmtWeight, fromDisplay, toDisplay, unitLabelFor } from '../data/units';
import './StrengthView.css';

interface Props {
  program: WorkoutDay[];
  /** open straight into one exercise's editor */
  exerciseId?: string;
  onBack: () => void;
  /** launch the plan wizard seeded to build a block around this lift */
  onPlanAround: (exerciseId: string) => void;
  /** called after any stored change — including a program edit (so the app refreshes + syncs) */
  onChanged: () => void;
}

/**
 * The window a block estimate is made over: the productive weeks left in the
 * active block, or a typical block when nothing is scheduled.
 */
function estimateWeeks(): { weeks: number; label: string } {
  const info = getActiveBlockInfo();
  if (info && !info.block.openEnded) {
    const idx = Math.max(0, blockWeekIndex(info.block));
    const left = productiveWeeks(info.block.phases.slice(idx));
    if (left > 0) return { weeks: left, label: `the ${left} hard week${left === 1 ? '' : 's'} left in this block` };
  }
  return { weeks: 6, label: 'a typical 6-week block' };
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
          including the first time you ever log the lift. Pick a lift to build and it tells you what
          the climb takes, reads your log for the weak link, and programs it.
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
  const target = goal?.targetWeight;
  const progress = target != null && current ? goalProgress(max?.weight ?? current.value, current.value, target) : null;
  const frequency = goal ? supportingDays(getStoredProgram(), exerciseId).length : 0;

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
          {progress != null && (
            <div className="lift-progress-track">
              <div className="lift-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <span className="lift-row-goal-text">
            Building{target != null ? ` toward ${fmtWeight(target)}` : ''}
            {frequency > 0 ? ` · trained ${frequency}× a week` : ' · not in your current program'}
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
  const [target, setTarget] = useState(storedGoal?.targetWeight != null ? String(toDisplay(storedGoal.targetWeight)) : '');
  const [savedFlash, setSavedFlash] = useState<'max' | 'goal' | 'plan' | null>(null);
  // The "add to my current plan" picker
  const [adding, setAdding] = useState(false);
  const [mainDayId, setMainDayId] = useState<number | ''>('');
  const [variationId, setVariationId] = useState<string>('');
  const [variationDayId, setVariationDayId] = useState<number | ''>('');
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

  const typedTarget = fromDisplay(parseFloat(target));
  const targetValid = isFinite(typedTarget) && typedTarget > 0;
  const targetOrNull = targetValid ? typedTarget : null;
  const goalDirty = !storedGoal || (storedGoal.targetWeight ?? null) !== targetOrNull;

  // What the climb consists of, and what the log says the weak link is.
  const takes = whatItTakes(exerciseId, nameFor(exerciseId));
  const read = snapshot ? techniqueRead(snapshot, exerciseId, preview) : null;
  const trainedOn = supportingDays(program, exerciseId);
  const frequency = trainedOn.length;
  const variations = variationsFor(exerciseId);

  // The end-of-block estimate — only once something is actually training the
  // lift, because the number is a property of the plan, not of the lifter.
  const window = estimateWeeks();
  const estimate: BlockProjection | null = current && frequency > 0
    ? projectBlock({
        current: current.value, weeks: window.weeks, frequency, experience, goal: trainingGoal, trend,
        target: targetOrNull,
      })
    : null;

  const daysWithout = program.filter(d => !d.exercises.some(e => e.id === exerciseId));
  // Already programmed → the picker only asks where a variation goes.
  const needMain = frequency === 0;

  function flash(kind: 'max' | 'goal' | 'plan') {
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

  /** Start (or update) tracking this lift; the target is optional. */
  function saveGoal() {
    saveStrengthGoal(exerciseId, targetOrNull);
    flash('goal');
    onChanged();
  }

  /** Put the lift (and optionally a variation) into the live program as main slots. */
  function addToPlan() {
    if (needMain && mainDayId === '') return;
    const next = program.map(d => ({ ...d, exercises: [...d.exercises] }));
    const place = (dayId: number, id: string) => {
      const day = next.find(d => d.id === dayId);
      if (!day || day.exercises.some(e => e.id === id)) return;
      const slot = slotFor(id, nameFor(id), { snapshot, slot: { main: true } });
      day.exercises.unshift({ ...slot, main: true });
    };
    if (needMain && mainDayId !== '') place(mainDayId, exerciseId);
    if (variationId && variationDayId !== '' && variationDayId !== mainDayId) place(variationDayId, variationId);
    saveStoredProgram(next);
    saveStrengthGoal(exerciseId, targetOrNull);
    setAdding(false);
    flash('plan');
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

      {/* ── Building this lift ── */}
      <section className="strength-section">
        <span className="strength-label">Get stronger on this lift</span>

        {read && (
          <div className={`technique technique--${read.kind}`}>
            <span className="technique-head">{read.headline}</span>
            <p className="technique-detail">{read.detail}</p>
            {read.suggestions.length > 0 && (
              <ul className="technique-list">
                {read.suggestions.map((sug, i) => <li key={i}>{sug}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="takes">
          <span className="takes-head">What it takes</span>
          <p className="takes-line">{takes.frequency}</p>
          {takes.variations.length > 0 && (
            <ul className="takes-list">
              {takes.variations.map(v => (
                <li key={v.id}><strong>{nameFor(v.id)}</strong> — {v.why}</li>
              ))}
            </ul>
          )}
          <p className="strength-hint">{takes.variationsNote} {takes.accessories}</p>
        </div>

        <div className={`plan-status${frequency > 0 ? '' : ' plan-status--off'}`}>
          {frequency > 0 ? (
            <>
              <span className="plan-status-head">
                In your plan · trained {frequency}× a week
              </span>
              <span className="plan-status-detail">
                {trainedOn.map(t => `${t.day.label}: ${t.ids.map(nameFor).join(' + ')}`).join(' · ')}
              </span>
              {estimate && (
                <p className="plan-status-estimate">
                  Over {window.label} this is built to take your max from {fmtWeight(estimate.current)} to roughly{' '}
                  <strong>{toDisplay(estimate.low)}–{fmtWeight(estimate.high)}</strong>
                  {estimate.target && estimate.target.verdict === 'inside' ? ` — your ${fmtWeight(estimate.target.weight)} target sits inside that.` : '.'}
                  {estimate.notes.map((n, i) => <span key={i}> {n}</span>)}
                </p>
              )}
              {!estimate && (
                <p className="strength-hint">Enter a 1RM above (or log the lift) and the coach estimates what this block is built to deliver.</p>
              )}
              {frequency < 2 && variations.length > 0 && !adding && (
                <p className="strength-hint">Once a week is thin for a max. Add a second day below with a variation.</p>
              )}
            </>
          ) : (
            <span className="plan-status-head">Not in your current program — nothing is training it yet.</span>
          )}
        </div>

        <div className="max-weight-wrap">
          <input
            className="strength-input"
            type="number"
            inputMode="decimal"
            placeholder="Target max (optional)"
            aria-label={`Target one-rep max in ${unit}, optional`}
            value={target}
            onChange={e => setTarget(e.target.value)}
          />
          <span className="strength-input-unit">{unit}</span>
        </div>
        {estimate?.target?.verdict === 'beyond' && (
          <p className="strength-hint">{estimate.notes.find(n => /block/.test(n)) ?? ''}</p>
        )}

        {adding ? (
          <div className="add-plan">
            {needMain && (
            <label className="add-plan-field">
              <span>{nameFor(exerciseId)} — main lift on</span>
              <select className="strength-select" value={mainDayId} onChange={e => setMainDayId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Pick a day…</option>
                {daysWithout.map(d => <option key={d.id} value={d.id}>{d.label} · {d.muscleGroups}</option>)}
              </select>
            </label>
            )}
            {variations.length > 0 && (needMain ? daysWithout.length > 1 : daysWithout.length > 0) && (
              <>
                <label className="add-plan-field">
                  <span>{needMain ? 'Second day — a variation (recommended)' : 'Variation for the extra day'}</span>
                  <select className="strength-select" value={variationId} onChange={e => setVariationId(e.target.value)}>
                    <option value="">{needMain ? 'No second day' : 'Pick a variation…'}</option>
                    {variations.map(v => <option key={v.id} value={v.id}>{nameFor(v.id)}</option>)}
                  </select>
                </label>
                {variationId && (
                  <label className="add-plan-field">
                    <span>{nameFor(variationId)} on</span>
                    <select className="strength-select" value={variationDayId} onChange={e => setVariationDayId(e.target.value === '' ? '' : Number(e.target.value))}>
                      <option value="">Pick a day…</option>
                      {daysWithout.filter(d => d.id !== mainDayId && !d.exercises.some(e => e.id === variationId)).map(d => (
                        <option key={d.id} value={d.id}>{d.label} · {d.muscleGroups}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <div className="strength-actions">
              <button
                className="strength-primary-btn"
                disabled={(needMain ? mainDayId === '' : !variationId) || (!!variationId && variationDayId === '')}
                onClick={addToPlan}
              >
                Add to my plan
              </button>
              <button className="strength-text-btn" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="strength-actions strength-actions--stack">
            {daysWithout.length > 0 && (needMain || variations.some(v => daysWithout.some(d => !d.exercises.some(e => e.id === v.id)))) && (
              <button
                className={frequency > 0 ? 'strength-secondary-btn' : 'strength-primary-btn'}
                onClick={() => { setMainDayId(''); setVariationId(variations[0]?.id ?? ''); setVariationDayId(''); setAdding(true); }}
              >
                {savedFlash === 'plan' ? 'Added to your plan' : frequency > 0 ? 'Add another day' : 'Add to my current plan'}
              </button>
            )}
            <button
              className="strength-secondary-btn"
              onClick={() => {
                // The lift rides into the plan as a goal even if nothing was tapped first.
                saveStrengthGoal(exerciseId, targetOrNull);
                if (maxValid && maxDirty) saveOneRepMax({ exerciseId, weight: typedMax, source, date });
                onPlanAround();
              }}
            >
              Build a block around it
            </button>
            {storedGoal ? (
              <div className="strength-actions">
                {goalDirty && (
                  <button className="strength-text-btn" onClick={saveGoal}>
                    {savedFlash === 'goal' ? 'Saved' : 'Save target'}
                  </button>
                )}
                <button className="strength-text-btn strength-text-btn--danger" onClick={() => { removeStrengthGoal(exerciseId); onChanged(); }}>
                  Stop tracking this lift
                </button>
              </div>
            ) : (
              <button className="strength-text-btn" onClick={saveGoal}>
                {savedFlash === 'goal' ? 'Tracking' : 'Just track it on my Journey'}
              </button>
            )}
          </div>
        )}
        <p className="strength-hint">
          “Add to my current plan” puts the lift at the top of a day as its main lift — and a variation on a second
          day — in the program you’re running now. “Build a block around it” has the coach design the next
          block with this lift leading, trained 2–3× a week.
        </p>
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
