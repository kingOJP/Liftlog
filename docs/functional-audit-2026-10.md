# LiftLog functional audit — five user profiles, three months each

_October 2026. Audit of the app as it exists at commit `f1b0f57` (main). No code was changed._

## 1. What was audited and how

The brief: embody a person in the gym asking five things of the app —

1. Tell me what to do.
2. Teach me how to do it.
3. Remember what I did.
4. Tell me how I'm progressing.
5. Help me decide what to do next.

— across the five user profiles (Newcomer, Guided Beginner, Self-Directed, Optimizer, Advanced), from account creation through three months of training.

Three methods were combined:

- **Code reading** of every screen and engine (`src/components/*`, `src/data/*`).
- **A three-month engine simulation.** A temporary vitest harness onboarded each profile through the real planner (`buildPlanProposal`), activated blocks through the real `planStore`, trained week by week against the real prescription engine (`buildSetPlan`) and coach overlay (`computeProgramPlan`), wrapped blocks with the real retrospective, and replanned with the real carryover. The athlete was simulated as a human, not a perfect follower: a hidden per-exercise capacity that grows at a training-age-dependent rate, day-to-day noise, set-to-set fatigue, occasional skipped sessions, one week off for the Newcomer. Every week the harness recorded what the user would have seen: the dashboard coach card, every exercise card's chip, prescription and goal line, coach adjustments, the block review, the next proposal, and the Metrics screen. 13 weeks, 6 July – 4 October 2026.
- **A headless-browser walkthrough** (Playwright, 390×844 viewport) of the real UI: empty start, the wizard for three different profiles, review screens, workout logging, finishing, history, metrics, journey, day editor, quick workouts, settings, glossary, exercise detail.

The simulation harness, per-profile logs and screenshots are in the session scratchpad (`scratchpad/sim/*.md`, `scratchpad/shots/*.png`); the harness itself is `scratchpad/sim/audit.sim.test.ts` and can be dropped back into `src/data/` to reproduce every quote below. The simulated athlete is synthetic, so absolute numbers (how much load was gained) are illustrative; every finding below is traced to a code path, and the mechanisms are deterministic.

## 2. Scorecard

Ratings 1–5 for how well the app answers each question for each profile, after three months.

| Question | Newcomer | Guided Beginner | Self-Directed | Optimizer | Advanced |
|---|---|---|---|---|---|
| 1. Tell me what to do | 4 | 4 | **1** | 3 | 2 |
| 2. Teach me how to do it | **1** | **1** | 2 | 2 | 3 |
| 3. Remember what I did | 4 | 4 | 3 | 4 | 4 |
| 4. Tell me how I'm progressing | 2 | 2 | **1** | 2 | 2 |
| 5. Help me decide what to do next | 3 | 3 | **1** | **2** | **1** |

The headline: the app is strongest exactly where the profile table says beginners need it least (logging, analytics plumbing) and weakest where the two ends of the table need it most. Beginners get no instruction at all; self-directed and advanced lifters cannot program for themselves and are actively fought by engines that assume a wizard-made plan. In the middle, the block-to-block learning loop that is the app's signature idea (retrospective → carryover → next proposal) is currently reading the wrong week and rotating lifts that were progressing.

## 3. The five journeys

### 3.1 Newcomer (0–3 months) — beginner · general fitness · 3 days · full gym

**Weeks 0–1.** The empty dashboard is good: "No workouts yet" plus a single call to action. The wizard is nine quick screens with honest copy ("Be honest — the best plan is the one you'll actually keep"). The proposal is labelled "Evidence-based starting point", picks Full Body ×3, opens with one intro week, and every exercise carries a reason ("Beginner-friendly Quads work — easy to learn and load safely"). First workout: every card says "First time on this lift — find a weight you can control for 8–12 reps with 1–2 in reserve", with reps pre-filled and weight blank. This is a clear answer to "tell me what to do".

