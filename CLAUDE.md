# LiftLog — Claude Context

## Project goal

LiftLog is a Progressive Web App for coached strength training — plan a training journey, log workouts, get adaptive coaching — installable on iPhone via "Add to Home Screen." The user is a first-time web app developer. The app lives at this repo and auto-deploys to Cloudflare Pages on push to `main`.

New accounts start with a **blank slate** — no pre-populated workouts. The stored-program
fallback is `[]`; a first program comes from the plan wizard. The hardcoded 4-day `PROGRAM`
in program.ts is only a sets/reps seed for the built-in exercise library.

Long-term milestones (roughly):
1. ✅ PWA shell + Cloudflare deployment
2. ✅ Dashboard with 4 day cards, week date range
3. ✅ Workout logging + IndexedDB persistence
4. ✅ Recommended weights (progressive overload) + inline set editing
5. ✅ History view + session editing
6. ✅ Day/exercise editing (add, remove, rename exercises per day)
7. ✅ Google OAuth login + cloud sync
8. ✅ Exercise metadata (muscle groups, equipment, weight type) + metrics dashboard
9. ✅ Progress charts (custom CSS bar/line charts)
10. ✅ Rest timer (auto-starts on logging a set; adjustable, with haptic buzz)
11. ✅ Data-driven coaching engine (`insights.ts`) — fractional weekly set-volume per
    muscle vs the 10–20 hard-set target, e1RM plateau/trend detection, prioritized
    recommendations + next-workout suggestion. Surfaced on the Dashboard (Coach card)
    and in Metrics (Coach section).
12. ✅ Configurable program start date (Settings screen) + week-over-week volume delta
13. ✅ Rev 2: double-progression recommendation engine with deload detection,
    shared analytics core (`analytics.ts`), Settings screen, "last time" context
    on exercise cards, Vitest test suite, worker payload validation
14. ✅ Adaptive coaching system: `coach.ts` planner (holistic set-volume
    redistribution across future workouts, computed as a pure overlay — never
    mutates the stored program), workout-duration tracking as an optimization
    constraint, redesigned Coach insights (3 highlights + 3 opportunities;
    under-trained nudges removed — the planner fixes volume instead), muscle
    heatmap (front/back SVG silhouettes, timeframe presets)
15. ✅ Backend audit: Monday-anchored week numbering, per-account local-data
    isolation (`liftlog_data_owner`), app-wide exercise library + metadata with
    deletion tombstones (D1 `app_exercises`/`app_exercise_metadata`/`deleted_exercises`)
16. ✅ Merge-based session sync (sync v2) — sessions are atomic documents keyed
    by immutable GUID, merged per-session by `updatedAt` with deletion tombstones
    (replaces full-replace LWW sync and the `pendingSessions` workaround), plus
    in-workout draft persistence (localStorage; auto-restore on reopening the day)
17. ✅ Exercise Intelligence / substitution engine (`substitution.ts`) — per-exercise
    "Find replacement" in the day editor: top-3 ranked, explained suggestions that
    preserve the slot's programming; curated catalog expansion (~89 exercises)
18. ✅ Training journey — the long-term planning layer above individual workouts:
    TrainingPlan/TrainingBlock domain model (`plan.ts`), block planner
    (`planner.ts`: goal + history → explained split/phases/workouts proposal),
    collaborative 3-step plan wizard (PlanSetupView), JourneyView (block
    timeline + retrospectives), block retrospectives (`retrospective.ts`) whose
    carryover feeds the next planning cycle, phase-aware engines (planned
    deload/recovery weeks override recommendations and pause the set-planner),
    legacy history migrated into an open-ended "Foundation" block, journey
    document synced LWW (D1 `training_plans`)
19. ✅ Exercise ownership architecture (`docs/ownership-architecture.md`) — exercises
    split into application-owned (catalog + admin-curated global layer, audited),
    user-owned (per-user library/metadata/tombstones — one user's edits can never
    affect another), and workout-instance layers; role system (user/admin/tester);
    custom-exercise lifecycle (pending queue → admin review → global promotion)
20. ✅ Athlete profiling + beginner-safe planning — a `TrainingProfile` (`plan.ts`)
    captures Tier-1 hard constraints (injuries, equipment access, days) and Tier-2
    calibration (experience level + training age, priority muscles),
    collected through a redesigned one-question-per-page onboarding wizard
    (PlanSetupView, slide animation, pre-filled on replans). Exercises carry an
    intrinsic difficulty tier + prerequisites (`exercises.ts`); the planner steers
    beginners to low-skill machine/dumbbell work at higher reps and lower volume,
    gates advanced lifts behind their prerequisites, and biases volume toward
    priority muscles. Experience is inferred from logged data (`experience.ts`) and
    only ratchets up: plans use the higher of self-reported and inferred, and the
    Journey surfaces a "level up" nudge. Profile rides the LWW plan-document sync.
23. ✅ Prescription ownership — rep ranges moved off the exercise and onto the
    prescription. `LibraryExercise` carries identity only; `dosage.ts` resolves
    sets × reps from (goal, slot, movement, training age) and `prescribe.ts`
    routes every entry point through it — day editor, mid-workout add, quick
    workouts, the planner and the worker's exercise promotion. Heavy axial
    barbell work (hinge/squat) gets its own low, narrow tier. When nothing can
    be resolved (no plan, no history) the slot carries **no** range and the card
    shows no targets, instead of a fabricated 3 × 8–12.
22. ✅ Progressive-overload audit — the prescription engine now reads the athlete and the
    plan, not just the lift (`PrescriptionContext`: goal + effective training age). Jump size
    derives from the load–rep relationship instead of a flat 5 lbs; load climbs are
    rate-limited per week by training age; stalls must show on both reps and e1RM *and*
    survive one bad session; e1RM is ignored above ~12 reps where the formula stops being
    valid; a deficit holds the load instead of deloading it. Covered by a 12-week loop
    simulation as well as per-branch tests.
21. ✅ Calendar-week analytics + per-set prescriptions — every week-bucketed metric
    groups by the Monday-anchored wall-clock week (`sessionWeekStart`) instead of the
    re-anchorable stored `weekNumber`, so weekly volume is chronological, gap-honest
    and highlights the current week. `buildSetPlan()` turns the single recommended
    weight into a full `SetPlan`: one pre-filled row per programmed set, with rep
    targets fitted to the lifter's own set-to-set fatigue drop-off, rep-total and
    e1RM-breakout progression triggers, and equipment-aware load increments.
    Warm-ups became an explicit ＋ Warm-up set row instead of a mode toggle.

21. ✅ Sport-support training (`docs/sport-support.md`) — a `sport-support` goal for
    athletes whose primary training is elsewhere (**triathlon and running**). The
    weekly volume band is now goal-derived (`volumeTargetFor` in analytics.ts:
    4–10 sets/muscle here vs 10–20) rather than a global constant, which removes
    the ratchet where the coach added volume, insights called it low, and the
    retrospective carried "under-target" into the next block. `sports.ts` owns the
    research layer as data — per-sport day templates with per-slot dose and
    rationale, per-event `EventProfile`s (distance sets the main lifts' rep range,
    whether plyometrics earn a place, the volume scale and the tissue emphases),
    the interference budget (`liftBudget`: weekly sport hours × race distance cap
    lifting days and weekly sets), proximity-driven periodization
    (`buildSportPhases`: how much of the block builds vs holds — **no race week**,
    since there is no exact race-date input), and niggle routing.
    `WorkoutDay.phases` gates a day by block phase so the lifting taper is
    enforced, not merely described. Wizard questions are scoped to the sport
    (`SPORT_ONLY_QUESTIONS`, `nigglesFor`). Timed exercises (`ExerciseDef.unit`)
    log seconds.
22. ✅ Introductory weeks — the `intro` PhaseKind, decided by *novelty* rather than
    training age (`introWeeksFor` in planner.ts): beginners always get one (two on
    a block ≥8 weeks), and an experienced lifter earns one when the goal changed
    or ≥50% of the block's exercises are new (`NOVEL_SELECTION_SHARE`). Grounded
    in the repeated-bout effect — the first exposure to an unaccustomed movement
    or rep range is the sore one. Not a deload: ~20% off, no set additions, and it
    doesn't count toward earning a deload. Required computing phases **after** day
    generation in `buildPlanProposal` so `stimulusChange()` can compare the
    proposal against the current program. Also: the vague 'Athletic Performance'
    goal was removed from `GOALS` (the `Goal` type keeps the member so stored
    plans still resolve).

24. ✅ October 2026 audit action plan (`docs/action-plan-2026-10.md`, eight phases, all
    landed): atomic session writes + serialized, visible sync + protected drafts; honest
    progress/stall engines (easy-week exclusion, load-normalized volume, score-driven
    deloads, rep-range memory on set logs); the journey learning the right lessons
    (one-directional activation, coach decisions, nudge-only experience, beginner band,
    block-growth cap); self-programming (hand-built days, slot dose editor, manual
    progression, quick workouts); clocks on every synced document + explicit restores +
    conditional (ETag) pull + worker hardening + SW update toast; exercise instructions;
    strength structure (barbell anchoring, phase rep ranges, top set + back-offs) and
    bodyweight regressions; per-exercise history, session notes, kg/lb preference, a11y.
25. ✅ One-rep maxes + strength goals (`strength.ts`, `StrengthView`) — a stored 1RM is
    the one *measurement* the engines get (everything else is an estimate). It anchors
    the prescription where the log can't: a never-trained lift gets a real starting load
    (`firstSessionFromMax` in recommendations.ts) instead of "find a weight", and a max
    entered *after* the last session re-anchors the load (`maxReanchor`, same guard rails
    as the rep-range re-anchor: ≥5% shift, ≤20% per step, a *lower* max only cuts load
    when the last session also missed the range). The exercise card shows the prescribed
    load as **% of 1RM**; the Strength screen shows the whole program as a % table. A
    **1RM goal** gets a projection (`projectGoal`: the lifter's own e1RM trend, clamped
    to a training-age-expected rate — ACSM ~40%/16%/10% per 6 mo/6 mo/yr — tempered by
    the goal; a range, never a date), surfaced on the Journey ("Strength targets") and
    the dashboard journey card. "Design a block around this lift" seeds the wizard
    (`PlanSeed`) and the planner's `focusExerciseIds` guarantees the lift a main slot
    (`anchorFocusLift`), bypassing the beginner skill gate and equipment filters with a
    warning. Records ride the journey document (`PlanState.strength`, LWW sync; no
    backend change). Entry points: Settings → 1RMs & goals (always available), Journey,
    Metrics' e1RM chart, and a never-trained exercise card mid-workout.

**Future milestones:**
- Adaptive engine v2 (`docs/adaptive-engine-roadmap.md`) — staged evolution from hand-tuned
  rules toward an estimator: record the prescription and per-set timestamps (Stage 0), a
  capacity filter with real uncertainty replacing the dead band / stall window / e1RM cliff
  (Stage 1), fatigue as a second state (Stage 2), a constrained controller (Stage 3). The
  rules become the constraint set, not the competition. Both self-reported RPE and
  drop-off-inferred effort are **rejected** there, with reasons.
- Journey v2 — deload-position editing in the wizard (`validatePhases` already
  enforces the constraints), LLM-backed proposal source (`PlanProposal` is the
  seam: any generator that emits one plugs into the same review-and-activate
  flow), block-over-block comparison charts, rehab/peaking block presets.
- Body-weight log — so bodyweight-exercise e1RM and "total lifted" include the lifter
  (the kg/lb preference landed in Phase 8; see `data/units.ts`).
- Delta push — pull is conditional (ETag/304) but every push still re-upserts every session
  document. The clocks are in place; the missing piece is a per-device `lastPushedAt` and a
  payload of only the documents newer than it (decision D7 deferred this half).
- Planner v2 — effort-aware volume decisions, automatic exercise substitution (the planner
  currently only *suggests* adding an exercise when no slot fits; it could now rank that
  suggestion through `substitution.ts`), and per-exercise rep-range adjustments in
  addition to set counts.
- Reactive rest-day suggestions — instead of asking which weekdays the user trains
  (removed: it was collected but unused), suggest rest days from the profile + logged
  training rhythm ("you've trained 3 days straight — tomorrow looks like a rest day").
- Cardio awareness v2 — the sport-support goal now takes self-reported weekly sport
  hours and turns them into a real lifting budget, but the number is captured once at
  planning time and goes stale. Integrate external activity sources (Apple Health /
  Google Fit / Strava) so the budget responds to an actual training week, and surface
  the hours as editable on the Journey with a nudge when logged rhythm diverges.
- Exercise Intelligence v2 — external candidate sources behind the `ExerciseProfile`
  normalization seam (AI-generated suggestions, coach-curated collections), injury-aware
  and equipment-aware (travel/home-gym) substitution modes.

---

## Stack

- **React + Vite + TypeScript** — `npm run dev` to start, `npm run build` to build
- **Vitest** — `npm test` (or `npm run test:watch`); `npm run typecheck` for types alone;
  `npm run lint` for ESLint; `npm run check` runs lint + tests + build and is what the
  Cloudflare Pages build command should run so a red commit never deploys.
  `.github/workflows/ci.yml` runs typecheck + lint + tests on every PR and push to `main`.
  Tests live next to the modules they cover (`src/data/*.test.ts`, `src/db/*.test.ts`,
  `worker/*.test.ts`), plus `test/` for tests that span the client/worker boundary.
  See the Testing section below for the environment, the D1/IDB harnesses and the
  tsconfig layout.
- **IndexedDB** — via a custom `idbReq<T>` promise wrapper in `src/db/database.ts` (no third-party library). Read and write in **separate transactions** to avoid IDB auto-commit bugs; multi-record writes queue all requests synchronously on one transaction and await `txDone(tx)`.
- **localStorage** — for program config, exercise library, exercise metadata, settings, and migration flags. Managed in `src/data/programStore.ts`, `src/data/exercises.ts` and `src/data/settings.ts`.
- **Plain CSS** — no CSS framework, dark theme via CSS custom properties
- **Charts** — hand-rolled CSS/SVG `BarChart`/`LineChart` (no charting dependency)
- **Cloudflare Pages** — auto-deploys from GitHub `main` branch

---

## TypeScript rule — CRITICAL

`tsconfig.app.json` has `verbatimModuleSyntax: true`. This means **all interface/type-only imports must use `import type`**:

```ts
import type { WorkoutDay } from '../data/program';   // ✅
import { WorkoutDay } from '../data/program';         // ❌ crashes at runtime in the browser
```

Value imports are fine as normal: `import { PROGRAM, getWeekNumber } from '../data/program'`.

---

## Design tokens (src/index.css)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0f0f12` | Page background |
| `--bg-card` | `#1a1a1e` | Card backgrounds |
| `--bg-input` | `#1a1a1e` | Input backgrounds |
| `--border` | `#2a2a30` | Borders |
| `--text` | `#f0f0f4` | Primary text |
| `--text-muted` | `#888891` | Secondary text |
| `--purple` | `#7C72E8` | Accent / primary action |
| `--green` | `#1D9E75` | Success / done state |
| `--red` | `#E85555` | Destructive actions |

