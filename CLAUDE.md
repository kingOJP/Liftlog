# LiftLog — Claude Context

## Project goal

LiftLog is a Progressive Web App for tracking a 4-day bodybuilding split, installable on iPhone via "Add to Home Screen." The user is a first-time web app developer. The app lives at this repo and auto-deploys to Cloudflare Pages on push to `main`.

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

**Future milestones:**
- Delta-based sync — the current full-replace, last-writer-wins sync is the biggest remaining architectural risk (two devices logging on the same day can drop a session; pendingSessions only patches one case). A per-session upsert protocol with tombstones is the fix.
- RPE/RIR logging — one optional field per set would let the engine distinguish "grinding at RPE 10" from "easy reps," making deload detection much sharper.
- In-workout session persistence — sets live only in React state until "Finish Workout"; an accidental app kill loses the session. Draft-session storage in IDB would fix it.
- Mesocycle awareness — planned accumulation/deload weeks rather than reactive-only deloads; the configurable start date is the foundation.
- Unit preference (kg/lb), exercise substitution suggestions from the equipment/workout-type taxonomy (the metadata already exists to power this), and worker-side tests with vitest-pool-workers.
- Exercise swap suggestions — add a button on exercises in the workout edit screen to suggest a different exercise that hits the same primary muscle group and doesn't repeat any others in the workout.
- Planner v2 — RPE-aware volume decisions, automatic exercise substitution (the planner
  currently only *suggests* adding an exercise when no slot fits), and per-exercise rep-range
  adjustments in addition to set counts.

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
  | { screen: 'settings' };
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
    exercises.ts               — Single source of truth for all 28 exercises (ExerciseDef),
                                  EXERCISES array, EXERCISE_MAP, getExerciseMeta(),
                                  saveExerciseMeta() — metadata overrides in localStorage
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
    recommendations.ts         — calculateRecommendation(history, exercise) → WeightRec | null
                                  ({ weight, direction, kind, reason }); double progression +
                                  stall-triggered deload (see algorithm section below)
    coach.ts                   — adaptive programming engine: computeProgramPlan(program, snapshot)
                                  → ProgramPlan (conservative set additions/trims across future
                                  workouts, each with a plain-language reason) + applyPlanToDay()
                                  overlay. Pure function of history — never mutates the program.
    heatmap.ts                 — muscle heatmap data: computeMuscleHeat() over a time window,
                                  heatColor()/heatLabel() (blue→green→yellow→red weekly-rate
                                  gradient), presetWindow()/mesocycleWindow()
    metrics.ts                 — computeMetrics(snapshot) → Metrics (volume, e1RM series, muscle sets)
    insights.ts                — computeCoaching(program, snapshot) → Coaching: 3 positive
                                  highlights + 3 highest-impact opportunities, e1RM trend/plateau
                                  detection, weekly muscle volume, next-workout suggestion, and
                                  the coach plan (embeds computeProgramPlan)
    sync.ts                    — pushSync(), pullSync(), getLoggedInUser() — cloud sync via /api/sync
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
    DayEditView.tsx/css        — edit a day's muscle group label + add/remove exercises
    ExerciseListView.tsx/css   — alphabetical list of all exercises, taps into ExerciseMetaView
    ExerciseMetaView.tsx/css   — edit an exercise's muscle groups, equipment, weight type
    MetricsView.tsx/css        — metrics dashboard: Coach section (highlights, opportunities,
                                  program adjustments), muscle heatmap, volume summary, weekly
                                  chart, e1RM chart, muscle sets chart, unclassified banner
    MuscleHeatmap.tsx/css      — front/back SVG body silhouettes colored by weekly training
                                  volume per muscle; 7d/30d/mesocycle/custom timeframe presets
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
| `liftlog_pending_sessions` | `pendingSessions.ts` | Sessions saved locally but not yet confirmed by the server |
| `liftlog_deleted_exercises` | `programStore.ts` | Deleted-exercise tombstones (synced app-wide; filtered on every library read) |
| `liftlog_data_owner` | `sync.ts` | Email of the account the local data belongs to — a mismatch at startup wipes user-scoped local data |
| `liftlog_library_v2` | `programStore.ts` | Migration flag — deduplication pass 1 |
| `liftlog_library_v3` | `programStore.ts` | Migration flag — deduplication pass 2 (current) |

