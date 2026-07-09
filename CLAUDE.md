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
                                  WeightType types + the option arrays the UI renders
    program.ts                 — Exercise/WorkoutDay interfaces, PROGRAM (4 days),
                                  getWeekNumber()/getWeekNumberForDate(), getWeekDateRange(),
                                  getExerciseName()
    settings.ts                — device-local settings (localStorage): configurable program
                                  start date (drives week numbering) + rest-timer default
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
    analytics.ts               — shared analytics core: loadTrainingSnapshot() (ONE dumpIDB read
                                  powering every consumer), buildSnapshot() (pure, for tests),
                                  epley1RM, e1rmSeries(), musclesForExercise()/primaryMuscleFor()
                                  (override → master list → name match), SETS_TARGET_LOW/HIGH,
                                  sessionDurationMs()/avgDurationByDay() (workout durations)
    progress.ts                — THE progress/stall assessment: assessSnapshot(snapshot, goal) →
                                  per-exercise ExerciseProgress (status progressing/steady/
                                  stalled/declining) blending e1RM trend + volume-load trend +
                                  weight/rep PRs with goal-dependent weights, discounting sessions
                                  trained later in the workout than usual (exercise-order
                                  freshness). Single source of truth for "is this progressing?"
                                  across insights, recommendations, retrospective, planner,
                                  substitution (see progress engine section below)
    recommendations.ts         — calculateRecommendation(history, exercise) → WeightRec | null
                                  ({ weight, direction, kind, reason }); double progression +
                                  stall-triggered deload, order-aware (late-slot sessions skipped
                                  as the baseline) (see algorithm section below)
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
                                  validatePhases() deload guardrails
    planner.ts                 — block planner: buildPlanProposal(input, program, snapshot,
                                  prevRetro) → PlanProposal (split, phase layout, generated
                                  workouts, per-exercise decisions with reasons, confidence,
                                  parsed guidance notes) — pure, like every other engine
    retrospective.ts           — computeBlockRetrospective(block, snapshot) → adherence,
                                  per-lift e1RM change, muscle volume, coach-voice summary,
                                  carryover signals the next planner run consumes
    planStore.ts               — journey persistence (localStorage `liftlog_plan`):
                                  activateProposal(), completeActiveBlock(), getActivePhase(),
                                  ensureJourneyMigrated() (wraps legacy history in a Foundation
                                  block), mergeServerPlanState() (LWW sync)
    heatmap.ts                 — muscle heatmap data: computeMuscleHeat() over a time window,
                                  heatColor()/heatLabel() (blue→green→yellow→red weekly-rate
                                  gradient), presetWindow()/mesocycleWindow()
    metrics.ts                 — computeMetrics(snapshot) → Metrics (volume, e1RM series, muscle sets)
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
                                  set logging, tap-to-edit
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
    charts.tsx/css             — reusable BarChart and LineChart (hand-rolled CSS/SVG)