---

## iPhone PWA safe area

All sticky headers use: `padding-top: calc(14px + env(safe-area-inset-top))`
Bottom bars use: `padding-bottom: calc(12px + env(safe-area-inset-bottom))`
Scrollable lists add: `padding-bottom: calc(96px + env(safe-area-inset-bottom))`

All inputs use `font-size: 16px` to prevent iOS Safari zoom-on-focus.

---

## Auth

The app requires Google OAuth login. No content is shown until the user is authenticated.

- Login: `/api/auth/google` (Google OAuth redirect)
- Logout: `POST /api/auth/logout` (a form submit from Settings; GET is 405 — a GET sign-out can
  be fired by a link prefetch or a hostile page)
- Current user: `getLoggedInUser()` in `src/data/sync.ts` — reads from a cookie set by the server
- `LoginView` is shown when `getLoggedInUser()` returns null
- Server side, `getAuthenticatedUser()` resolves session + account + role in **one** query
  (`User.role`); sign-in also sweeps expired `user_sessions` rows

---

## Navigation

No router — pure React state in `App.tsx`. The `View` discriminated union:

```ts
type View =
  | { screen: 'dashboard' }
  | { screen: 'workout'; day: WorkoutDay }        // the day is SNAPSHOTTED into the view
  | { screen: 'history' }
  | { screen: 'edit-session'; sessionId: number; dayId: number }
  | { screen: 'edit-day'; dayId: number }
  | { screen: 'new-day'; day: WorkoutDay }
  | { screen: 'exercise-list' }
  | { screen: 'exercise-meta'; exerciseId: string; exerciseName: string }
  | { screen: 'metrics' }
  | { screen: 'settings' }
  | { screen: 'glossary' }
  | { screen: 'journey' }
  | { screen: 'plan-setup'; seed?: PlanSeed }
  | { screen: 'quick-setup' }
  | { screen: 'quick-workout' }
  | { screen: 'shared-preview' }
  | { screen: 'shared-workout' }
  | { screen: 'strength'; exerciseId?: string; back: View };   // remembers where to return
```

The per-exercise **history** (`ExerciseHistorySheet`) and the instruction sheet are overlays,
not routes: they open over a workout without unmounting it.

Day-scoped views (`workout`, `edit-session`, `edit-day`) look the day up with a fallback:
if the `dayId` no longer exists (program replaced by a sync), the app renders the
dashboard instead of crashing.

`program: WorkoutDay[]` state lives in `App.tsx`, initialized from `getStoredProgram()` (localStorage). On day edits it's updated and saved back.

---

## File map

```
src/
  App.tsx                      — root state, navigation, auth check, startup migration + sync
  App.css                      — app shell, header safe area
  index.css                    — CSS custom properties, global reset

  data/
    taxonomy.ts                — domain vocabularies: MuscleGroup / WorkoutType / Equipment /
                                  WeightType / MeasureUnit types + the option arrays the UI
                                  renders. unitLabel() formats a set's count ("reps"/"sec")
    program.ts                 — Exercise/WorkoutDay interfaces (incl. WorkoutDay.phases +
                                  dayInPhase() — per-day block-phase gating, how the
                                  sport-support lifting taper is enforced), PROGRAM (4 days),
                                  getWeekNumber()/getWeekNumberForDate(), getWeekDateRange(),
                                  getExerciseName(). Also THE calendar-week math:
                                  startOfWeek()/addWeeks()/weeksBetween()/weekStartLabel()
                                  (Monday-anchored; plan.mondayOf delegates here)
    settings.ts                — device-local settings (localStorage): the week-numbering
                                  anchor (managed automatically — first-use stamp, then the
                                  journey via planStore.ensureWeekAnchor) + rest-timer default
    exercises.ts               — Single source of truth for the ~89 built-in exercises
                                  (ExerciseDef), EXERCISES array, EXERCISE_MAP, getExerciseMeta(),
                                  saveExerciseMeta() — metadata overrides in localStorage.
                                  Includes the curated catalog expansion that feeds the
                                  substitution engine's candidate pool
    programStore.ts            — localStorage CRUD: getStoredProgram, saveStoredProgram,
                                  getExerciseLibrary, saveExerciseLibrary, addToExerciseLibrary,
                                  getExerciseName, generateExerciseId.
                                  Runs library migration (v2/v3) on first call to getExerciseLibrary,
                                  and canonicalizes legacy -d1/-d2/-d4 program IDs on every read.
    legacyIds.ts               — LEGACY_ID_MAP + canonicalizeId(): single source of truth for the
                                  old -d1/-d2/-d4 → canonical exercise-ID remap (used by set-log
                                  migration in database.ts and program canonicalization here)
    analytics.ts               — shared analytics core + volumeTargetFor(goal) (THE weekly
                                  set band; 4–10 for sport-support, 10–20 otherwise):
                                  loadTrainingSnapshot() (ONE dumpIDB read
                                  powering every consumer), buildSnapshot() (pure, for tests),
                                  epley1RM, e1rmSeries(), musclesForExercise()/primaryMuscleFor()
                                  (override → master list → name match), SETS_TARGET_LOW/HIGH,
                                  sessionDurationMs()/avgDurationByDay() (workout durations),
                                  sessionWeekStart() — the grouping key for every week-bucketed
                                  analytic (see the weekly-bucketing note below)
    progression.ts             — THE shared thresholds: GOAL_SIGNAL_WEIGHTS, compositeScore()
                                  (−1…+1 goal-weighted blend of e1RM/volume/PRs), fullMarksFor()
                                  (training-age-scaled bars), deadband() (3% noise floor),
                                  stallWindowFor(), holdsInsteadOfDeload(), score bands. Pure
                                  arithmetic, no stores — imported by BOTH progress.ts (what the
                                  review says) and recommendations.ts (what goes on the bar), so
                                  the two can never disagree about the same lift
    progress.ts                — THE progress/stall assessment: assessSnapshot(snapshot, goal) →
                                  per-exercise ExerciseProgress (status progressing/steady/
                                  stalled/declining) blending e1RM trend + volume-load trend +
                                  weight/rep PRs with goal-dependent weights, discounting sessions
                                  trained later in the workout than usual (exercise-order
                                  freshness). Single source of truth for "is this progressing?"
                                  across insights, retrospective, planner, substitution; shares
                                  its thresholds with recommendations.ts via progression.ts
                                  (see progress engine section below)
    recommendations.ts         — calculateRecommendation(history, exercise, ctx) → WeightRec |
                                  null and buildSetPlan(...) → SetPlan (one PrescribedSet per
                                  programmed set + a goal line). ctx = PrescriptionContext
                                  (weightType, phase, goal, experience, now). Rep-total double
                                  progression, load–rep-sized increments, weekly rate cap by
                                  training age, two-lever stall detection, goal-aware deficit
                                  handling, per-set fatigue targets, order-aware baseline
                                  (see algorithm section below)
    coach.ts                   — adaptive programming engine: computeProgramPlan(program, snapshot)
                                  → ProgramPlan (conservative set additions/trims across future
                                  workouts, each with a plain-language reason) + applyPlanToDay()
                                  overlay. Pure function of history — never mutates the program.
    substitution.ts            — Exercise Intelligence: profileFor()/candidateProfiles()
                                  (normalized ExerciseProfile view: muscles, pattern, equipment,
                                  derived compound/isolation), suggestReplacements(target, day,
                                  snapshot) → top-3 ranked, explained replacement suggestions
                                  (see substitution engine section below)
    plan.ts                    — training-journey domain: TrainingPlan/TrainingBlock/
                                  BlockRetrospective types, PhaseKind week tags, Monday-anchored
                                  block week math (blockWeekIndex/currentPhase/blockEnded),
                                  validatePhases() deload + opener guardrails, isEasyPhase()/
                                  isOpenerPhase(). Also the athlete model: TrainingProfile +
                                  ExperienceLevel/EquipmentAccess and their option arrays, plus
                                  SportContext (SportId/SportEvent/RaceProximity/EnduranceLoad/
                                  Discipline) for sport-support
    dosage.ts                  — THE prescription resolver (pure): dosage(goal, slot, profile,
                                  experience) → sets × rep range for every goal INCLUDING
                                  sport-support (so the day editor/quick workouts dose it right)
                                  and every timed hold (seconds, not reps), isHeavyAxial()
                                  (barbell hinge/squat → low narrow ranges), rangeFromHistory()
                                  (read the range off the lifter's own log), resolvePrescription()
    prescribe.ts               — the store-reading wrapper: prescribeFor(id, opts) and
                                  slotFor(id, name, opts) → a dosed program slot. Every route an
                                  exercise takes into a workout goes through here
    sports.ts                  — sport-support research layer as data: SPORTS (triathlon,
                                  running) + SPORT_EVENTS with per-distance EventProfile,
                                  Slot/DayTemplate vocabulary (shared with planner.ts),
                                  liftBudget() interference ceiling, buildSportPhases()
                                  proximity-driven periodization, buildSportPlan()
                                  (per-sport templates + distance emphases + weak-link
                                  bias + niggle routing + two capping passes),
                                  NIGGLES/nigglesFor. See docs/sport-support.md
    planner.ts                 — block planner: buildPlanProposal(input, program, snapshot,
                                  prevRetro) → PlanProposal (split, phase layout, generated
                                  workouts, per-exercise decisions with reasons, confidence,
                                  parsed guidance notes) — pure, like every other engine.
                                  Experience-aware: beginner-safe dosage/split/selection,
                                  prerequisite skill-gating, priority-muscle volume bias.
                                  Also introWeeksFor()/stimulusChange() — novelty-driven
                                  intro weeks (phases are computed AFTER the days, so
                                  selection novelty can be measured)
    strength.ts                — one-rep maxes + strength goals (pure): OneRepMax/StrengthGoal
                                  types, %1RM math (pctOfMaxForReps, percentBandFor,
                                  loadBandFor, programLoadsFor — the per-plan % table),
                                  log evidence (bestLoggedMax, strengthTrend — least-squares
                                  e1RM rate over 12 weeks, currentMax — a tested max stands
                                  unless the log has beaten it SINCE), projectGoal()
                                  (EXPECTED_WEEKLY_GAIN_PCT by training age, GOAL_RATE_SCALE,
                                  ETA with a fast/slow band, feasibility). Persisted via
                                  planStore (PlanState.strength); consumed by the
                                  recommendation engine through PrescriptionContext.oneRepMax
    experience.ts              — data-driven experience inference: inferExperience(snapshot)
                                  (training age + consistency + difficulty mastered),
                                  effectiveExperience() (max of self-report and inferred),
                                  experienceSuggestion() (the "level up" nudge)
    retrospective.ts           — computeBlockRetrospective(block, snapshot) → adherence,
                                  per-lift e1RM change, muscle volume, coach-voice summary,
                                  carryover signals the next planner run consumes
    planStore.ts               — journey persistence (localStorage `liftlog_plan`):
                                  activateProposal(), completeActiveBlock(), getActivePhase(),
                                  getTrainingProfile()/saveTrainingProfile()/getProfileOrDefault(),
                                  ensureJourneyMigrated() (wraps legacy history in a Foundation
                                  block), mergeServerPlanState() (LWW sync)
    heatmap.ts                 — muscle heatmap data: computeMuscleHeat() over a time window,
                                  heatColor()/heatLabel() (blue→green→yellow→red weekly-rate
                                  gradient), presetWindow()/mesocycleWindow()
    metrics.ts                 — computeMetrics(snapshot, now) → Metrics (weekly volume bucketed
                                  by calendar week, e1RM series, muscle sets)
    insights.ts                — computeCoaching(program, snapshot) → Coaching: 3 positive
                                  highlights + 3 highest-impact opportunities, e1RM trend/plateau
                                  detection, weekly muscle volume, next-workout suggestion, and
                                  the coach plan (embeds computeProgramPlan)
    sync.ts                    — pushSync(), pullSync(), getLoggedInUser(), ensureLocalDataOwner()
                                  — merge-based cloud sync via /api/sync, clock-compared on
                                  every document, conditional (ETag) pull (see Cloud sync)
    merges.ts                  — admin exercise merges: stored from→to map, pure remap helpers,
                                  applyExerciseMerges() (set logs + program + library + metadata,
                                  reviving a tombstoned survivor)
    appUpdate.ts               — "new build ready" flag from the service worker's controllerchange;
                                  App renders the reload toast outside workouts
    instructions.ts            — compiled, app-owned exercise instructions (setup, 3–5 cues,
                                  faults) for every catalog exercise; instructionsFor(id) resolves
                                  timestamped catalog copies, null for a true custom exercise
    search.ts                  — matchesExerciseQuery()/filterExercises(): every typed word must
                                  appear in the name, any order — shared by the list and the picker
    units.ts                   — weight unit preference (lb/kg): toDisplay()/fromDisplay()/
                                  fmtWeight() — storage is ALWAYS lbs; only labels and inputs
                                  convert, and every engine reason string formats through here
    syncMerge.ts               — pure session-merge planner: SessionDoc, sessionGuid(),
                                  sessionUpdatedAt(), planSessionMerge() — the sync-v2 merge rules,
                                  unit-tested without IndexedDB
    sessionTombstones.ts       — deleted-session tombstone set (localStorage, user-scoped, synced)
    draftSession.ts            — in-progress workout draft (localStorage): saveDraftSession(),
                                  getResumableDraft(), clearDraftSession()
    *.test.ts                  — Vitest unit tests for the data layer

  db/
    database.ts                — all IndexedDB logic (3 stores: sessions, setLogs, exerciseLogs).
                                  Also: migrateExerciseIds() — remaps old -d1/-d2/-d4 exercise IDs.

  components/
    Dashboard.tsx/css          — Coach card (next day + top insight + "coach adjusted" note)
                                  + 4 day cards + icon nav row
    DayCard.tsx/css            — single day card (exercise count + ~duration from the coach's
                                  3-min-per-set estimate) as two real buttons: start, Edit
    WorkoutView.tsx/css        — workout logging + edit-session mode + recommendations + rest
                                  timer + coach-plan overlay/banner + duration capture
    ExerciseCard.tsx/css       — per-exercise card: recommendation chip, "last time" line,
                                  goal line, the whole prescription (next set pre-filled and
                                  editable, remaining sets previewed), ＋ Warm-up / ＋ Extra
                                  set, tap-to-edit logged sets
    RestTimer.tsx/css          — floating rest countdown; auto-(re)starts on each logged set
    HistoryView.tsx/css        — all past sessions in reverse chronological order, with the
                                  session note; the card header is the one button
    DayEditView.tsx/css        — edit a day's muscle group label + add/remove exercises +
                                  per-exercise "Find replacement" (⇄) suggestion panel
    ExerciseListView.tsx/css   — searchable alphabetical list of all exercises (data/search.ts —
                                  the same matcher as the picker), taps into ExerciseMetaView
    ExerciseMetaView.tsx/css   — "How to do it" entry + edit an exercise's muscle groups,
                                  equipment, weight type
    InstructionSheet.tsx/css   — the bottom sheet with an exercise's setup / cues / faults and the
                                  ⓘ InfoButton every surface uses; useInstructionSheet.tsx is the
                                  per-screen state hook (open(id, name) + the rendered sheet)
    MetricsView.tsx/css        — metrics dashboard: Coach section (highlights, opportunities,
                                  program adjustments), muscle heatmap, volume summary, weekly
                                  chart, e1RM chart, muscle sets chart, unclassified banner
    MuscleHeatmap.tsx/css      — front/back SVG body silhouettes colored by weekly training
                                  volume per muscle; 7d/30d/mesocycle/custom timeframe presets
    JourneyView.tsx/css        — training journey: active block (phase timeline, intent,
                                  progression), wrap-up/end-early with retrospective, past
                                  blocks with expandable reviews
    PlanSetupView.tsx/css      — collaborative plan wizard: goal + schedule + open notes →
                                  proposed structure (confidence, split, phases, reasons) →
                                  workout review (kept/new/replacement badges, swap ⇄ / remove)
                                  → activate
    SettingsView.tsx/css       — Exercises/Glossary/1RMs & goals entries, weight unit (lb/kg), rest-timer
                                  default, account + POST sign-out, sync status + Sync now
    ExerciseHistorySheet.tsx/css — per-exercise history overlay: bests, progress verdict + recent
                                  PRs, est-1RM and volume trends, every session with its sets and
                                  note. Opened from the card's "Last time" line, a Metrics
                                  Progress row and the exercise detail screen
    useDialog.ts               — the modal contract (Escape closes, focus moves in and is trapped,
                                  the opener gets focus back) shared by every dialog/sheet
    StrengthView.tsx/css       — 1RMs & goals: list of tracked lifts → per-lift editor (max +
                                  source + date with log evidence and "Use this", the program
                                  as a % of 1RM table, goal input with live projection, "Add to
                                  my plan", "Design a block around this lift" → seeded wizard)
    LoginView.tsx/css          — Google OAuth login screen
    charts.tsx/css             — reusable BarChart (highlightIndex / highlightMax, zero-value
                                  gap bars) and LineChart (hand-rolled CSS/SVG)
```

