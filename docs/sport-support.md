# Sport-support training

The `sport-support` goal covers athletes whose primary training happens somewhere
else — a triathlon build, a marathon block — and who lift to make that training
better rather than as an end in itself. Triathlon and running are modelled today;
`sports.ts` is the seam for adding more.

It exists because the rest of LiftLog was, reasonably, built around a lifter. A
triathlete who asked the plan wizard for help got a bodybuilding program: a
push/pull/legs split, hypertrophy rep ranges, and a coach that kept adding sets
until every muscle reached 10 a week. That last part was the real problem — not a
bad first plan but a ratchet, described below.

---

## What the code encodes, and why

### Heavy and low-volume, not hypertrophy dosing

The strength work that transfers to endurance performance is **maximal strength
work**: two sessions a week, two or three multi-joint lifts, roughly 3–5 sets of
3–8 reps at high load, stopping short of failure. Reviews of strength training in
endurance athletes (Rønnestad & Mujika; Beattie and colleagues on running
economy) consistently find improvements in cycling and running economy, time to
exhaustion, and fatigue resistance from that kind of dosing — and not from
higher-volume hypertrophy work.

This is also why muscle growth is not a goal here. Added mass is weight the
athlete carries for the whole race. `GOAL_WEIGHTS` in `progress.ts` reflects it:
for `sport-support`, e1RM and PR events carry the verdict and rising tonnage is
weighted lightly, because increasing volume is a *cost* on this path rather than
evidence of progress.

**Where it lives:** two places, deliberately.

- **`dosage.ts`** carries `sport-support` as a row in the same goal-keyed table
  as every other goal — heavy multi-joint work at 4–6, cheap accessories,
  low-rep plyometrics. This is what an exercise gets when it enters a program by
  any route other than the plan wizard: the day editor, the mid-workout add
  panel, a quick workout. Without it those routes fell through to a hypertrophy
  default. It deliberately overrides `isHeavyAxial` for this goal (which would
  give a barbell squat 3 × 5–8), because force production is the entire reason
  an endurance athlete squats.
- **`sports.ts`** carries a per-slot `dose` on each template slot, which wins
  where present (`doseFor` in `planner.ts`). The templates know things the goal
  table cannot: the race distance's rep range, and which slot is the tendon work
  versus the anchor. Each dose sits next to the rationale that justifies it.

### The interference effect scales with the sport's own load

Concurrent-training research (Wilson and colleagues' meta-analysis being the
most-cited) finds the interference effect grows with endurance training frequency
and duration, and that **running interferes more than cycling** because of its
eccentric load. Strength is better preserved than hypertrophy or power.

So the lifting ceiling cannot be a constant — it has to be a function of how much
the athlete is already doing. `liftBudget()` takes self-reported weekly sport
hours and returns the number of lifting days and the total weekly working sets
the plan is allowed to spend, and the race distance scales that ceiling on top:
the same six hours spent on marathon-specific mileage costs the legs more than six
hours of 5k work.

**Where it lives:** `DAYS_BY_LOAD` / `SETS_BY_LOAD` and `liftBudget()` in
`sports.ts`.

### The volume band, and the ratchet it fixes

`SETS_TARGET_LOW`/`HIGH` (10–20 weekly hard sets per muscle) used to be global
constants that `coach.ts`, `insights.ts`, `retrospective.ts`, `heatmap.ts` and
`substitution.ts` each imported directly. For an endurance athlete that band is
roughly double the appropriate dose, and the consequences compounded:

1. `computeProgramPlan` added a set to any muscle under 10/week,
2. `computeCoaching` flagged the same muscles as `low`,
3. `computeBlockRetrospective` marked them `low` and put them in
   `carryover.underMuscles`,
4. which `buildPlanProposal` consumed and added *another* set to next block.

Volume climbed week over week while the athlete's run mileage was also climbing.
`volumeTargetFor(goal)` in `analytics.ts` now owns the band — 4–10 for
`sport-support`, unchanged at 10–20 for every other goal — and every engine takes
a band rather than importing constants.

