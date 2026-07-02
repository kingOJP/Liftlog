# LiftLog

A Progressive Web App for tracking a 4-day bodybuilding split — installable on iPhone via
"Add to Home Screen." LiftLog isn't just a logbook: it uses your workout history and
evidence-based hypertrophy principles (double progression, weekly set-volume targets,
plateau detection and deloads) to recommend what to lift next.

## Features

- **Workout logging** — per-exercise set logging with inline editing, a rest timer that
  auto-starts on every set, and offline-first IndexedDB persistence.
- **Smart recommendations** — double-progression engine suggests the next working weight
  per exercise, with a plain-English reason ("All 3 sets hit 12+ reps — add load"), and
  detects multi-session stalls to prescribe a deload.
- **Coaching** — weekly fractional set-volume per muscle scored against the 10–20 hard-set
  hypertrophy range, e1RM trend/plateau detection, and a prioritized insight feed on the
  dashboard and metrics screens.
- **Metrics** — weekly volume, estimated 1RM (Epley) progress charts, and sets-per-muscle
  breakdowns, all with hand-rolled CSS/SVG charts.
- **History** — every past session, expandable and editable (including re-dating).
- **Program editing** — customize each day's exercises, targets, and order; per-exercise
  muscle/equipment metadata.
- **Cloud sync** — Google OAuth + a Cloudflare Worker/D1 backend keep devices in sync.

## Stack

React 19 + Vite + TypeScript on the front end; IndexedDB (custom promise wrapper, no ORM)
and localStorage for local state; a Cloudflare Worker with D1 for auth and sync; plain CSS
with dark-theme custom properties. No router, no state library, no chart library.

## Development

```bash
npm install
npm run dev        # start the Vite dev server
npm test           # run the Vitest unit suite
npm run lint       # ESLint
npm run build      # typecheck + production build (PWA)
```

The worker (auth + sync API) lives in `worker/` and is configured via `wrangler.jsonc`;
`worker/schema.sql` defines the D1 schema. Deploys happen automatically from `main`.

## Architecture notes

`CLAUDE.md` is the living architecture document: file map, data model, localStorage keys,
sync sequence, and the recommendation/coaching algorithms. Start there.

Key layering:

- `src/db/database.ts` — the only file that touches IndexedDB.
- `src/data/analytics.ts` — loads a single "training snapshot" per screen and owns the
  shared math (e1RM, muscle resolution). Everything analytical builds on it.
- `src/data/recommendations.ts` / `insights.ts` / `metrics.ts` — pure functions over the
  snapshot; unit-tested in `src/data/*.test.ts`.
- `src/components/` — one folder of view components; navigation is a discriminated union
  in `App.tsx`.
