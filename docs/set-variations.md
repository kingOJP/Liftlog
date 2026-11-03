# Set variations: technique and grip

How a set was done, as opposed to which movement it was. Two optional, per-set fields
ride on every logged set, and may be prescribed on a program slot:

| Field | Values | What it is |
|---|---|---|
| `technique` | `paused` · `tempo` · `deficit` | a **rep style** — every rep of a numbered working set is done this way |
| | `drop` · `rest-pause` · `partials` | an **extension** — a continuation tacked onto the set before it |
| `grip` | `close` · `wide` · `neutral` · `underhand` · `overhand` · `mixed` | hand position |

Everything lives in `src/data/variations.ts` (vocabulary, labels, options, the muscle shift
table, volume credit) and `src/data/sessionHistory.ts` (the like-for-like history the
prescription engine reads). Both are pure.

## Why the two classes of technique are different things

A **rep style** changes what a rep is worth. A paused 225 × 5 is a harder set than a
touch-and-go 225 × 5, so the two cannot share a progression. Styles are compared like with
like everywhere:

- **Prescription** (`sessionHistory.exerciseHistory`): the engine sees only sessions done
  the way today's sets are expected to be done. The expectation is the slot's prescribed
  variation, or failing that whatever the last session was done with — which is also what
  the card pre-selects, so the row and the number agree. The first time a variation is
  logged there is nothing to compare against, so the plain sets are borrowed and the goal
  line says so ("expect fewer reps") instead of presenting the number as earned.
- **Progress** (`progress.ts`): each session point carries its dominant `style`; the trend
  is read over points matching the latest hard session's style, and PR bests are tracked
  per (exercise, style). Switching to paused restarts the trend rather than reading as a
  decline, and switching back is not a PR. The evidence line names the switch.

An **extension** is more set, not a new set. A drop set is the set before it carrying on
with the load reduced; a rest-pause burst is the same set after a breath; partials are what
is left after full reps run out. So:

- It is **not numbered** on the card ("↳ Drop", not "Set 4") and does not consume a
  prescribed set — the plan's next row is still Set 3 after a drop on Set 2.
- It counts **half a set** of weekly volume (`EXTENSION_SET_CREDIT`). Counting each drop
  as a whole set turns 3 sets + 3 drops into six hard sets and sends the coach trimming a
  program that was fine; counting it as nothing ignores real work. The drop-set literature
  counts a drop set as one set with several drops and finds hypertrophy per set-equivalent
  in the same range as straight sets, which is what the half expresses.
- It **never feeds e1RM**, strength maxes or the progression engine. A drop is performed on a
  muscle that has already failed; a heavy partial would "estimate" a 1RM the lifter has never
  moved through a full range. (`countsForStrength`; checked in `analytics.e1rmSeries`,
  `strength.bestLoggedMax`/`e1rmSeriesFor`, `progress.exercisePointSeries`, the history
  sheet's bests.)
- Tonnage still includes it on the Metrics volume chart — it is work that was done.

Paused and tempo sets **do** feed e1RM. They produce a lower estimate, which is the
conservative error.

## Muscle emphasis shifts

`adjustInvolvement(base, pattern, variation)` applies a compiled delta table keyed by
**movement pattern** (a grip changes a row the same way whichever row it is). Rules that
keep it a shift rather than a reclassification:

- The primary muscle is never touched — a close-grip bench is still a chest press.
- A secondary can climb to at most 0.75 ("nearly direct") or fall to 0 (dropped). Weight 1
  stays the unique marker of the prime mover, which the coach planner's `find(m => m.weight
  === 1)` and the unmapped-exercise check rely on.
- A muscle the base classification doesn't list can be added (deficit deadlift → quads).

The table, briefly: narrowing a press grip shifts load to the triceps and widening does the
reverse; a wide pronated pull takes the biceps out while a close, neutral or underhand pull
brings the biceps (and on rows, the lats) in; a hammer or reverse curl is a forearm
exercise; a double-overhand pull is grip-limited; a deficit pull starts from more knee
flexion with a longer lever on the lower back. Paused and tempo reps shift nothing — same
muscles, harder reps.

`analytics.musclesForSet(id, variation)` is the resolver; `muscleSetTotals` reads every
logged set through it (cached per exercise × variation) and multiplies by `setCredit`, so
the coach planner, Metrics, the heatmap and the retrospective all see the shift with no
further changes. The coach's slot-level reads go through `musclesForSlot(ex)` so a slot
prescribed as close-grip is credited to the triceps when it plans where a set should go.

## Which options appear where

`gripOptionsFor(pattern)` and `techniqueOptionsFor(pattern, unit)` keep the UI honest: grips
only where grip is a variable (presses, rows, pulls, curls, hinges, shrugs, pushdowns),
deficit only where standing on a block changes the lift (hinges, lunges, push-ups), and
nothing at all for timed holds. An exercise that offers nothing shows no control.

## Surfaces

- **ExerciseCard** — a sliders button beside Log set (shows the chosen tag once set) opens a
  two-row chip panel (Reps / Grip; extensions after a divider). The choice carries to every
  following numbered set. "＋ Drop set" (or "＋ Rest-pause" on unloaded work) is the one-tap
  path to an extension row. Logged rows carry a quiet tag; extension rows are labelled
  "↳ Drop" in the accent colour. The inline editor has the same control.
- **SlotDoseEditor** (day editor, quick workout) — pins a technique/grip on the slot;
  `prescriptionDetail` names it ("4 sets · 3–5 reps · paused · close grip").
- **History / ExerciseHistorySheet** — tags per set; the sheet summarises a session's style
  and extras ("paused · close grip", "+ warm-up, drop set").

## Wire and storage

`SetLog.technique` / `SetLog.grip` are schemaless IDB fields like `order` (no version bump),
omitted when absent so legacy documents are byte-identical. They travel on the session
document (`SessionDoc.sets`, D1 `sets_json`). The worker validates shape only (optional
string ≤ 24 chars) so a newer client's vocabulary is carried rather than refereed; the client
drops values it doesn't know on write. `Exercise.technique` / `Exercise.grip` ride the
program document. No migration anywhere.

## Not done, on purpose

- **Stance** (sumo, narrow, split) is a third dimension with the same shape as grip. Left
  out to keep the control to two rows; it slots in beside `grip` when wanted.
- **Clusters, AMRAP, failure** are effort or structure, not a way of doing a rep; see the
  effort discussion in CLAUDE.md's roadmap — the engine should not pretend to see effort.
- The planner and substitution engine don't yet choose between variations (e.g. propose a
  close-grip bench for a triceps gap). `musclesForSet` is the seam.