What is missing is any answer to "teach me how to do it". A goblet squat, a chest-supported row and a cable kick-back are names on a card. There is no description, cue, image, video or link anywhere in the app — not on the card, not on the exercise detail screen (which edits muscle groups and equipment), not in the picker. The glossary (Settings) explains *coaching* vocabulary, not movements. For the profile the table marks ■■■■■ on instruction, this is the biggest gap in the product.

**Weeks 2–6.** Double progression works as designed: holds with a concrete target ("Get one set to 12 reps at 110 lbs"), then increases ("35 reps at 35 lbs — your best work at this load, with a set at 12 — go to 40 lbs"). Three problems surface:

- *Frequency.* Full Body A/B/C use fifteen different exercises; the goblet squat is trained once a week. The split's own rationale says "you practise the big movements often" — it is the opposite. The planner's `used` set forbids reuse across days (`planner.ts` `pickForSlot`).
- *The coach banner fires at every workout.* From week 3 on, Day 2 opens with "Coach adjusted today's workout — Cable Crunch 2→3: Abs is averaging 2 weekly sets, below the 10–20 target" and Day 1 with the same for calves. The overlay is recomputed and never persists, so the same +1 is proposed for thirteen weeks and never closes the gap (a beginner template deliberately gives 2 sets; the band it is judged against is 10–20).
- *Experience flips at week 4.* After 10 sessions the inferred level becomes intermediate ("consistently training compound lifts" — hip thrusts are intermediate-tagged) and the engines switch to it: the weekly load cap halves from 10% to 5% and the beginner's "hold instead of deload" protection is gone. The user said "just starting" four weeks earlier.

**Week 7 — block review.** "Strength moved the right way: +13.1% across 15 lifts… 64 PRs" is accurate and motivating. Then: "0 of 12 trained muscles landed in the 10–20 weekly-set band… the next block adds a set there." Block 2 adds a set to eleven muscles, drops the intro week, uses intermediate dosage, and the first workout is 70 minutes instead of 46 — a 70% jump in weekly sets for a General Fitness plan whose intent line promises "no marathon sessions".

**Weeks 8–13.** The athlete took week 8 off. The dashboard's top insight for the next three Mondays: "Leg Press is trending down — est. 1RM −12.4% over 4 sessions. Prioritize recovery — sleep and food". The decline is the planned recovery week (10% lighter by prescription) sitting at the end of the trend window. At the end of three months, on a second recovery week, the Metrics Coach tab lists three "trending down" lifts and the Progress tab marks 6 of 15 lifts declining — all of them lifts that climbed all quarter.

### 3.2 Guided Beginner (3–12 months) — beginner · muscle growth · 4 days · priority arms · 8-week block

Upper/Lower ×2, two intro weeks, priority muscles honoured (+1 set on curls and kick-backs, each explained). Also good: the UI run showed the planner respecting a knee note in other tests, and the 4-day beginner split is sensible.

Problems, in order of appearance:

- *Session 2 of every lift is a wall of red.* The intro back-off (×0.8) only applies once there is history, so session 1 is logged at whatever the lifter chose and session 2 prescribes 80% of it with a red "↓ 40 lbs" chip on every card (screenshot `28-guided-intro-week-chips.png`). The phase banner that would explain this only renders for deload/recovery weeks (`WorkoutView.tsx:435`), not intro weeks.
- *The shoulder note was ignored.* The injuries box's own placeholder suggests "sore right shoulder overhead". Typing exactly that produced "Notes saved with the plan" and a Machine Shoulder Press on Day 1. The parser's injury vocabulary is `pain|injur|hurt|issue|problem|tweak|surgery` (`planner.ts:140`); "sore" is not in it.
- *Chin-ups the lifter cannot do.* Day 3 gets Chin Ups 3×8–12 (intermediate-tagged, not skill-gated). The simulated lifter manages 8/7/6. Every week after: "Reps fell under 8 — build back into the range", then "Stalled 3 sessions — reset to 8 crisp reps", then the dashboard's top insight for weeks 9–13 is "Chin Ups is trending down. Prioritize recovery — sleep and food". The rep engine has no regression (band, assisted, negatives) and cannot set a target below `repLow`.
- *Block review.* "Strength inched forward — −4.5% on average across 23 tracked lifts. You set 96 PRs." The negative number is the intro week: the first session of the block was heavier than everything that followed until week 7. "0 of 14 trained muscles landed in the band" again, +1 set everywhere, and block 2's upper days are 82 minutes against the split's "keeping each session under an hour".
- At week 3 this nine-month lifter is inferred intermediate; by block 2 the main lifts are dosed 4×6–10.