Two further guards:

- **The coach may trim but never add** on this goal, or during a maintenance
  week. Volume creep is the specific failure mode of concurrent training, and
  every set the coach bolts on is recovery taken from a session it cannot see.
- **A flat e1RM scores positive.** During a race build, *holding* strength is the
  win. Without this the app labels lifts `stalled` mid-build and fires deloads
  that aren't needed. (`fat-loss` already worked this way for the same reason.)

### Periodization is shaped by race proximity, not by a race date

The athlete chooses the block length. How close their race is decides how much of
that length is spent building strength versus holding it:

| Proximity | Shape | Why |
|---|---|---|
| No date / 5–6 months | Build the whole way | Nothing is close enough for lifting to cost anything, and this is the cheapest window to raise maximal strength |
| 3–4 months | Build roughly 60%, then hold | Enough runway to build, close enough that the sport starts taking priority |
| Within 8 weeks | Build ~25%, mostly hold, close with an easy week | Strength is already banked; the job is keeping it without spending recovery the race needs |

The closing easy week doubles as the start of a taper when a race is near. It cuts
sets and not load, because strength is maintained on a fraction of the volume that
built it provided intensity is held.

**There is deliberately no "race week" phase emitted.** Without an exact race-date
input the planner cannot know which week the start line falls in, and labelling the
wrong week as race week is worse than saying nothing — a 12-week block for a race
five months out would have called week 12 race week and been wrong by two months.
The `race-week` `PhaseKind` remains in the type so any block stored by an earlier
build still renders, and the copy for a near-term race says what to do in race week
in prose instead. If an exact race date is ever collected, this is where it plugs in.

Two `PhaseKind` values were added for this goal (`maintenance`) and for the intro
rule below (`intro`), which meant relaxing `validatePhases`: openers must be
contiguous and at the front of the block, capped at `MAX_OPENER_WEEKS`.

### Distance changes the programming

A 5k and a marathon are not the same job, and neither are a sprint tri and an
Ironman. Each event carries an `EventProfile` (`SPORT_EVENTS` in `sports.ts`):

| | Main reps | Plyometrics | Volume | Emphases |
|---|---|---|---|---|
| 5k / Sprint tri | 4–6 | yes | 100% | Calves, Quads |
| 10k / Olympic tri | 4–6 | yes | 95–100% | Calves, Hamstrings |
| Half / 70.3 | 5–8 | **no** | 85% | Calves, Hamstrings, Abductors |
| Marathon / 140.6 | 6–8 | **no** | 70% | Calves, Hamstrings, Abductors |

The shorter the race, the closer it is run to the athlete's ceiling, and the more
maximal strength and rate of force development transfer. The longer it is, the more
eccentric load the legs are already absorbing from the training itself — which is
why plyometrics come out past half distance rather than being scaled down. Adding
impact work to a marathon build is a poor trade at any dose. The volume that remains
goes to the tissues that actually fail in long-distance training: calves, hamstrings
and hip abductors.

### Questions are scoped to the sport

Triathlon is the only multi-sport event here, so it is the only one asked which
discipline is its weak link — a runner has no equivalent answer, and asking anyway
produced a question that visibly didn't apply. `SPORT_ONLY_QUESTIONS` in
`PlanSetupView` drives this, and `nigglesFor(sport)` does the same for the niggle
chips (swimmer's shoulder is not a runner's problem).

Running gets its own templates rather than the triathlon ones with the swim slots
removed: no vertical pull for the catch, no external rotation, one row for posture,
and the volume redirected to single-leg work, hip abduction and single-leg calf
raises.

### The taper is enforced, not described

`WorkoutDay.phases` gates a day by block phase. A three-day block programs all
three sessions during its build weeks, drops the short power session once
maintenance starts, and runs a single session through the closing easy week. The
Dashboard filters day cards by the current phase and says which sessions are
paused and why.

Without this the taper would be a paragraph of advice next to three unchanged day
cards.

---

