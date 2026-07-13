# Exercise Ownership Architecture

This document describes the ownership model introduced for exercises and their
metadata, the reasoning behind it, where it deliberately diverges from the
product brief, and the roadmap for the parts designed here but not yet built.

## The problem being fixed

Before this change the server kept exercises in **app-wide mutable tables**
(`app_exercises`, `app_exercise_metadata`, `deleted_exercises`). Every user
read them and — worse — every user's sync push wrote them. Consequences:

- A custom exercise created by one user appeared in every account's library.
- Editing an exercise's muscle mapping changed heatmaps, volume targets and
  coaching for **everyone**.
- Deleting an exercise tombstoned it globally and permanently.

These are not bugs in the sync code; the sync merge rules were actually sound.
The missing concept was **ownership**: nothing in the data model said *whose*
an exercise or an edit was, so everything defaulted to "everyone's".

## The ownership model

Every piece of content in the system now has exactly one owner class:

| Owner class | Meaning | Who writes it | Examples |
|---|---|---|---|
| **Application-owned** | The shared knowledge base | Admins only, audited | built-in catalog, `global_exercises`, `global_exercise_metadata` |
| **User-owned** | One account's private data | That user, via sync | `user_exercises`, `exercise_metadata` rows, `user_deleted_exercises`, programs, sessions, plans |
| **Pending** | Submitted, awaiting curation | Created by user pushes, resolved by admins | `pending_exercises` |

This is deliberately a *convention applied per table* rather than a generic
`ownership` polymorphic table. The brief asked for an ownership abstraction
covering future entities (shared programs, community content, imports); a
generic `owned_entities` table with type/owner/visibility columns was
considered and rejected: D1 is relational SQLite, every entity here already
has a natural home table, and a polymorphic indirection would buy nothing
today while complicating every query. When shared programs arrive, they get
their own table with `owner_user_id` + `visibility` columns — the *pattern*
(owner column, per-owner tombstones, admin-audited global layer, pending
queue) is the reusable architecture, not a table. Future owner classes
(shared, imported, organization) are new values of that pattern, not new
infrastructure.

## The three exercise layers

### Layer 1 — Global Exercise Library (application-owned)

Two sources, one logical layer:

1. **The compiled-in catalog** (`src/data/exercises.ts`, ~68 `ExerciseDef`s).
   This *is* the global library's core. It ships in the client bundle, is
   versioned by git, reviewed in PRs, and available offline — which for a PWA
   is strictly better than fetching it. The brief's instinct to move
   everything server-side was resisted: a code-shipped catalog already has
   audit history (git), review workflow (PRs), and zero sync cost.
2. **`global_exercises` / `global_exercise_metadata`** (D1) — the admin-curated
   *delta* on top of the catalog: promotions from the pending queue and
   corrections that must reach users without a client deploy. Served to every
   user on pull; the client stores the metadata in `liftlog_global_meta`
   (read-only, replaced wholesale on every pull).

Metadata precedence everywhere: **catalog < global < user override**
(`getExerciseMeta`). Global improvements keep flowing to all users; a user's
personal override always wins for them — and only them.

Every write to the global layer goes through `/api/admin` and lands an
audit row in `global_exercise_audit`: what changed (`detail_json`
before/after), who (`changed_by`), when, why (`reason` is *required* — the
API rejects reason-less edits).

### Layer 2 — User overrides (user-owned)

- **`user_exercises`** — the user's library (custom exercises + their private
  sets/reps defaults for catalog exercises). Upserted per exercise on push,
  never delete-and-replace; same merge discipline the app-wide table used, now
  scoped by `user_id`.
- **`exercise_metadata`** — per-user metadata overrides. This table already
  existed with exactly the right shape from the pre-app-wide era; it is
  *reused* as the override layer, which means overrides written before the
  app-wide detour are already in the right place.
- **`user_deleted_exercises`** — per-user tombstones. Deleting an exercise now
  deletes it for you alone. (The legacy global `deleted_exercises` table is
  kept as a read-only seed: deletions made while deletion was app-wide still
  apply, because un-deleting them for everyone would resurrect data users
  intentionally removed.)
- Client-side, the account-switch wipe (`ensureLocalDataOwner`) now clears the
  library, overrides and tombstones too — they are user-owned, so they must
  not leak across accounts on a shared device.

The brief's Layer-2 examples (nicknames, notes, warm-up prefs, favorites) are
future columns/keys on this layer; the architecture point is that the layer
exists and syncs per-user.

### Layer 3 — Workout instances

Already correct: program slots (`liftlog_program` / `user_programs`) carry the
prescription (sets, rep range), and `session_docs` carry what actually
happened. No changes were needed — noted here so the three-layer model is
complete.

## Exercise lifecycle & AI discovery

Custom exercises are identifiable by construction: `generateExerciseId` stamps
`${slug}-${Date.now()}`, so a trailing 10+-digit timestamp marks user-created
content. On every push, the worker queues any such exercise into
`pending_exercises` (`INSERT OR IGNORE` — first submission wins) together with
the submitter's metadata snapshot. This gives the full pipeline from the brief
with zero extra client work:

```
create locally → (metadata from the user's own classification) → pending queue
→ admin review (GET /api/admin/pending) → approve → global_exercises (+audit)
                                        → reject  → status row (+audit)
```

