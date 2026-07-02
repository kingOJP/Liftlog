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

**Future milestones:**
- Delta-based sync — the current full-replace, last-writer-wins sync is the biggest remaining architectural risk (two devices logging on the same day can drop a session; pendingSessions only patches one case). A per-session upsert protocol with tombstones is the fix.
- RPE/RIR logging — one optional field per set would let the engine distinguish "grinding at RPE 10" from "easy reps," making deload detection much sharper.
- In-workout session persistence — sets live only in React state until "Finish Workout"; an accidental app kill loses the session. Draft-session storage in IDB would fix it.
- Mesocycle awareness — planned accumulation/deload weeks rather than reactive-only deloads; the configurable start date is the foundation.
- Unit preference (kg/lb), exercise substitution suggestions from the equipment/workout-type taxonomy (the metadata already exists to power this), and worker-side tests with vitest-pool-workers.
- Exercise swap suggestions — add a button on exercises in the workout edit screen to suggest a different exercise that hits the same primary muscle group and doesn't repeat any others in the workout.
- Human model graph — interactive human body that shows a heatmap of the muscle groups worked in a time frame, with buttons/interactions to change the scale/window.

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
                                  (override → master list → name match)
    recommendations.ts         — calculateRecommendation(history, exercise) → WeightRec | null
                                  ({ weight, direction, kind, reason }); double progression +
                                  stall-triggered deload (see algorithm section below)
    metrics.ts                 — computeMetrics(snapshot) → Metrics (volume, e1RM series, muscle sets)
    insights.ts                — computeCoaching(program, snapshot) → Coaching: fractional weekly
                                  set-volume per muscle vs 10–20 target, e1RM trend/plateau
                                  detection, prioritized insights + next-workout suggestion
    sync.ts                    — pushSync(), pullSync(), getLoggedInUser() — cloud sync via /api/sync
    *.test.ts                  — Vitest unit tests for the data layer

  db/
    database.ts                — all IndexedDB logic (3 stores: sessions, setLogs, exerciseLogs).
                                  Also: migrateExerciseIds() — remaps old -d1/-d2/-d4 exercise IDs.

  components/
    Dashboard.tsx/css          — Coach card (next day + top insight) + 4 day cards + icon nav row
    DayCard.tsx/css            — single day card with Edit button
    WorkoutView.tsx/css        — workout logging + edit-session mode + recommendations + rest timer
    ExerciseCard.tsx/css       — per-exercise card: recommendation chip, "last time" line,
                                  set logging, tap-to-edit
    RestTimer.tsx/css          — floating rest countdown; auto-(re)starts on each logged set
    HistoryView.tsx/css        — all past sessions in reverse chronological order
    DayEditView.tsx/css        — edit a day's muscle group label + add/remove exercises
    ExerciseListView.tsx/css   — alphabetical list of all exercises, taps into ExerciseMetaView
    ExerciseMetaView.tsx/css   — edit an exercise's muscle groups, equipment, weight type
    MetricsView.tsx/css        — metrics dashboard: volume summary, weekly chart, e1RM chart,
                                  muscle sets chart, unclassified exercises banner
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
1. `migrateExerciseIds()` — fast local IDB fix, must run **before** WorkoutView reads logs
2. `pullSync()` — pulls server data into IDB + localStorage (clears and replaces)
3. `migrateExerciseIds()` again — in case pull restored old IDs from the server
4. `pushSync()` — if pull found nothing or any IDs were remapped

Sync payload includes: sessions, setLogs, exerciseLogs, program, exercise library, **and
exercise metadata** (muscle/equipment/weight-type overrides). On pull, metadata is *merged*
into local (server wins per exercise; unsynced local edits survive) so the info you enter for
new exercises persists across devices and re-pulls. `pushSync()`/`pullSync()` also run
`purgeEmptySessions()` so ghost/empty workouts can't resurrect through sync.

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

Returns `{ weight, direction, kind, reason }` (`kind`: `increase`/`hold`/`decrease`/`deload`).
ExerciseCard pre-fills the weight input (only while untouched) and shows the reason as a
colour-coded chip, plus a "Last time" line with the previous session's sets. The engine is fully
covered by `recommendations.test.ts`.

---

## Coaching engine (`src/data/insights.ts`)

`computeCoaching(program, snapshot)` takes a `TrainingSnapshot` (from `analytics.ts`) and produces:
- **Per-muscle weekly set volume** using *fractional* sets — a primary muscle counts as 1 hard set,
  each secondary muscle as 0.5 — scored against the 10–20 hard-set hypertrophy range
  (`low`/`optimal`/`high`). Muscle involvement resolves via override → master list → name match.
- **Strength trends** — best Epley e1RM per session per exercise; over the last 3 sessions a
  >±3% change is `up`/`down`, otherwise `flat` (a plateau).
- **Prioritized insights** — under-trained muscles, plateaus/declines, and a couple of "climbing"
  positives, capped at 6 and sorted by priority. Under-trained-muscle nudges are limited to
  muscles *not* worked in the last 2 sessions and capped at 4, so the Coach stays focused
  instead of listing every muscle below target.
- **Next workout** — the program day longest since last trained.

Surfaced on the Dashboard (Coach card: next day + top insight) and Metrics (full Coach section).
`SETS_TARGET_LOW`/`SETS_TARGET_HIGH` are exported and shared with MetricsView.

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
- **`e.stopPropagation()`** is used on nested buttons (Edit, ×) inside tappable cards to prevent triggering parent onClick.
- **White screen with no terminal error** after adding new files = Vite HMR confusion. Fix: hard refresh (`Ctrl+Shift+R`) + restart dev server.
- **Exercise ID migration** — old builds used `-d1`/`-d2`/`-d4` suffixed IDs for exercises that appeared in multiple days. The remap lives in `src/data/legacyIds.ts` (`LEGACY_ID_MAP`/`canonicalizeId`). It is applied in **two** places that must stay in sync: `migrateExerciseIds()` in `database.ts` (set logs — run before any code that reads set logs by exercise ID) **and** `getStoredProgram()` in `programStore.ts` (the stored program on every read). Fixing only the set logs is not enough: if the stored program still holds a legacy ID, every new workout re-creates legacy-ID set logs, so both must be canonicalized.