---

## localStorage keys

| Key | Owner | Purpose |
|---|---|---|
| `liftlog_program` | `programStore.ts` | User's customised workout program |
| `liftlog_exercises` | `programStore.ts` | Exercise library — movement identity only (id + name); **no sets/rep range** |
| `liftlog_exercise_meta` | `exercises.ts` | Per-exercise metadata overrides (muscle, equipment, etc.) |
| `liftlog_settings` | `settings.ts` | Device-local settings (program start date) |
| `liftlog_rest_seconds` | `settings.ts` | Rest-timer default duration (pre-Rev-2 key, kept) |
| `liftlog_deleted_exercises` | `programStore.ts` | Deleted-exercise tombstones (user-scoped, synced; filtered on every library read) |
| `liftlog_global_meta` | `exercises.ts` | Layer-1 admin-curated global exercise metadata (read-only, replaced on every pull) |
| `liftlog_role` | `sync.ts` | Signed-in account's role (`user`/`admin`/`tester`) from the server — UI hint only |
| `liftlog_deleted_sessions` | `sessionTombstones.ts` | Deleted-session tombstones (GUIDs; user-scoped, synced) |
| `liftlog_draft_session` | `draftSession.ts` | In-progress workout draft — written on every set change, cleared at Finish |
| `liftlog_plan` | `planStore.ts` | Training journey document (all plans + blocks + retrospectives + athlete `profile` + `strength` 1RMs/goals; user-scoped, synced LWW) |
| `liftlog_data_owner` | `sync.ts` | Email of the account the local data belongs to — a mismatch at startup wipes user-scoped local data |
| `liftlog_program_updated` | `programStore.ts` | Clock of the program's last local edit (0 = unstamped); compared on both ends of sync |
| `liftlog_restored_exercises` | `programStore.ts` | Tombstones this device knowingly lifted (re-added by hand / merge survivor), pushed as `restoredExerciseIds` until the server stops reporting them deleted |
| `liftlog_exercise_merges` | `merges.ts` | Admin from→to exercise-id map (application-owned, replaced on pull; applied only when it or the pulled data changed) |
| `liftlog_sync_status` | `syncStatus.ts` | Device-local sync visibility (`lastSuccessAt`, `lastError`, `hasUnpushed`, `authExpired`) |
| `liftlog_sync_etag` | `sync.ts` | ETag of the last full pull — sent as `If-None-Match`; a 304 skips the merge |
| `liftlog_weight_unit` | `units.ts` | Display/entry unit (`lb`/`kg`) — device-local; storage stays in lbs |
| `liftlog_library_v2` | `programStore.ts` | Migration flag — deduplication pass 1 |
| `liftlog_library_v3` | `programStore.ts` | Migration flag — deduplication pass 2 (current) |

---

## IndexedDB schema (version 3)

**`sessions`** — index: `weekNumber`
- `id` (autoincrement), `guid?` (immutable sync identity; legacy rows get `legacy-<startedAt>`
  backfilled by `ensureSessionGuids()`), `dayId`, `weekNumber`, `startedAt`, `completedAt?`,
  `updatedAt?` (last meaningful write — per-session conflict resolution for merge sync),
  `note?` (free-text session note; rides the session document — D1 `session_docs.note`,
  migration `0009`; `rewriteSessionSets(…, note)` with `null` clears it)

**`setLogs`** — index: `sessionId`
- `id`, `sessionId`, `exerciseId`, `setNumber`, `weight`, `reps`, `order?`
- `order`: 0-based position of the exercise within the workout (the order it was trained),
  written for every set by WorkoutView. Absent on pre-order rows; the progress engine falls
  back to set-log insertion order. Schemaless field — no version bump (see below). Travels in
  the sync wire (SessionDoc sets, D1 `sets_json`); `undefined` is dropped by JSON so legacy
  docs are byte-identical.

**`exerciseLogs`** — index: `sessionId` (difficulty ratings — feature removed, store kept for compatibility; no longer synced)
- `id`, `sessionId`, `exerciseId`, `difficulty`

v2 added `exerciseMuscles` + `exerciseDetails` stores; v3 deleted them (metadata moved to localStorage).
`guid`/`updatedAt` needed no version bump — IDB records are schemaless; only stores/indexes are versioned.

Key exported functions: `saveWorkout`, `rewriteSessionSets`, `createSession`, `completeSession`, `touchSession`, `ensureSessionGuids`, `addSetLog`, `getSession`, `updateSessionDate`, `getSetLogsForSession`, `deleteSetLogsForSession`, `deleteSetLogsByExerciseId`, `hasSetLogsForExercise`, `migrateExerciseIds`, `purgeEmptySessions`, `dumpIDB`, `mergeServerSessions`, `clearIDB`.

**Session writes are atomic.** A session row must never exist without its sets, because
`purgeEmptySessions()` tombstones empty sessions *app-wide*. So the three write paths each run
as ONE `readwrite` transaction over `sessions` + `setLogs`: `saveWorkout()` (Finish — the row's
`add` success callback queues every set on the same transaction), `rewriteSessionSets()`
(edit-session — old keys deleted, new rows inserted, `updatedAt` bumped, optional re-date, one
commit; aborts if the session is gone) and `applySessionMergePlan` (the whole pull plan in one
transaction). `createSession`/`addSetLog`/`completeSession` survive for tests and tooling but
WorkoutView no longer uses them. Belt and braces: the purge skips any empty session younger
than `PURGE_GRACE_MS` (1 h) — a ghost is old by definition — and `completeSession` tolerates a
missing row.

Anything that *analyzes* history (dashboard, metrics, coaching, recommendations, history list) goes through `loadTrainingSnapshot()` in `data/analytics.ts` — one `dumpIDB()` read per screen, never per-session queries.

---

## Cloud sync

On app mount, `App.tsx` runs this sequence (only when logged in):
1. `ensureLocalDataOwner()` — if a *different* account signed in on this device, wipe
   user-scoped local data (IDB history, program, session tombstones, draft, exercise
   library, metadata overrides, deleted-exercise tombstones) **before** any sync so one
   account's data can never be shown to — or pushed into — another account. Application-owned
   data (global metadata layer) and device settings survive the switch (`liftlog_data_owner`).
2. `migrateExerciseIds()` + `ensureSessionGuids()` — local IDB fixes, must run **before**
   anything reads logs or the first merge runs
3. `pullSync()` — merges server data into IDB + localStorage (see below)
4. `migrateExerciseIds()` again — in case pull merged old IDs from the server
5. `pushSync()` — uploads the merged union

**Merge protocol (sync v2).** The unit of sync is the *session document*: a session row (with
its optional `note`) plus its set logs, identified by an immutable client-generated `guid` (pre-v2 rows derive the
deterministic `legacy-<startedAt>` so every device computes the same identity). On the wire
sessions/setLogs stay flat arrays; the server stores one row per document
(`session_docs`, `sets_json` blob) and **upserts per document — newer `updatedAt` wins** — so
two devices logging different workouts both keep theirs, and an edit propagates as the newer
copy. Pull merges the same way locally (`planSessionMerge` in `data/syncMerge.ts`, pure +
unit-tested; applied by `mergeServerSessions` in `db/database.ts`): tombstoned sessions are
removed, newer server copies replace local ones, **local-only sessions are never dropped**.
Session deletions (ghost purge, exercise-history wipe) record tombstones
(`liftlog_deleted_sessions` locally, `deleted_sessions` in D1, per-user) so they stick.
Anything that rewrites a session's sets must bump its `updatedAt` (`touchSession`) or the
merge will consider the server copy equal and other devices won't converge.
Legacy `workout_sessions`/`set_logs` tables are a read-only pull fallback until a user's
first v2 push; `exerciseLogs` (removed difficulty feature) is no longer synced.

Sync payload also includes: program, exercise library, exercise metadata
(muscle/equipment/weight-type overrides), deleted-exercise tombstones, restored-exercise ids,
and the **training journey document** (`plan` — all plans/blocks/retrospectives as one JSON
doc, per-user D1 `training_plans` table). `pushSync()`/`pullSync()` also run
`purgeEmptySessions()` so ghost/empty workouts can't resurrect through sync (the server
additionally refuses to store empty session docs).

**Everything carries a clock; the newer copy wins on both ends.** Sessions and the journey
always did; the program, library entries and metadata overrides were clock-less, so pull
adopted whatever the server had and a background pull landing after a day edit silently
reverted it (audit H4). Now: `saveStoredProgram(program, now)` stamps
`liftlog_program_updated` (a pull adopting the server copy passes the *server's* clock so
devices agree), `LibraryExercise.updatedAt` and `ExerciseMetaOverride.updatedAt` stamp per
row (`addToExerciseLibrary`/`archiveExercise`/`saveExerciseMeta`), the wire carries
`programUpdatedAt`, `exercises[].updatedAt` and `exerciseDetails[].updatedAt`, and D1 has
`updated_at` on `user_programs`/`user_exercises`/`exercise_metadata` (migration `0008`). The
worker upserts `WHERE excluded.updated_at >= stored`; the client (`mergeExerciseLibrary`,
`mergeExerciseMeta`, the program branch of `pullSyncUnlocked`) keeps a local row that is
strictly newer. **0 means unstamped** (rows from before clocks, default library entries): two
unstamped copies behave exactly as before (incoming wins), so older clients keep working, and
the first stamped edit from any device wins over them. An unstamped local program yields to a
non-empty server copy unless `hasUnpushed` is set (the local copy may be the edit that push
carries); an **unstamped empty** server program is still the wipe guard and is never adopted,
while a **stamped empty** one is the user deleting their last day — so the last day is
deletable now (the worker stores a stamped empty program).

