# LiftLog

A data-driven strength coach in your pocket — a Progressive Web App that plans your training,
adapts it to what you actually lift, and coaches you toward long-term goals. Tell it your goal
and constraints and it designs a training plan with you; log your workouts and it reads the data
to recommend what to lift next, redistributes your weekly volume, watches for plateaus, and
schedules deloads. Installable on iPhone via "Add to Home Screen," offline-first, and synced to
your account.

LiftLog is built around one idea: **every recommendation is explained and grounded in your own
history.** The engines are pure functions of (your program, your logged workouts), so the coach
re-derives its advice on every device, and nothing is a black box — each set added, weight
suggested, or exercise swapped comes with a plain-English reason.

## What it does

- **Training journey** — the planning layer above individual workouts. A collaborative wizard
  turns your goal, schedule, equipment, injuries and experience into a proposed **training block**
  (a multi-week mesocycle with weekly phases: accumulation → intensification → peak → deload).
  You review every workout — with reasons — before it starts. Blocks stack into a journey; each
  one ends with a retrospective that feeds the next planning cycle.
- **Adaptive coaching** — a set-volume planner redistributes work across your future workouts to
  keep each muscle in the 10–20 weekly hard-set range, respecting recovery and your average
  workout duration. It never edits your program directly — it's a transparent overlay you see
  explained when you open a day.
- **Smart recommendations** — a double-progression engine suggests the next working weight (or
  reps, for bodyweight work) per exercise, with a reason ("all sets hit 12+ reps — add load"),
  and detects multi-session stalls to prescribe a deload. It's order-aware: a lift you trained
  late in a workout isn't unfairly marked down.
- **Progress engine** — a single, multi-signal read on "is this lift progressing?" that blends
  estimated-1RM trend, volume-load trend, and weight/rep PRs, weighted for your current goal.
  Powers the insights, recommendations, retrospectives, and the Progress report.
- **Exercise intelligence** — "Find replacement" ranks and explains substitutions that preserve a
  slot's programming, from a curated catalog of ~68 exercises, personalized to your history,
  equipment and volume balance.
- **Athlete-aware planning** — a training profile (injuries, equipment access, experience level,
  priority muscles) steers exercise selection: beginners get low-skill, higher-rep work and
  gentler volume; advanced lifts are skill-gated behind their prerequisites. Experience is also
  inferred from your data and only ratchets up.
- **Workout logging** — per-exercise set logging with inline editing, warm-up tagging (logged and
  visible, but never counted in metrics), a rest timer that auto-starts on every working set, an
  in-progress draft that survives an app kill, and offline-first IndexedDB persistence. New here
  and don't want a plan yet? Log a **quick one-off workout** without starting a block.
- **Metrics** — a tabbed coach panel (narrative insights, per-exercise progress report, recent
  PRs), a front/back muscle heatmap, weekly volume, estimated-1RM and volume-load trend charts,
  and sets-per-muscle breakdowns — all hand-rolled CSS/SVG, no charting library.
- **History** — every past session, expandable and editable (including re-dating).
- **Sharing** — hand a workout to a friend via a QR code; their own recommendation engine fills
  in weights from their history, so the workout fits their level automatically.
- **Cloud sync** — Google OAuth + a Cloudflare Worker/D1 backend keep every device in sync.
  Workouts merge per-session by immutable GUID (no lost data across devices); the training
  journey, program, exercise library and metadata sync too.

## Stack

React 19 + Vite + TypeScript on the front end; IndexedDB (a custom promise wrapper, no ORM) and
localStorage for local state; a Cloudflare Worker with D1 for auth and sync; plain CSS with
dark-theme custom properties. No router, no state library, no chart library. Vitest + jsdom cover
the pure data layer.

## Development

```bash
npm install
npm run dev        # start the Vite dev server
npm test           # run the Vitest unit suite
npm run lint       # ESLint
npm run build      # typecheck + production build (PWA)
```

The worker (auth + sync API) lives in `worker/` and is configured via `wrangler.jsonc`;
`worker/schema.sql` (and `worker/migrations/`) define the D1 schema. Deploys to Cloudflare Pages
happen automatically from the `main` branch.

## Architecture notes

`CLAUDE.md` is the living architecture document: file map, data model, localStorage keys, sync
protocol, and the recommendation/coaching/planning algorithms in detail. Start there.

Key layering:

- `src/db/database.ts` — the only file that touches IndexedDB.
- `src/data/analytics.ts` — loads a single "training snapshot" per screen and owns the shared math
  (e1RM, muscle resolution, working-vs-warm-up split). Everything analytical builds on it, so a
  warm-up set can never skew a metric.
- `src/data/progress.ts` / `recommendations.ts` / `coach.ts` / `insights.ts` / `planner.ts` /
  `substitution.ts` — pure functions over the snapshot; unit-tested in `src/data/*.test.ts`.
- `src/data/plan.ts` / `planStore.ts` / `retrospective.ts` — the training-journey domain (plans,
  blocks, phases, athlete profile) and its persistence/sync.
- `src/components/` — one folder of view components; navigation is a discriminated union in
  `App.tsx` (no router).