## The triathlon template

Sprint through full distance, biased by the athlete's weak discipline and
rerouted by any recurring niggles.

Sprint/Olympic distance shown; half and full raise the main lifts to 5–8 or 6–8
reps and drop Day C entirely.

**Day A — Max Strength (every week of the block)**

| Slot | Dose | Why |
|---|---|---|
| Squat / leg press | 4 × 4–6 | Peak hip and knee extension force — sustainable bike power, cheaper stride |
| Hip hinge (RDL) | 3 × 6–8 | Posterior chain; the best-supported protective factor for the run |
| Seated calf raise | 3 × 8–12 slow | **Bent knee = soleus**, the largest force contributor in running gait |
| Pallof press | 2 × 8–12 | Anti-rotation trunk — holds the aero position without leaking power |

**Day B — Unilateral + Upper (drops out for the closing easy week)**

| Slot | Dose | Why |
|---|---|---|
| Step up / split squat | 3 × 6–8 | Loaded single-leg hip extension — the closest gym analogue to a pedal stroke |
| Single-leg RDL | 3 × 8–10 | Hamstring strength plus pelvic control; exposes asymmetry |
| Chin up / pull down | 3 × 6–10 | Vertical pulling for the swim catch |
| Row | 2 × 8–12 | Postural counterweight to hours in aero |
| Dumbbell external rotation | 2 × 12–15 | Posterior-cuff balance against the swim's internal-rotation bias |

**Day C — Power & Stability (build weeks only, ~20 min)**

| Slot | Dose | Why |
|---|---|---|
| Pogo hops | 3 × 12–20 | Achilles stiffness — the elastic return that makes each stride cost less |
| Box jump | 2–3 × 4–6 | Rate of force development; matters more at short course |
| Hip abduction | 3 × 12–15 | Glute med / pelvic control — the cheapest insurance against ITB and PFP |
| Side plank | 2 × 30–45 s | Lateral trunk stability under single-leg load |