**The journey document merges in two parts** (`worker/planMerge.ts`, shared by the worker's
push and the client's `mergeServerPlanState`): plans/blocks/pending activation LWW by
`updatedAt`, the athlete `profile` LWW by **its own** `profile.updatedAt` — independently.
`saveTrainingProfile` no longer bumps the document clock; before, a "level up" tap on an
offline device outranked a newer block activation made elsewhere while the program store
still adopted that block's program. The worker reads the current row and writes the merged
document (`updated_at = max(both clocks)`).

**Deletions are permanent until explicitly restored.** The server keeps a user's tombstones
forever (so no stale device resurrects a deletion), which also means lifting a tombstone
locally used to be undone by the next pull. A restore is now told to the server:
`liftExerciseTombstones()` (used by `addToExerciseLibrary` and by admin merges whose survivor
the user had deleted — audit H3) records the id in `liftlog_restored_exercises`, push sends
`restoredExerciseIds`, the worker deletes those per-user tombstones, and pull neither
re-applies a tombstone this device knowingly lifted nor keeps the restore once the server
stops reporting the id deleted. Legacy app-wide tombstones (`deleted_exercises`) cannot be
lifted per user.

**Pull is conditional** (audit M2, decision D7). The worker computes a per-user weak ETag from
the clocks and row counts of everything a pull serves (session docs, session tombstones,
program, library, metadata, exercise tombstones, plan, the global audit clock, merges, role),
**before** reading the data (so a concurrent push can only make the tag stale, never the
data), answers a matching `If-None-Match` with 304, and sends `Cache-Control: no-store` so the
browser cache stays out of it. The client stores the tag (`liftlog_sync_etag`) only after a
pull it merged in full and returns `false` on 304 — the 60 s tick costs one small request when
nothing changed. Any successful push changes the server state, so the next pull is a full one.
Delta **push** (only documents newer than the last push) is deliberately not built; see Future
milestones.

**Admin merges** (`merges.ts`) run only when the map changed or the pull brought new data —
not on every tick — and when applied they also carry a merged exercise's metadata override
onto a survivor that has none (audit M12). `normalizeOverride(o, id)` takes the exercise id,
so a stale bare `'Press'` resolves from the catalog entry it sits on (or the name of a custom
exercise) instead of always defaulting to Horizontal.

**Worker hardening** (audit M1): 500 bodies are generic (the stack goes to `console.error`
only); `validatePush` checks `exerciseMuscles`/`exerciseDetails` shapes, `completedAt`,
`programUpdatedAt`, `restoredExerciseIds` and bounds the program document
(`MAX_PROGRAM_BYTES`); the push is applied as one atomic batch (chunked at `BATCH_MAX` only if
it ever outgrows one, with every upsert ordered before anything destructive); tombstone
`DELETE`s are issued once, when a tombstone is first learned, not for every tombstone on every
push. Worker tests cover each on the `node:sqlite` testkit. D1 schema changes are numbered
files in `worker/migrations/` recorded in `schema_migrations` — see
`worker/migrations/README.md` for the apply step and the rule that `schema.sql` must change
with them.

**Sync is serialized and visible.** Every entry point runs through `syncLock` (`syncLock.ts`,
a promise chain) so the 60 s tick, the focus handler, startup and the post-workout push never
interleave. `syncStatus.ts` (device-local, `liftlog_sync_status`) records `lastSuccessAt`,
`lastError`, `hasUnpushed` (set when a push starts, cleared only when one succeeds — so a push
that failed after Finish is retried by the next background tick, not the next cold start) and
`authExpired` (a 401 from either direction). Surfaced as a Settings line + "Sync now", a quiet
Dashboard badge when failing, and an app-wide "sign in again" banner when the session expired.
`App` is wrapped in an `ErrorBoundary` whose recovery screen notes that the draft survived.

**A new build announces itself.** The service worker is `registerType: 'autoUpdate'`, which
used to swap the SW silently and leave a resident iOS PWA running stale JS against a newer
worker for days (audit M15). `data/appUpdate.ts` listens for `controllerchange` (only a
*change* of controller — the first install isn't an update) and `App` shows an "Update ready —
Reload" toast, never while a workout is open (it appears once the workout closes).

**Ownership on the server (D1)** — full design in `docs/ownership-architecture.md`.
Exercises live in three owned layers. **Layer 1 (application-owned):** the compiled-in
catalog (`exercises.ts`) plus admin-curated `global_exercises`/`global_exercise_metadata`,
served to every user on pull and written only through the audited `/api/admin` API
(`worker/admin.ts`; every change requires a reason and lands in `global_exercise_audit`).
**Layer 2 (user-owned):** `user_exercises` (the user's library), per-user `exercise_metadata`
rows (metadata overrides) and `user_deleted_exercises` (per-user tombstones) — all
`user_id`-keyed like session docs and the program, so nothing a user creates, edits or
deletes can affect another account. **Layer 3:** workout instances (program slots + session
docs, unchanged). Client metadata precedence: catalog < global (`liftlog_global_meta`,
replaced wholesale on every pull) < user override (`liftlog_exercise_meta`).
The pre-ownership app-wide tables (`app_exercises`/`app_exercise_metadata`/
`deleted_exercises`) are read-only legacy fallbacks: a user with no per-user rows adopts them
on pull, the startup push then snapshots their copy per-user, and legacy global tombstones
stay honored for everyone. **Library and metadata sync remain merge-based, never replace**:
the worker upserts per exercise per user on push and the client merges on pull
(`mergeExerciseLibrary` — the newer copy wins per id, local-only entries survive); only
tombstones delete, and only an explicit restore un-deletes (see above). `ensureProgramExercisesInLibrary` (end of every pull) rebuilds any library entry the
program references but the library lost, and `getExerciseName` humanizes orphaned timestamped
ids as a last-resort display fallback. **Lifecycle:** custom exercises (timestamped ids) are
queued into `pending_exercises` on push; admins review via `/api/admin/pending`, and approval
promotes into the global layer. **Roles:** `user_roles` table (`user`/`admin`/`tester`,
absent = user), resolved server-side (`worker/roles.ts`), enforced on `/api/admin`, reported
on pull and cached in `liftlog_role` as a UI hint only.

---

## Progress & stall engine (`src/data/progress.ts`)

The single definition of "is this exercise making progress?" — used by insights, retrospectives,
the planner and substitution, and (through the shared thresholds in `progression.ts`) by the
prescription engine's own stall verdict, so the whole app agrees. e1RM alone is a raw-strength proxy (blind to volume gains, rep PRs, and workout
context), so `assessExercise` / `assessSnapshot(snapshot, goal)` blend four signals:

- **e1RM trend** — best Epley estimate, first vs last session in the trailing window.
- **volume-load trend** — tonnage (Σ weight × reps); total reps for bodyweight-at-0 work.
- **PR events** — weight PRs (beat all-time heaviest) and rep PRs (more reps than ever at a
  weight lifted before), detected against running all-time bests.
- **exercise order (freshness)** — each set carries the `order` it was trained in. If the
  latest session ran ≥2 slots later than the exercise's usual position (median), it's excluded
  as a trend endpoint: "benched 4th because the racks were taken" is fatigue, not weakness.

Three validity rules keep the signals honest, all shared with the prescription engine:
**planned easy weeks are never endpoints** — each point carries `easy` (from a `PhaseResolver`,
`planStore.getPhaseResolver()` app-wide or `blockPhaseResolver(block)` inside a retrospective)
and deload/recovery/intro sessions are excluded from the trend and can never be PRs, so a block
that ends on its deload is judged to its last hard week; **volume is load-normalized**
(`normalizedReps`: reps at the first session's working weight, ~1 rep per 3% of load) so a
successful load increase can't read as lost volume, and both signals pass through `deadband()`;
**e1RM is only read from sets of ≤12 reps** (`validE1rm`). A verdict needs three *hard*
sessions; rep PRs compare a session's bests against sessions before it (set 2 beating set 1 is
not a PR).

The signals combine into a −1…+1 composite with **goal-dependent weights**
(`GOAL_SIGNAL_WEIGHTS` in `progression.ts`, shared with the prescription engine):
strength leans on e1RM, hypertrophy/fat-loss on volume, and where adding strength isn't the
point — dieting, or supporting a sport whose own volume is climbing — merely *holding* it
scores positive (otherwise a race build reads as a block of stalled lifts and fires deloads
nobody needs). Composite → `status`: `progressing` / `steady` / `stalled` /
`declining` (with `evidence[]` strings and `recentPRs[]` for the UI). Bodyweight work drops
the e1RM signal and its weight is redistributed. `progressDirections()` reduces the map to
up/down/stalled id sets for engines that only need direction. Fully covered by
`progress.test.ts`; **`getTrainingGoal()` (planStore) supplies the active goal** to every
caller.

## Progressive overload algorithm (`src/data/recommendations.ts`)

Runs when opening a new (non-edit) workout. WorkoutView loads one training snapshot and, for
each exercise, builds its recent history **across every day it appears in** (the last
`historyDepthFor(experience)` sessions containing that exercise, newest first), then calls
`calculateRecommendation(history, exercise, ctx)`. `ctx` is a `PrescriptionContext`
(options bag, not positional args): `weightType`, `phase`, **`goal`** and **`experience`** —
the engine reads the athlete and the plan, not just the lift. WorkoutView supplies
`getTrainingGoal()` and `effectiveExperience(getProfileOrDefault(), snapshot)`.

`ctx.phase` and `ctx.goal` come from the plan; the history depth WorkoutView passes is
`historyDepthFor(experience)` (the stall window + 2), not a flat four. Every set log records the
rep range in force (`repLow`/`repHigh`, Stage 0 of the adaptive-engine roadmap), so the engine
can tell a range that changed between blocks from a missed session: under the new range it
**holds** with "your rep range moved" instead of easing back, and the weekly cap anchors only to
same-era sessions so a re-anchor never reads as "already went up this week".

Branches, evaluated in order:

0a. **Anchor to a known 1RM** (`ctx.oneRepMax`, from `strength.ts` via planStore) — with
   **no history**, `firstSessionFromMax` prescribes `loadFromMax(1RM, repHigh)` (Epley
   solved for load × `REANCHOR_SAFETY`, snapped down to the equipment increment) as a
   neutral `reanchor` rec instead of returning null; with history, a max entered **after**
   the last session (`maxReanchor`) re-anchors when the derived load differs ≥5%, capped at
   20% per step. Asymmetric like the rest of the engine: a higher max is acted on, a lower
   one only when the last session also fell under the range (completed sets beat an entered
   number). A max older than the latest session is ignored — the log has moved on.
0. **Re-anchor (rep range changed)** — the reps logged sit ≥2 outside the prescribed range →
   recompute the load from the **estimated 1RM** instead of nudging it (see below).
1. **Increase (volume at a fixed load)** — a full set count, **one set at `repHigh`**, and a
   session matching the **most work ever done at this load** → add load. See the volume note
   below; this replaced a rep total of `sets × repHigh` that the per-set plan never prescribed.
2. **Increase (e1RM breakout)** — 2+ recent sessions at the same load, reps already at
   `repHigh − 1`+, and best e1RM up ≥3% across them → move up now rather than waiting for a
   perfect rep total. Skipped on high-rep work (see the e1RM validity note below).
3. **Deload** — a window of sessions at the same weight whose **goal-weighted composite**
   (`progression.ts`) scores under `STALL_SCORE` → drop ~10% and build back up. The score
   *decides* (it is no longer gated on "no PR events", which made it irrelevant); window
   length (3, or 6 for advanced) and who gets a cut at all depend on training age and goal.
4. **Decrease** — reps under `repLow`, **confirmed** (see below) → ease back ~5%.
5. **Hold** (double progression) — reps in range → keep the weight, chase reps. The reason
   names the exact gap ("2 more reps than last time (36 total) earns the next increase").

Seven things make this a coach's answer rather than a rule-of-thumb, each fixing a way the
earlier version was wrong:

**Progress is measured as volume at a fixed load, and judged by one shared composite**
(`progression.ts`). Two changes, one idea. The **increase** trigger is `credit()` volume
compared against `bestWorkAt()` — the most work ever done *at this weight* — gated on reaching
`repHigh` on a set. The old absolute target (`sets × repHigh`, i.e. every set at the ceiling)
demanded something fatigue makes impossible and `buildSetPlan` never prescribed: on a 4×4–6
slot the plan asked for 6/6/5/5 = 22 while the trigger required 24, so a lifter who did exactly
what they were told never earned an increase and was **deloaded every third session for
complying**. Fixing the load is what makes volume usable at all — raw tonnage falls ~17% every
time a lifter successfully adds weight (3×12 @ 100 → 3×9 @ 110), under-credits heavy work
(100×12 = 1200 "beats" 110×10 = 1100) and is inflated by junk volume, so it is never compared
across loads. Sessions from a different **rep era** (credited average ≥ `repHigh + 2`, the
re-anchor threshold) are excluded from the high-water mark, or a 3×8 log at a weight would set
a bar a 4×4–6 prescription cannot clear by design. The **stall** verdict is
`compositeScore()` — the same goal-weighted blend of e1RM trend, volume trend and PR events
the Metrics screen reports, so the app can no longer call a lift steady and deload it in the
next workout. `deadband()` (3%) keeps ordinary session-to-session noise out of the decision,
`stallWindowFor()` gives advanced lifters 6 sessions instead of 3 (they progress across a
block, not session to session, and their honest rate sits inside the noise floor), and `holdsInsteadOfDeload()` decides who repeats the weight
rather than cutting it: `fat-loss`, `sport-support`, and **beginners** (whose path is linear
progression — a novice who stopped adding reps needs another rep, not a lighter bar).
Full marks scale with training age (`fullMarksFor`, same 2×/1×/0.5× ratios as the weekly load
cap), so a 5% gain reads as a plateau for a novice and a good block for an advanced lifter.

**A load that belongs to a different rep range is re-anchored, not nudged** (`rangeReanchor`).
Double progression only knows how to move a lifter *within* a range. When the range itself
changes underneath them — a hypertrophy block's 3×10–12 becoming a sport-support block's
4×4–6 — every increment rule starts from the wrong number, and the weekly rate cap turns the
walk to the right load into a month of sessions too easy to be worth doing (185 lbs for a
lifter who just did 185×9, 185×9, 185×8, 205×7). Set logs don't record the prescription that
was in force, so the mismatch is inferred from the reps, and the new load comes from the
**estimated 1RM** — the only thing that carries strength *between* rep ranges: best valid
e1RM → `loadForReps(e1rm, repHigh)` → shaded `REANCHOR_SAFETY` (5%, because several sets at
a rep count is not a rep max) → snapped down to the equipment's increment. Guard rails: the
mismatch must be ≥`RANGE_MISMATCH_REPS` (2) outside the range so ordinary double progression
is untouched; one step may move the load at most `REANCHOR_MAX_STEP` (20%), with the next
session re-anchoring again from fresh evidence; past `E1RM_VALID_REPS` the load–rep model is
used instead of a fictional 1RM; and the **weekly rate cap does not apply** — this is not
progress being paced, it is the same strength re-expressed in new units. The two directions
carry different burdens of proof, mirroring the rest of the engine: **too light** re-anchors
on the latest session (vetoed by a previous one that contradicts it) because reps *above* a
range can't be explained by a bad night's sleep; **too heavy** needs a previous session that
missed the same way, because falling short is exactly what an off day looks like. An easy
week (deload/intro/race) backs off *from the re-anchored load* — a new block often opens with
an intro week, and 20% off a load that was already wrong is two mistakes compounding.

**Extra and heavier sets can only help** (`credit()` vs `countedSets()`). Every session is read
two ways. The **credited** view — the best `sets` of everything at or above the working weight,
each valued at what it would have been worth *at* that weight (`equivalentReps`, the same
~3%-per-rep relationship) — is what can EARN something: increases, and the rep improvement that
calls off a deload. The **strict** view — programmed sets at the working weight, in order — is
the only thing that can COST load. So a lifter who works up to a top set gets credit for it
(185×9, 185×9, 185×8, 205×7 is four sets of work against a programmed four, not three, and
205×7 outscores 185×7), a fifth set taken to failure is ignored rather than averaged in, and
the under-range branch reads whichever view looks better. The cap at the programmed set count
is what keeps it honest in the other direction — five sets of eight still isn't a 3×12.

**Jump size comes from the load–rep relationship, not a flat 5 lbs.** Standard %1RM tables
(1RM 100%, 5RM ~87%, 10RM ~75%) put one rep at roughly 2.5–3% of load; `PCT_LOAD_PER_REP = 3`
is the conservative end. `sizedIncrement()` takes the largest whole increment that still lands
the lifter inside their range: 3×12 in an 8–12 range has 4 reps of room ≈ 12% of load, while
scraping the target in a 10–12 range has 2 ≈ 6%. Creeping 5 lbs after a maxed-out range just
spends the next session repeating it. The same relationship sets rep targets after any load
change (`predictReps`) — a rate-capped 2.5% jump barely costs a rep, and a 10% deload *buys
back* about three, so prescribing `repLow` after every change was wrong in both directions.

**Load climbs are rate-limited per week by training age** (`WEEKLY_LOAD_CAP`: 10% beginner,
5% intermediate, 2.5% advanced — novices progress session to session, intermediates weekly,
advanced across a block). `weeklyCeiling()` anchors to where the lift was 7 days ago (the
oldest fresh session in the window), so it limits the climb across the week rather than per
session: a lift trained twice a week takes one increase, not two. Without it, high-frequency
training manufactures the very plateau the deload branch then has to clean up. The cap never
blocks the *minimum* increment — you cannot microload finer than the gym stocks, so a 25 lb
belt load (5% = 1.25 lbs) still gets its one jump. Emergent and worth knowing: over a long run
the caps barely separate the levels, because what actually paces load is how fast reps climb —
a bigger jump costs more reps to rebuild. The cap is a guard rail, not a brake.

**A stall has to show on both levers, and survive a bad day.** Reading e1RM alone flags a
lifter going 10/9/8 → 10/10/9 → 10/10/10 at a fixed load as stalled — their top set never
moved — yet that is textbook double progression working; deloading them is backwards. And
comparing only the *latest* session to the oldest turns one bad night's sleep into a deload
(24 → 27 → 30 → 24 reads as "no progress" despite a high-water mark two sessions back). So the
test is: **no session in the window beat the window's anchor, on reps or on e1RM.**
Symmetrically, a single under-range session never cuts load — day-to-day strength varies too
much to program off one data point. It takes a clear miss (`repLow − 2`) or a second
under-range session **at the same weight** (a first session after a back-off must not confirm
the miss that caused it, or the weight walks down a step at a time forever).

**e1RM is only consulted where it's valid.** 1RM prediction equations are fitted on sets of
~1–10 reps and drift badly past ~12 (`E1RM_VALID_REPS`). On 3×16–20 cable laterals the estimate
is noise — enough that a one-rep shuffle between sets reads as a strength gain and vetoes a
real plateau. Past the threshold, progress is read from reps alone.

**The goal changes the answer** (`GOAL` from `getTrainingGoal()`). Most consequentially in a
deficit: a plateau there reflects energy availability, not accumulated fatigue, and the
objective is *retaining* muscle — so on `fat-loss` a stall **holds** the load instead of
deloading it (loaded and bodyweight engines alike), a miss must be confirmed across two
sessions before load is cut, and increases take the minimum step rather than a room-sized
jump. Defending the load through a cut is the win; PRs come back when you eat.

**Increments are equipment-aware** (`incrementFor(weight, weightType)`): a dumbbell rack only
goes up in 5s, but a barbell, a dip belt or a machine takes 2.5 lb microloading — so light
non-rack work moves in 2.5s instead of taking a 30% jump, and heavy lifts scale to ~2.5%
(a 400 lb leg press moves 10 lbs). Back-offs (`easeBack`) snap to the same increment and never
go below 5 lbs.

The **working weight** of a session is the most-used weight (tie → heaviest), so logged
warm-up/ramp-up sets don't skew the recommendation.

**Order-aware baseline.** Sessions where the exercise sat much later in the workout than usual
(≥2 slots past its median `order`) are dropped from the baseline — the prescription builds off
fresh-slot sessions, so a lift that dipped because it ran last doesn't get ratcheted down or
falsely flagged as stalled. The reason string says so. Falls back to all sessions when none
are fresh-slot.

**Unloaded work progresses by count, not load.** Any session whose working weight is 0 lbs —
bodyweight, timed holds, or a loaded exercise logged unloaded — switches to count progression
(`repProgression()` in the same file), with the SAME rules as the loaded engine read through
`credit()`/`countedSets()`: increase when the best set reaches `repHigh` **and** the credited
total matches the best ever here (`bestCountAt`; the set-1 target then goes *past* the ceiling,
since there is no heavier bar), stall is best-of-window vs the anchor (one bad day never
deloads; a failed bonus set is ignored), beginners/fat-loss/sport-support hold the standard
instead of resetting, under-range needs a confirming session or a clear miss, and the in-range
target is set 1 + 1. The old rule (every set at `repHigh`) was unreachable against the plan's
descending targets and deloaded a compliant lifter forever (audit C1). ExerciseCard shows
"↑ N reps" (or "N sec") instead of a weight when `targetReps` is set.

Returns `{ weight, targetReps?, direction, kind, reason }`
(`kind`: `increase`/`hold`/`decrease`/`deload`/`reanchor`). ExerciseCard colours the chip by
`direction`, except `reanchor` which is neutral (purple) — re-matching a load to a new rep
range is a correction, not a verdict on the last session.

### Per-set prescription (`buildSetPlan`)

One weight is a recommendation; a plan is what a coach writes down. `buildSetPlan(history,
exercise, ctx?)` wraps `calculateRecommendation` (same `PrescriptionContext`) and returns a
**`SetPlan`**:
one `PrescribedSet { setNumber, weight, targetReps }` per programmed working set, plus a
plain-language `goal` line stating what this session must do to earn the next increase.

- **Rep targets descend across sets**, because reps do. The drop-off is fitted from the
  lifter's *own* recent sessions (reps of set N minus set 1 at the working weight, averaged
  over the last 3 sessions); set indices they've never reached fall back to a ~7%-per-set
  decay. Targets are clamped inside `repLow…repHigh`. Prescribing a flat `3 × repHigh` to
  someone who has never beaten 12/11/10 is prescribing a failure — and beating the fitted
  targets is exactly the rep total that triggers rule 1.
- **Set 1's target** is `lastSet1Reps + 1` on a hold; after any load change it's what
  `predictReps()` says the new load costs (or buys back), clamped to the range — not a blanket
  `repLow`.
- **A planned deload/recovery week** flattens every target to `repLow` at the backed-off load;
  no fatigue-chasing in a scheduled easy week.
- **Never-trained exercises still get a plan** — `rec` is null, weights are `null` (the card
  shows an empty input), targets are `repLow`, and the goal says to find a working weight.
  The card offers "Know your 1RM?" there (→ Strength screen); with a stored max the plan is
  instead anchored at the 1RM-derived load with set 1 aimed at `repHigh − 1`.
- The plan is built from the **coach-adjusted** set count (`effectiveDay`), so a planner set
  addition shows up as a real prescribed row.
- Targets and the fatigue fit both read the **fresh-slot baseline**, so a late-slot session
  can't skew the plan any more than it can skew the recommendation.

**A strength block's main lifts are one top set plus back-offs** (decision D4, audit F9).
`dosage.topSetScheme(slot, goal, experience, weightType)` gates it — a `strength` plan, a
`main` slot dosed by the plan in the strength tier (ceiling ≤ 6), not a beginner, a loadable
implement — and WorkoutView passes `scheme: 'top-set'` on the `PrescriptionContext`.
`topSetPlan()` then computes the recommendation on the **top set alone** (`topSetView`: each
past session reduced to its heaviest sets, judged as a one-set prescription), so "a top set at
the ceiling earns the next jump" is literally what the engine checks — the weekly cap, the
stall window and the re-anchor all read that set. Set 1 is the top set at the recommended
load; sets 2…n sit at `backoffFactor(phase)` of it (90%, 85% in a peak week), snapped to the
increment, with the rep target the load–rep relationship predicts at the lighter weight. A
planned easy week flattens everything to `repLow` at the backed-off load. With no loaded
history it falls through to the straight layout.

**The main lifts' rep range tightens by phase** in a strength block (`dosage.phaseRange` /
`applyPhaseRanges`, the same gate minus experience): build weeks keep the dosed range (4–6,
3–5 for heavy axial), push weeks sit one rep lower, peak weeks two (floor 1). WorkoutView
applies it to `effectiveDay` after the coach overlay, so the card, the recorded `repLow`/
`repHigh` on the set logs and the engine all see this week's range — and because the logs
carry the range, the move into a tighter range reads as a **range change** (hold with "your
rep range moved"), never as a miss. Typed (`rangeSource: 'user'`) and history-derived ranges
never shift; easy weeks keep the base range at a backed-off load.

**Unloaded work can be told to build UP to its range** (audit F11). The under-range branch of
`repProgression` sets `targetReps` to one more than what was managed, capped at `repLow`
("build to it: 6 clean reps per set this time") instead of demanding the floor forever, and
`buildSetPlan` lets the row targets sit below `repLow` on the way back. After
`REGRESSION_MISSES` (3) consecutive unloaded sessions under the range (`needsRegression`),
WorkoutView asks the substitution engine for a **regression** (`{ regression: true }`: no
harder than the target, strong preference for a loadable implement) and the card offers "Add
X today" — a lat pull-down for a chin-up — through the ordinary mid-workout add path; making
it permanent is a day-editor decision.

`recommendations.test.ts` covers each branch plus a **loop-level simulation**: 12 weeks of a
lifter who hits their targets must climb monotonically, never trip a deload, and never exceed
the weekly rate for any training age.

ExerciseCard renders the plan directly: the next unlogged set is an editable row **pre-filled
with its prescribed weight and reps** (one tap to log), the remaining sets are previewed
dimmed below it, and logging a set at a weight of your own carries that weight forward to the
rest of the session instead of snapping back to the recommendation. Above them sit the
colour-coded reason chip, the "Last time" line and the goal line. Both engines are covered by
`recommendations.test.ts`.

**Warm-ups are an explicit addition, not a mode.** With working sets pre-filled, a "tag the
next set as a warm-up" toggle would fight the prescription, so warm-ups are added with a
**＋ Warm-up set** button that opens an empty amber row above the working sets (`＋ Extra set`
appears once the prescription is complete). Warm-up sets still never count toward analytics
(`setsBySession` excludes them), don't start the rest timer, and can still be re-tagged from
the inline set editor's `W` chip.

---

## Prescription: who decides sets × reps (`dosage.ts` + `prescribe.ts`)

**A rep range is a property of a prescription, not of a movement.** The same deadlift is
3 × 5–8 in a hypertrophy block and 4 × 3–5 in a strength block. Before this, the library
`Exercise` carried `sets/repLow/repHigh`, `buildDefaultLibrary()` seeded them from the
hardcoded `PROGRAM` and fell back to `{3, 8, 12}` for anything it didn't list, and the day
editor / add panel / quick-workout picker each hardcoded the same constant — so an exercise
entering the program by any route other than the plan wizard carried a range nobody chose.
A barbell deadlift got a cable row's dose.

Now:

- **`LibraryExercise`** (`program.ts`) is identity only — `{ id, name, archived? }`. The
  sets/rep fields survive on the type as `@deprecated` **wire-compatibility only**: the server's
  `user_exercises`/`global_exercises` tables and older clients still send them, and they are
  never read. (Stage 2 drops the columns once no client reads them; doing both at once would
  break sync for anyone on an older build.)
- **`Exercise`** (a program slot) keeps the prescription — but `repLow`/`repHigh` are now
  **optional**, and genuinely absent when there is nothing to prescribe from.
- **`dosage.ts`** is pure: `dosage(goal, slot, profile, experience)`, plus `isHeavyAxial()`,
  `rangeFromHistory()` and the `resolvePrescription()` cascade. No store reads, so it stays
  testable and free of import cycles with planStore.
- **`prescribe.ts`** reads the stores and calls it: `prescribeFor(id, opts)` →
  `RepPrescription | null`, and `slotFor(id, name, opts)` → a dosed `Exercise`.

**The cascade** (`resolvePrescription`), most informed first:

| Situation | Prescription |
|---|---|
| In a program slot | the slot's own (unchanged) |
| Ad-hoc, active plan | `dosage(goal, non-main, profile, experience)` |
| Ad-hoc, no plan, has history | `rangeFromHistory()` — median reps ± 2, median set count |
| Ad-hoc, no plan, never trained | **null** — no targets, weight still prefilled from last time |

`getPlannedGoal()` (planStore) returns `null` when there's no plan **or when the active plan's
goal was never chosen** (`planHasChosenGoal`: `origin === 'planned'`, or any non-open-ended block
— i.e. a wizard block — in it), which is what makes step 3 reachable; `getTrainingGoal()` keeps
its `'general'` fallback for analytics that just need *a* goal to weight signals.
`ensureJourneyMigrated()` wraps pre-journey or quick-workout-only history in a Foundation plan
with a **placeholder `general` goal that is not a prescription source**; the rule applies at
read time, so existing accounts' migrated plans (goal hypertrophy, origin migrated) are covered
without a data migration, and a migrated plan that later received a wizard block keeps its goal
because that activation was the choice. Every prescription records its provenance on the slot:
`Exercise.rangeSource` is `'plan'` (dosed from a goal), `'user'` (typed) or `'history'` (read off
the log). **The engine only re-anchors a load to a chosen range** — re-anchoring to a
history-derived one is circular, and it is how a 5×5 lifter was told to drop 20% every session.
`Exercise.progression: 'manual'` switches the coach off for a slot (no chip, no targets, last
weights pre-filled). `parseDose()` (dosage.ts) is the one validator for typed sets × reps.

**Heavy axial work has its own tier.** `isHeavyAxial()` = barbell **and** Hip Hinge or Squat
pattern — so conventional/Romanian deadlifts and back squats qualify, while cable pull-throughs,
leg press and hip thrusts (same muscles, no spinal load) do not. Those lifts get 3 × 5–8
(4 × 3–5 on strength, 4 × 4–6 on athletic) instead of being dosed like any other compound.
Chasing a 3 × 12 rep total on a deadlift buys a lot of spinal fatigue and a degraded bar path
for stimulus available more cheaply elsewhere.

**The beginner floor outranks everything**, axial tier included: a novice never gets sub-8 reps
whatever the goal, because technique is the constraint. Worth knowing that an account which
never completed onboarding has no stored profile, so `getProfileOrDefault()` returns beginner
and the goal-specific tiers don't apply until they onboard or the data infers a higher level.

**With no prescription**, `calculateRecommendation` returns a plain hold at the last working
weight ("No rep target set — log a few sessions and the coach will learn your working range"),
`buildSetPlan` emits rows with `targetReps: null`, and `prescriptionLabel()`/
`prescriptionDetail()` (program.ts) render "3 sets" rather than "3 × undefined–undefined".
Every progression branch needs a range — you cannot judge "beat the range" without one — so the
engine narrows to `PrescribedSlot` before doing any work.

---

## Coaching engine (`src/data/insights.ts` + `src/data/coach.ts`)

### Adaptive planner (`coach.ts`)

`computeProgramPlan(program, snapshot, now?)` is a **pure function of history** that produces a
`ProgramPlan` — small set additions/trims applied to future workouts as an overlay
(`applyPlanToDay`). The stored program is **never mutated**: the plan re-derives on every load,
stays consistent across devices (history syncs, the plan follows), and every change carries a
plain-language `reason` shown to the user. Under-trained muscles are *fixed* by the planner, not
notified about.

How it decides:
- **Volume measurement** — fractional hard sets per muscle over a trailing 28-day window,
  normalized to a weekly rate (primary = 1, secondary = 0.5).
- **Under target (<10/week)** — +1 set to the best-scoring slot across *all* program days:
  direct stimulus beats secondary spillover, fewer extra muscles = less fatigue, never pushes a
  muscle already ≥20/week, spreads across movements instead of stacking the workhorse, avoids
  lifts with a declining e1RM, mild bonus for the muscle's lightest day (frequency).
- **Over target (>22/week)** — −1 set from the exercise doing the most direct sets.
- **Guardrails** — no adaptation until 6 completed sessions; ≤2 sets added and ≤2 trimmed per
  plan; ±1 set per exercise; exercises stay within 2–5 sets; a day is only touched once it has
  2+ recent sessions; added sets must keep the day within **+15% of its average duration**
  (`avgDurationByDay` — 3 min/set estimate).
- **Structural gaps** — if a muscle is ≥3 sets under target with no eligible slot, the plan emits
  a suggestion (add exercise X to day Y) surfaced as a `program-gap` opportunity.

Surfaced in WorkoutView (banner: "Coach adjusted today's workout" + reasons; recommendations
target the adjusted set counts) and MetricsView (Program adjustments list). Fully covered by
`coach.test.ts`.

### Insights (`insights.ts`)

`computeCoaching(program, snapshot, week?, now?, phase?, goal?)` embeds the plan and produces:
- **Highlights (≤3)** — fresh PRs (weight or rep PRs within 10 days), progressing lifts,
  week-over-week volume gains, consistency streaks.
- **Opportunities (≤3)** — declining lifts (recovery-oriented advice), stalled lifts
  (pre-frames the engine's deload), muscles past the volume ceiling, planner `program-gap`
  suggestions.
- **Progress** (`progress: ExerciseProgress[]`) — the multi-signal per-exercise assessment
  from `progress.ts`, weighted for the `goal` argument (`getTrainingGoal()`). Highlights and
  opportunities derive from each exercise's `status`, not a raw e1RM %.
- **Per-muscle weekly set volume** (`muscleVolume`) and **next workout** (day longest untrained).

Surfaced on the Dashboard (Coach card) and Metrics. On Metrics the Coach narrative, the
**Progress Report** (per-exercise status + signal breakdown + evidence, attention items first)
and the **Recent PRs** timeline share **one tabbed panel** (Coach / Progress / PRs — tabs
appear only when they have content); below it sit **Exercise Trends** (paired est-1RM and
volume-load charts), the heatmap, and volume charts.
`SETS_TARGET_LOW`/`SETS_TARGET_HIGH` live in `analytics.ts` (re-exported from insights.ts).

### Muscle heatmap (`heatmap.ts` + `MuscleHeatmap.tsx`)

Front/back SVG silhouettes with one region per `MuscleGroup`, colored by weekly-rate volume:
blue (untrained) → green (10–20 target) → yellow (elevated) → red (very high). Muscle mapping
reuses `musclesForExercise()` — no duplicate mapping. Presets: 7 days / 30 days / current
mesocycle (4-week blocks anchored to the program start date) / custom range. Tap a region for
sets + weekly rate + status.

---

## Substitution engine (`src/data/substitution.ts`)

The Exercise Intelligence layer behind "Find replacement" (⇄) in DayEditView. Same
architecture as the coach: **pure functions of (exercise, day, TrainingSnapshot)** — no
storage writes, fully unit-tested (`substitution.test.ts`).

- **`ExerciseProfile`** — the normalized view every candidate is ranked as: muscles
  (through `resolveExerciseIdentity` in analytics.ts — THE override → catalog → name-match
  resolver, shared with `musclesForExercise`/`movementPatternFor`), movement
  pattern (`WorkoutType`), equipment, weight type, and derived compound/isolation
  mechanics. Any future candidate source (external APIs, AI generation, coach-curated
  collections) plugs in by producing profiles; the ranker never changes.
- **Candidate pool** (`candidateProfiles()`) — the user's exercise library first (a custom
  entry that duplicates a catalog exercise *by name* shadows it, so the ID their history
  is logged under wins), then the built-in catalog. Tombstoned/archived exercises and
  exercises with no resolvable primary muscle are excluded.
- **Ranking** (`suggestReplacements`) — hard filters (not the target, not already in the
  day, must train the target's primary muscle, not the same lift under another name —
  token-subset check catches "Cable Pushdown" vs "Tricep Cable Pushdown"), then additive
  scored factors, each carrying a plain-language reason or caution: direct-vs-secondary
  stimulus, muscle-overlap similarity, movement pattern (same-pattern bonus **or** a
  redundancy penalty when the rest of the day already covers that pattern — never both),
  compound/isolation match, equipment the user has actually trained with, familiarity +
  e1RM trend from history, weekly volume balance (extra muscles should fill under-target
  gaps, not pile onto muscles at the ceiling), and a fatigue penalty for dragging in more
  muscles. Top 3 with score > 0 are shown.
- **Accepting a swap** replaces the exercise in place, preserving the slot's sets/rep
  range/order, and `addToExerciseLibrary` makes the newcomer first-class (also lifting any
  deletion tombstone). Nothing "notifies" the coach: the planner, insights and
  recommendations are pure functions of (program, history), so they re-derive from the
  updated program automatically — on every device, once it syncs.
- Without history (`snapshot: null`) the engine still works on structural factors; the
  history-driven factors simply contribute nothing.
- **Regression mode** (`suggestReplacements(…, { regression: true })`) is the "easier way
  to train this" variant WorkoutView asks for after three unloaded misses: candidates no
  harder than the target (`DIFFICULTY_RANK`), +16 for a loadable implement ("start below
  bodyweight"), −10 for another bodyweight lift.

---

## Training journey (`plan.ts` + `planner.ts` + `retrospective.ts` + `planStore.ts`)

The planning layer above individual workouts. Two domain levels, deliberately not more:

- **`TrainingPlan`** — a "goal era" (Muscle Growth, Strength, Fat Loss, Athletic, General).
  Owns a sequence of blocks; at most one plan is active; history is unlimited. Activating a
  proposal with the *same* goal appends a block to the active plan; a *different* goal
  completes the plan and starts a new one (goal transition).
- **`TrainingBlock`** — a mesocycle: `startDate`, `phases: PhaseKind[]` (**one tag per
  week** — recovery/accumulation/intensification/peak/deload), the program designed for it,
  plain-language `intent` + `progression`, and (once completed) its `retrospective`.
  Phases-as-week-tags is the bridge between the coach thinking in phases and the user
  thinking in weeks. Open-ended blocks (`openEnded`, migrated legacy training) are
  perpetual accumulation with no scheduled end.

**Key invariants:**
- All intelligence is pure functions, same as coach/substitution: `buildPlanProposal()`
  and `computeBlockRetrospective()` take a `TrainingSnapshot` and return documents.
- **The active block's program IS `liftlog_program`.** Activation copies the block's
  program into the program store and re-anchors the week-numbering start date
  (`saveProgramStart`). Nothing else in the app needs to know blocks exist — coach,
  recommendations, metrics keep reading (program, history).
- **Scheduled activation (deferred install).** `activateProposal()` returns
  `{ started, plan }`. If a block is approved for a *future* start Monday while a block is
  still running, it's stored as a `pendingActivation` (block `status: 'pending'`) instead of
  installing immediately — the current week's workouts stay put. `startPendingActivation()`
  (App startup + the 60 s background tick, which doubles as its scheduler) commits it once the
  start date arrives: it computes the outgoing block's retrospective *then* (so the final
  training week counts), swaps in the new program, and re-anchors weeks. Re-planning before a
  pending block starts replaces it; JourneyView offers "Start it today instead"
  (`force: true`). If nothing is running (or the start is today/past), activation commits
  immediately as before. Dashboard/JourneyView surface the pending block.
- **Undoing a premature activation.** `deferActiveBlockToNextWeek()` is the inverse of
  `commitActivation`: it reactivates the block the active one replaced (restoring its program
  as the live program and clearing the auto-generated retrospective) and reschedules the
  just-started block as a `pendingActivation` for next Monday — so the user can finish the
  current week on their previous workouts. `canDeferActiveBlock()` gates the JourneyView
  action (only when a started, non-open-ended block has a completed predecessor).
- **Phase-aware engines:** `getActivePhase()` (planStore) resolves this week's phase;
  during `deload`/`recovery` weeks `calculateRecommendation(…, phase)` prescribes ~10%
  off (rep-goal floor for bodyweight) and `computeProgramPlan(…, phase)` returns the
  empty plan (no set fiddling in a planned easy week). WorkoutView shows a phase banner
  for every easy phase, intro included. Intro and recovery weeks back off from the
  heaviest *recent* working weight (a recovery week after a deload must not compound);
  a deload backs off from the last session. A lift whose only session was logged in the
  current intro week is **repeated**, not backed off (`ctx.phaseOf`) — the first session
  was the easy exposure. The wizard never opens with a recovery week after a block that
  ended on its deload, nor on a mid-block replan.
- **Activation is one-directional.** A block whose start Monday is ahead is *always*
  queued as a `pendingActivation`, whether or not something is running. Blocks record how
  they closed (`completedBy: 'activation' | 'user'`), what they replaced
  (`replacedBlockId`) and the *live* program at that moment (`replacedProgram`);
  `deferActiveBlockToNextWeek()` only undoes an activation-close, refuses while another
  block is queued, and restores the live program (edits included) rather than the replaced
  block's snapshot. A block also records the `experience` it was planned at.
- **Coach decisions are the overlay's memory.** The in-block coach stays a pure overlay,
  but each adjustment has a `key` and the WorkoutView banner offers "Keep it for this
  block" / "Not this block". Answers live on the active block (`coachDecisions`, synced
  with the journey): accepted ones keep applying quietly, declined ones are no longer
  proposed, and the banner only shows open ones.