---

## IndexedDB schema (version 3)

**`sessions`** — index: `weekNumber`
- `id` (autoincrement), `dayId`, `weekNumber`, `startedAt`, `completedAt?`

**`setLogs`** — index: `sessionId`
- `id`, `sessionId`, `exerciseId`, `setNumber`, `weight`, `reps`

**`exerciseLogs`** — index: `sessionId` (difficulty ratings — feature removed, store kept for compatibility)
- `id`, `sessionId`, `exerciseId`, `difficulty`

v2 added `exerciseMuscles` + `exerciseDetails` stores; v3 deleted them (metadata moved to localStorage).

Key exported functions: `createSession`, `completeSession`, `addSetLog`, `getSession`, `updateSessionDate`, `getCompletedSessionsForWeek`, `getSetLogsForSession`, `deleteSetLogsForSession`, `deleteSetLogsByExerciseId`, `hasSetLogsForExercise`, `migrateExerciseIds`, `purgeEmptySessions`, `dumpIDB`, `restoreIDB`.

Anything that *analyzes* history (dashboard, metrics, coaching, recommendations, history list) goes through `loadTrainingSnapshot()` in `data/analytics.ts` — one `dumpIDB()` read per screen, never per-session queries.

---

## Cloud sync

On app mount, `App.tsx` runs this sequence (only when logged in):
1. `ensureLocalDataOwner()` — if a *different* account signed in on this device, wipe
   user-scoped local data (IDB history, program, pending sessions) **before** any sync so one
   account's data can never be shown to — or pushed into — another account. App-wide exercise
   data and device settings survive the switch. Owner is tracked in `liftlog_data_owner`.
2. `migrateExerciseIds()` — fast local IDB fix, must run **before** WorkoutView reads logs
3. `pullSync()` — pulls server data into IDB + localStorage (clears and replaces)
4. `migrateExerciseIds()` again — in case pull restored old IDs from the server
5. `pushSync()` — if pull found nothing or any IDs were remapped

Sync payload includes: sessions, setLogs, exerciseLogs, program, exercise library, exercise
metadata (muscle/equipment/weight-type overrides), **and deleted-exercise tombstones**. On
pull, metadata is *merged* into local (server wins per exercise; unsynced local edits survive)
so the info you enter for new exercises persists across devices and re-pulls.
`pushSync()`/`pullSync()` also run `purgeEmptySessions()` so ghost/empty workouts can't
resurrect through sync.

**Per-user vs app-wide on the server (D1):** sessions/set logs/program are per-user
(`user_id`-keyed tables). The exercise library and its metadata are **app-wide** — global
`app_exercises` / `app_exercise_metadata` tables shared by every account (the per-user
`exercise_metadata` table and `user_programs.exercises_json` remain only as legacy pull
fallbacks). Exercise deletion writes a tombstone (`deleted_exercises` server table,
`liftlog_deleted_exercises` locally, synced both ways); tombstoned IDs are filtered from every
library read, sync push/pull, and the default-library rebuild, so a deleted exercise stays
deleted no matter which device or account pushes a stale copy.

---

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

`computeCoaching(program, snapshot)` embeds the plan and produces:
- **Highlights (≤3)** — fresh PRs (all-time best e1RM within 10 days), climbing lifts,
  week-over-week volume gains, consistency streaks.
