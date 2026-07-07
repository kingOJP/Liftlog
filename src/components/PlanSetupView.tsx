import { useEffect, useMemo, useState } from 'react';
import type { WorkoutDay, Exercise } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { GOALS, PHASE_INFO, nextMonday, parsePlanDate } from '../data/plan';
import type { Goal } from '../data/plan';
import { buildPlanProposal, defaultBlockWeeks } from '../data/planner';
import type { PlannerInput, PlanProposal, ExerciseDecision } from '../data/planner';
import { activateProposal, getActiveBlockInfo, getLatestRetrospective } from '../data/planStore';
import { computeBlockRetrospective } from '../data/retrospective';
import { suggestReplacements } from '../data/substitution';
import type { ReplacementSuggestion } from '../data/substitution';
import './PlanSetupView.css';

interface Props {
  /** the live program — continuity context for the planner */
  program: WorkoutDay[];
  onBack: () => void;
  onActivated: () => void;
}

type Step = 'goal' | 'structure' | 'workouts';

const WEEK_OPTIONS = [4, 5, 6, 8];
const DAY_OPTIONS = [2, 3, 4, 5, 6];

export default function PlanSetupView({ program, onBack, onActivated }: Props) {
  const [step, setStep] = useState<Step>('goal');
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

  // Step 1 inputs
  const [goal, setGoal] = useState<Goal>('hypertrophy');
  const [daysPerWeek, setDaysPerWeek] = useState(program.length >= 2 && program.length <= 6 ? program.length : 4);
  const [weeks, setWeeks] = useState(defaultBlockWeeks());
  const [includeDeload, setIncludeDeload] = useState(true);
  const [startDate, setStartDate] = useState(nextMonday());
  const [notes, setNotes] = useState('');

  // Steps 2–3
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [decisions, setDecisions] = useState<Map<string, ExerciseDecision>>(new Map());
  const [swapTarget, setSwapTarget] = useState<{ dayId: number; exerciseId: string } | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(s => {
      if (cancelled) return;
      setSnapshot(s);
      setSnapshotReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // The previous block's findings feed the planner. If a block is still
  // active (e.g. the open-ended foundation block), review it live so its
  // lessons apply to this plan even before it's formally wrapped up.
  const activeInfo = useMemo(() => getActiveBlockInfo(), []);
  const plannerRetro = useMemo(() => {
    if (activeInfo && snapshot && snapshot.sessions.length > 0) {
      return computeBlockRetrospective(activeInfo.block, snapshot);
    }
    return getLatestRetrospective();
  }, [activeInfo, snapshot]);

  // Offer a recovery opener only right after finished structured training —
  // returning from a wrapped-up block, not from open-ended lifting.
  const [openWithRecovery] = useState(() => {
    const latest = getLatestRetrospective();
    return latest != null && Date.now() - latest.to < 21 * 86_400_000;
  });

  const startDateValid = parsePlanDate(startDate) != null;

  function generate() {
    const input: PlannerInput = {
      goal, daysPerWeek, weeks, includeDeload, openWithRecovery, startDate,
      notes: notes.trim(),
    };
    const p = buildPlanProposal(input, program, snapshot, plannerRetro);
    setProposal(p);
    setDays(p.days.map(d => ({ ...d, exercises: [...d.exercises] })));
    setDecisions(new Map(p.decisions.map(d => [`${d.dayId}:${d.exerciseId}`, d])));
    setSwapTarget(null);
  }

  function handleContinueToStructure() {
    generate();
    setStep('structure');
  }

  function replaceExercise(dayId: number, oldEx: Exercise, sug: ReplacementSuggestion) {
    setDays(prev => prev.map(d => d.id !== dayId ? d : {
      ...d,
      exercises: d.exercises.map(e => e.id !== oldEx.id ? e : {
        id: sug.exercise.id,
        name: sug.exercise.name,
        sets: oldEx.sets,
        repLow: oldEx.repLow,
        repHigh: oldEx.repHigh,
      }),
    }));
    setDecisions(prev => {
      const next = new Map(prev);
      next.delete(`${dayId}:${oldEx.id}`);
      next.set(`${dayId}:${sug.exercise.id}`, {
        exerciseId: sug.exercise.id,
        name: sug.exercise.name,
        dayId,
        status: 'replacement',
        replacesName: oldEx.name,
        reason: sug.reasons[0] ?? 'Your pick during review.',
      });
      return next;
    });
    setSwapTarget(null);
  }

  function removeExercise(dayId: number, exerciseId: string) {
    setDays(prev => prev.map(d => d.id !== dayId ? d : {
      ...d, exercises: d.exercises.filter(e => e.id !== exerciseId),
    }));
    setSwapTarget(null);
  }

  function handleActivate() {
    if (!proposal || activating) return;
    if (days.some(d => d.exercises.length === 0)) return;
    setActivating(true);
    // Close the running block with a review computed from everything logged —
    // that retrospective is what the block hands to the future.
    const outgoingRetro = activeInfo && snapshot && snapshot.sessions.length > 0
      ? computeBlockRetrospective(activeInfo.block, snapshot)
      : null;
    activateProposal({ ...proposal, days }, outgoingRetro);
    onActivated();
  }

  const allIds = useMemo(() => new Set(days.flatMap(d => d.exercises.map(e => e.id))), [days]);

  function suggestionsFor(dayId: number, ex: Exercise): ReplacementSuggestion[] {
    const day = days.find(d => d.id === dayId);
    if (!day) return [];
    return suggestReplacements(ex, day, snapshot, 5)
      .filter(s => !allIds.has(s.exercise.id))
      .slice(0, 3);
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const header = (
    <header className="plan-setup-header">
      <button
        className="back-btn"
        onClick={() => {
          if (step === 'goal') onBack();
          else if (step === 'structure') setStep('goal');
          else setStep('structure');
        }}
        aria-label="Back"
      >
        &#8592;
      </button>
      <div className="plan-setup-title">
        <span>New training plan</span>
        <span className="plan-setup-step">
          {step === 'goal' ? 'Step 1 · Your goal' : step === 'structure' ? 'Step 2 · The plan' : 'Step 3 · The workouts'}
        </span>
      </div>
    </header>
  );

  if (step === 'goal') {
    return (
      <div className="plan-setup">
        {header}
        <div className="plan-setup-body">
          <section className="setup-section">
            <span className="setup-label">What matters most right now?</span>
            <div className="goal-list">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  className={`goal-card${goal === g.id ? ' goal-card--active' : ''}`}
                  onClick={() => setGoal(g.id)}
                >
                  <span className="goal-card-label">{g.label}</span>
                  <span className="goal-card-blurb">{g.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="setup-section">
            <span className="setup-label">Days you can train per week</span>
            <div className="chip-row">
              {DAY_OPTIONS.map(n => (
                <button
                  key={n}
                  className={`setup-chip${daysPerWeek === n ? ' setup-chip--active' : ''}`}
                  onClick={() => setDaysPerWeek(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </section>

          <section className="setup-section">
            <span className="setup-label">Block length</span>
            <div className="chip-row">
              {WEEK_OPTIONS.map(n => (
                <button
                  key={n}
                  className={`setup-chip${weeks === n ? ' setup-chip--active' : ''}`}
                  onClick={() => setWeeks(n)}
                >
                  {n} wk
                </button>
              ))}
            </div>
            <label className="setup-toggle">
              <input
                type="checkbox"
                checked={includeDeload}
                onChange={e => setIncludeDeload(e.target.checked)}
              />
              <span>End with a deload week</span>
            </label>
            <p className="setup-hint">
              Blocks are how the coach plans: train hard for a stretch, shed the fatigue,
              review what worked, then build the next block on it.
            </p>
          </section>

          <section className="setup-section">
            <span className="setup-label">Start date</span>
            <input
              className="setup-date-input"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              aria-invalid={!startDateValid}
            />
            {!startDateValid && <p className="setup-hint setup-hint--error">Pick a valid date.</p>}
          </section>

          <section className="setup-section">
            <span className="setup-label">Anything the coach should know? <em>(optional)</em></span>
            <textarea
              className="setup-notes"
              rows={3}
              placeholder="Injuries, equipment limits, schedule, other goals — e.g. “no barbell at my gym”, “left knee pain”…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </section>
        </div>

        <div className="plan-setup-footer">
          <button
            className="setup-primary-btn"
            disabled={!snapshotReady || !startDateValid}
            onClick={handleContinueToStructure}
          >
            {snapshotReady ? 'Design my plan' : 'Reading your history…'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'structure' && proposal) {
    return (
      <div className="plan-setup">
        {header}
        <div className="plan-setup-body">
          <div className={`confidence confidence--${proposal.confidence.level}`}>
            <span className="confidence-level">
              {proposal.confidence.level === 'high' ? 'Personalized to your training'
                : proposal.confidence.level === 'medium' ? 'Partly personalized'
                : 'Evidence-based starting point'}
            </span>
            <span className="confidence-detail">{proposal.confidence.detail}</span>
          </div>

          <section className="setup-section">
            <span className="setup-label">Training split</span>
            <div className="structure-split">{proposal.splitName}</div>
            <p className="setup-hint">{proposal.splitReason}</p>
          </section>

          <section className="setup-section">
            <span className="setup-label">The {proposal.phases.length} weeks</span>
            <div className="structure-weeks">
              {proposal.phases.map((p, i) => (
                <div className={`structure-week structure-week--${p}`} key={i}>
                  <span className="structure-week-num">Week {i + 1}</span>
                  <span className="structure-week-phase">{PHASE_INFO[p].label}</span>
                  <span className="structure-week-blurb">{PHASE_INFO[p].blurb}</span>
                </div>
              ))}
            </div>
            {proposal.phaseNotes.map((n, i) => <p className="setup-hint" key={i}>{n}</p>)}
          </section>

          <section className="setup-section">
            <span className="setup-label">Coaching intent</span>
            <p className="structure-intent">{proposal.intent}</p>
            <p className="setup-hint">{proposal.progression}</p>
          </section>

          {notes.trim() && (
            <section className="setup-section">
              <span className="setup-label">What the coach took from your notes</span>
              {proposal.guidanceNotes.map((n, i) => (
                <p className="setup-hint setup-hint--noted" key={i}>✓ {n}</p>
              ))}
            </section>
          )}

          {proposal.warnings.length > 0 && (
            <section className="setup-section setup-section--warn">
              {proposal.warnings.map((w, i) => <p className="setup-hint" key={i}>⚠ {w}</p>)}
            </section>
          )}
        </div>

        <div className="plan-setup-footer">
          <button className="setup-primary-btn" onClick={() => setStep('workouts')}>
            Show me the workouts
          </button>
        </div>
      </div>
    );
  }

  if (step === 'workouts' && proposal) {
    const canActivate = days.length > 0 && days.every(d => d.exercises.length > 0) && !activating;
    return (
      <div className="plan-setup">
        {header}
        <div className="plan-setup-body">
          <p className="setup-hint">
            Every pick is explained — swap (⇄) or remove (×) anything before the plan goes live.
            The best plan is the one you'll actually run.
          </p>
          {days.map(day => (
            <section className="setup-section" key={day.id}>
              <span className="setup-label">{day.label} · {day.muscleGroups}</span>
              <div className="review-list">
                {day.exercises.map(ex => {
                  const decision = decisions.get(`${day.id}:${ex.id}`);
                  const isSwapping = swapTarget?.dayId === day.id && swapTarget.exerciseId === ex.id;
                  return (
                    <div className="review-ex" key={ex.id}>
                      <div className="review-ex-head">
                        <div className="review-ex-main">
                          <span className="review-ex-name">{ex.name}</span>
                          <span className="review-ex-dose">{ex.sets} × {ex.repLow}–{ex.repHigh}</span>
                        </div>
                        <div className="review-ex-actions">
                          <button
                            className="review-ex-btn"
                            aria-label={`Replace ${ex.name}`}
                            onClick={() => setSwapTarget(isSwapping ? null : { dayId: day.id, exerciseId: ex.id })}
                          >
                            ⇄
                          </button>
                          <button
                            className="review-ex-btn review-ex-btn--danger"
                            aria-label={`Remove ${ex.name}`}
                            onClick={() => removeExercise(day.id, ex.id)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {decision && (
                        <div className="review-ex-why">
                          <span className={`review-badge review-badge--${decision.status}`}>
                            {decision.status === 'kept' ? 'Kept' : decision.status === 'replacement' ? `Replaces ${decision.replacesName}` : 'New'}
                          </span>
                          <span className="review-ex-reason">{decision.reason}</span>
                        </div>
                      )}
                      {isSwapping && (
                        <div className="review-swaps">
                          {suggestionsFor(day.id, ex).map(s => (
                            <button
                              className="review-swap"
                              key={s.exercise.id}
                              onClick={() => replaceExercise(day.id, ex, s)}
                            >
                              <span className="review-swap-name">{s.exercise.name}</span>
                              {s.reasons[0] && <span className="review-swap-reason">{s.reasons[0]}</span>}
                            </button>
                          ))}
                          {suggestionsFor(day.id, ex).length === 0 && (
                            <p className="setup-hint">No good alternative found for this slot.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {day.exercises.length === 0 && (
                  <p className="setup-hint setup-hint--error">This day is empty — a plan can't activate with an empty workout.</p>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="plan-setup-footer">
          <button className="setup-primary-btn" disabled={!canActivate} onClick={handleActivate}>
            {activating ? 'Activating…' : `Activate plan — starts ${startDate}`}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