- **Deload guardrails** (`validatePhases`): recovery only as the opener, one deload max,
  deload closes the block, ≥3 productive weeks before it. `buildPhases` auto-drops an
  unearned deload and says why.
- **The learning loop:** wrapping a block stores a `BlockRetrospective` (adherence,
  per-lift e1RM change, muscle volume vs the 10–20 band, coach-voice summary). Its
  `carryover` (keep/review exercise ids, under/over muscles) feeds the next
  `buildPlanProposal`: keepers get selection bonuses, stalled lifts get rotated with a
  "replaces X" explanation, under-target muscles get +1 set, over-ceiling muscles −1.
  The wizard computes a *live* retrospective of the running block, so even the first
  planned block learns from foundation history.
- **Confidence is declared:** proposals label themselves evidence-based (0 sessions),
  partly personalized (<12) or personalized (≥12), and every exercise decision carries a
  reason shown in the review step.
- **Open-ended notes** are parsed conservatively (`parseGuidance`: equipment limits,
  knee/shoulder/lower-back issues); every match is echoed back as a "what the coach took
  from your notes" line, everything else stays visible on the plan.
- **Migration:** `ensureJourneyMigrated()` (App startup, after pull, before push) wraps
  pre-journey history + program in a migrated plan with one open-ended "Foundation
  training" block, so the first planning cycle starts from everything already logged.