### 3.3 Self-Directed (1–3 years) — intermediate · never uses the wizard · own PPL as quick workouts

This profile exposes the app's hidden assumption: that there is always a plan.

**Week 1.** Quick Workout works: search the library, create "Pendlay Row" with its own sets and reps, log, finish. Cards for library exercises show "3 sets" and no rep target — honest. The dashboard shows no coach card (there is no program), no week counter, and History labels the session "Quick workout".

**Week 2.** On the next launch, startup migration (`planStore.ensureJourneyMigrated`) wraps the one quick workout in a "Foundation training" block with goal **hypertrophy**. The user never chose a goal, but from now on `getPlannedGoal()` is hypertrophy and every ad-hoc exercise is dosed from the hypertrophy table — for a **beginner**, because no profile was ever stored (`getProfileOrDefault()`). The bench the user runs at 5×5 now carries a 2×8–12 slot and the chip reads "↓ 175 lbs — Reps fell well under 8 — ease back and rebuild".

**Weeks 3–13.** Every single week, on a lift the user is adding weight to: "↓ 150 lbs [reanchor] — You've been working 192.5 lbs for about 5 reps — that's a heavier range than this block's 8–12. Re-anchoring: your est. 1RM of 225 lbs puts 8–12 reps at 150 lbs." There is no block. By week 11 the inferred level is *advanced* (two advanced-tagged lifts, 30+ sessions), which quietly gives the squat and deadlift the 3×5–8 axial tier — so those two lifts happen to be judged fairly, while the bench is "wrong" for twelve weeks. The deadlift is deloaded twice for being flat within the 3% noise floor.

**Progress.** Metrics' Coach tab only ever says "3 workouts in the last 7 days". The Progress tab is hidden — it filters to the current program, which is empty — although the engine assessed all 12 lifts. The PR tab works. Exercise Trends works. So this user gets charts, but never a verdict, never a plateau warning, never a suggestion.

**If they then try the wizard:** goal pre-filled to Muscle Growth (from the block they never made), experience pre-filled Beginner, and the proposal opens with an intro week because "you've changed what you're training for".

There is also no way for this user to build a program by hand: there is no "add a day" anywhere in the app (a day can only arrive through the wizard or a scanned share link), and the day editor cannot change the sets or rep range of an existing slot — only swap, remove and reorder. Quick workouts cap the pre-filled rows at the dose, so a 5×5 lifter taps "＋ Extra set" twice per exercise, every session.

### 3.4 Optimizer (2–5 years) — intermediate · muscle growth · 5 days · priority chest and back · 6-week blocks with deload · edits the plan

The collaborative features are present and pleasant: swap with explained suggestions during review, remove, priority muscles honoured, Edit Day mid-block, "Find replacement" with reasons and cautions, a planned deload with a banner. The first block is coherent: 9 of 13 muscles in band, 90% adherence, 98 PRs.

