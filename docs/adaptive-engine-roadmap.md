# The adaptive engine: from tuned rules to estimated state

This document proposes a staged evolution of the prescription engine
(`recommendations.ts`, `progression.ts`, `coach.ts`) from hand-tuned rules toward
an estimator that infers the athlete's state from their log and prescribes
against it. It records what each stage buys, what it costs, what must exist
before it can be built, and which adjacent ideas have been considered and
rejected.

Nothing here is scheduled. It exists so the next person to open this question
starts from the analysis rather than from the instinct.

---

## The framing

It is tempting to describe this as "replacing the rules with a model." That is
the wrong framing, and getting it wrong is how this ends up as a rewrite that
loses more than it gains.

**The engine is already a model.** `recommendations.ts` predicts, from your
history, how much load you can handle for a given rep count; it just does so with
coefficients that were reasoned out and typed in by hand. `PCT_LOAD_PER_REP = 3`
is a dose–response model. `WEEKLY_LOAD_CAP` is a rate-of-adaptation model keyed on
training age. `NOISE_FLOOR_PCT = 3` is a measurement-error model. `fullMarksFor()`
is a prior on how much progress a given athlete should show. These are all real
parameters of a real model — they are simply *fixed*, identical for every athlete,
and carry no uncertainty.

So the shift proposed here is narrower and more honest than "add machine
learning":

1. **Estimate the parameters that should be personal** instead of fixing them.
   Your rate of adaptation, your measurement noise, your fatigue decay.
2. **Carry uncertainty explicitly.** Today every number is a point estimate, so
   the code compensates with thresholds — a 3% dead band, a 3-session stall
   window, a hard 12-rep cutoff on est. 1RM validity. Each is a crude stand-in
   for "is this change bigger than the noise?", which is a question an estimator
   answers directly.
3. **Keep the rules as constraints.** This is the invariant that makes the whole
   plan additive rather than destructive — see below.

---

## The invariant: rules become the constraint set

Everything the engine currently encodes as a *decision rule* — the weekly volume
band (`volumeTargetFor`), the per-week load caps, the duration budget in
`coach.ts`, the interference budget in `sports.ts`, equipment and injury filters,
the beginner rep floor — is domain knowledge that no amount of one person's
training data could learn. It must survive.

The change is what those rules act on. Today they are *the decision*. In the
target state they are the **feasible region** that a prescription is chosen
inside. Formally: the estimator says what the athlete can do, the objective says
what we want, and the rules say what is allowed.

This matters because it settles the most dangerous question in the whole idea:
**what happens when the optimizer finds a shortcut?** The answer is that it
cannot, because the shortcut is outside the constraint set. Which brings us to
the objective.

### The objective must not be volume

The intuitive objective — "maximise volume increase week over week" — is
degenerate, and an optimizer will exploit it far more efficiently than a rule
engine ever stumbled into it.

Volume load (Σ weight × reps) is cheapest to buy by *lowering the load and adding
reps and sets*. That is exactly the failure mode `progression.ts` already
documents: tonnage falls ~17% every time a lifter successfully adds weight,
under-credits heavy work (100×12 "beats" 110×10, though the second is stronger by
any 1RM estimate), and is inflated by junk volume. Hand that objective to a
search procedure and it will walk the athlete down in load and up in reps forever,
reporting success the whole way.

The mirror failure is just as real: optimise estimated 1RM alone and the answer is
to cut volume to nothing and grind heavy singles, accumulating joint stress and
injury risk that the objective cannot see.

The workable objective is **goal-weighted predicted capacity gain, subject to the
constraint set** — with volume as a *control variable* rather than the thing being
maximised. `GOAL_SIGNAL_WEIGHTS` in `progression.ts` is already the right shape
for the weighting; it just currently scores the past rather than ranking a
choice.

---

## Why bother — what is actually failing

Three defects fixed in one sitting, each independently making prescribed loads too
light, and all three the same species of problem: rules that were individually
correct and collectively blind.

- A rep-range change never re-anchored the load, because no rule compared the
  prescription to the one the history was logged under.
- Only sets at exactly the working weight counted, so working up to a top set
  registered as *less* work than not doing it.
- The increase trigger demanded a rep total (`sets × repHigh`) that the per-set
  planner never prescribed, so a compliant lifter was deloaded every third
  session for doing exactly what the app asked.

Each fix was principled. But the fixes interact — the third one needed a further
guard (excluding sessions from a different "rep era" from the high-water mark)
that only surfaced because a loop simulation caught it. That is the signature of
a rule set approaching its complexity ceiling: every new rule has to be checked
against every existing one, and the checking is what finds the bugs.

An estimator does not remove the need for judgement. It replaces *n* interacting
thresholds with one coherent mechanism that produces the same verdicts and can be
scored against reality.

### The decisive advantage: falsifiability

A rule engine makes no predictions, so it cannot be wrong in any measurable way.
The only way to evaluate a change to `calculateRecommendation` today is to reason
about it, write a test encoding that reasoning, and hope the reasoning was right.