```

---

## localStorage keys

| Key | Owner | Purpose |
|---|---|---|
| `liftlog_program` | `programStore.ts` | User's customised workout program |
| `liftlog_exercises` | `programStore.ts` | Exercise library (name + sets/reps defaults) |
| `liftlog_exercise_meta` | `exercises.ts` | Per-exercise metadata overrides (muscle, equipment, etc.) |
| `liftlog_settings` | `settings.ts` | Device-local settings (program start date) |
| `liftlog_rest_seconds` | `settings.ts` | Rest-timer default duration (pre-Rev-2 key, kept) |
| `liftlog_deleted_exercises` | `programStore.ts` | Deleted-exercise tombstones (synced app-wide; filtered on every library read) |
| `liftlog_deleted_sessions` | `sessionTombstones.ts` | Deleted-session tombstones (GUIDs; user-scoped, synced) |
| `liftlog_draft_session` | `draftSession.ts` | In-progress workout draft — written on every set change, cleared at Finish |
| `liftlog_plan` | `planStore.ts` | Training journey document (all plans + blocks + retrospectives; user-scoped, synced LWW) |
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
   user-scoped local data (IDB history, program, session tombstones, draft) **before** any
   sync so one account's data can never be shown to — or pushed into — another account.
   App-wide exercise data and device settings survive the switch (`liftlog_data_owner`).
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

**Per-user vs app-wide on the server (D1):** session docs, tombstones and the program are
per-user (`user_id`-keyed). The exercise library and its metadata are **app-wide** — global
`app_exercises` / `app_exercise_metadata` tables shared by every account (the per-user
`exercise_metadata` table and `user_programs.exercises_json` remain only as legacy pull
fallbacks). **Library and metadata sync are merge-based, never replace**: the worker upserts
per exercise on push (no `DELETE FROM app_exercises`) and the client merges on pull
(`mergeExerciseLibrary` — incoming wins per id, local-only entries survive), so a background
pull racing an unpushed library write, or a stale device's push, can no longer silently delete
a custom exercise — only tombstones delete. `ensureProgramExercisesInLibrary` (end of every
pull) rebuilds any library entry the program references but the library lost, and
`getExerciseName` humanizes orphaned timestamped ids (`jefferson-split-squats-1782…` →
"Jefferson Split Squats") as a last-resort display fallback. Exercise deletion writes a tombstone (`deleted_exercises` server table,
`liftlog_deleted_exercises` locally, synced both ways); tombstoned IDs are filtered from every
library read, sync push/pull, and the default-library rebuild, so a deleted exercise stays
deleted no matter which device or account pushes a stale copy.

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
strength leans on e1RM, hypertrophy/fat-loss on volume, and in a deficit merely *holding*
strength scores positive. Composite → `status`: `progressing` / `steady` / `stalled` /
`declining` (with `evidence[]` strings and `recentPRs[]` for the UI). Bodyweight work drops
the e1RM signal and its weight is redistributed. `progressDirections()` reduces the map to
up/down/stalled id sets for engines that only need direction. Fully covered by
`progress.test.ts`; **`getTrainingGoal()` (planStore) supplies the active goal** to every
caller.

## Progressive overload algorithm (`src/data/recommendations.ts`)

Runs when opening a new (non-edit) workout. WorkoutView loads one training snapshot and, for
each exercise, builds its recent history **across every day it appears in** (up to the last 3
sessions containing that exercise, newest first). `calculateRecommendation(history, exercise)`
implements **double progression** with stall detection, evaluated in order:

1. **Increase** — the last session had at least `exercise.sets` working sets and *every* one hit
   `repHigh`+ reps → add load. Increment = `max(5, round5(weight × 0.025))` (5 lbs normally,
   ~2.5% for heavy lifts like leg press).
2. **Deload** — 3+ consecutive sessions at the same working weight with no e1RM improvement
   (>1%) → drop ~10% and build back up.
3. **Decrease** — average working-set reps fell under `repLow` → ease back ~5%.
4. **Hold** (double progression) — reps are in range → keep the weight, chase reps until
   `sets × repHigh` earns the increase.

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
the weight engine (beat the range → +1 rep goal; stalled 3 sessions → reset to `repLow`; under
range → build back to `repLow`; in range → chase one more rep). If external load *was* logged
(e.g. weighted pull-ups with a belt), the normal weight engine applies. ExerciseCard shows
"↑ N reps" instead of a weight when `targetReps` is set.

Returns `{ weight, targetReps?, direction, kind, reason }` (`kind`: `increase`/`hold`/`decrease`/`deload`).
ExerciseCard pre-fills the weight input (only while untouched) and shows the reason as a
colour-coded chip, plus a "Last time" line with the previous session's sets. The engine is fully
covered by `recommendations.test.ts`.

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

`src/data/program.ts` defines the 4-day `PROGRAM` with just id, name, sets, repLow, repHigh per exercise. It no longer contains `RETIRED_EXERCISES` — those are now in `EXERCISES` in exercises.ts.

`src/data/programStore.ts` builds the exercise library from `EXERCISES` on first load, running a one-time migration to strip stale duplicate IDs (the old `-d1/-d2/-d4` suffixed IDs).

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
- **Program start date** is user-configurable in Settings (`settings.ts`, default `2026-06-09`).
  Changing it only affects the week numbering of *new* sessions — historical sessions keep the
  `weekNumber` they were stored with.
- **Settings are device-local** — `liftlog_settings` and `liftlog_rest_seconds` are not synced.
  (Exercise metadata *is* synced as of the metadata-sync change — see Cloud sync.)
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

### 4. Mesocycle awareness
The current deload is purely reactive (stall → deload). A planned accumulation/deload structure
would let the engine front-run fatigue: e.g., 3 weeks accumulation → 1 deload week, cycling
automatically. The configurable program start date (already in Settings) is the foundation —
extend it to support a `mesocycleLengthWeeks` setting and expose the current mesocycle phase
(accumulation / peak / deload) to the recommendation engine and Coach card.

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
