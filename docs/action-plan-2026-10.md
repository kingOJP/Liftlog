# LiftLog — Remediation Action Plan (October 2026 audits)

_Status: AGREED 2026-10-05 (all eight open decisions resolved — see §11). Inputs:
`docs/audit-2026-10.md` (engineering: C1–C2, H1–H8, M1–M18, LOW) and
`docs/functional-audit-2026-10.md` (functional: F1–F17). Baseline commit `8b5b1e3` (main)._

Every finding in both audits maps to exactly one work item below; the coverage matrix at the end
is the checklist. Items marked **[D#]** reference a decision recorded in §11.

---

## 1. How the phases were cut

The two audits recommend different first moves (engineering: C2 data loss; functional: F1
phase-blind progress). Both are right, and they don't conflict — they touch different files. The
phases below are ordered by **what a user loses if it isn't fixed**, and grouped so that each phase
leaves the codebase in a state the next one can build on:

| # | Phase | Why this position | Exit criterion |
|---|---|---|---|
| 0 | Guardrails | Nothing after this may regress silently. Cheap. | CI green on PRs, lint clean, regression harnesses in place |
| 1 | Stop losing workouts | Irreversible data loss (C2, H1) beats every other finding | No write path can leave a session empty; drafts survive navigation |
| 2 | Engines tell the truth | The prescription/progress engines currently mis-coach every bodyweight user and every planned-block user | Bodyweight sim climbs; easy weeks never read as declines |
| 3 | The journey learns the right lessons | Builds on Phase 2's phase-aware progress; fixes planning + retrospective + wizard | Block 2 is a sane continuation of block 1 for all five profiles |
| 4 | Programming for yourself | Opens the app to the two profiles it currently fights | A quick-workout user is never dosed from a goal they didn't pick; days/sets/reps are editable |
| 5 | Sync and server integrity | Needs the sync mutex from Phase 1; introduces D1 migrations | Edits are never silently reverted; worker leaks nothing |
| 6 | Teach me how to do it | Content-heavy, mostly parallelizable | Every catalog exercise has cues reachable from the card |
| 7 | Strength and advanced lifters | Depends on Phase 2's stall tolerance and Phase 4's slot editing | Advanced strength sim ends a block above where it started |
| 8 | Polish, visibility, docs | Everything remaining; final CLAUDE.md reconciliation | Coverage matrix fully ticked |

**Parallel tracks.** Phase 6 (content) and the worker side of Phase 5 can run alongside Phases 2–4
because they touch disjoint files. Everything else is sequential by dependency.

**Working agreements for every item**
- One PR per numbered item (split further if a diff passes ~600 lines). Branch names
  `claude/<phase>-<item>-<slug>`.
- Each PR carries its own tests; the "test coverage gaps" section of the engineering audit lists
  the specific missing tests and each item below names which ones it closes.
- Each PR updates the relevant CLAUDE.md section in the same diff (the audit found five places
  where the doc already drifted; don't add a sixth).
- No PR widens scope: an item that discovers a neighbouring bug files it under Phase 8 unless it
  blocks the item.

---

## 2. Phase 0 — Guardrails

**0.1 Lint clean.** Fix the two `react-hooks/purity` errors (`DayEditView.tsx:49`,
`PlanSetupView.tsx:312`): hoist `now` into state captured at mount. Closes **M3** (lint half).
Also removes the double substitution ranking per render the audit measured.

**0.2 CI.** `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run lint &&
npm test` on pull requests and on pushes to `main`. Deploy gating per **[D6]**: the PR adds a
`check` script (`npm run lint && npm test && npm run build`) and documents that the Cloudflare
Pages build command must be switched to `npm run check` — **that switch is a manual step for
you in the Pages dashboard**, as is (optionally) requiring the Actions check under branch
protection for `main`. Bump the 10 dev-dependency vulnerabilities while touching the lockfile.
Closes **M3** (CI half) and the "dev-dependency vulnerabilities" LOW.

**0.3 Regression harnesses.** The session scratchpads that held the audit tooling are gone, so
rebuild three things as permanent tests:
- `src/data/profileSimulation.test.ts` — the functional audit's five-profile, 13-week harness
  (synthetic athlete with capacity growth, noise, fatigue, skips) that onboards through the real
  planner, trains against the real `buildSetPlan`/`computeProgramPlan`, wraps blocks and replans.
  Initially it asserts only what passes today; Phases 2–4 and 7 tighten its assertions as they
  land (loads trail capacity by < X%, no replacement storm, no "declining" after an easy week).
- A bodyweight/timed twin of the 12-week "whole loop" test in `recommendations.test.ts` (fails
  today — it is the reproduction for C1; mark `it.fails` until Phase 2.2 lands).
- `src/data/catalog.test.ts` — the catalog invariants the audit checked by script (ids unique,
  names unique, muscles valid, prerequisites resolve, head tags valid, option arrays sorted).

Closes the "ready-made `catalog.test.ts`" gap; sets up the nets for everything else.

---

## 3. Phase 1 — Stop losing workouts

**1.1 Atomic session-document writes.** (C2a, C2e) `writeSessionDoc` writes the session row and
all its set logs in one `readwrite` transaction over both stores (chain the `add`s in the `put`
request's `onsuccess`, then `txDone`). Edit-session save inserts the new logs *before* deleting
the old keys, in the same transaction. `applySessionMergePlan` uses the same path per document.
`completeSession` tolerates a missing row like `touchSession`. Tests: fake-indexeddb interruption
(abort the transaction mid-way, assert either all or nothing landed).

**1.2 Purge grace period + sync mutex.** (C2b, C2c) `purgeEmptySessions` refuses to tombstone a
session whose `startedAt`/`updatedAt` is younger than 1 hour, and never the session id WorkoutView
currently has open. `sync.ts` serializes pull/push/purge through one module-level promise chain
(`withSyncLock`). Tests: purge racing `createSession`; concurrent `pullSync` + `pushSync` run in
order.

**1.3 Finish can't dead-end.** (C2d) `handleFinish` in try/catch/finally: visible error toast,
`setFinishing(false)`, draft kept on failure, cleared only on success.

**1.4 Draft model v2.** (H1) The draft stores the `WorkoutDay` snapshot (exercise list, sets, rep
ranges) plus the origin (`program` / `quick` / `shared`), so quick and shared workouts resume too.
Rules: never overwrite a draft that has sets for a different day without a confirmation sheet;
confirm Back when sets are logged; a dashboard "Resume unfinished workout" card; the open
workout's day is frozen for the lifetime of the view (read through a ref), and
`startPendingActivation` is skipped while a workout is mounted. Tests: `draftSession.test.ts`
covering overwrite protection, quick-workout resume, and day-snapshot restore.

**1.5 Edit-session loader.** (H7) The loader effect depends on `existingSessionId` only; `day`
is read through a ref. Test: a program refresh during edit does not reset `sets`.

**1.6 Sync visibility and retry.** (H8) A small `syncStatus` store (last success, last error,
`hasUnpushed` flag set on every local write path). The 60 s tick pushes when `hasUnpushed`;
pull/push surface 401 as a re-auth prompt instead of returning silently; Settings shows "Last
synced …" and the Dashboard shows a quiet badge when sync is failing. Test: a rejected push flips
`hasUnpushed`, the next tick retries.

**1.7 Error boundary + share capacity.** (M14) Top-level `ErrorBoundary` in `main.tsx` that
preserves the draft and offers "Back to dashboard"; `ShareWorkoutModal` catches `qr.make()`
overflow and shows "too large to share", encoder capped to QR capacity.

**1.8 Edit Session for quick/shared workouts.** (M6) When `dayId` is not in the program, build
the edit `day` from the session's logged exercises instead of falling to the dashboard.

Also folded in here: `HistoryView.formatDate(completedAt!)` "Invalid Date" guard and the
edit-mode date field that disappears once cleared (`WorkoutView.tsx:412`) — both are in the
files this phase rewrites.

---

## 4. Phase 2 — Engines tell the truth

**2.1 Phase-aware progress, insights and retrospectives.** (F1, F8 part, F14 part)
`assessSnapshot`/`assessExercise` take a `phaseOf(session)` resolver built from the journey's
block dates. Sessions logged in `isEasyPhase` weeks (deload, recovery, intro) are never a trend
endpoint and are neutral for PR and stall detection; the retrospective's window ends at the last
*hard* week of the block; `computeCoaching` (which already takes `phase`) threads the resolver
through. This one change removes the "trending down — prioritize recovery" Mondays, the "−7.4%
… 98 PRs" reviews and the replacement storm. Tests: `progress.test.ts` easy-week endpoint
exclusion; `retrospective.test.ts` block ending in deload reports the hard-week delta;
`profileSimulation` asserts no lift is "declining" the Monday after a recovery week.

**2.2 Bodyweight and timed engine parity.** (C1, H5, F11 part) Rewrite `repProgression` on
`credit(last, sets).sets` with the loaded engine's rules: increase when the best set ≥ `repHigh`
*and* the credited total ≥ the best prior total; "matched the prescribed total" counts as
progress; stall is best-of-window vs. anchor (one bad day never deloads); failed bonus sets never
lower the target; `buildSetPlan` may prescribe above `repHigh` on `kind: 'increase'`. Share the
window logic with the loaded engine instead of a second copy. Tests: the bodyweight loop
simulation from 0.3 flips from `it.fails` to passing; one-bad-day and bonus-set cases.

**2.3 Make the stall verdict real.** (M4) Today `stalled ≡ sameWeight && prEvents === 0` for
every goal. Drop the `prEvents === 0` precondition and let `compositeScore` decide against a
documented threshold, so the Metrics screen and the chip can no longer disagree about the same
lift. Test: at least one randomized window where the composite flips the recommendation; chip ↔
Progress-tab agreement over the simulation logs. Update the CLAUDE.md claim either way.

**2.4 Weekly cap boundary.** (M5) Snap `weeklyCeiling` to the equipment increment (or compare
with an epsilon). Test: 100 → 110 → next session is held at 110 for a beginner.

**2.5 Intra-session rep PRs.** (M11) Compute session bests first, compare against the
pre-session map. Test: the first session ever yields zero rep PRs.

**2.6 History depth.** (M18) WorkoutView passes `stallWindowFor(experience) + 2` sessions (or
all sessions at the working weight); `bestWorkAt` sees the full history at that load. Test:
advanced lifter with one late-slot session still gets a stall check.

**2.7 Rep-range change between blocks.** (F12) When the slot's range changed since the last
session, hold or re-anchor instead of decreasing. To know that reliably, start recording the
prescription on each set log (`prescribedLow`/`prescribedHigh`, schemaless, dropped from JSON
when absent) — this is Stage 0 of `docs/adaptive-engine-roadmap.md`, so it is work the roadmap
already wants. Infer from reps as the fallback for legacy logs.

**2.8 Prescription UI consistency.** (M13) Timed exercises render seconds in the chip and the
goal line; `workingWeight` reset keyed per exercise id (content compare), not on every plan
rebuild. Add ExerciseCard tests (currently none).

**2.9 Engine edge cases (LOW).** 0 lbs on a non-bodyweight, non-timed exercise → treat as
unloaded, never "go to 2.5 lbs" or a deload that raises load; `sets: 0` guarded; re-anchor
fallback made monotonic in reps; a re-anchor does not count as "already went up this week";
an unprescribed slot still honours a planned easy week; hold reason gap off-by-one; `dosage()`
checks `unit === 'seconds'` before `HIGH_REP_PATTERNS`. Also **M10**: `startOfWeek` builds the
Monday with `new Date(y, m, d - offset)` so a midnight DST transition can't produce a phantom
week; test across America/Santiago, Havana and Asia/Beirut.

**2.10 One progress rule.** (LOW analytics) `coach.ts:134-139` drops its raw-e1RM "declining"
rule and reads `progress.ts` like everyone else.

**2.11 Advanced lifters are not deloaded for progressing slowly.** (F9 part) An advanced lifter
gaining ~1%/month can't clear the 3% noise floor in four sessions. `fullMarksFor('advanced')`
and `deadband` shrink together for advanced, the stall window lengthens, and main lifts in a
`strength` plan hold instead of deload until two consecutive windows confirm. Test: the
Advanced profile simulation ends its block at or above its starting loads.

---

## 5. Phase 3 — The journey learns the right lessons

**3.1 Block completion provenance + pending rules.** (H2, M16) Blocks record
`completedBy: 'activation' | 'user'`; `deferActiveBlockToNextWeek` only reverses a block closed
by the same activation, refuses when a `pendingActivation` exists, and restores the *live*
program. Activation is one-directional: pending whenever `anchor > now`, whatever is running;
wrapping up with a pending block either starts it or asks. Tests: defer-after-user-wrap-up,
defer-with-pending, wrap-up-with-pending, future-start-with-nothing-running.

**3.2 Phase-gated adherence.** (H6) `sessionsPlanned = Σ phases program.filter(dayInPhase)`;
per-muscle weekly sets counted the same way; the "next block adds a set there" copy only when
the goal's planner actually adds. Test: sprint-tri block with 100% attendance scores 100%.

**3.3 Experience inference.** (F5, M9) Gate on training age in weeks and session count
(proposed: intermediate ≥ 26 weeks and ≥ 40 sessions; advanced ≥ 78 weeks and ≥ 120 sessions,
plus the difficulty-mastered signal), count only ids with explicit catalog difficulty, and make
`inferExperience` take `now` (purity LOW). Per **[D2]**, inference becomes **nudge-only**:
`effectiveExperience()` is retired, every engine reads the stored profile's level, and
`experienceSuggestion()` drives the Journey "level up" card, which writes the profile only when
the user taps it. Update the CLAUDE.md "only ratchets up" section accordingly. Tests: the
Newcomer stays beginner for 13 weeks unless the nudge is accepted; a custom-exercise-only log
never produces a nudge.

**3.4 Wizard: deload default + injuries.** (F10, M7) `includeDeload` defaults from the
experience answered in this run. Injuries become structured chips (joint × side, reusing the
niggle mechanism) with free text as a supplement; the parser gains negation (`no | without |
recovered | fully`), the `sore | tight | ache` vocabulary its own placeholder uses, and excludes
lift names (`back squat`, `front squat`) from the `back` rule. Tests: the audit's three benign
sentences ban nothing; "sore right shoulder overhead" removes overhead pressing.

**3.5 Beginners are judged by a beginner band and volume grows gradually.** (F6, F16)
`volumeTargetFor(goal, experience)` returns a lower band for beginners (proposed 6–12), used by
the coach overlay, metrics, the heatmap legend and the retrospective. The retrospective's +1
set carryover is capped per block (proposed: ≤ 3 muscles, and total weekly sets ≤ +25% block
over block; a larger jump earns an intro week). Session-length budget: the planner warns against
the split's own promise (60 min for "under an hour", 75 for "no marathon sessions"), not a flat
95. Per **[D5]**, the coach overlay stays pure and gains a persisted decision record: the
WorkoutView banner offers Accept / Not now per adjustment, the decision is stored per block in
the synced plan document (`block.coachDecisions: { key, accepted, at }`, keyed by exercise id +
direction), `applyPlanToDay` applies accepted ones and suppresses declined ones, and the planner
counts accepted sets toward the band. The stored program is still never mutated.

**3.6 Full-body frequency.** (F7) Main compounds may repeat across full-body days (A/B
alternation; `ctx.used` applies to accessories only), and beginners earn a load increase whenever
every set hits the ceiling, not only on a best-ever total. Test: Newcomer simulation trails
capacity by < 15% at week 13 (today 25–44%).

**3.7 Intro week, first exposure.** (F8) Intro weeks get the phase banner; a never-trained lift
in an intro week says so in the goal line and treats its first session as the intro baseline
(no red 80% chips in session 2). Retro endpoints already exclude intro sessions after 2.1.

**3.8 Coach overlay hygiene.** (F15) Program-gap suggestions pass the same difficulty/skill gate
as the planner; declined adjustments aren't re-proposed for the rest of the block (the record
from 3.5); "Next up" never names a day gated out of the current phase (LOW insights).

**3.9 Sport-support template fixes.** (M8) Split `main` into `main` (rep range) and
`protected` (trim floor); add `intro` to `BUILD_PHASES`/`THROUGH_MAINTENANCE`; one capping pass
that knows both floors (sports.ts emphasis survives planner.ts re-cap). Tests: intro week
schedules all days; step-up never gets 4×4–6; hamstring emphasis survives capping.

**3.10 Review copy tells the truth.** (F14) Sign-aware strength sentence ("moved back" for a
negative number), band sentence aware of the beginner band, deload rationale drawn from
hard-week data only.

**3.11 Planner/journey LOWs.** `openWithRecovery` not on mid-block replans; `blockEndTs` via
`addWeeks`; 3-week beginner blocks get an intro week; `intentFor` doesn't count intro as build;
`ensureJourneyMigrated` preserves `profile`/`pendingActivation`; `ALL_GOALS` removed;
`canContinue` dead branch; `retrospective.ts:44-51` duplicate predicate.

Also here: `blockSimulation.test.ts` gains a replan-against-existing-program-and-retro leg, and
"every week schedules a workout" becomes "every non-gated day is scheduled".

---

## 6. Phase 4 — Programming for yourself

**4.1 No plan means no plan.** (F2, F17 part) `ensureJourneyMigrated` marks what it creates
(`origin: 'migrated'`) and gives quick-workout-only history **no goal**; `getPlannedGoal()`
ignores migrated, goal-less plans so the `rangeFromHistory → null` cascade becomes reachable;
program slots record `rangeSource: 'plan' | 'user' | 'history'` and the re-anchor branch never
fires on a range the user didn't choose; the wizard doesn't pre-fill a goal the user never
picked; the Journey card stops saying "Muscle Growth · Foundation training". Per **[D1]**,
existing accounts are re-flagged too: a one-time startup migration (`liftlog_plan_v2` flag)
marks any plan whose only block is the migrated Foundation block as `origin: 'migrated'` with
`goal: null`, **unless** the account has since activated a wizard-made block (then the plan is
theirs and keeps its goal). The flagged document bumps `updatedAt` so it wins the LWW sync and
propagates to every device. Tests: Self-Directed simulation produces zero re-anchor chips and is
never dosed as beginner; a migrated-then-onboarded account is left alone.

**4.2 Build and edit your own program.** (F3) Dashboard "Add day"; rename and reorder days;
sets × reps editable per slot in `DayEditView` and in the wizard's review step; a per-slot
`progression: 'coach' | 'manual'` switch (manual = no chip, no plan, prefill from last time);
quick workouts prefill at the lifter's last set count for that exercise, not the dose; "Save
as a day" from a finished quick workout. Assumes all of these are in scope — see Assumptions.

**4.3 Progress for every lift you train.** (F13 part) The Progress tab filters to lifts trained
in the window, not to the current program (so quick-workout users and rotated-out lifts
appear), with "show all" beyond the first five.

**4.4 Small display fixes.** (F17 part) `prescriptionLabel`/`prescriptionDetail` render "5 × 5"
for a fixed range instead of "5 × 5–5".

**4.5 One add-exercise panel, one dosing validator.** (LOW duplication) `DayEditView`,
`QuickWorkoutView` and the wizard review all use the shared `AddExercisePanel`; the
`Number(x) || fallback || 3` rule becomes one validator that rejects negatives, fractions and
`repLow > repHigh`. Needed because 4.2 touches all three.

---

## 7. Phase 5 — Sync and server integrity

**5.1 Merges respect tombstones and metadata.** (H3, M12) `applyExerciseMerges` lifts the
tombstone on `toId` before remapping; a merge copies the from-override onto a survivor that has
none; `normalizeOverride` takes the id so a stale bare `'Press'` on an overhead press resolves
Vertical. End-to-end test through `pullSync` with an in-memory worker.

**5.2 Clocks on program, library and metadata.** (H4) `updatedAt` on the program document,
per-row `updatedAt` on library entries and metadata overrides (migration `0008`), compared on
both ends before writing; `profile` gets its own clock inside `PlanState`; pull never adopts
server program/library/metadata while `hasUnpushed` is set (from 1.6); the worker accepts an
empty program so the last day is deletable. Extend `test/syncContract.test.ts` with the
two-device edit race.

**5.3 Worker hardening.** (M1) Generic 500 bodies (stack to logs only); validate
`exerciseMuscles`, `exerciseDetails`, `completedAt` type, program byte bound; push applied as
one batch where D1 allows, otherwise ordered so tombstones and deletes land in the *last*
chunk; tombstone `DELETE`s issued only for ids present in the push. Tests on the `node:sqlite`
testkit.

**5.4 Conditional pull.** (M2) Per **[D7]**, only the pull half ships now: the worker computes a
per-user ETag from `max(updated_at)` across session docs, plan, program, library and metadata
(the clocks from 5.2 make this possible), honours `If-None-Match` with a 304, and the client
skips the merge entirely on 304. The 60 s tick then costs one small request when nothing
changed. Delta push (send only documents with `updatedAt > lastPushedAt`) is recorded in
CLAUDE.md's Future milestones, not built here.

**5.5 Service-worker updates.** (M15) Listen for `controllerchange`; show an "Update ready —
reload" toast, suppressed while a workout is open.

**5.6 Analytics performance.** (M17) One cached `Intl.DateTimeFormat`; `getExerciseMeta` reads
a memoized parsed override map invalidated on write; `headSetTotals` resolves meta once per
exercise; `applyExerciseMerges` runs once per merge version, not every tick.

**5.7 Ops LOWs.** `schema_migrations` tracking table + a documented apply step; expired
`user_sessions` purge; `/api/auth/logout` becomes POST; one auth query resolves user + role.

---

## 8. Phase 6 — Teach me how to do it

**6.1 Instruction data.** `src/data/instructions.ts`: compiled, app-owned, never synced (same
footing as `difficultyFor`): `{ setup: string; cues: string[]; faults?: string[] }` per catalog
id, `instructionsFor(id)` resolving timestamped custom ids through `catalogDefFor`. Per
**[D3]** this is **text only** — no link field, nothing to rot, works offline. Catalog test
asserts every exercise has an entry with 3–5 cues.

**6.2 Surfaces.** An ⓘ on `ExerciseCard` opening a bottom sheet; the same sheet from the picker
rows, `ExerciseMetaView`, the wizard review and the substitution panel; glossary terms
cross-link where a cue uses one.

**6.3 Content.** 89 entries drafted, then reviewed by you before merge (one PR per muscle region
to keep review tractable). Text only per **[D3]**; custom exercises show "No instructions yet"
rather than an empty sheet.

**6.4 Exercise list search.** (F17 part) Search box over the 89-row list, shared with the picker.

---

## 9. Phase 7 — Strength and advanced lifters

**7.1 Main-lift anchoring.** (F9 part) Strength main slots carry `preferIds` (the mechanism
sport templates already use) so squat/bench/deadlift/press anchor the block; never rotate a
main lift to a different pattern or implement in a `strength` plan; never schedule two heavy
axial lifts in one session. Test: Advanced simulation's block 2 keeps all four main lifts.

**7.2 Intensity structure.** (F9 part) Per **[D4]**, two layers: (a) phase-dependent rep
ranges for `strength` (build 4–6, push 3–5, peak 2–4) threaded through `dosage()` and read by
`calculateRecommendation` via `PrescriptionContext.phase`, so "reps drop and loads climb" is
enforced, not described — and a phase change counts as a range change for 2.7, so it re-anchors
instead of reading as a miss; (b) a top-set/back-off scheme for main lifts: `buildSetPlan`
emits set 1 as the top set at the recommended load and the remaining sets at a back-off
percentage (proposed 90%, phase-dependent), with the increase trigger judged on the top set and
the volume credit on the back-offs. No 1RM input, no RPE (consistent with the adaptive-engine
roadmap's rejection of self-reported effort). Tests: Advanced simulation shows reps falling and
loads rising across build → push → peak; the top set is never lighter than the back-offs.

**7.3 Bodyweight regressions.** (F11) Chin/pull-ups skill-gated for beginners; the rep engine
may set a target below `repLow` with "build to N" copy; after three misses the substitution
engine proposes a regression (lat pull-down, banded) from the card.

---

## 10. Phase 8 — Polish, visibility, docs

**8.1 Per-exercise history screen** (F13) reachable from the card's "Last time" line and the
Progress tab: all sessions, e1RM and volume trend, PRs.

**8.2 Session information + units.** (F17) Day-card estimated duration (3 min/set, the same
estimate the coach uses); per-session notes (a `note?` string on the session document, synced
like any other field); and per **[D8]** a kg/lb preference in `settings.ts` with
`toDisplay()`/`fromDisplay()` helpers at every weight input and label — storage stays in lbs,
increments stay equipment-based in lbs and are displayed converted. The body-weight log stays
on the roadmap.

**8.3 Accessibility LOWs.** No nested interactive elements (HistoryView, DayCard); keyboard path
for set rows; labelled heatmap regions and `<select>`s; modals with `role="dialog"`, focus trap,
Escape; cleared `setTimeout` in ExerciseMetaView; try/catch around `handleArchive`/`handleDelete`
/`handleActivate`; `removeExerciseFromProgram` side-effect out of the state updater.

**8.4 Remaining duplication.** One override→catalog→name-match resolver (`analytics.ts`,
`substitution.ts`); one date-input formatter; delete dead `program.ts getExerciseName`.

**8.5 CLAUDE.md reconciliation.** Each phase updates its section, but this item re-reads the
whole file against the code: "Exercise library never deletes", the `View` union, the removed
`→ 'Press'` remap, SettingsView metadata copy, the composite-stall claim, and the new
instruction/beginner-band/clock sections.

---

## 11. Decisions (resolved 2026-10-05)

| # | Decision | Chosen | Consequence in the plan |
|---|---|---|---|
| D1 | Existing accounts' migrated "Foundation" plans | **Re-flag existing too** | 4.1 ships a one-time migration; ad-hoc dosage changes for current accounts that never ran the wizard |
| D2 | Experience inference | **Nudge only** | 3.3 retires `effectiveExperience()`; engines read the stored profile; the Journey card is the only path to a higher level |
| D3 | Instruction content | **Text cues only** | 6.1 has no link field; 6.3 is 89 text entries, reviewed by you per muscle region |
| D4 | Strength intensity structure | **Phase rep ranges + top-set/back-off** | 7.2 builds both layers; no 1RM input, no RPE |
| D5 | Coach adjustment persistence | **Pure overlay + accepted record** | 3.5 adds `coachDecisions` to the block in the synced plan document; the program is still never mutated |
| D6 | Deploy gating | **Actions on PRs + Pages build runs lint and tests** | 0.2 adds the workflow and a `check` script; you switch the Pages build command (manual step below) |
| D7 | Incremental sync | **ETag pull now, delta push later** | 5.4 is pull-only; delta push goes to Future milestones |
| D8 | kg + body-weight log | **kg yes, body-weight log later** | 8.2 adds the unit preference; body-weight log stays on the roadmap |

**Manual steps only you can do** (none block the first PRs):
1. After 0.2 merges: in the Cloudflare Pages project settings, set the build command to
   `npm run check` so a commit that fails lint or tests never deploys.
2. Optionally, in GitHub → Settings → Branches, add a protection rule for `main` requiring the
   `ci` check, so a red PR can't be merged either.
3. Phase 6.3: review each content PR (one per muscle region) for coaching accuracy before merge.

## 12. Assumptions made without asking

- Phase 4.2 includes all of: add/rename/reorder days, slot sets × reps editing in both the day
  editor and the wizard review, a per-slot manual-progression switch, and "save quick workout
  as a day". Trim if any of these is out of scope.
- Phase 2.7 records the prescription on set logs (adaptive-engine Stage 0) rather than
  inferring the range change from reps alone.
- Beginner volume band is 6–12 weekly sets; retro growth cap is +25% weekly sets per block;
  intermediate inference gate is 26 weeks / 40 sessions, advanced 78 weeks / 120 sessions. All
  are constants in one place and easy to retune.
- Injuries move to structured chips (3.4) rather than a smarter free-text parser alone.
- Draft model keeps one draft slot with explicit overwrite confirmation, not multiple drafts.
- The purge grace period is 1 hour.

## 13. Coverage matrix

| Audit item | Phase item |
|---|---|
| C1 | 2.2 |
| C2 | 1.1, 1.2, 1.3 |
| H1 | 1.4 |
| H2 | 3.1 |
| H3 | 5.1 |
| H4 | 5.2 |
| H5 | 2.2 |
| H6 | 3.2 |
| H7 | 1.5 |
| H8 | 1.6 |
| M1 | 5.3 |
| M2 | 5.4 |
| M3 | 0.1, 0.2 |
| M4 | 2.3 |
| M5 | 2.4 |
| M6 | 1.8 |
| M7 | 3.4 |
| M8 | 3.9 |
| M9 | 3.3 |
| M10 | 2.9 (startOfWeek midnight-DST fix + test, grouped with the engine edge cases) |
| M11 | 2.5 |
| M12 | 5.1 |
| M13 | 2.8 |
| M14 | 1.7 |
| M15 | 5.5 |
| M16 | 3.1 |
| M17 | 5.6 |
| M18 | 2.6 |
| LOW — engine edge cases | 2.9 |
| LOW — planner/journey | 3.11 |
| LOW — analytics/insights (empty-program highlight, "Next up" gated day, coach.ts raw rule, `getProgramStart` write in render) | 2.10, 3.8 (gated "Next up"), 8.4 |
| LOW — duplication | 4.5, 8.4 |
| LOW — worker/ops | 5.7, 0.2 (dev-dep bumps) |
| LOW — UI/a11y | 1.1/1.3 (busy flags, date field, Invalid Date), 8.3 |
| LOW — CLAUDE.md drift | every phase + 8.5 |
| Test coverage gaps | 0.3, and named per item above |
| F1 | 2.1 |
| F2 | 4.1 |
| F3 | 4.2 |
| F4 | 6.1–6.3 |
| F5 | 3.3 |
| F6 | 3.5 |
| F7 | 3.6 |
| F8 | 3.7, 2.1 |
| F9 | 2.11, 7.1, 7.2 |
| F10 | 3.4 |
| F11 | 2.2, 7.3 |
| F12 | 2.7 |
| F13 | 4.3, 8.1 |
| F14 | 2.1, 3.10 |
| F15 | 3.8 |
| F16 | 3.5 |
| F17 | 4.1 (journey card copy), 4.4 (fixed-rep label), 6.4 (list search), 8.2 (duration, notes, kg), 4.2 (reorder days). Body-weight log: deliberately left on the roadmap (D8) |