- The journey syncs as **one document** (`liftlog_plan` ↔ D1 `training_plans`), LWW by
  `updatedAt`; cleared on account switch like other user-scoped data.

---

## Athlete profile + experience (`plan.ts` + `experience.ts` + `PlanSetupView`)

The coach designs around **the person**, not just the goal. A `TrainingProfile` (stored
inside `PlanState`, so it rides the existing `liftlog_plan` LWW sync with no backend change)
holds two tiers, collected by the onboarding wizard:

- **Tier 1 — hard constraints** (gate exercise selection): injuries as structured
  **`injuryAreas`** chips (knee / shoulder / lower-back / hip / elbow / wrist →
  `applyInjuryArea`, the one place each area's bans live) plus free text parsed by
  `parseGuidance` — clause by clause, with negation ("no knee problems", "fully recovered",
  "years ago"), lift names stripped first ("back squat" is not a back) and the complaint
  vocabulary people use ("sore", "tight", "niggle"); `EquipmentAccess` (full-gym / home-rack /
  dumbbells-only / minimal → banned weight/equipment sets), days per week.
- **Tier 2 — calibration:** `ExperienceLevel` (+ training age), `priorityMuscles`
  (weak points).

(Preferred training days and a self-reported cardio level were considered and dropped —
they collected input the planner couldn't honestly act on. Their better versions live in
Future milestones: reactive rest-day suggestions and external cardio integrations.)

**Experience drives beginner-safe planning** (`planner.ts`, all keyed off the *effective*
level):
- **Dosage** — beginners get fewer sets and never sub-8 reps (no near-maximal work while
  learning technique), whatever the goal; advanced lifters keep 4×4–6 main work.
- **Split** — beginners are capped at full-body (2–3d) / upper-lower (4d); picking 5–6 days
  yields a 4-day layout + a warning that recovery, not gym time, is the early limiter.
- **Selection** — every catalog exercise has an intrinsic `difficulty` tier + `prerequisites`
  (`exercises.ts`, `difficultyFor()`/`prerequisitesFor()`, surfaced on `ExerciseProfile`).
  Beginners are scored toward beginner-tagged movements; **advanced lifts are skill-gated** —
  hidden unless the athlete has logged the lift itself or a prerequisite (train the RDL
  before the pull deadlift). Advanced profiles get a nudge toward the barbell compounds.
- **Priority muscles** get +1 set each (same guardrails as the retro under-muscle bump).
- **A strength block anchors on the barbell lifts** (audit F9, `anchorStrengthMains`): the
  main chest / squat / hinge slots carry `preferIds` (bench, back squat, conventional
  deadlift → RDL), the vertical-press slot becomes a `main` preferring the barbell overhead
  press, a slot's preferred lifts join its candidate pool even when filed under a
  neighbouring muscle (the deadlift is Glutes-primary; the hamstring slot still wants it),
  and the current program's `main` lifts are removed from the rotation set — a stalled squat
  is kept and deloaded, never swapped for a goblet squat. Sport templates already name their
  movements and are untouched.
- **One heavy axial lift per session** (`pickForSlot`): once a day holds a barbell squat or
  hinge, later slots filter out `isHeavyAxial` candidates when anything else fits — a squat
  day gets a leg curl, a deadlift day gets a hack squat. A sport template's `heavy` slot is
  an explicit prescription and is exempt.
- **Any lift with prerequisites is gated for a beginner**, not only advanced ones:
  `chin-ups` is listed as intermediate with `lat-pull-down`/`straight-arm-pulldowns` as
  prerequisites, so a novice is handed the pull-down first (audit F11).
- **Copy** — beginners get concrete starting-weight/effort guidance and a linear-progression
  framing; the deload defaults off for them.

**Experience is inferred, but only the nudge changes anything** (`experience.ts`):
`inferExperience(snapshot, now)` is gated on training *age* — intermediate at ≥26 weeks and
≥40 sessions, advanced at ≥78 weeks and ≥120 sessions (or ≥3 catalog-classified advanced lifts
mastered across ≥52 weeks / ≥80 sessions). Only ids with explicit catalog difficulty count as
evidence (`hasCatalogDifficulty`); a custom exercise defaults to intermediate for *selection*
but says nothing about the athlete. `effectiveExperience()` now simply returns the stored
level: every engine plans and prescribes with what the athlete said until they accept the
Journey's **"level up" nudge** (`experienceSuggestion`). The old max(self-report, inferred)
rule promoted a newcomer to intermediate in week four on the strength of a hip-thrust tag and
took away the beginner protections with it.

**The wizard** (`PlanSetupView`) is **one question per screen** with a slide animation
(`prefers-reduced-motion` respected), a progress bar, single-select auto-advance, Skip on
optional questions, and pre-fill from the saved profile so replans are fast. Same component
serves first-run onboarding and every replan; it saves the profile on activate.

---

## Exercise data architecture

`src/data/exercises.ts` is the single source of truth for the ~89 built-in exercises
(the original 28 plus a curated catalog expansion that feeds the substitution engine's
candidate pool — catalog-only exercises join the user's library when swapped into the
program, not before):
- `EXERCISES: ExerciseDef[]` — id, name, primaryMuscle, secondaryMuscles, workoutType, equipment, weightType
- `EXERCISE_MAP: Map<string, ExerciseDef>` — fast lookup by id
- `getExerciseMeta(id)` — returns metadata, preferring user overrides from `liftlog_exercise_meta` over defaults
- `saveExerciseMeta(id, meta)` — writes user override to `liftlog_exercise_meta`
- `catalogDefFor(id)` — resolves a timestamped custom id whose slug is a catalog exercise
  (`back-extensions-1782…` → `back-extensions`) back to its `ExerciseDef`. `generateExerciseId`
  stamps `${slug}-${Date.now()}`, so a custom entry that duplicates a catalog exercise by name
  ends up with a catalog slug + timestamp; stripping a trailing `-<10+ digits>` recovers it.
  Used by `getExerciseMeta`, `getExerciseName` and `profileFor` so these resolve muscles/name
  instead of surfacing as unclassified "Other".
- `difficultyFor(id)` / `prerequisitesFor(id)` — intrinsic skill tier (`beginner`/
  `intermediate`/`advanced`, default intermediate) and prerequisite exercise ids for advanced
  lifts. Compiled-in catalog data (a `DIFFICULTY`/`PREREQUISITES` map + `DIFFICULTY_RANK`),
  **not** user metadata — never synced. Drives beginner-safe selection + skill-gating in the
  planner; also on `ExerciseProfile`.
- `instructionsFor(id)` (`instructions.ts`) — how to do the movement: a setup line, 3–5 cues
  in coaching order and the common faults, for every catalog exercise (`catalog.test.ts`
  enforces coverage and the cue count). Compiled, app-owned, never synced — the same footing
  as difficulty. **Text only, by decision (D3):** no links or media to rot, works offline.
  Surfaced by the ⓘ `InfoButton` → `InstructionSheet` on the workout card, every picker row,
  the day editor and its replacement cards, the quick-workout builder, the plan review (rows
  and swap suggestions) and as the "How to do it" entry on the exercise detail screen. A
  custom exercise with no catalog namesake gets "No instructions yet", never an empty sheet.
- `unitFor(id)` / `isTimedExercise(id)` — whether a set counts reps or seconds
  (`ExerciseDef.unit`, absent = reps). Intrinsic catalog data like difficulty: app-owned,
  never synced, never a user override. Timed exercises (planks, carries) show **no weight
  input** and log at 0 lbs, the same convention bodyweight work uses, so the existing
  rep-progression engine progresses the hold with no schema change.
- The catalog carries an **athletic / sport-support layer** on top of the bodybuilding
  exercises: unilateral lower body (step-up, single-leg RDL), hip abduction, tendon work
  (single-leg calf raise), plyometrics (pogo hops, box jump), anti-rotation and isometric
  trunk (Pallof press, dead bug, plank, side plank, Copenhagen), loaded carries, and
  shoulder rotation / posterior cuff (dumbbell external rotation, prone Y raise). Pallof
  press, dead bug, side plank and Copenhagen plank are **Obliques**-primary (rotation/lateral
  flexion); a plain plank stays **Abs** (extension resistance, not rotation).
- A **kettlebell staples** layer (7 exercises) covers movements the dumbbell/barbell catalog
  doesn't reach rather than duplicating them under a new `weightType`: ballistic hip hinge
  (swing), offset/unilateral pressing and rowing, a front-rack lunge, and the suitcase carry —
  a loaded, anti-lateral-flexion **Obliques** stimulus distinct from the muscle's only other
  coverage (isometric holds). The Turkish get-up has no single prime mover; it's classified by
  its limiting factor (resisting rotation as the base changes through the sequence) alongside
  Pallof press and dead bug. The swing and get-up are `advanced` with prerequisites (a
  controlled hip hinge; core anti-rotation work) for the same reason good mornings is — an
  unforgiving technique floor.

`src/data/program.ts` defines the 4-day `PROGRAM` with just id, name, sets, repLow, repHigh per exercise. It no longer contains `RETIRED_EXERCISES` — those are now in `EXERCISES` in exercises.ts.

`src/data/programStore.ts` builds the exercise library from `EXERCISES` on first load, running a
one-time migration to strip stale duplicate IDs (the old `-d1/-d2/-d4` suffixed IDs). The library
holds **movement identity only** — no sets or rep range. See the Prescription section for where
dosage comes from instead.

### Muscle taxonomy tiers

Three tiers, coarsest to finest (`docs` reference: see `src/data/taxonomy.ts` comment block).
`MuscleGroup` is unchanged as *the* level every engine reasons about — this is additive, not a
rename:

- **Tier 1 — Region** (`MuscleRegion`, `MUSCLE_REGIONS`, `regionFor()` in `taxonomy.ts`) — Chest /
  Back / Shoulders / Arms / Core / Legs. Purely organizational grouping of `MuscleGroup`s for
  pickers (the plan wizard's priority-muscle options are grouped this way, e.g. "Core" =
  Abs + Obliques). No volume target of its own.
- **Tier 2 — MuscleGroup** — unchanged role: volume targets (`volumeTargetFor`), the heatmap,
  splits, substitution matching, priority muscles, synced metadata. One addition: **Obliques**
  split out of Abs — rotational/anti-rotation work is a distinct programming decision from
  spinal flexion (see the sport-support layer note above).
- **Tier 3 — MuscleHead** (`MuscleHead` type in `taxonomy.ts`; `MUSCLE_HEADS` vocabulary +
  `headsFor(id)` in `exercises.ts`) — anatomically distinct heads *within* a muscle, for the nine
  muscles where exercise selection actually differentiates them (Chest, Delts, Traps, Biceps,
  Triceps, Quads, Hamstrings, Glutes, Calves — e.g. incline press → Upper Chest, lateral raise →
  Side Delt, seated calf raise → Soleus). Compiled catalog data on the same footing as
  `difficultyFor`/`prerequisitesFor`: not user-editable, not synced, absent on custom exercises,
  not surfaced in the main UI yet. `headSetTotals()` (`analytics.ts`) is the queryable
  counterpart — per-(muscle, head) set totals plus an `unspecified` bucket for exercises with no
  catalogued head emphasis — kept for future holistic volume analysis (e.g. flagging a
  chronically undertrained rear delt even when total delt volume looks fine).

### Movement pattern tiers

Two tiers (`taxonomy.ts` comment block). Renamed from the old flat `WorkoutType` — "workout
type" never described what the field actually captured. The `ExerciseDef`/metadata *field*
stays `workoutType` for wire/schema compatibility (JSON keys and the D1 column are unchanged);
only the type name and vocabulary change.

- **Tier 2 — MovementPattern** (`MOVEMENT_PATTERNS` in `taxonomy.ts`) — unchanged role: the
  family-level match the substitution engine and planner/sports.ts slot templates operate at
  (Row vs. Pull Down vs. Pull Up are genuinely different movements). One correction: **Press**
  — the one real inconsistency in an otherwise-consistent list — used to span both bench-style
  horizontal pressing and overhead-style vertical pressing. Split into **Horizontal Press** /
  **Vertical Press**. A stale stored override of the old bare `'Press'` value can't be
  disambiguated from the string alone, so `normalizeOverride(o, id)` resolves it from the
  exercise id (`legacyPressPlane`: the catalog entry's plane, else "overhead/military/…" in a
  custom name, else Horizontal); the older synonyms `'Overhead Press'` and `'Chest Press'`/`'Push Up'` (from an even
  earlier merge into `'Press'`) remap unambiguously since they name their plane directly.
- **Tier 1 — MovementCategory** (`MOVEMENT_CATEGORIES`, `patternCategoryFor()` in
  `taxonomy.ts`) — a coarser layer above MovementPattern, for the same reason Region sits above
  MuscleGroup: most of MovementPattern's ~28 values have only 1–3 exercises, too few to show a
  *trend* — "is my Face Pull number going up" just restates that exercise's own progress. Eight
  categories (Squat, Hinge, Push, Pull, Core, Carry, Power, Isolation) aggregate enough
  exercises to say something new — the same mental model lifters already use for
  squat/bench/deadlift/press trends. `Isolation` is a deliberate catch-all: every pattern needs
  a category, but a bicep curl and a calf raise trending on one line isn't a meaningful signal,
  so isolation work is bucketed together without being treated as trend-worthy itself. Compiled
  catalog data, not user-editable, not synced — same footing as MuscleHead.
  `movementPatternFor(id)` (`analytics.ts`) resolves an exercise's pattern with the same
  precedence as `musclesForExercise` (user override → catalog → name match), and
  `categoryProgress(snapshot, goal)` (`progress.ts`) rolls per-exercise progress status up by
  category — not surfaced in the UI yet, kept for future pattern-vs-growth insights.

---

## Testing

`npm test` runs everything (~950 tests, ~6s). `npm run typecheck` runs types alone;
`npm run build` runs typecheck then Vite; `npm run check` is lint + test + build (the deploy
gate). CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on PRs and `main`.

**Where tests live.** Beside what they cover — `src/data/*.test.ts`, `src/db/*.test.ts`,
`worker/*.test.ts` — with one exception: `test/` holds tests that span the client/worker
boundary, because they belong to neither side's tsconfig (see below).

**The suite runs on `environment: 'node'`, not jsdom.** The data layer's only browser
dependency is `localStorage`, and `src/test/setup.ts` provides it in about twenty lines.
Booting jsdom to get it cost 28s of environment setup against ~1s of actual assertions —
the whole suite was 3x slower than the work it was doing. A file that genuinely needs a
DOM opts back in with a `// @vitest-environment jsdom` docblock (only `share.test.ts`
does, for `window.location`). **Do not add jsdom back globally**; shim the one API instead.

**The worker is tested against a real database, not a real runtime.** `worker/testkit.ts`
executes the production `schema.sql` on `node:sqlite` (built into Node 22, no dependency)
and adapts it to the D1 surface the worker uses — `prepare/bind/all/first/run` plus an
atomic `batch`. That means NOT NULL and PRIMARY KEY violations surface exactly as they do
in production, and `undefined` bindings throw the way D1 throws rather than silently
becoming NULL. `vitest-pool-workers` was the documented plan and was rejected: what these
handlers need verified is SQL and validation, not workerd semantics, and workerd costs
more per file than the entire suite.

**IndexedDB is tested with `fake-indexeddb`.** `database.ts` caches its connection in a
module-level `_db`, so tests reset state by calling `clearIDB()` rather than swapping the
`IDBFactory` — replacing the factory leaves the module pointing at an orphaned database.

**`test/syncContract.test.ts` wires the real client to the real worker.** `fetch` is
stubbed to call `handleSync` directly over an in-memory D1, so a push really is validated,
stored, and pulled back. This exists because the client/server payload contract is the one
thing neither side's tests could see, and it is exactly where sync broke: the client
stopped sending `sets`/`repLow`/`repHigh` on library exercises, the worker still required
them, and every push 400'd. Any change to `SyncPayload` or `validatePush` should be made
with this file open.

**tsconfig layout.** Four projects, because the two halves compile against different
globals and mixing them silently degrades inference:
- `tsconfig.app.json` — the client (DOM lib).
- `worker/tsconfig.json` — production worker code, Workers types **only**, tests excluded.
  An accidental `fs`/`process` import fails here rather than at the edge.
- `worker/tsconfig.test.json` — worker tests: Workers types **first**, then Node. The order
  matters: letting Node's declarations win collapses D1's typed row results into `any`,
  which quietly disables inference across `worker/sync.ts`.
- `test/tsconfig.json` — the cross-boundary tests. Deliberately not composite (it overlaps
  the others by design), so it is a separate `tsc -p` step in `npm run typecheck`.

**Conventions.** Test names state the behaviour and the reason ("never drops a workout
logged locally but not yet pushed"), not the function name. Where a test pins down
current-but-questionable behaviour, say so in a comment rather than asserting it silently —
`admin.test.ts` does this for promotions that require no reason. `blockSimulation.test.ts`
is the integration tier: it designs a block per athlete profile and *trains* it week by
week, catching composition bugs no unit test can see. Its `simulate()` calls run at
collection time, so hoist them to the `describe` body rather than repeating them per `it`.

**Known defects are pinned with `it.fails`, not skipped.** `profileSimulation.test.ts`
(five user profiles trained for a quarter by a synthetic *human* athlete — noisy, fatiguing,
skipping sessions — through the real planner, planStore, prescription, coach, retrospective
and replan loop), the bodyweight/timed loop in `recommendations.test.ts`, and any future
reproduction of an audit finding are written as `it.fails(...)` with a comment naming the
phase of `docs/action-plan-2026-10.md` that fixes them. (As of Phase 7 every pinned finding
has flipped to a plain `it`; the convention stays for the next audit.) The synthetic athlete
in `profileSimulation.test.ts` answers the coach the way a compliant one does — every open
adjustment is accepted the first time it is shown — so the "same adjustment every workout"
check measures what a real user who taps *Keep it* would see. vitest reports an `it.fails` test
that starts passing as a failure, so fixing the bug *forces* the test to flip to a plain
`it` in the same PR — the reproduction becomes the regression test with no step forgotten.
`catalog.test.ts` pins the catalog invariants (unique ids/names, vocabulary membership,
prerequisites that resolve to easier lifts, heads from the right muscle, legacy-id and
PROGRAM references) that are otherwise only checked by hand.

---

## Decisions & things to keep in mind

- **DB writes only at "Finish Workout"** — sets are pure React state until save. This makes
  inline editing/deletion free (no DB rollback needed). A localStorage draft
  (`draftSession.ts`) shadows the state on every set change so an app kill mid-workout loses
  nothing: reopening the same day within 12 h auto-restores it (with a Discard button); the
  draft is cleared at Finish. Edit-session mode never drafts. Finish is wrapped in
  try/catch: a failed save shows an error above the button, keeps the sets and the draft, and
  re-enables the button.
- **The draft slot is protected and self-describing.** One slot, but a draft that holds logged
  sets is never overwritten by opening another day: WorkoutView asks `conflictingDraft()` first
  and shows a sheet (resume it / discard it and start this one). The draft carries the
  `WorkoutDay` snapshot, its `origin` (`program`/`quick`/`shared`) and mid-workout additions,
  so quick and shared workouts resume after a kill like program days, via the Dashboard's
  "Resume unfinished workout" card (`getUnfinishedWorkout()` → `App.handleResumeDraft`). Back
  with logged sets asks for confirmation (the draft survives either way).
- **An open workout is frozen.** `App` snapshots the day into the view (`{ screen: 'workout';
  day }`) and WorkoutView freezes `day`/`program` in state, so a background pull that replaces
  the program can neither unmount the workout nor change its exercises mid-set; the tick also
  skips `startPendingActivation()` while a workout is open. WorkoutView instances are keyed by
  day/session id so resuming a different day mounts fresh state.
- **Edit session flow** — "Edit Session" in history opens WorkoutView with `existingSessionId`.
  On save `rewriteSessionSets()` replaces the set logs and bumps `updatedAt` in one transaction
  so merge sync propagates the edit. The loader effect depends on `existingSessionId` only (the
  day is frozen), so a program refresh can't wipe unsaved edits. A quick/shared session, or one
  whose day the program no longer has, is edited from a placeholder day — WorkoutView renders
  every logged exercise the day doesn't list.
- **New accounts get no default program** — `getStoredProgram()` falls back to `[]`, not
  `PROGRAM`. The dashboard shows an empty state + plan CTA; the wizard builds the first
  program. Existing accounts are unaffected (their program is in localStorage and in the
  per-user `user_programs` server row, restored by pull on any device).
- **A program can be built by hand.** Dashboard "＋ Add a day" / "Build my own program" opens
  `DayEditView` with `isNew` (nothing is stored until saved with an exercise); the editor
  renames a day, edits each slot's sets × rep range and coach/manual progression through the
  shared `SlotDoseEditor`, reorders and removes days, and all three pickers (day editor,
  quick workout, mid-workout add) are the one `AddExercisePanel`. Finishing a quick workout
  offers to keep it as a program day. The Metrics Progress tab lists every lift trained in the
  last 60 days, not just the current program, with a show-all control.
- **Removing an exercise from a day never deletes it** — it stays in the library so history
  can still resolve the name by id. Deleting happens only from the exercise detail screen,
  which offers *Archive* (hidden from lists, history kept) or *Delete* (history wiped), records
  a synced tombstone, and can be undone only by an explicit restore (see Cloud sync).
- **Weights are stored in pounds, always** — `units.ts` converts for display and entry only
  (`toDisplay`/`fromDisplay`/`fmtWeight`), the engines compute in lbs and format their reason
  strings through `fmtWeight`, and increments stay equipment-based in lbs (shown converted).
  A kg entry is stored to two decimals so it round-trips within display precision.
- **Every modal is a dialog** — `useDialog` gives it Escape, focus-in, a Tab trap and focus
  return; interactive rows are real buttons or `role="button"` with a key handler, never a
  clickable container wrapping another button.
- **Difficulty rating was removed** — the Easy/Medium/Hard buttons were removed. The `exerciseLogs` IDB store still exists but nothing writes to it.
- **The week-numbering anchor is managed automatically** — the "Training block start"
  setting was removed. `getProgramStartValue()` stamps first use of the app on this device
  as the initial anchor; block activation anchors to the block's start; wrapping a block
  re-anchors to the block's end; and `planStore.ensureWeekAnchor()` (App startup + after
  every background pull) re-derives the anchor from the *synced* journey document so every
  device agrees. Changing the anchor only affects the week numbering of *new* sessions —
  historical sessions keep the `weekNumber` they were stored with.
- **Analytics bucket by CALENDAR week, never by `session.weekNumber`** — this follows directly
  from the bullet above. `weekNumber` is stamped from whatever anchor was in force at logging
  time, so re-anchoring leaves stored numbers out of chronological order (a July session
  carrying week 9 sorting after a later one carrying week 1) and colliding across blocks.
  Grouping by the Monday-anchored wall-clock week (`sessionWeekStart()` in `analytics.ts`,
  built on `startOfWeek()` in `program.ts`) is stable forever. This is what weekly volume,
  weekly muscle sets and every week-over-week delta use; `weekNumber` survives only as a
  per-session record and a sync field. `computeMetrics(snapshot, now)` and
  `computeCoaching(program, snapshot, now, …)` take a timestamp, not a week number.
- **The weekly volume chart is a continuous timeline** — oldest week on the left, current week
  on the right and highlighted (`BarChart`'s `highlightIndex`, not `highlightMax`). It always
  ends on the current week even at zero ("this week so far" is the number to beat), spans at
  most `VOLUME_WEEKS` (8), and renders untrained weeks as real zero-height gaps rather than
  collapsing them — a skipped week must look like a skipped week.
- **Time away is handled explicitly, not by accident** — the engine reads the last
  N sessions of an exercise regardless of when they happened, so the calendar needs
  its own guards. Two: the weekly rate cap (`weeklyCeiling`) anchors to the most
  recent session when nothing falls inside the trailing 7 days, so a lifter back
  from a layoff gets the same weekly allowance as one who trained through rather
  than the largest jump the sizing model can produce; and the stall window
  (`STALL_WINDOW_DAYS`, 5 weeks) only calls a plateau when the three sessions are
  close enough together to have accumulated fatigue — three sessions across three
  months is infrequent training, and the reason string says so instead of
  deloading them.
- **Blocks are simulated end to end** (`blockSimulation.test.ts`) — twelve profiles
  across experience levels, goals, equipment, injuries and sports each design a
  10-week block and then *train* it week by week, logging exactly what the plan
  prescribes and feeding the history back. It asserts the properties no unit test
  can see: every week schedules a workout, easy weeks do less work than hard ones,
  loads climb for goals that build and hold for goals that defend, and weekly
  volume stays inside the goal's band. It has already caught a real
  over-prescription (six-day splits blowing past the delt ceiling) and a real
  compounding bug (consecutive intro weeks getting progressively easier).
- **The planner enforces the volume ceiling** (`capWeeklyVolume`) — split templates
  are calibrated on *direct* sets, but every compound also feeds half a set into
  its secondaries, and on a 6-day split that spillover put Delts at 25.5 weekly
  sets against a 20 ceiling. The last pass in `buildPlanProposal` trims non-main
  slots (floor 2 sets) until the projection fits, each trim carrying its reason
  into the review step. Prescribing over the ceiling and letting the in-block
  coach undo it all block is a worse experience than not prescribing it.
- **Timed work is progressed by time** — a set of an exercise with
  `unit: 'seconds'` logs at 0 lbs with no weight input, and `repProgression`
  drives the hold through the same four branches as a bodyweight rep count.
  Count progression is gated on `weight === 0` alone, so neither editing a
  plank's weight-type metadata nor logging a machine unloaded can put a zero
  on the load engine ("go to 2.5 lbs" is not advice). `dosage()` checks the
  unit before any pattern rule. The unit travels on `PrescriptionContext` so
  every reason string reads right.
- **The weekly set band belongs to the goal and the athlete, not the app** — every engine
  takes a `VolumeTarget` from `volumeTargetFor(goal, experience)` instead of importing
  `SETS_TARGET_LOW/HIGH`: 4–10 on sport-support, **6–12 for a beginner**
  (`BEGINNER_VOLUME_TARGET` — the beginner templates prescribe ~5–8 sets a muscle by
  design; judging that against 10–20 made the coach add a set at every workout and the
  retrospective report "0 of 12 muscles in band"), 10–20 otherwise. The planner also caps
  block-over-block growth (`MAX_BLOCK_GROWTH`, +25% weekly sets; retro bumps come back off
  first) and limits retro +1s to three muscles, holds each split to the session length its
  own copy promises (`sessionBudgetFor`), lets full-body day C **reuse** day A's big
  compounds (`Slot.reuse` — the movement that matters most is trained twice a week), marks
  template anchors `main` on the generated slots (trimmed last, floor 3 sets), and runs its
  trend read through the phase resolver so a block that climbed to its deload is not rotated.
  On the sport templates `heavy` (bilateral squat/hinge) takes the event rep range and `main`
  only protects, and `intro` is a build-side phase so every day gets its easy first exposure. On `sport-support` the coach
  planner may **trim but never add** sets (also true in any `maintenance` week): volume
  creep is the specific failure mode of concurrent training, and the coach cannot see the
  swim/bike/run sessions its extra set would cost.
- **Settings are device-local** — `liftlog_settings` and `liftlog_rest_seconds` are not synced.
  (The week anchor stays consistent across devices anyway because ensureWeekAnchor derives it
  from the synced journey; exercise metadata *is* synced — see Cloud sync.)
- **Empty workouts are purged** — a session with no set logs is a ghost/duplicate and is
  deleted by `purgeEmptySessions()` (startup + around every sync). This also cleaned up the
  legacy duplicate-workout problem for good.
- **Weight 0 is valid** — bodyweight exercises log with 0 lbs; only reps must be positive.
- **Session timestamps are the duration signal** — `startedAt` is stamped when WorkoutView
  opens and `completedAt` at the *final logged set* (not the "Finish" tap), so
  `completedAt − startedAt` is the workout duration. No schema change was needed. Sessions
  from older builds have duration ≈ 0 and are filtered by `sessionDurationMs()`'s validity
  window (10 min – 4 h).
- **Metadata reads are cached by raw string** — `getExerciseMeta()` is called per set log by
  the analytics; it used to re-parse and re-normalize the whole override blob every call
  (1.7 s on two years of history, audit M17). `exercises.ts` keeps the parsed map as long as
  `localStorage.getItem` returns the same string (so writes from anywhere, other tabs and
  `localStorage.clear()` in tests all invalidate it), hands out copies, and every writer goes
  through `writeMetaOverrides`. The same audit replaced `toLocaleDateString` with one cached
  `Intl.DateTimeFormat` (`shortDateLabel` in program.ts) and made `headSetTotals` resolve each
  exercise once.
- **Taxonomy merges are normalized on read** — `normalizeOverride()` in `exercises.ts`
  remaps merged-away values from stored overrides (localStorage or a server pull) on every
  read so old data keeps resolving in the dropdowns:
  - Equipment `'Leg Press Machine'` → `'Machine'` (the catch-all for any exercise machine)
  - Muscles `'Front Delts'`/`'Side Delts'`/`'Rear Delts'` → `'Delts'` (duplicates created by
    the collapse are deduped — first mention wins, later ones are nulled)
  - Movement patterns `'Chest Press'`/`'Push Up'` → `'Horizontal Press'`, `'Overhead Press'`
    → `'Vertical Press'`, and a stale bare `'Press'` is resolved from the exercise it sits on
    (`legacyPressPlane`: catalog plane, else the name, else Horizontal)
- **Taxonomy option arrays are alphabetical** — `MUSCLE_GROUPS`, `WORKOUT_TYPES`,
  `EQUIPMENT_OPTIONS`, `WEIGHT_TYPES` render directly as dropdowns; keep them sorted when
  adding values.
- **`e.stopPropagation()`** is used on nested buttons (Edit, ×) inside tappable cards to prevent triggering parent onClick.
- **White screen with no terminal error** after adding new files = Vite HMR confusion. Fix: hard refresh (`Ctrl+Shift+R`) + restart dev server.
- **Exercise ID migration** — old builds used `-d1`/`-d2`/`-d4` suffixed IDs for exercises that appeared in multiple days. The remap lives in `src/data/legacyIds.ts` (`LEGACY_ID_MAP`/`canonicalizeId`). It is applied in **two** places that must stay in sync: `migrateExerciseIds()` in `database.ts` (set logs — run before any code that reads set logs by exercise ID) **and** `getStoredProgram()` in `programStore.ts` (the stored program on every read). Fixing only the set logs is not enough: if the stored program still holds a legacy ID, every new workout re-creates legacy-ID set logs, so both must be canonicalized.

---

## Future Roadmap (V3)

These are the highest-leverage improvements identified in the Rev 2 audit. Implement them in
roughly this order when ready — each one builds on the previous.

### 1. ~~Delta-based sync~~ — DONE (merge-based sync v2)
Implemented as per-session-document merge rather than a cursor-based delta protocol: payloads
are tiny for a personal training log, so incremental transfer (`lastSyncAt` cursors) would add
clock-skew and per-device state for no user-visible benefit. What actually fixes the data-loss
risk is *merge semantics*: immutable session GUIDs (not `startedAt`, which `updateSessionDate`
mutates), per-document last-write-wins by `updatedAt`, and deletion tombstones. See the Cloud
sync section. `pendingSessions` was removed.

### 2. Effort — **not measurable today; both RPE and drop-off inference are rejected**
The deload trigger reads a goal-weighted blend of volume, est. 1RM and PR events
(`progression.ts`), and every one of those signals is blind to effort: 3×10 left with two reps
in the tank and 3×10 to failure are identical volume and completely different stimuli. That gap
is real. **An `rpe` field is not how this app closes it.** Self-reported RIR is least accurate
in exactly the population and the situations that matter — novices, multi-joint lifts, sets
stopped short of failure — and an optional subjective field that the user knows they'd fill in
carelessly is worse than no field, because the engine would weight bad data as a measurement.
This app already tried the cheap version and removed it (the Easy/Medium/Hard difficulty
rating; the `exerciseLogs` store is its fossil).

**Set-to-set rep drop-off was proposed as the objective replacement, and is also rejected.**
Sets get cut short for *scheduling* reasons, not just fatigue ones — stopping a squat two reps
early because the workout continues afterward produces the same curve as reaching failure, and
the bias is systematic per athlete and per exercise position rather than random. Worth knowing
that this already affects live code: `fatigueDrops()` fits rep targets to observed drop-off, so
an athlete who habitually leaves reps on the later sets has that *preference* learned as their
*capacity* and prescribed back to them indefinitely.

What effort measurement would actually require is in `docs/adaptive-engine-roadmap.md`: per-set
timestamps (Stage 0) make set duration and rest intervals available, which is the only
objective proximity-to-failure proxy a phone can capture. Until then the honest position is
that the engine cannot see effort, and should not pretend to.

### 3. ~~In-workout session persistence (draft sessions)~~ — DONE
Implemented in localStorage rather than IDB: a draft is one small single-writer object, and
synchronous writes can't be lost to an interrupted async transaction during an app kill.
WorkoutView shadows its set state into `liftlog_draft_session` on every change; reopening the
same day within 12 h auto-restores it (banner + Discard), Finish clears it. `startedAt` is
preserved so duration tracking stays correct. See `data/draftSession.ts`.

### 4. ~~Mesocycle awareness~~ — DONE (training blocks)
Implemented as the training journey's block/phase system rather than a
`mesocycleLengthWeeks` setting: blocks carry one phase tag per week
(accumulation/intensification/peak/deload), planned deload weeks override the
recommendation engine (~10% off) and pause the set-planner, and the week anchor
is managed automatically by the journey (no manual setting). See the Training
journey section.

### 5. Quality-of-life additions
These are independent of each other and can land in any order:

- **Unit preference (kg / lb)** — a single `weightUnit` setting in `settings.ts`; all display
  and input converts via a thin `toDisplay(lbs)` / `fromDisplay(val)` helper. Store always in lbs.
- **Exercise substitution suggestions** — when the Coach flags a muscle as under-trained, surface
  1–2 exercises from `EXERCISES` that target it and match the user's available equipment
  (`taxonomy.ts` already has the data).
- ~~**Worker-side tests**~~ — DONE, but **not** with `vitest-pool-workers`: booting workerd
  per file costs more than the whole suite, and the parts worth testing (validation, the
  D1 upserts, the role gate, the OAuth handshake) need a real *database*, not a real
  *runtime*. `worker/testkit.ts` runs the real `schema.sql` on `node:sqlite` instead. See
  the Testing section.
