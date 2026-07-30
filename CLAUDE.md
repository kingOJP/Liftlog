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
    preserve the slot's programming; curated catalog expansion (~68 exercises)
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

**Future milestones:**
- RPE/RIR logging — one optional field per set would let the engine distinguish "grinding at RPE 10" from "easy reps," making deload detection much sharper.
- Journey v2 — deload-position editing in the wizard (`validatePhases` already
  enforces the constraints), LLM-backed proposal source (`PlanProposal` is the
  seam: any generator that emits one plugs into the same review-and-activate
  flow), block-over-block comparison charts, rehab/peaking block presets.
- Unit preference (kg/lb) and worker-side tests with vitest-pool-workers.
- Planner v2 — RPE-aware volume decisions, automatic exercise substitution (the planner
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
- **Vitest + jsdom** — `npm test` (or `npm run test:watch`). Unit tests live next to the
  modules they cover (`src/data/*.test.ts`) and target the pure data layer.
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
- Logout: `/api/auth/logout`
- Current user: `getLoggedInUser()` in `src/data/sync.ts` — reads from a cookie set by the server
- `LoginView` is shown when `getLoggedInUser()` returns null

---

## Navigation

No router — pure React state in `App.tsx`. The `View` discriminated union:

```ts
type View =
  | { screen: 'dashboard' }
  | { screen: 'workout'; dayId: number }
  | { screen: 'history' }
  | { screen: 'edit-session'; sessionId: number; dayId: number }
  | { screen: 'edit-day'; dayId: number }
  | { screen: 'exercise-list' }
  | { screen: 'exercise-meta'; exerciseId: string; exerciseName: string }
  | { screen: 'metrics' }
  | { screen: 'settings' }
  | { screen: 'journey' }
  | { screen: 'plan-setup' };
```

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
    exercises.ts               — Single source of truth for the ~68 built-in exercises
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
    progress.ts                — THE progress/stall assessment: assessSnapshot(snapshot, goal) →
                                  per-exercise ExerciseProgress (status progressing/steady/
                                  stalled/declining) blending e1RM trend + volume-load trend +
                                  weight/rep PRs with goal-dependent weights, discounting sessions
                                  trained later in the workout than usual (exercise-order
                                  freshness). Single source of truth for "is this progressing?"
                                  across insights, recommendations, retrospective, planner,
                                  substitution (see progress engine section below)
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
                                  experience) → sets × rep range, isHeavyAxial() (barbell hinge/
                                  squat → low narrow ranges), rangeFromHistory() (read the range
                                  off the lifter's own log), resolvePrescription() (the cascade)
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
                                  — merge-based cloud sync via /api/sync (see Cloud sync section)
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
    DayCard.tsx/css            — single day card with Edit button
    WorkoutView.tsx/css        — workout logging + edit-session mode + recommendations + rest
                                  timer + coach-plan overlay/banner + duration capture
    ExerciseCard.tsx/css       — per-exercise card: recommendation chip, "last time" line,
                                  goal line, the whole prescription (next set pre-filled and
                                  editable, remaining sets previewed), ＋ Warm-up / ＋ Extra
                                  set, tap-to-edit logged sets
    RestTimer.tsx/css          — floating rest countdown; auto-(re)starts on each logged set
    HistoryView.tsx/css        — all past sessions in reverse chronological order
    DayEditView.tsx/css        — edit a day's muscle group label + add/remove exercises +
                                  per-exercise "Find replacement" (⇄) suggestion panel
    ExerciseListView.tsx/css   — alphabetical list of all exercises, taps into ExerciseMetaView
    ExerciseMetaView.tsx/css   — edit an exercise's muscle groups, equipment, weight type
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
    SettingsView.tsx/css       — program start date, rest-timer default, account/sign-out
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
| `liftlog_plan` | `planStore.ts` | Training journey document (all plans + blocks + retrospectives + athlete `profile`; user-scoped, synced LWW) |
| `liftlog_data_owner` | `sync.ts` | Email of the account the local data belongs to — a mismatch at startup wipes user-scoped local data |
| `liftlog_library_v2` | `programStore.ts` | Migration flag — deduplication pass 1 |
| `liftlog_library_v3` | `programStore.ts` | Migration flag — deduplication pass 2 (current) |

---

## IndexedDB schema (version 3)

**`sessions`** — index: `weekNumber`
- `id` (autoincrement), `guid?` (immutable sync identity; legacy rows get `legacy-<startedAt>`
  backfilled by `ensureSessionGuids()`), `dayId`, `weekNumber`, `startedAt`, `completedAt?`,
  `updatedAt?` (last meaningful write — per-session conflict resolution for merge sync)

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

Key exported functions: `createSession`, `completeSession`, `touchSession`, `ensureSessionGuids`, `addSetLog`, `getSession`, `updateSessionDate`, `getSetLogsForSession`, `deleteSetLogsForSession`, `deleteSetLogsByExerciseId`, `hasSetLogsForExercise`, `migrateExerciseIds`, `purgeEmptySessions`, `dumpIDB`, `mergeServerSessions`, `clearIDB`.

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

**Merge protocol (sync v2).** The unit of sync is the *session document*: a session row plus
its set logs, identified by an immutable client-generated `guid` (pre-v2 rows derive the
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
(muscle/equipment/weight-type overrides), deleted-exercise tombstones, and the **training
journey document** (`plan` — all plans/blocks/retrospectives as one JSON doc, per-user D1
`training_plans` table, whole-document LWW by `updatedAt` on both ends: the server upserts
only a newer copy, the client replaces local only with a newer copy). On pull, metadata
is *merged* into local (server wins per exercise; unsynced local edits survive).
`pushSync()`/`pullSync()` also run `purgeEmptySessions()` so ghost/empty workouts can't
resurrect through sync (the server additionally refuses to store empty session docs).

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
(`mergeExerciseLibrary` — incoming wins per id, local-only entries survive); only tombstones
delete. `ensureProgramExercisesInLibrary` (end of every pull) rebuilds any library entry the
program references but the library lost, and `getExerciseName` humanizes orphaned timestamped
ids as a last-resort display fallback. **Lifecycle:** custom exercises (timestamped ids) are
queued into `pending_exercises` on push; admins review via `/api/admin/pending`, and approval
promotes into the global layer. **Roles:** `user_roles` table (`user`/`admin`/`tester`,
absent = user), resolved server-side (`worker/roles.ts`), enforced on `/api/admin`, reported
on pull and cached in `liftlog_role` as a UI hint only.

---

## Progress & stall engine (`src/data/progress.ts`)

The single definition of "is this exercise making progress?" — used by insights, the
recommendation deload trigger, retrospectives, the planner and substitution, so the whole app
agrees. e1RM alone is a raw-strength proxy (blind to volume gains, rep PRs, and workout
context), so `assessExercise` / `assessSnapshot(snapshot, goal)` blend four signals:

- **e1RM trend** — best Epley estimate, first vs last session in the trailing window.
- **volume-load trend** — tonnage (Σ weight × reps); total reps for bodyweight-at-0 work.
- **PR events** — weight PRs (beat all-time heaviest) and rep PRs (more reps than ever at a
  weight lifted before), detected against running all-time bests.
- **exercise order (freshness)** — each set carries the `order` it was trained in. If the
  latest session ran ≥2 slots later than the exercise's usual position (median), it's excluded
  as a trend endpoint: "benched 4th because the racks were taken" is fatigue, not weakness.

The signals combine into a −1…+1 composite with **goal-dependent weights** (`GOAL_WEIGHTS`):
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
each exercise, builds its recent history **across every day it appears in** (up to the last 4
sessions containing that exercise, newest first), then calls
`calculateRecommendation(history, exercise, ctx)`. `ctx` is a `PrescriptionContext`
(options bag, not positional args): `weightType`, `phase`, **`goal`** and **`experience`** —
the engine reads the athlete and the plan, not just the lift. WorkoutView supplies
`getTrainingGoal()` and `effectiveExperience(getProfileOrDefault(), snapshot)`.

Branches, evaluated in order:

1. **Increase (rep total)** — at least `exercise.sets` working sets and a **rep total** of
   `sets × repHigh` over the *programmed* set count → add load. Counting the total rather than
   demanding *every* set hit `repHigh` is what stops the engine parroting last week's weight:
   13/12/11 is the same 36 reps as 12/12/12 and has equally earned the jump. Capping the count
   at `exercise.sets` stops bonus sets (5×8 = 40 reps) from earning it.
2. **Increase (e1RM breakout)** — 2+ recent sessions at the same load, reps already at
   `repHigh − 1`+, and best e1RM up ≥3% across them → move up now rather than waiting for a
   perfect rep total. Skipped on high-rep work (see the e1RM validity note below).
3. **Deload** — 3 sessions at the same weight where **nothing in the window beat where it
   started**, on *either* lever → drop ~10% and build back up.
4. **Decrease** — reps under `repLow`, **confirmed** (see below) → ease back ~5%.
5. **Hold** (double progression) — reps in range → keep the weight, chase reps. The reason
   names the exact gap ("2 more reps than last time (36 total) earns the next increase").

Four things make this a coach's answer rather than a rule-of-thumb, each fixing a way the
earlier version was wrong:

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

**Bodyweight exercises progress by reps, not load.** When the exercise's `weightType` is
`Bodyweight` *and* the last session's working weight was 0 lbs, the engine switches to rep
progression (`repProgression()` in the same file): the recommendation carries a `targetReps`
per-set goal, total session reps replace e1RM as the stall metric, and the four branches mirror
the weight engine (beat the range → +1 rep goal; stalled 3 sessions → reset to `repLow`, or
*hold the standard* on a fat-loss goal; under range → build back to `repLow`; in range → chase
one more rep). If external load *was* logged
(e.g. weighted pull-ups with a belt), the normal weight engine applies. ExerciseCard shows
"↑ N reps" instead of a weight when `targetReps` is set.

Returns `{ weight, targetReps?, direction, kind, reason }` (`kind`: `increase`/`hold`/`decrease`/`deload`).

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
- The plan is built from the **coach-adjusted** set count (`effectiveDay`), so a planner set
  addition shows up as a real prescribed row.
- Targets and the fatigue fit both read the **fresh-slot baseline**, so a late-slot session
  can't skew the plan any more than it can skew the recommendation.

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

`getPlannedGoal()` (planStore) returns `null` when there's no plan, which is what makes step 3
reachable; `getTrainingGoal()` keeps its `'general'` fallback for analytics that just need *a*
goal to weight signals. Note that `ensureJourneyMigrated()` gives legacy users a Foundation
plan with a real goal, so in practice most accounts resolve at step 2.

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
  (override → catalog → name match, same precedence as `musclesForExercise`), movement
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
  empty plan (no set fiddling in a planned easy week). WorkoutView shows a phase banner.
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

- **Tier 1 — hard constraints** (gate exercise selection): injuries/limitations (free text,
  parsed by `parseGuidance`), `EquipmentAccess` (full-gym / home-rack / dumbbells-only /
  minimal → banned weight/equipment sets), days per week.
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
- **Copy** — beginners get concrete starting-weight/effort guidance and a linear-progression
  framing; the deload defaults off for them.

**Experience is inferred, and only ratchets up** (`experience.ts`): `inferExperience(snapshot)`
reads training age (weeks spanned), consistency (session count), and difficulty mastered
(advanced lifts trained ≥3 sessions). `effectiveExperience()` = max(self-reported, inferred),
so a beginner whose data says otherwise still gets the better plan; the wizard plans with the
effective level and JourneyView shows a **"level up" nudge** (`experienceSuggestion`) to bump
the stored profile. Never downgrades.

**The wizard** (`PlanSetupView`) is **one question per screen** with a slide animation
(`prefers-reduced-motion` respected), a progress bar, single-select auto-advance, Skip on
optional questions, and pre-fill from the saved profile so replans are fast. Same component
serves first-run onboarding and every replan; it saves the profile on activate.

---

## Exercise data architecture

`src/data/exercises.ts` is the single source of truth for the ~68 built-in exercises
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
- `unitFor(id)` / `isTimedExercise(id)` — whether a set counts reps or seconds
  (`ExerciseDef.unit`, absent = reps). Intrinsic catalog data like difficulty: app-owned,
  never synced, never a user override. Timed exercises (planks, carries) show **no weight
  input** and log at 0 lbs, the same convention bodyweight work uses, so the existing
  rep-progression engine progresses the hold with no schema change.
- The catalog carries an **athletic / sport-support layer** on top of the bodybuilding
  exercises: unilateral lower body (step-up, single-leg RDL), hip abduction, tendon work
  (single-leg calf raise), plyometrics (pogo hops, box jump), anti-rotation and isometric
  trunk (Pallof press, dead bug, plank, side plank, Copenhagen), loaded carries, and
  shoulder rotation / posterior cuff (dumbbell external rotation, prone Y raise).

`src/data/program.ts` defines the 4-day `PROGRAM` with just id, name, sets, repLow, repHigh per exercise. It no longer contains `RETIRED_EXERCISES` — those are now in `EXERCISES` in exercises.ts.

`src/data/programStore.ts` builds the exercise library from `EXERCISES` on first load, running a
one-time migration to strip stale duplicate IDs (the old `-d1/-d2/-d4` suffixed IDs). The library
holds **movement identity only** — no sets or rep range. See the Prescription section for where
dosage comes from instead.

---

## Decisions & things to keep in mind

- **DB writes only at "Finish Workout"** — sets are pure React state until save. This makes
  inline editing/deletion free (no DB rollback needed). A localStorage draft
  (`draftSession.ts`) shadows the state on every set change so an app kill mid-workout loses
  nothing: reopening the same day within 12 h auto-restores it (with a Discard button); the
  draft is cleared at Finish. Edit-session mode never drafts.
- **Edit session flow** — "Edit Session" in history opens WorkoutView with `existingSessionId`. On save it deletes all old set logs for that session, re-writes them, and calls `touchSession()` so merge sync propagates the edit.
- **New accounts get no default program** — `getStoredProgram()` falls back to `[]`, not
  `PROGRAM`. The dashboard shows an empty state + plan CTA; the wizard builds the first
  program. Existing accounts are unaffected (their program is in localStorage and in the
  per-user `user_programs` server row, restored by pull on any device).
- **Exercise library never deletes** — removing an exercise from a day keeps it in the localStorage library so history can still resolve the name by ID.
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
- **The weekly set band belongs to the goal, not the app** — every engine takes a
  `VolumeTarget` from `volumeTargetFor(goal)` instead of importing `SETS_TARGET_LOW/HIGH`.
  A new goal that needs a different dose changes one function. On `sport-support` the coach
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
- **Taxonomy merges are normalized on read** — `normalizeOverride()` in `exercises.ts`
  remaps merged-away values from stored overrides (localStorage or a server pull) on every
  read so old data keeps resolving in the dropdowns:
  - Equipment `'Leg Press Machine'` → `'Machine'` (the catch-all for any exercise machine)
  - Muscles `'Front Delts'`/`'Side Delts'`/`'Rear Delts'` → `'Delts'` (duplicates created by
    the collapse are deduped — first mention wins, later ones are nulled)
  - Workout types `'Chest Press'`/`'Overhead Press'`/`'Push Up'` → `'Press'`
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

### 2. RPE / RIR logging
The deload trigger today fires purely on e1RM stagnation across 3 sessions, which can't
distinguish "I was grinding at RPE 10" from "these were easy reps." One optional `rpe` field per
set (scale 1–10, blank = untracked) lets the engine confirm fatigue before recommending a deload
and detect under-effort when reps stay in range but RPE is low.

Implementation: add `rpe INTEGER` to `setLogs` IDB store (schema v4), show a small tap-to-set
chip next to each logged set row, update `calculateRecommendation` to factor in average RPE.
No UI change is needed if the field is left blank — fully backwards-compatible.

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
- **Worker-side tests** — the `worker/` directory has no test coverage. Add
  `vitest-pool-workers` (Cloudflare's Vitest integration) and cover `validatePush()`, the
  OAuth redirect helper, and the D1 upsert logic.
