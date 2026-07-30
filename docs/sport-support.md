# Sport-support training

The `sport-support` goal covers athletes whose primary training happens somewhere
else — a triathlon build, a marathon block, a Hyrox season — and who lift to make
that training better rather than as an end in itself.

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

**Where it lives:** per-slot `dose` in `sports.ts`; `dosage()` in `planner.ts`
honours a slot's prescription instead of consulting the goal's generic table.

### The interference effect scales with the sport's own load

Concurrent-training research (Wilson and colleagues' meta-analysis being the
most-cited) finds the interference effect grows with endurance training frequency
and duration, and that **running interferes more than cycling** because of its
eccentric load. Strength is better preserved than hypertrophy or power.

So the lifting ceiling cannot be a constant — it has to be a function of how much
the athlete is already doing. `liftBudget()` takes self-reported weekly sport
hours and returns the number of lifting days and the total weekly working sets
the plan is allowed to spend. Power sports (sprinting, field sports) pay almost
no tax; hybrid racing wants the volume, since strength endurance *is* the event.

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

### Periodization runs off the race date

There is no lifting peak in a race build. The arc is **build → maintain → taper →
race week**, and `buildSportPhases()` derives it from the weeks between the
block's start Monday and the race:

| Phase | What changes |
|---|---|
| `accumulation` / `intensification` | The real strength work. The only weeks where lifting is allowed to cost anything. |
| `maintenance` | Loads held, sets cut. The sport takes priority; lifting defends what was built. |
| `deload` (taper) | Same kind of weight, roughly a third of the work. |
| `race-week` | One short session early, nothing inside 72 hours of the start. |

The taper is cheap because strength is maintained on a fraction of the volume
that built it, provided intensity is held. That's why the taper cuts sets and not
load, and why `calculateRecommendation` treats `maintenance` as a normal
progression week rather than an easy one.

Two new `PhaseKind` values were needed (`maintenance`, `race-week`), which meant
relaxing one guardrail in `validatePhases`: a deload may now sit immediately
before a race week. A taper and the race itself are the one legitimate pair of
consecutive easy weeks.

### The taper is enforced, not described

`WorkoutDay.phases` gates a day by block phase. A three-day triathlon block
programs all three sessions during its build weeks, drops the short power session
once maintenance starts, and runs a single session through the taper and race
week. The Dashboard filters day cards by the current phase and says which
sessions are paused and why.

Without this the taper would be a paragraph of advice next to three unchanged day
cards.

---

## The triathlon template

Sprint through full distance, biased by the athlete's weak discipline and
rerouted by any recurring niggles.

**Day A — Max Strength (every week of the block)**

| Slot | Dose | Why |
|---|---|---|
| Squat / leg press | 4 × 4–6 | Peak hip and knee extension force — sustainable bike power, cheaper stride |
| Hip hinge (RDL) | 3 × 6–8 | Posterior chain; the best-supported protective factor for the run |
| Seated calf raise | 3 × 8–12 slow | **Bent knee = soleus**, the largest force contributor in running gait |
| Pallof press | 2 × 8–12 | Anti-rotation trunk — holds the aero position without leaking power |

**Day B — Unilateral + Upper (drops out for the taper and race week)**

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
place — and its fragility is why it's the first thing cut when the schedule
tightens.

### Capping

Two passes, in order, both taking sets only from non-main slots and never below
two:

1. **Per muscle**, against `volumeTargetFor('sport-support')`. Stops a weak-link
   bonus or a stacked pattern from pushing one area past the band.
2. **Weekly total**, against `liftBudget().maxWeeklySets`.

When accessory sets bottom out and the total is still over budget, a whole slot
is dropped with a stated reason rather than thinning everything into two-set
gestures. Fewer exercises done properly beats more done token.

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
`difficulty` — app-owned, never synced, never a user override. Timed exercises
have no weight input at all and log at 0 lbs, the convention bodyweight work
already used, so the existing rep-progression engine in `recommendations.ts`
progresses the hold with no schema change. The logger, target line, history rows
and plan review all read the unit and say "sec".

---

## Adding a sport

`sports.ts` is the seam. A new sport is a `SportMeta` entry plus its templates,
dosage and rationale — the planner is a generic assembler and doesn't branch on
sport. Triathlon, running, cycling and swimming are marked `specialised: true`;
Hyrox and sprint/field currently fall back to the general layout and say so in
the plan's warnings, which is the honest state rather than a half-researched
template presented as authoritative.

## Known limitations

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
