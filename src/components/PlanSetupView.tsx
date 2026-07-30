import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkoutDay, Exercise } from '../data/program';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import type { MuscleGroup } from '../data/taxonomy';
import {
  GOALS, PHASE_INFO, EXPERIENCE_LEVELS, EQUIPMENT_ACCESS,
  ENDURANCE_LOADS, DISCIPLINES, RACE_PROXIMITY, defaultSportContext,
  nextMonday, parsePlanDate, experienceLabel,
} from '../data/plan';
import type {
  Goal, ExperienceLevel, EquipmentAccess, TrainingProfile,
  SportId, SportEvent, EnduranceLoad, Discipline, SportContext, RaceProximity,
} from '../data/plan';
import { SPORTS, sportLabel, eventsFor, defaultEventFor, nigglesFor } from '../data/sports';
import { buildPlanProposal, defaultBlockWeeks } from '../data/planner';
import type { PlannerInput, PlanProposal, ExerciseDecision } from '../data/planner';
import {
  activateProposal, getActiveBlockInfo, getLatestRetrospective,
  getProfileOrDefault, getActivePlan, saveTrainingProfile,
} from '../data/planStore';
import { effectiveExperience, inferExperience } from '../data/experience';
import { unitFor } from '../data/exercises';
import { computeBlockRetrospective } from '../data/retrospective';
import { suggestReplacements } from '../data/substitution';
import type { ReplacementSuggestion } from '../data/substitution';
import './PlanSetupView.css';

interface Props {
  program: WorkoutDay[];
  onBack: () => void;
  onActivated: () => void;
}

// ── The question flow ─────────────────────────────────────────────────────────
// One question per screen. Tier 1 (hard constraints) and Tier 2 (calibration)
// are interleaved by conversational flow, not grouped by tier — the user just
// answers a short series of quick taps.
type QId =
  | 'goal' | 'experience' | 'trainingAge' | 'days'
  | 'equipment' | 'injuries' | 'priority' | 'schedule' | 'startDate'
  // sport-support only
  | 'sport' | 'sportEvent' | 'raceProximity' | 'sportLoad' | 'weakLink'
  | 'niggles' | 'sportWeeks';

const BASE_ORDER: QId[] = [
  'goal', 'experience', 'trainingAge', 'days',
  'equipment', 'injuries', 'priority', 'schedule', 'startDate',
];

// Supporting another sport asks a different set of questions, because the
// answers do different work: the sport and its weekly hours set the volume
// ceiling, the race distance sets the rep ranges and whether plyometrics earn
// their place, and race proximity sets how much of the block builds versus
// holds. The generic priority-muscle question is dropped — a sport prescription
// is already at its volume ceiling, so there is nothing honest to do with it.
const SPORT_ORDER: QId[] = [
  'goal', 'sport', 'sportEvent', 'raceProximity', 'sportLoad', 'weakLink',
  'experience', 'days', 'equipment', 'niggles', 'injuries', 'sportWeeks', 'startDate',
];

// Questions that only apply to some sports. Triathlon is the only multi-sport
// event here, so it is the only one with a weak discipline to bias toward.
const SPORT_ONLY_QUESTIONS: Partial<Record<QId, SportId[]>> = {
  weakLink: ['triathlon'],
};

function orderFor(goal: Goal, sport: SportId): QId[] {
  if (goal !== 'sport-support') return BASE_ORDER;
  return SPORT_ORDER.filter(q => {
    const limited = SPORT_ONLY_QUESTIONS[q];
    return !limited || limited.includes(sport);
  });
}

type Stage = 'questions' | 'structure' | 'workouts';

const WEEK_OPTIONS = [4, 5, 6, 8];
const SPORT_WEEK_OPTIONS = [4, 6, 8, 10, 12];
const DAY_OPTIONS = [2, 3, 4, 5, 6];

const TRAINING_AGE_OPTIONS: { label: string; months: number }[] = [
  { label: 'Just starting', months: 0 },
  { label: '< 6 months', months: 3 },
  { label: '6–12 months', months: 9 },
  { label: '1–2 years', months: 18 },
  { label: '2–5 years', months: 42 },
  { label: '5+ years', months: 72 },
];