Key property: **queueing never gates the user.** Their exercise works
immediately in their own library; approval only decides whether it becomes
part of everyone's Layer 1. Rejection doesn't delete anything from the
submitter — it just never goes global.

AI-generated exercises (future: LLM-backed planner proposals) enter through
the same door with `source: 'ai'`. The `metadata_json` blob is deliberately
schemaless so richer AI metadata (cues, progressions, mistakes, aliases) can
be attached before the review UI exists. Nothing — human or AI — can write
Layer 1 without an admin approval, enforced server-side.

Duplicate avoidance at scale (alias tables, token-similarity matching — the
substitution engine's name-token check is the seed for this) is designed to
live at *review time*, where an admin merges duplicates, not at creation time
where false positives would block users.

## Roles

`user_roles` in D1; absent row = `'user'`. Resolution is server-side
(`worker/roles.ts`); the pull response reports the role and the client caches
it in `liftlog_role` **as a UI hint only** — every privileged operation is
enforced by the worker (403 for non-admins on all `/api/admin` routes).

- **user** — everything the app does today; all writes land in Layer 2/3.
- **admin** — custodian of Layer 1 via `/api/admin` (pending review, global
  edits with mandatory reasons, audit reads). Assigned manually:
  `INSERT INTO user_roles (user_id, role) VALUES ('<google-sub>', 'admin');`
- **tester** — reserved (see below).

New roles are new rows/values, not schema work. Fine-grained permissions
(per-capability grants) were considered and skipped: with three roles and one
privileged surface, a capability matrix is speculative complexity.

## Testing role — designed, deliberately not built here

The brief asks for scenario-based synthetic athletes (Brand New User →
Advanced Lifter → Plateaued → Injury Recovery …) with believable history.
Design decisions, recorded for the implementation pass:

1. **Isolation = never sync.** A `tester` session should seed data into
   IndexedDB/localStorage and **skip push entirely** (the role is the flag the
   client checks). That is a stronger guarantee than a parallel "testing
   database": production D1 never sees a synthetic row, no dual-DB plumbing,
   and wiping a scenario is the existing account-switch wipe.
2. **Deterministic generators beat AI-generated data.** Scenarios should be
   pure functions `(profile, weeks, seed) → sessions[]` built on the app's own
   domain math (double progression, deload responses, order effects, adherence
   noise from a seeded PRNG). Believability comes from replaying the app's
   *own* progression rules with realistic noise; determinism makes coaching
   regressions reproducible. An LLM can *author* profile parameters, but the
   generator must be code.
3. The generator doubles as a test fixture: `progress.ts`/`coach.ts` tests can
   consume the same scenario builders, which is where most of its long-term
   value lives.

This is the next milestone-sized unit of work; bundling it into this change
would have made both halves worse.

## Migration strategy

No data is rewritten in place; migration is **lazy adoption**, the same
pattern already proven by the legacy-sessions and legacy-metadata fallbacks:

1. Deploy migration `0005_ownership.sql` (purely additive, `IF NOT EXISTS`,
   safe to re-run). The app-wide tables stop being written but remain.
2. On pull, a user with no per-user rows is served the app-wide tables
   (library and metadata) — i.e. they adopt the current shared state, which
   for existing users *is* their state.
3. Their next push (which App.tsx runs right after pull on every startup)
   snapshots that data into `user_exercises` / `exercise_metadata` rows. From
   then on the fallback is inert for them.
4. Legacy global tombstones remain honored for everyone (read-only union), so
   nothing deleted pre-ownership resurrects.

Existing workout history, programs and plans are untouched. The known,
accepted cost: users adopt the *union* library the app-wide era created
(including other users' custom exercises that leaked in). An admin can retire
those globally-leaked strays, or users delete them — now safely, affecting
only themselves.

## Future extensibility

How the named future features land on this foundation:

- **Coach-authored programs / shared plans / community templates** — a table
  with `owner_user_id`, `visibility ('private'|'link'|'public')`, and the same
  pending/approval pattern for public listing.
- **QR imports** — imported content is written into Layer 2 with a
  `source`/provenance field; unknown exercises inside it flow through the
  existing pending queue.
- **Organization/team libraries** — an owner class between user and global: a
  `library_id` scope column on the Layer-2 tables.
- **Exercise ratings / community validation** — per-user rows aggregated into
  the review UI as promotion evidence.
- **Richer global metadata** (aliases, cues, force type, uni/bilateral,
  assets) — columns/JSON on `global_exercise_metadata` + `ExerciseDef`; the
  precedence chain and audit trail already handle them.

## What changed where (code map)

- `worker/migrations/0005_ownership.sql`, `worker/schema.sql` — new tables.
- `worker/sync.ts` — pull/push rescoped to per-user tables with adoption
  fallbacks; global layer merged into pull; pending queue fed on push; pull
  reports `role` and `globalExerciseMetadata`.
- `worker/roles.ts`, `worker/admin.ts`, `worker/index.ts` — roles + admin API.
- `src/data/exercises.ts` — `liftlog_global_meta` layer, catalog < global <
  user precedence, `clearExerciseMeta`.
- `src/data/programStore.ts` — `clearExerciseLibraryData`.
- `src/data/sync.ts` — global-meta/role pull handling; account-switch wipe now
  includes user-owned exercise data.

Wire compatibility: the push payload is unchanged and old clients ignore the
two new pull fields, so stale cached PWAs keep syncing correctly — they simply
get correctly-scoped data.