- **Opportunities (≤3)** — strength declines (recovery-oriented advice), plateaus (pre-frames
  the engine's deload), muscles past the volume ceiling, planner `program-gap` suggestions.
- **Strength trends** — best Epley e1RM per session per exercise; over the last 3 sessions a
  >±3% change is `up`/`down`, otherwise `flat` (a plateau).
- **Per-muscle weekly set volume** (`muscleVolume`) and **next workout** (day longest untrained).

Surfaced on the Dashboard (Coach card: next day + top opportunity/highlight + "coach adjusted"
note) and Metrics (Coach section: What's working / Biggest opportunities / Program adjustments).
`SETS_TARGET_LOW`/`SETS_TARGET_HIGH` live in `analytics.ts` (re-exported from insights.ts).

### Muscle heatmap (`heatmap.ts` + `MuscleHeatmap.tsx`)

Front/back SVG silhouettes with one region per `MuscleGroup`, colored by weekly-rate volume:
blue (untrained) → green (10–20 target) → yellow (elevated) → red (very high). Muscle mapping
reuses `musclesForExercise()` — no duplicate mapping. Presets: 7 days / 30 days / current
mesocycle (4-week blocks anchored to the program start date) / custom range. Tap a region for
sets + weekly rate + status.

---

## Exercise data architecture

`src/data/exercises.ts` is the single source of truth for the 28 built-in exercises:
- `EXERCISES: ExerciseDef[]` — id, name, primaryMuscle, secondaryMuscles, workoutType, equipment, weightType
- `EXERCISE_MAP: Map<string, ExerciseDef>` — fast lookup by id
- `getExerciseMeta(id)` — returns metadata, preferring user overrides from `liftlog_exercise_meta` over defaults
- `saveExerciseMeta(id, meta)` — writes user override to `liftlog_exercise_meta`

`src/data/program.ts` defines the 4-day `PROGRAM` with just id, name, sets, repLow, repHigh per exercise. It no longer contains `RETIRED_EXERCISES` — those are now in `EXERCISES` in exercises.ts.

`src/data/programStore.ts` builds the exercise library from `EXERCISES` on first load, running a one-time migration to strip stale duplicate IDs (the old `-d1/-d2/-d4` suffixed IDs).

---

## Decisions & things to keep in mind

- **DB writes only at "Finish Workout"** — sets are pure React state until save. This makes inline editing/deletion free (no DB rollback needed).
- **Edit session flow** — "Edit Session" in history opens WorkoutView with `existingSessionId`. On save it deletes all old set logs for that session and re-writes them.
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

### 1. Delta-based sync
**The biggest remaining architectural risk.** The current sync is full-replace, last-writer-wins:
`pushSync()` sends the entire IDB and `pullSync()` wipes local IDB and restores from server.
On two concurrent devices (phone + desktop) this silently drops whichever device synced last.

Fix: move to per-session upsert with tombstones. Each `session` row gets a `deletedAt` timestamp
instead of being physically deleted. The worker merges by `startedAt` (the natural dedup key) and
returns only rows newer than the client's `lastSyncAt`. This also eliminates the `pendingSessions`
localStorage workaround entirely.

### 2. RPE / RIR logging
The deload trigger today fires purely on e1RM stagnation across 3 sessions, which can't
distinguish "I was grinding at RPE 10" from "these were easy reps." One optional `rpe` field per
set (scale 1–10, blank = untracked) lets the engine confirm fatigue before recommending a deload
and detect under-effort when reps stay in range but RPE is low.

Implementation: add `rpe INTEGER` to `setLogs` IDB store (schema v4), show a small tap-to-set
chip next to each logged set row, update `calculateRecommendation` to factor in average RPE.
No UI change is needed if the field is left blank — fully backwards-compatible.

### 3. In-workout session persistence (draft sessions)
Sets live only in React state from "Start Workout" until "Finish Workout." An accidental app kill
or Safari tab eviction silently loses the whole session.

Fix: write a draft session to IDB as sets are logged (not just at finish), keyed to a
`draftSessionId` in localStorage. On app mount, detect a stale draft and offer to resume or
discard. At "Finish Workout," promote the draft to a completed session atomically. This is the
single biggest UX risk for anyone doing long sessions with spotty connectivity.

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