Then the block review: "Strength inched forward — −7.4% on average across 27 tracked lifts. You set 98 PRs." It flags 16 lifts as stalled, and block 2 **replaces 20 of 27 exercises** — including the Flat Barbell Bench Press the user deliberately swapped in during review ("Fresh stimulus for Chest — Flat Barbell Bench Press has stalled"), Lat Pull Down, Barbell Rows, Back Squat → Hack Squat. The cause is mechanical: the retrospective judges each lift from its first session in the block to its last, and the last session is the planned deload at 90% load (`retrospective.ts:52–54` sets the window end to the block's scheduled end; `assessExercise(…, Infinity)` uses the endpoints). Block 2 → block 3 does it again (another 17 replacements; "Your last block ended with 10 stalled lifts, so this deload is non-negotiable"). Over three months the lifter never runs the same bench, row or press twice in a row, which is the opposite of what a hypertrophy block wants and the opposite of what the review-step badges promise ("Kept — consistency on a lift you know compounds faster than novelty").

Also: this three-year lifter is inferred *advanced* in week 7 (four advanced-tagged lifts trained three times each). And the user's own edits are only partially respected — the swap-in survived until the retro rotated it, and there is no way to set the 4 sets × 5 reps they wanted; the slot kept the planner's rep range.

### 3.5 Advanced (5+ years) — advanced · strength · 4 days · 8 weeks

**Wizard.** The deload checkbox arrives **unchecked** for an advanced lifter: its default is computed from the *saved* profile (none → beginner) at mount, not from the experience just answered (`PlanSetupView.tsx:126`). In the browser run the 8-week strength block came out Build×4 / Push×3 / Peak with no deload. (The simulation ticked it on.)

**Selection.** The "big lifts" are chosen by alphabetical tie-break: Day 1's chest main for a strength block is *Dumbbell* Bench Press 4×4–6; Day 4 stacks Good Mornings 4×3–5 and Conventional Deadlift 4×3–5 in one session with a kettlebell reverse lunge between them. Nothing anchors a strength block on squat/bench/deadlift/press.

**Phases.** Build, Push and Peak are labels only. The prescription engine branches on easy phases (`recommendations.ts:640`) and on nothing else; the structure screen promises "as the block moves into its peak weeks, reps drop and loads climb", and the week-7 "Peak" session was the lightest hard week of the block for bench and deadlift (they had just been deloaded by the stall rule). There is no %1RM, no top-set/back-off, no RPE or RIR, no undulation, no kilograms.

**Stalls.** An advanced lifter progressing ~1% a month cannot clear the 3% noise floor in four sessions, so the stall rule deloads them: deadlift held 357.5 for four sessions at 4/3/3/3 (never a set of 5, so never an increase), then "4 sessions at 357.5 lbs with no gain — deload to 320", then 330, 340 — ending the block below where it started. Bench the same. The block review: "−6.7% average across 23 lifts, 102 PRs", 20 of 23 lifts "up for rotation", and block 2 proposes **Goblet Squat 4×4–6** in place of the back squat, **Kettlebell Swing** in place of the deadlift, and Incline Dumbbell Press in place of the bench. An advanced strength athlete would not open the app again.

**Self-programming.** Everything said for the Self-Directed profile applies: no add-day, no set/rep editing, no way to switch the recommendation chip off or supply their own progression.

## 4. Findings, prioritised

### P0 — wrong training or broken trust

**F1. Progress, insights and block reviews are blind to planned easy weeks.**
The planned deload/recovery/intro load reductions are read as declines everywhere downstream of `progress.ts`. Dashboard: "trending down — prioritize recovery" for three consecutive Mondays after a recovery week (Newcomer wks 8–10; Guided wks 4–6 after the intro; Optimizer every recovery week). Metrics after a recovery week: 6 of 15 lifts "declining". Block retrospectives score first-session-to-deload-session, so every block that ends with its planned deload reports "strength flat to down" alongside ~100 PRs and flags most of the program for rotation (Optimizer: 20/27 replaced; Advanced: 20/23). This single mechanism breaks question 4 for every profile that uses blocks and breaks question 5 for the two most engaged ones.
_Where:_ `retrospective.ts:52–54, 72–96`; `progress.ts` `assessExercise` endpoints; `insights.ts:216–237`. _Direction:_ exclude sessions logged in `isEasyPhase` weeks from trend endpoints and from the retro's last point (or end the retro window at the last hard week); treat a deload-week session as neutral in PR/stall logic; the recommendation engine already knows the phase, so thread it through `computeCoaching` (it is already a parameter) into `assessSnapshot`.

**F2. Users with no plan are silently given one, and then fought by it.**
One quick workout + a relaunch = a "Foundation training" block with goal hypertrophy and no profile (so beginner dosage). Every ad-hoc lift is thereafter prescribed 2×8–12 / 2×10–15 and the re-anchor branch tells a 5×5 lifter to drop 20% every session for months, quoting "this block's 8–12". `getPlannedGoal()` returns the migrated goal, so the "no plan → history-derived range → null" cascade in `dosage.resolvePrescription` is unreachable for anyone who has logged once.
_Where:_ `planStore.ts:457–497` (`ensureJourneyMigrated` runs for any history, including quick-workout-only), `prescribe.ts:52–61`, `recommendations.ts` reanchor branch. _Direction:_ do not migrate quick-workout-only history into a goal-bearing plan (or mark it `goal: null`/`origin: 'migrated'` and have `getPlannedGoal` ignore migrated plans); prefer `rangeFromHistory` for any slot the user did not get from a plan; never re-anchor a slot whose range the user did not choose.

**F3. The Self-Directed and Advanced profiles cannot program.**
No add-day control exists (grep: none; a day only arrives via wizard or share link). `DayEditView` cannot edit sets or rep range of an existing exercise, cannot rename a day (only its muscle-group text), and `PlanSetupView`'s review has no set/rep inputs either. Quick workouts cap pre-filled rows at the dose. The profile table marks "Programming: User" for two of five profiles; today the app supports "Programming: App" and "Collaborative" only.
_Direction:_ "Add day" on the dashboard; sets/reps editable in the day editor and the review step (slot-level, which the prescription model already supports); a per-slot "my own progression / don't recommend" switch.

**F4. "Teach me how to do it" is unanswered.**
No exercise in the catalog or UI carries a description, setup/cue list, image, video or external link; the only educational surface is a 26-term coaching glossary under Settings. Newcomer and Guided Beginner (■■■■■ / ■■■■ on instruction) get a list of names. `ExerciseDef` has no field for it; `ExerciseCard` and `ExerciseMetaView` have no affordance.
_Direction:_ add compiled catalog instruction data (same footing as `difficultyFor`: app-owned, not synced) with 3–5 cues and a setup line; an ⓘ on the card and in pickers; optionally one reference link per exercise. Even text-only would move this from 1 to 3.

**F5. Experience inference promotes people far too fast.**
A true newcomer is "intermediate" after 8 sessions in which any intermediate-tagged lift (hip thrust, dumbbell press, push-up variants) appears three times; a 1–3-year lifter is "advanced" after 30 sessions with two advanced-tagged lifts — i.e. anyone who squats and deadlifts for 10 weeks. Because engines use the *effective* level immediately (not the nudge), the Newcomer lost the 10% weekly cap and the hold-not-deload protection in week 4 and was planned block 2 as an intermediate; the Optimizer was dosed as advanced from week 7. The rationale text ("consistently training compound lifts — that's intermediate territory") does not match the user's own 0–3-month self-report.
_Where:_ `experience.ts:732–744`. _Direction:_ gate on training age in weeks (e.g. intermediate ≥ 6 months and ≥ 40 sessions; advanced ≥ 18 months), and let the nudge, not the inference, change what the engines use.

### P1 — programming quality

**F6. Beginner plans are prescribed below the band they are judged against, then over-corrected.** Beginner templates give 2 sets per slot (~5 sets/muscle/week), the coach and metrics judge against 10–20, the retro reports "0 of 12 muscles in band" and adds a set to every muscle, so block 2 jumps +60–70% in weekly sets (Newcomer 34→58, Guided 54→82; sessions 43→73 and 58→82 min) with no intro week. Meanwhile the in-block coach proposes the same +1 set at every workout for thirteen weeks because the overlay is never persisted and can never reach the band. _Direction:_ a beginner band (or scale `volumeTargetFor` by experience), make the retro's +1 respect a per-block cap, persist coach adjustments the user accepts, and cap block-over-block set growth.

**F7. Full-body templates train each movement once a week.** A/B/C are disjoint by construction (`ctx.used`), contradicting the split's rationale and slowing novice linear progression; the beginner progression copy promises "add a little every session" but a lift appears weekly and the set-1 target rises one rep per session. In the simulation, prescribed loads trailed the Newcomer's true capacity by 25–44% after 13 weeks. _Direction:_ allow main compounds to repeat across full-body days (A/B alternation), and let beginners jump load whenever all sets hit the ceiling rather than requiring a best-ever total.

**F8. The intro week softens the second exposure, not the first.** Session 1 has no history so no back-off; session 2 is 80% of a self-chosen load, shown as red ↓ chips on every card with no banner (banner is deload/recovery only). The retro then reads the block from that heavier first session. _Direction:_ show the intro banner; for a never-trained lift in an intro week, say so in the goal line and treat the first session as the intro baseline; exclude intro sessions from retro endpoints (F1).

**F9. Strength blocks have no intensity structure, and main lifts are picked alphabetically.** Build/Push/Peak change nothing in `calculateRecommendation`; the promised "reps drop and loads climb" does not happen; the chest main of a strength day is decided by `localeCompare` (`planner.ts` `pickForSlot`), yielding Dumbbell Bench Press over the barbell and Good Mornings + Deadlift at 4×3–5 in one session. Advanced lifters, whose honest rate of progress sits inside the 3% noise floor, are deloaded every ~5 sessions and then told to rotate the squat for a goblet squat. _Direction:_ `preferIds` for strength main slots (the sport templates already have this mechanism), phase-dependent rep ranges or a top-set/back-off scheme for `strength`, `holdsInsteadOfDeload` (or a longer window with a smaller full-marks bar) for advanced lifters on main lifts, and never rotate a main lift for a different pattern/implement in a strength plan.

**F10. Two wizard bugs.** (a) `includeDeload` defaults from the stored profile, not the answer just given — an advanced lifter's first block has no deload unless they notice. (b) The injury parser does not understand the placeholder's own example ("sore right shoulder overhead" → Machine Shoulder Press is still picked). _Where:_ `PlanSetupView.tsx:126`, `planner.ts:140`.

**F11. Bodyweight prescriptions cannot regress.** A beginner given Chin Ups 3×8–12 who manages 7 is told to "build back into the range" forever, then "stalled — reset to 8", then "trending down — prioritize recovery". No assisted variant is offered, and Chin Ups is not skill-gated. _Direction:_ gate chin/pull-ups for beginners, allow a sub-`repLow` target, and have substitution propose a regression (lat pull-down, banded) when a bodyweight lift misses three times.

**F12. A rep-range change between blocks reads as a miss.** Lying Leg Curl 10–15 → 12–15: the week after an increase, "Reps fell well under 12 — ease back and rebuild". The re-anchor threshold needs a 2-rep gap and a corroborating session; a 1–2 rep range shift falls through to the decrease branch. _Direction:_ when the slot's range changed since the last session, re-anchor (or hold) rather than decrease.

### P2 — information and UX

**F13. Progress visibility is thin where it matters.** The Progress tab shows 5 of up to 23 lifts, only for the *current* program (lifts rotated out vanish from the review, which is exactly when the user wants to compare), and not at all for quick-workout users. There is no per-exercise history screen (the exercise detail page edits metadata only), and the card's "Last time" is a single session.

**F14. Contradictory review copy.** "Strength inched forward — −7.4% on average… You set 98 PRs"; "0 of 12 trained muscles landed in the band" for a plan the app designed; "Your last block ended with 16 stalled lifts, so this deload is non-negotiable" after a block in which every lift climbed.

**F15. Coach adjustments repeat and sometimes mis-suggest.** The same +1 set is proposed at every workout; the "program gap" suggestion offered Hanging Leg Raise (advanced-tagged) to the Newcomer.

**F16. Session length promises.** The planner warns only above 95 minutes; a 5-day "no marathon sessions" plan runs 70–79 min, a 4-day "under an hour" split runs 82 min in block 2.

**F17. Smaller items.** Exercise list has no search (89 rows); fixed-rep slots render as "5 × 5–5"; quick-workout users' journey card reads "Muscle Growth · Foundation training" for a goal they never chose; no per-session or per-set notes; no body-weight log (so bodyweight-exercise e1RM and "total lbs lifted" exclude it); no kg; the day card shows "5 exercises" but not estimated duration; the Edit Day screen cannot reorder days.

## 5. What works well

- **Onboarding and explanation.** One question per screen, honest subtitles, a declared confidence level, every exercise with a reason, every structural decision explained, swap-with-reasons at review time. This is the strongest "tell me what to do" opening of any tracker I know.
- **The per-set prescription.** Pre-filled weight and reps, remaining sets previewed, a goal line that states exactly what earns the next increase, equipment-aware increments, the fresh-slot baseline, rest timer that starts itself. Logging a set is one tap.
- **Memory.** Draft persistence, edit-session, warm-up tagging, merge-based sync, calendar-week analytics, the heatmap, weekly volume as a continuous timeline. Question 3 is largely solved.
- **Safety rails that fired correctly in the simulation.** Beginner split caps, skill gating of the deadlift and back squat, the volume ceiling pass, deload guardrails, the sport-support budget (not profiled here but reviewed), the one-bad-session rule ("Short of 8 reps, but one session isn't a trend — repeat 175 lbs before dropping it").
- **Engineering.** 741 passing tests including an end-to-end block simulation; pure engines made this audit possible in an afternoon.

## 6. Suggested order of work

1. **F1** (phase-aware progress/retro) — one change restores questions 4 and 5 for every planned user and stops the rotation storm.
2. **F2 + F3** — stop migrating quick-workout history into a goal, make slot sets/reps editable, add "add day". This opens the app to the two self-programming profiles.
3. **F5 + F10** — inference thresholds, deload default, injury vocabulary (all small).
4. **F4** — instruction content; even text cues move two profiles from 1 to 3.
5. **F6/F7/F8** — beginner band, frequency, intro-week first exposure.
6. **F9** — strength-block intensity structure and main-lift anchoring.
7. **F11–F17** as capacity allows.

## Appendix — simulation set-up

| Profile | Self-report | Goal / days | Blocks in 13 weeks | Athlete behaviour |
|---|---|---|---|---|
| Newcomer | beginner, 0 mo | general · 3 | 6 wk → 6 wk → (week 1 of a third) | 15% skips, week 8 off, cautious |
| Guided Beginner | beginner, 9 mo | hypertrophy · 4, priority arms | 8 wk → 5 wk | 10% skips |
| Self-Directed | none stored | own PPL as quick workouts | none (Foundation migration only) | 3% skips, adds weight when ready |
| Optimizer | intermediate, 42 mo | hypertrophy · 5, priority chest/back, shoulder note | 6 wk (+deload) → 6 wk → (week 1 of a third) | swaps bench in at review, adds face pulls mid-block, 5% skips |
| Advanced | advanced, 84 mo | strength · 4 | 8 wk (+deload) → 5 wk | 100% adherence |

Capacity growth per week: beginner 2%, intermediate 0.6%, advanced 0.25%; daily noise ±3%; set-to-set fatigue 7%; the athlete attempts the prescribed target (+1 rep some of the time) and logs what the capacity allows. Workout dates: Mondays from 2026-07-06; "today" for the end-of-quarter Metrics read is 2026-10-04.