// Priority areas map a friendly label to the muscle groups it biases volume to.
const PRIORITY_OPTIONS: { label: string; muscles: MuscleGroup[] }[] = [
  { label: 'Chest', muscles: ['Chest'] },
  { label: 'Back', muscles: ['Upper Back', 'Lats'] },
  { label: 'Shoulders', muscles: ['Delts'] },
  { label: 'Arms', muscles: ['Biceps', 'Triceps'] },
  { label: 'Quads', muscles: ['Quads'] },
  { label: 'Hamstrings', muscles: ['Hamstrings'] },
  { label: 'Glutes', muscles: ['Glutes'] },
  { label: 'Calves', muscles: ['Calves'] },
  { label: 'Abs', muscles: ['Abs'] },
];

export default function PlanSetupView({ program, onBack, onActivated }: Props) {
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

  // Pre-fill from the saved profile (repeat plans breeze through) and the
  // active plan's goal.
  const saved = useMemo(() => getProfileOrDefault(), []);
  const activeGoal = useMemo(() => getActivePlan()?.goal, []);

  const [stage, setStage] = useState<Stage>('questions');
  const [qIndex, setQIndex] = useState(0);
  const [dir, setDir] = useState<'next' | 'back'>('next');

  // Answers
  const [goal, setGoal] = useState<Goal>(activeGoal ?? 'hypertrophy');
  const [experience, setExperience] = useState<ExperienceLevel>(saved.experience);
  const [trainingAgeMonths, setTrainingAgeMonths] = useState<number | undefined>(saved.trainingAgeMonths);
  const [daysPerWeek, setDaysPerWeek] = useState(saved.daysPerWeek);
  const [equipment, setEquipment] = useState<EquipmentAccess>(saved.equipment);
  const [injuries, setInjuries] = useState(saved.injuries);
  const [priorityMuscles, setPriorityMuscles] = useState<MuscleGroup[]>(saved.priorityMuscles);
  const [weeks, setWeeks] = useState(defaultBlockWeeks());
  const [includeDeload, setIncludeDeload] = useState(saved.experience !== 'beginner');
  const [startDate, setStartDate] = useState(nextMonday());

  // Sport-support answers
  const savedSport = saved.sport ?? defaultSportContext();
  const [sportId, setSportId] = useState<SportId>(savedSport.sport);
  const [sportEvent, setSportEvent] = useState<SportEvent>(savedSport.event);
  const [proximity, setProximity] = useState<RaceProximity>(savedSport.proximity);
  const [sportLoad, setSportLoad] = useState<EnduranceLoad>(savedSport.load);
  const [weakLink, setWeakLink] = useState<Discipline>(savedSport.weakLink);
  const [niggles, setNiggles] = useState<string[]>(savedSport.niggles);

  // Changing sport invalidates the distance and any sport-specific niggles.
  function chooseSport(next: SportId) {
    if (next !== sportId) {
      setSportEvent(defaultEventFor(next));
      const allowed = new Set(nigglesFor(next).map(n => n.id));
      setNiggles(prev => prev.filter(n => allowed.has(n)));
    }
    pick(setSportId, next);
  }

  // Proposal + review
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [decisions, setDecisions] = useState<Map<string, ExerciseDecision>>(new Map());
  const [swapTarget, setSwapTarget] = useState<{ dayId: number; exerciseId: string } | null>(null);
  const [activating, setActivating] = useState(false);

  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(s => {
      if (cancelled) return;
      setSnapshot(s);
      setSnapshotReady(true);
    });
    return () => { cancelled = true; if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, []);

  // Data-driven experience nudge: if logged training outranks the self-report,
  // surface it on the experience question.
  const inferred = useMemo(() => (snapshot ? inferExperience(snapshot) : null), [snapshot]);

  const activeInfo = useMemo(() => getActiveBlockInfo(), []);
  const plannerRetro = useMemo(() => {
    if (activeInfo && snapshot && snapshot.sessions.length > 0) {
      return computeBlockRetrospective(activeInfo.block, snapshot);
    }
    return getLatestRetrospective();
  }, [activeInfo, snapshot]);

  const [openWithRecovery] = useState(() => {
    const latest = getLatestRetrospective();
    return latest != null && Date.now() - latest.to < 21 * 86_400_000;
  });

  const startDateValid = parsePlanDate(startDate) != null;
  const order = orderFor(goal, sportId);
  // Switching goal can shorten the flow underneath us; clamp rather than crash.
  const qId = order[Math.min(qIndex, order.length - 1)];

  // ── Navigation ──────────────────────────────────────────────────────────────
  function goNext() {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setDir('next');
    if (qIndex < order.length - 1) {
      setQIndex(i => i + 1);
    } else {
      generateAndReview();
    }
  }
  function goBack() {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setDir('back');
    if (qIndex > 0) setQIndex(i => i - 1);
    else onBack();
  }
  // Single-select answer: reflect the tap, then slide onward automatically.
  function pick<T>(setter: (v: T) => void, value: T) {
    setter(value);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(goNext, 240);
  }

  function sportContext(): SportContext {
    return {
      sport: sportId,
      event: sportEvent,
      proximity,
      load: sportLoad,
      // Only triathlon asks; a single-sport athlete has no weak discipline.
      weakLink: sportId === 'triathlon' ? weakLink : 'even',
      niggles,
    };
  }

  function buildProfile(): TrainingProfile {
    return {
      injuries: injuries.trim(),
      equipment,
      daysPerWeek,
      experience,
      trainingAgeMonths,
      priorityMuscles,
      // Kept once set, even if the athlete plans a lifting block next: the sport
      // doesn't stop existing, and a later sport block pre-fills from it.
      ...(goal === 'sport-support' || saved.sport ? { sport: goal === 'sport-support' ? sportContext() : saved.sport } : {}),
      updatedAt: Date.now(),
    };
  }

  function generateAndReview() {
    const profile = buildProfile();
    // Plan with the *effective* experience — self-report maxed with inference —
    // so a beginner whose data says otherwise still gets the better plan.
    const effExp = effectiveExperience(profile, snapshot);
    const input: PlannerInput = {
      goal, daysPerWeek, weeks, includeDeload, openWithRecovery, startDate,
      notes: '',
      experience: effExp,
      equipmentAccess: equipment,
      priorityMuscles,
      injuries: injuries.trim(),
      // A goal change is one of the things that earns an introductory week.
      previousGoal: activeGoal ?? null,
      ...(goal === 'sport-support' ? { sport: sportContext() } : {}),
    };
    const p = buildPlanProposal(input, program, snapshot, plannerRetro);
    setProposal(p);
    setDays(p.days.map(d => ({ ...d, exercises: [...d.exercises] })));
    setDecisions(new Map(p.decisions.map(d => [`${d.dayId}:${d.exerciseId}`, d])));
    setSwapTarget(null);
    setStage('structure');
  }

  // ── Review actions ────────────────────────────────────────────────────────────
  function replaceExercise(dayId: number, oldEx: Exercise, sug: ReplacementSuggestion) {
    setDays(prev => prev.map(d => d.id !== dayId ? d : {
      ...d,
      exercises: d.exercises.map(e => e.id !== oldEx.id ? e : {
        id: sug.exercise.id, name: sug.exercise.name,
        sets: oldEx.sets, repLow: oldEx.repLow, repHigh: oldEx.repHigh,
      }),
    }));
    setDecisions(prev => {
      const next = new Map(prev);
      next.delete(`${dayId}:${oldEx.id}`);
      next.set(`${dayId}:${sug.exercise.id}`, {
        exerciseId: sug.exercise.id, name: sug.exercise.name, dayId,
        status: 'replacement', replacesName: oldEx.name,
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
    saveTrainingProfile(buildProfile());
    const outgoingRetro = activeInfo && snapshot && snapshot.sessions.length > 0
      ? computeBlockRetrospective(activeInfo.block, snapshot)
      : null;
    activateProposal({ ...proposal, days }, outgoingRetro);
    onActivated();
  }

  function toggleNiggle(id: string) {
    setNiggles(prev => (prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]));
  }

  const allIds = useMemo(() => new Set(days.flatMap(d => d.exercises.map(e => e.id))), [days]);
  function suggestionsFor(dayId: number, ex: Exercise): ReplacementSuggestion[] {
    const day = days.find(d => d.id === dayId);
    if (!day) return [];
    return suggestReplacements(ex, day, snapshot, 5, Date.now(), goal).filter(s => !allIds.has(s.exercise.id)).slice(0, 3);
  }

  function togglePriority(muscles: MuscleGroup[]) {
    setPriorityMuscles(prev => {
      const has = muscles.every(m => prev.includes(m));
      return has ? prev.filter(m => !muscles.includes(m)) : [...new Set([...prev, ...muscles])];
    });
  }

  // ── Questions stage ───────────────────────────────────────────────────────────
  if (stage === 'questions') {
    const progress = ((qIndex + 1) / order.length) * 100;
    const optional = qId === 'trainingAge' || qId === 'injuries' || qId === 'priority'
      || qId === 'niggles';

    return (
      <div className="plan-setup">
        <header className="plan-setup-header">
          <button className="back-btn" onClick={goBack} aria-label="Back">&#8592;</button>
          <div className="wizard-progress" aria-hidden="true">
            <div className="wizard-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </header>

        <div className="wizard-stage">
          <div className={`wizard-card wizard-card--${dir}`} key={qId}>
            {renderQuestion()}
          </div>
        </div>

        {(optional || needsContinue(qId)) && (
          <div className="plan-setup-footer">
            {optional && (
              <button className="wizard-skip" onClick={goNext}>Skip</button>
            )}
            {needsContinue(qId) && (
              <button
                className="setup-primary-btn"
                disabled={!canContinue()}
                onClick={goNext}
              >
                {qIndex === order.length - 1
                  ? (snapshotReady ? 'Design my plan' : 'Reading your history…')
                  : 'Continue'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Structure review ──────────────────────────────────────────────────────────
  if (stage === 'structure' && proposal) {
    return (
      <div className="plan-setup">
        <header className="plan-setup-header">
          <button className="back-btn" onClick={() => setStage('questions')} aria-label="Back">&#8592;</button>
          <div className="plan-setup-title">
            <span>Your plan</span>
            <span className="plan-setup-step">Review the structure</span>
          </div>
        </header>
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

          {proposal.guidanceNotes.length > 0 && (
            <section className="setup-section">
              <span className="setup-label">What the coach took from your answers</span>
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
          <button className="setup-primary-btn" onClick={() => setStage('workouts')}>
            Show me the workouts
          </button>
        </div>
      </div>
    );
  }

  // ── Workout review ────────────────────────────────────────────────────────────
  if (stage === 'workouts' && proposal) {
    const canActivate = days.length > 0 && days.every(d => d.exercises.length > 0) && !activating;
    return (
      <div className="plan-setup">
        <header className="plan-setup-header">
          <button className="back-btn" onClick={() => setStage('structure')} aria-label="Back">&#8592;</button>
          <div className="plan-setup-title">
            <span>Your workouts</span>
            <span className="plan-setup-step">Swap or remove anything</span>
          </div>
        </header>
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
                          <span className="review-ex-dose">
                            {ex.sets} × {ex.repLow}–{ex.repHigh}{unitFor(ex.id) === 'seconds' ? 's' : ''}
                          </span>
                        </div>
                        <div className="review-ex-actions">
                          <button className="review-ex-btn" aria-label={`Replace ${ex.name}`}
                            onClick={() => setSwapTarget(isSwapping ? null : { dayId: day.id, exerciseId: ex.id })}>⇄</button>
                          <button className="review-ex-btn review-ex-btn--danger" aria-label={`Remove ${ex.name}`}
                            onClick={() => removeExercise(day.id, ex.id)}>×</button>
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
                            <button className="review-swap" key={s.exercise.id} onClick={() => replaceExercise(day.id, ex, s)}>
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

  // ── Question rendering ────────────────────────────────────────────────────────
  function needsContinue(id: QId): boolean {
    // Single-select questions auto-advance; these need an explicit Continue.
    return id === 'injuries' || id === 'priority'
      || id === 'schedule' || id === 'startDate' || id === 'niggles'
      || id === 'sportWeeks';
  }
  function canContinue(): boolean {
    if (qId === 'startDate') return startDateValid && snapshotReady;
    if (qId === 'schedule') return true;
    return true;
  }

  function renderQuestion() {
    switch (qId) {
      case 'goal':
        return (
          <Question title="What matters most right now?" subtitle="This sets the whole shape of your training.">
            <div className="opt-list">
              {GOALS.map(g => (
                <OptionCard key={g.id} active={goal === g.id} label={g.label} blurb={g.blurb}
                  onClick={() => pick(setGoal, g.id)} />
              ))}
            </div>
          </Question>
        );

      case 'experience':
        return (
          <Question title="How long have you been lifting?" subtitle="It changes how hard and how heavy your plan starts.">
            <div className="opt-list">
              {EXPERIENCE_LEVELS.map(x => (
                <OptionCard key={x.id} active={experience === x.id} label={x.label} blurb={x.blurb}
                  onClick={() => pick(setExperience, x.id)} />
              ))}
            </div>
            {inferred && experienceRank(inferred.level) > experienceRank(experience) && (
              <p className="wizard-inferred">
                Heads up — your logged training looks more like <strong>{experienceLabel(inferred.level)}</strong>.
                Pick what feels right; the coach will meet you where your data is either way.
              </p>
            )}
          </Question>
        );

      case 'trainingAge':
        return (
          <Question title="Roughly how much of that was consistent?" subtitle="A ballpark is fine — it fine-tunes your starting point." optional>
            <div className="chip-grid">
              {TRAINING_AGE_OPTIONS.map(o => (
                <button key={o.months}
                  className={`setup-chip${trainingAgeMonths === o.months ? ' setup-chip--active' : ''}`}
                  onClick={() => pick(setTrainingAgeMonths, o.months)}>
                  {o.label}
                </button>
              ))}
            </div>
          </Question>
        );

      case 'days':
        return (
          <Question title="How many days a week can you train?" subtitle="Be honest — the best plan is the one you'll actually keep.">
            <div className="chip-grid">
              {DAY_OPTIONS.map(n => (
                <button key={n}
                  className={`setup-chip setup-chip--lg${daysPerWeek === n ? ' setup-chip--active' : ''}`}
                  onClick={() => pick(setDaysPerWeek, n)}>
                  {n}
                </button>
              ))}
            </div>
          </Question>
        );

      case 'equipment':
        return (
          <Question title="What can you train with?" subtitle="Every exercise picked will fit what you've got.">
            <div className="opt-list">
              {EQUIPMENT_ACCESS.map(e => (
                <OptionCard key={e.id} active={equipment === e.id} label={e.label} blurb={e.blurb}
                  onClick={() => pick(setEquipment, e.id)} />
              ))}
            </div>
          </Question>
        );

      case 'injuries':
        return (
          <Question title="Any injuries or movements to avoid?" subtitle="Tell the coach in plain words — it'll route around them." optional>
            <textarea
              className="setup-notes wizard-textarea"
              rows={4}
              placeholder="e.g. “left knee pain on squats”, “bad lower back”, “sore right shoulder overhead”…"
              value={injuries}
              onChange={e => setInjuries(e.target.value)}
              autoFocus
            />
            <p className="setup-hint">Leave blank if nothing's bothering you.</p>
          </Question>
        );

      case 'priority':
        return (
          <Question title="Anything you want to bring up?" subtitle="Pick weak points or muscles you care about most — they'll get extra volume." optional>
            <div className="chip-grid">
              {PRIORITY_OPTIONS.map(o => {
                const active = o.muscles.every(m => priorityMuscles.includes(m));
                return (
                  <button key={o.label}
                    className={`setup-chip${active ? ' setup-chip--active' : ''}`}
                    onClick={() => togglePriority(o.muscles)}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </Question>
        );

      case 'schedule':
        return (
          <Question title="How long should this block run?" subtitle="A block is one focused training cycle before you reassess.">
            <div className="chip-grid">
              {WEEK_OPTIONS.map(n => (
                <button key={n}
                  className={`setup-chip${weeks === n ? ' setup-chip--active' : ''}`}
                  onClick={() => setWeeks(n)}>
                  {n} wk
                </button>
              ))}
            </div>
            <label className="setup-toggle">
              <input type="checkbox" checked={includeDeload} onChange={e => setIncludeDeload(e.target.checked)} />
              <span>End with a deload (recovery) week</span>
            </label>
            {experience === 'beginner' && (
              <p className="setup-hint">
                As a beginner you can skip planned deloads for a while — steady weekly progress is the whole game early on.
              </p>
            )}
          </Question>
        );

      case 'sport':
        return (
          <Question title="Which sport are you supporting?" subtitle="Your sport sets the ceiling — the plan is built to fit around it, not compete with it.">
            <div className="opt-list">
              {SPORTS.map(sp => (
                <OptionCard key={sp.id} active={sportId === sp.id} label={sp.label} blurb={sp.blurb}
                  onClick={() => chooseSport(sp.id)} />
              ))}
            </div>
          </Question>
        );

      case 'sportEvent':
        return (
          <Question title={`Which ${sportLabel(sportId).toLowerCase()} distance?`}
            subtitle="Distance changes the job: short races reward strength and power, long ones reward staying in one piece.">
            <div className="opt-list">
              {eventsFor(sportId).map(e => (
                <OptionCard key={e.id} active={sportEvent === e.id} label={e.label} blurb={e.blurb}
                  onClick={() => pick(setSportEvent, e.id)} />
              ))}
            </div>
          </Question>
        );

      case 'raceProximity':
        return (
          <Question title="When's your next race?" subtitle="This decides how much of the block builds strength and how much just holds it.">
            <div className="opt-list">
              {RACE_PROXIMITY.map(r => (
                <OptionCard key={r.id} active={proximity === r.id} label={r.label} blurb={r.blurb}
                  onClick={() => pick(setProximity, r.id)} />
              ))}
            </div>
          </Question>
        );

      case 'sportLoad':
        return (
          <Question title={`How many hours a week of ${sportLabel(sportId).toLowerCase()} right now?`}
            subtitle="Be honest — this is what decides how much lifting you can absorb without digging a hole.">
            <div className="opt-list">
              {ENDURANCE_LOADS.map(l => (
                <OptionCard key={l.id} active={sportLoad === l.id} label={l.label} blurb={l.blurb}
                  onClick={() => pick(setSportLoad, l.id)} />
              ))}
            </div>
          </Question>
        );

      case 'weakLink':
        return (
          <Question title="Which part needs the most help?" subtitle="The plan biases toward it — a little, not a lot.">
            <div className="opt-list">
              {DISCIPLINES.map(d => (
                <OptionCard key={d.id} active={weakLink === d.id} label={d.label} blurb={d.blurb}
                  onClick={() => pick(setWeakLink, d.id)} />
              ))}
            </div>
          </Question>
        );

      case 'niggles':
        return (
          <Question title="Any recurring niggles?" subtitle="Pick anything that flares up. Each one reroutes the plan rather than just being noted." optional>
            <div className="opt-list">
              {nigglesFor(sportId).map(n => (
                <OptionCard key={n.id} active={niggles.includes(n.id)} label={n.label} blurb={n.blurb}
                  onClick={() => toggleNiggle(n.id)} />
              ))}
            </div>
            <p className="setup-hint">Leave everything unpicked if nothing's bothering you.</p>
          </Question>
        );

      case 'sportWeeks':
        return (
          <Question title="How long should this block run?" subtitle="One focused training cycle before you reassess. Your call — the plan shapes itself around the length you pick.">
            <div className="chip-grid">
              {SPORT_WEEK_OPTIONS.map(n => (
                <button key={n}
                  className={`setup-chip${weeks === n ? ' setup-chip--active' : ''}`}
                  onClick={() => setWeeks(n)}>
                  {n} wk
                </button>
              ))}
            </div>
            <p className="setup-hint">
              {proximity === 'soon'
                ? 'With a race inside 8 weeks, most of whatever length you pick will be spent holding strength rather than building it.'
                : proximity === 'none' || proximity === 'far'
                  ? 'With no race close, the whole block can build — longer means more strength banked before race season.'
                  : 'The plan builds through the first part of the block and holds through the rest.'}
            </p>
          </Question>
        );

      case 'startDate':
        return (
          <Question title="When do you want to start?" subtitle="Pick a Monday to line up with weekly tracking.">
            <input
              className="setup-date-input wizard-date"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              aria-invalid={!startDateValid}
            />
            {!startDateValid && <p className="setup-hint setup-hint--error">Pick a valid date.</p>}
          </Question>
        );
    }
  }
}

function experienceRank(x: ExperienceLevel): number {
  return x === 'beginner' ? 0 : x === 'intermediate' ? 1 : 2;
}

function Question({ title, subtitle, optional, children }: {
  title: string; subtitle?: string; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <>
      <div className="wizard-q-head">
        {optional && <span className="wizard-q-optional">Optional</span>}
        <h2 className="wizard-q-title">{title}</h2>
        {subtitle && <p className="wizard-q-sub">{subtitle}</p>}
      </div>
      {children}
    </>
  );
}

function OptionCard({ active, label, blurb, onClick }: {
  active: boolean; label: string; blurb: string; onClick: () => void;
}) {
  return (
    <button className={`opt-card${active ? ' opt-card--active' : ''}`} onClick={onClick}>
      <span className="opt-card-label">{label}</span>
      <span className="opt-card-blurb">{blurb}</span>
    </button>
  );
}