A state estimator predicts **what you will lift next session**. That prediction
can be scored against what actually happened, on real logs, held out. One-step-ahead
prediction error is a number that goes down when the model gets better and up when
it gets worse — the first honest feedback signal this engine would ever have had.

That alone justifies Stage 1, independently of any prescription changes.

---

## Stages

### Stage 0 — record what was prescribed, and when each set happened

**What.** Two schemaless fields on `SetLog` (`db/database.ts`): the prescription
in force when the set was logged (target weight and reps, from `buildSetPlan`),
and a timestamp for the set itself. Both are additive, both are `undefined` on
legacy rows, neither needs an IDB version bump — the same pattern `order` and
`warmup` already use, including surviving the sync wire untouched.

**Why.** Two of the deepest limitations in the engine trace to their absence.

*Nothing records what was asked for.* You cannot fit a dose–response without
knowing the intended dose and the deviation from it, and you cannot measure
adherence at all — which is the largest confounder in a single athlete's data. It
has already bitten twice: the re-anchor detects a rep-range change by *inferring*
it from reps, because the set logs do not know what range was in force.

*Nothing records when a set happened.* `WorkoutView` holds `lastSetAtRef` in
memory to compute `completedAt`, then discards it. So rest intervals — known
precisely, at zero cost, at the moment of logging — are thrown away. Rest is the
main confounder for every within-session fatigue measure, and set duration is the
one genuinely objective effort proxy available on a phone.

**Unlocks.** Every later stage. Adherence reporting on its own is worth the
change even if nothing else here is ever built.

**Cost.** Small. Two fields, one write path, no migration.

**Risk.** Nearly none. The only judgement call is that a prescription record makes
the set log slightly larger on the sync wire.

---

### Stage 1 — a capacity filter

**What.** Per exercise, a state-space estimate of latent capacity (est. 1RM) with
an uncertainty band, updated from each logged set. Each set (weight, reps) is a
noisy observation of capacity; the observation variance grows with rep count,
because 1RM prediction equations are fitted on low-rep sets and drift badly past
~12. Process noise represents genuine drift in capacity between sessions.

**Why.** It replaces four separate hand-set thresholds with one mechanism:

| Today | Becomes |
|---|---|
| `deadband(3%)` — noise floor | posterior uncertainty; is the change larger than σ? |
| `stallWindowFor()` — 3 or 4 sessions | capacity trend not distinguishable from flat |
| `E1RM_VALID_REPS = 12` hard cliff | observation weight decaying with reps |
| `fullMarksFor()` — training-age bars | estimated per-athlete drift rate |

The `E1RM_VALID_REPS` case is the clearest illustration of the gain. Today a
12-rep set counts fully and a 13-rep set counts not at all — a discontinuity
nobody believes in, chosen because a point estimate has no way to express "this
observation is weak." A filter downweights it smoothly and continues.

**Unlocks.** Falsifiable evaluation (above). Better reason strings, not worse:
"est. 1RM 253 ± 8, up 4% — beyond the noise in your logs" is more informative
than the current text, not less.

**Cost.** Moderate. A 1–2 state linear filter is a few dozen lines and runs in
microseconds over a personal training log — no backend, no persisted estimator
state, re-derived on load like every other engine in `data/`. The architecture
already suits it.

**Risk.** The parameters (process noise, observation noise) themselves need
setting, so this does not eliminate tuning — it moves it somewhere more principled
and, critically, somewhere that can be fitted against real logs rather than
argued about.

**How you know it worked.** One-step-ahead prediction error on held-out sessions,
beaten against a naive baseline ("next session equals last session"). If it cannot
beat that baseline it is not ready to prescribe anything.

---

### Stage 2 — fatigue as a second state

**What.** Extend the estimator to the classical two-component form: a slow
"fitness" state and a fast-decaying "fatigue" state, driven by a training-load
impulse per session. Performance is the difference between them. This is
Banister's fitness–fatigue model (1975) and its descendants — long-established,
small, and appropriate to sparse data.

**Why.** Fatigue is currently unmodelled. The deload trigger counts flat sessions
*after* they happen; nothing anticipates accumulated fatigue, and nothing connects
this week's volume to next week's performance. A fatigue state makes the deload
decision predictive rather than reactive, and it gives the block planner a real
basis for phase design instead of a fixed template.

**What the impulse can be.** Volume load and session duration are already
available (`sessionDurationMs`, `avgDurationByDay`). Note the deliberate absence
of session RPE, the classical choice — see Rejected ideas.

**Cost.** Moderate, and mostly in validation rather than code.

**Risk.** This is where the single-athlete data limit starts to bite. The model has
parameters (decay constants, gains) that are genuinely hard to identify from one
person's sparse log, and mis-set decay constants produce confident nonsense. Fit
cautiously, with strong priors, and prefer refusing to answer over answering
badly.

**Blocker.** The sport-support case cannot work without external load. An athlete
whose squat capacity is a function of Tuesday's interval session cannot be modelled
by an app that never sees Tuesday. The cardio-integration roadmap item
(Apple Health / Google Fit / Strava) is a hard prerequisite for this stage to mean
anything for endurance athletes.

