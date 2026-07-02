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
12. ⬜ Configurable `PROGRAM_START` / week-over-week weight trend metrics (partial)

---

## Stack

- **React + Vite + TypeScript** — `npm run dev` to start, `npm run build` to build
- **IndexedDB** — via a custom `idbReq<T>` promise wrapper in `src/db/database.ts` (no third-party library). Read and write in **separate transactions** to avoid IDB auto-commit bugs.
- **localStorage** — for program config, exercise library, exercise metadata, and migration flags. Managed in `src/data/programStore.ts` and `src/data/exercises.ts`.
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
  | { screen: 'metrics' };
```

`program: WorkoutDay[]` state lives in `App.tsx`, initialized from `getStoredProgram()` (localStorage). On day edits it's updated and saved back.

---

## File map

```
src/
  App.tsx                      — root state, navigation, auth check, startup migration + sync
  App.css                      — app shell, header safe area
  index.css                    — CSS custom properties, global reset

  data/
    program.ts                 — Exercise/WorkoutDay interfaces, PROGRAM (4 days),
                                  PROGRAM_START, getWeekNumber(), getWeekDateRange(),
                                  getExerciseName()
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
    recommendations.ts         — calculateRecommendation(sets, exercise) → WeightRec | null
                                  ({ weight, direction, reason }); per-exercise next-weight + why
    metrics.ts                 — computeMetrics() → Metrics (volume, e1RM series, muscle sets)
    insights.ts                — computeCoaching(program) → Coaching: fractional weekly set-volume
                                  per muscle vs 10–20 target, e1RM trend/plateau detection,
                                  prioritized insights + next-workout suggestion
    sync.ts                    — pushSync(), pullSync(), getLoggedInUser() — cloud sync via /api/sync

  db/
    database.ts                — all IndexedDB logic (3 stores: sessions, setLogs, exerciseLogs).
                                  Also: migrateExerciseIds() — remaps old -d1/-d2/-d4 exercise IDs.

  components/
    Dashboard.tsx/css          — Coach card (next day + top insight) + 4 day cards + icon nav row
    DayCard.tsx/css            — single day card with Edit button
    WorkoutView.tsx/css        — workout logging + edit-session mode + recommendations + rest timer
    ExerciseCard.tsx/css       — per-exercise card: recommendation chip, set logging, tap-to-edit
    RestTimer.tsx/css          — floating rest countdown; auto-(re)starts on each logged set
    HistoryView.tsx/css        — all past sessions in reverse chronological order
    DayEditView.tsx/css        — edit a day's muscle group label + add/remove exercises
    ExerciseListView.tsx/css   — alphabetical list of all exercises, taps into ExerciseMetaView
    ExerciseMetaView.tsx/css   — edit an exercise's muscle groups, equipment, weight type
    MetricsView.tsx/css        — metrics dashboard: volume summary, weekly chart, e1RM chart,
                                  muscle sets chart, unclassified exercises banner
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

Key exported functions: `createSession`, `completeSession`, `addSetLog`, `getCompletedSessionsForWeek`, `getAllCompletedSessions`, `getSetLogsForSession`, `getLastCompletedSessionForDay`, `deleteSetLogsForSession`, `migrateExerciseIds`, `dumpIDB`, `restoreIDB`.

---

## Cloud sync

On app mount, `App.tsx` runs this sequence (only when logged in):
1. `migrateExerciseIds()` — fast local IDB fix, must run **before** WorkoutView reads logs
2. `pullSync()` — pulls server data into IDB + localStorage (clears and replaces)
3. `migrateExerciseIds()` again — in case pull restored old IDs from the server
4. `pushSync()` — if pull found nothing or any IDs were remapped

Sync payload includes: sessions, setLogs, exerciseLogs, program, exercise library.
Exercise metadata (`liftlog_exercise_meta`) is **not** synced — it's device-local.

---

## Progressive overload algorithm (`src/data/recommendations.ts`)

Runs when opening a new (non-edit) workout. Looks up the last completed session for that day and scores it on three signals (each worth ±⅓ of ±8%):

| Signal | Positive (+⅓) | Neutral (0) | Negative (−⅓) |
|---|---|---|---|
| Avg reps vs range | Above `repHigh` | Within range | Below `repLow` |
| Weight trend | Last set > first set | Flat | Last set < first set |
| Set count | More than `exercise.sets` | Equal | Fewer |

`weight = round(avgLastWeight × (1 + score × 0.08), nearest 5 lbs)`

`calculateRecommendation` returns `{ weight, direction, reason }`. `direction` (`up`/`down`/`hold`)
compares `weight` to the rounded last weight; `reason` is a short human explanation derived from the
dominant signal (e.g. "Beat your rep range — time to add load"). ExerciseCard pre-fills the weight
input (via `useEffect`, only if still empty) and shows the reason as a colour-coded chip.

---

## Coaching engine (`src/data/insights.ts`)

`computeCoaching(program)` reads all completed sessions and produces:
- **Per-muscle weekly set volume** using *fractional* sets — a primary muscle counts as 1 hard set,
  each secondary muscle as 0.5 — scored against the 10–20 hard-set hypertrophy range
  (`low`/`optimal`/`high`). Muscle involvement resolves via override → master list → name match.
- **Strength trends** — best Epley e1RM per session per exercise; over the last 3 sessions a
  >±3% change is `up`/`down`, otherwise `flat` (a plateau).
- **Prioritized insights** — under-trained muscles, plateaus/declines, and a couple of "climbing"
  positives, capped at 6 and sorted by priority.
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
- **`PROGRAM_START`** is hardcoded as `2026-06-09` in `program.ts`. The user wants to make this configurable later.
- **`e.stopPropagation()`** is used on nested buttons (Edit, ×) inside tappable cards to prevent triggering parent onClick.
- **White screen with no terminal error** after adding new files = Vite HMR confusion. Fix: hard refresh (`Ctrl+Shift+R`) + restart dev server.
- **Exercise ID migration** — old builds used `-d1`/`-d2`/`-d4` suffixed IDs for exercises that appeared in multiple days. The remap lives in `src/data/legacyIds.ts` (`LEGACY_ID_MAP`/`canonicalizeId`). It is applied in **two** places that must stay in sync: `migrateExerciseIds()` in `database.ts` (set logs — run before any code that reads set logs by exercise ID) **and** `getStoredProgram()` in `programStore.ts` (the stored program on every read). Fixing only the set logs is not enough: if the stored program still holds a legacy ID, every new workout re-creates legacy-ID set logs, so both must be canonicalized.