Plyometric and heavy-strength work improving running economy by a few percent
(Balsalobre-Fernández and colleagues' meta-analysis) is what earns Day C its
place — and its fragility is why it's the first thing cut, whether by the
schedule or by the race distance.

### Capping

Two passes, in order, both taking sets only from non-main slots and never below
two:

1. **Per muscle**, against `volumeTargetFor('sport-support')`. Stops a weak-link
   bonus or a stacked pattern from pushing one area past the band.
2. **Weekly total**, against `liftBudget().maxWeeklySets`.

When accessory sets bottom out and the total is still over budget, a whole slot
is dropped with a stated reason rather than thinning everything into two-set
gestures. Fewer exercises done properly beats more done token.

A muscle trained by two heavy slots can sit past the band with no accessory left
to trim — a weak-link bonus on top of a distance emphasis will do it. There the
band wins and a main lift loses a set, but never below three, which is the floor
the strength research supports. Distance emphases only ever bump accessory slots
for the same reason: an inflated main lift is one the capping pass can't undo.


### Niggles

Each one reroutes the template rather than being recorded:

- **Achilles / calf** — jumping out, calf work loaded heavy and slow instead.
- **Knee** — box jumps out, squatting moves to supported variations, hip
  abduction stays (it's the direct fix for the pelvic control that usually drives
  runner's knee).
- **Low back / hip** — barbell hinges and axial squatting replaced with supported
  and single-leg work.
- **Shoulder** — nothing overhead; rotation and posterior-cuff work gains a set.

---

## Timed exercises

Planks and carries are held for seconds, not repeated. `ExerciseDef.unit`
(`'reps' | 'seconds'`, absent meaning reps) is intrinsic catalog data alongside
`difficulty` — app-owned, never synced, never a user override.

A timed exercise has no weight input and logs at 0 lbs, the convention bodyweight
work already used, so **the hold is the progression**: `repProgression` drives it
through the same four branches as a bodyweight rep count — beat the range and the
target grows a second, stall three sessions and it resets to the floor, fall short
and it builds back. `buildSetPlan` prescribes a duration per set, and an easy week
flattens every set to the bottom of the range.

Two details worth knowing:

- **Count progression is gated on `weight === 0 && (bodyweight || timed)`**, not on
  weight type alone. A hold progresses by time whatever the catalog says it's
  loaded with, so a user editing a plank's weight-type metadata can't flip it onto
  the load engine.
- **The unit rides `PrescriptionContext`**, so every reason and goal string the
  engine emits is worded correctly. The mechanics are identical either way; only
  the words change, because "push for 46 reps" is nonsense on a plank.

---

## Adding a sport

`sports.ts` is the seam. A new sport is a `SportMeta` entry plus its templates,
dosage and rationale — the planner is a generic assembler and doesn't branch on
sport. Triathlon, running, cycling and swimming are marked `specialised: true`;
Hyrox and sprint/field currently fall back to the general layout and say so in
the plan's warnings, which is the honest state rather than a half-researched
template presented as authoritative.

## Known limitations

- **Only triathlon and running are modelled.** Cycling, swimming, Hyrox and
  power sports were removed rather than shipped as thin wrappers around an
  endurance template. Adding one means a `SportMeta` entry, its events and
  templates, and — for a non-endurance sport — restoring a load multiplier in
  `liftBudget`, which currently assumes the athlete's weekly hours are endurance
  hours.
- **No exact race date.** Proximity is a four-way choice, so the plan can shape
  the build-to-hold ratio but cannot place a taper or a race week on the calendar.
- **Sport hours are self-reported and go stale.** They're captured at planning
  time and drive the whole budget. They should become editable from the Journey
  with a nudge when the block's logged rhythm diverges. A previous "cardio level"
  field was removed from this codebase for being too coarse to act on; the
  difference here is that hours + sport + race date drive a concrete set ceiling
  and phase layout, but it is still self-report.
- **Nothing reads actual training load.** Integrating Apple Health / Strava would
  let the budget respond to a real training week instead of a remembered one.
- **`Abductors` and `Adductors` have no heatmap regions** yet — they're in the
  `MuscleGroup` taxonomy and count toward volume, but the SVG silhouettes in
  `MuscleHeatmap.tsx` don't render them.
- **Per-day phase gating has no editor.** `WorkoutDay.phases` is set by the
  planner; the day editor can't change it.

---

## Introductory weeks (all goals, not just this one)

The **repeated-bout effect** is exercise-specific: the first hard exposure to an
unaccustomed movement — or an unaccustomed rep range — produces markedly more
muscle damage and soreness than the second, and that first bout confers protection
for weeks. So the case for an easy opening week is about *novelty*, not training
age. A five-year lifter moving from 4-rep strength work to 15-rep hypertrophy work
is meeting a new stimulus just as surely as a novice is.

Novices additionally need time on task before load matters at all — the classic
"anatomical adaptation" phase — so they always get one, and two when the block is
long enough to spare them.

`introWeeksFor()` in `planner.ts`:

| Condition | Intro weeks |
|---|---|
| Beginner, block ≥ 8 weeks | 2 |
| Beginner, shorter block | 1 |
| Goal changed from the active plan (rep ranges change) | 1 |
| ≥ 50% of the block's exercises are new to the athlete | 1 |
| Otherwise | 0 |
| A recovery opener is already scheduled | 0 — never stack two easy openers |

An intro week is **not** a deload: it comes before any fatigue exists, and its job
is a comfortably submaximal first exposure. `calculateRecommendation` prescribes
~20% off in an intro week — a bigger cut than a deload's 10% — and the copy tells
the athlete to leave 4–5 reps in the tank. `computeProgramPlan` adds no sets, and
intro weeks don't count toward earning a deload.

This required computing the phase layout **after** the workouts are generated in
`buildPlanProposal`, since novelty can't be measured until the exercises exist.
`stimulusChange()` compares the proposal against the athlete's current program; a
first plan (no current program) scores zero novelty, because everything being new
is not information — experience alone decides there.