---

### Stage 3 — a constrained controller

**What.** Replace the branch cascade in `calculateRecommendation` with: search the
small space of admissible prescriptions (load × rep target × set count), score each
by predicted goal-weighted capacity gain under the Stage 1–2 model, and return the
best one that satisfies the constraint set. Exercise selection stays where it is.

**Why.** This is the point at which the engine stops needing a new branch for every
situation. The re-anchor, the increase trigger, the deload and the back-off all
become consequences of one calculation rather than four rules that must be kept
consistent with each other.

**Cost.** Large — this is the stage that touches everything downstream, including
every reason string and most of `recommendations.test.ts`.

**Risk.** Explainability is the real one. The current product is built on plain
language reasons attached to every change, and for a coaching app the explanation
*is* the product. A controller must be able to say *why* it chose what it chose —
"this is the heaviest load that keeps predicted fatigue inside your budget" — or
the change is a net loss however much the numbers improve.

**Prerequisite.** An honest simulator. `blockSimulation.test.ts` is a genuine asset
— twelve profiles training ten-week blocks — but its virtual lifter responds to
training according to the same assumptions the engine prescribes with, so it
currently grades its own homework. Before a controller can be trusted, the
simulated athlete needs independent dynamics and its own noise, so that a
prescription can actually be *wrong* in simulation.

---

### Stage 4 — a learned policy

**Not recommended.** Recorded here so the reasoning is not lost.

The appeal is obvious: let the app learn which lever to pull — reps, load, sets,
exercise, movement pattern — rather than being told. The arithmetic is what kills
it. One athlete produces roughly fifty training weeks a year, which is fifty
trials, each with one action, a delayed and noisy reward, non-stationary dynamics
(you get fitter; blocks change goals), and dominant unobserved confounders (sleep,
stress, and the entire endurance training load). Credit assignment under those
conditions is not a modelling challenge, it is an absence of signal.

Estimation is feasible on this data because a filter needs tens of observations
and there are hundreds. Policy learning is not, because it needs hundreds of clean
weekly trials and there are fifty dirty ones.

If it ever becomes interesting it is a **multi-user** problem, with partial pooling
across athletes and across exercises within a movement pattern. Worth noting: the
taxonomy work already in the app — movement patterns, equipment, muscle groups,
difficulty tiers — is exactly what makes that pooling possible. The data model is
ready for a problem the data volume is not.

---

## Data gaps, in priority order

| Gap | Consequence | Stage blocked |
|---|---|---|
| No prescription recorded on `SetLog` | No dose–response, no adherence measurement, rep-range changes must be inferred from reps | 0 (fix), all |
| No per-set timestamp | Rest intervals and set durations discarded at the moment they are known; no objective effort proxy possible | 0 (fix), 2 |
| No decision log — `computeProgramPlan` recomputes `changes` and discards them | Nothing records that the coach added a set, so nothing can evaluate whether it helped | 3 |
| No session context (bodyweight, external training load) | Endurance athletes' primary stimulus is invisible | 2 for sport-support |
| No uncertainty representation anywhere | Nowhere to put an error bar, in the model or the UI | 1 |
| Simulator shares the engine's assumptions | Cannot falsify a prescription in simulation | 3 |

---

## Rejected ideas

**Self-reported RPE / RIR.** Rejected, with reasoning recorded in CLAUDE.md's
roadmap. Briefly: self-reported effort is least accurate in exactly the situations
that matter, and an optional subjective field the user knows they would fill in
carelessly is worse than no field, because the engine weights bad data as
measurement. The app already tried the cheap version (the Easy/Medium/Hard
difficulty rating) and removed it.

**Effort inferred from set-to-set rep drop-off.** Proposed as the objective
replacement for RPE, and rejected on a decisive confound: sets are often cut short
for *scheduling* reasons rather than fatigue ones. An athlete who stops a squat set
two reps early because the workout continues afterward produces the same drop-off
curve as one who reached failure. The confound is not random — it is systematic per
athlete and per exercise position, which makes it worse than noise.

Worth noting this already affects live code: `fatigueDrops()` fits rep targets to
observed drop-off, so an athlete who habitually leaves reps on the later sets has
that *preference* learned as their *capacity* and prescribed back to them
indefinitely. Reviewing that is worthwhile independently of anything in this
document.

**A black box replacing the rules.** Rejected for three reasons developed above:
the natural objective is degenerate, single-athlete credit assignment is
intractable, and an unexplainable prescription is a worse product than an
explainable one even when it is more accurate.

---

## Open questions

- Should capacity be estimated per exercise, or per movement pattern with
  per-exercise offsets? The latter borrows strength across sparse lifts, which is
  the single biggest lever available for the data volume, but risks a
  poorly-trained variation dragging a well-trained one.
- How should the filter handle deliberate deloads and intro weeks, where reduced
  output is *prescribed* rather than observed? Almost certainly the phase must
  enter the observation model, or every planned easy week reads as a capacity
  drop.
- What does uncertainty look like in the UI? A number with an error bar is honest
  and may also be unwelcome on a workout card at 6am.
