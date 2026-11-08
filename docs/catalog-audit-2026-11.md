# Exercise catalog audit — November 2026

An audit of the compiled exercise catalog (`src/data/exercises.ts`) from the point of view of
a bodybuilder and strength coach: is every exercise classified correctly, and does the catalog
hold what an experienced lifter expects to find? Three yardsticks for "complete":

1. **Every common commercial-gym machine** (selectorized, plate-loaded and stations).
2. **The lifts an experienced lifter is routinely prescribed** — the ~100 that recur across
   strength, hypertrophy and general programs.
3. **A bodybuilder's top 10 per muscle group.**

**Result:** 89 → **141** catalog exercises (+52), **13 metadata corrections** to existing
entries, **25 named variants** that deliberately are *not* new exercises, **175 aliases** across 87 exercises,
and three new movement patterns. Every addition carries full metadata, a difficulty tier
(with prerequisites where gated), muscle heads where established, and instructions.

## How additions were decided: exercises vs. modifiers

The app already models *how* a set is done separately from *which* movement it is
(`variations.ts`, `docs/set-variations.md`): a **grip** (close / wide / neutral / underhand /
overhand / mixed) and a **rep style** (paused / tempo / deficit). Those modifiers already shift
the volume accounting (wide pulldown → less biceps; deficit deadlift → quads join in) and are
compared like-for-like by the progression and progress engines.

So the rule for this audit was: **if a named lift is an existing exercise with a different grip
or rep style, it is a named variant, not a catalog entry.** "Wide Grip Lat Pulldown", "Pendlay
Row", "Paused Squat" and "Deficit Deadlift" resolve to their base exercise with the modifier
pinned on the program slot. Adding them as exercises would have split one lift's history across
several ids (wide-grip pulldowns would never count toward the pulldown's trend), handed the
substitution engine near-duplicates to suggest for each other, and duplicated the emphasis
shift `variations.ts` already applies.

What *does* earn a catalog entry:

- **A different implement or machine** whose loading and increments differ (barbell vs.
  trap bar vs. machine) — the prescription engine snaps loads to the implement.
- **A different angle that changes the head trained** (incline vs. flat vs. decline; low-to-high
  vs. mid cable fly) — angle is not a modelled modifier, and the head differs.
- **A lift with its own 1RM culture** even where a modifier could describe it (sumo deadlift,
  close-grip bench) — lifters test and track these separately.

## The change table

Source key: **M** common gym machine · **P** routinely prescribed (top-100) · **B** bodybuilder
top-10 for the muscle.

### A. Additions (52)

| # | Exercise `id` | Primary | Secondary | Head | Pattern | Equipment / weight type | Difficulty | Source | Why |
|---|---|---|---|---|---|---|---|---|---|
| A1 | **Incline Machine Chest Press** `incline-machine-chest-press` | Chest | Delts, Triceps | Upper Chest | Horizontal Press | Machine / Machine | beginner | M B | Standard selectorized/plate-loaded machine; the stable upper-chest press beginners can load on day one. |
| A2 | **Smith Machine Incline Press** `smith-machine-incline-press` | Chest | Delts, Triceps | Upper Chest | Horizontal Press | Smith Machine / Machine | beginner | M B | A bodybuilding staple for upper chest — fixed path lets the pecs, not stability, be the limit. |
| A3 | **Decline Barbell Bench Press** `decline-barbell-bench-press` | Chest | Triceps, Delts | Lower Chest | Horizontal Press | Bench / Barbell | intermediate | P | Commonly prescribed; lower-chest bias and a shorter, shoulder-friendlier range than flat. |
| A4 | **Incline Dumbbell Fly** `incline-dumbbell-fly` | Chest | Delts | Upper Chest | Fly | Bench / Dumbbell | beginner | B | Upper-chest isolation with a loaded stretch; the incline counterpart to Dumbbell Fly. |
| A5 | **Low to High Cable Fly** `low-to-high-cable-fly` | Chest | Delts | Upper Chest | Fly | Cable Machine / Machine | beginner | B | Upper-chest cable isolation. Fly angle changes the head trained, so it is an exercise, not a modifier. |
| A6 | **Arnold Press** `arnold-press` | Delts | Triceps | Front Delt | Vertical Press | Bench / Dumbbell | intermediate | P B | Widely prescribed dumbbell press with a long range; front-delt dominant. |
| A7 | **Landmine Press** `landmine-press` | Delts | Chest, Triceps | Front Delt | Vertical Press | None / Barbell | intermediate | P | The go-to shoulder-friendly press for lifters who cannot press strictly overhead. |
| A8 | **Push Press** `push-press` | Delts | Triceps, Quads, Glutes | Front Delt | Vertical Press | Squat Rack / Barbell | advanced (gated: barbell-overhead-press, seated-db-overhead-press) | P | Standard athletic/strength accessory — overloads the press with leg drive. Gated behind the strict press. |
| A9 | **Cable Upright Row** `cable-upright-row` | Delts | Traps, Biceps | Side Delt | Lateral Raise | Cable Machine / Machine | intermediate | P B | Side-delt and trap builder; cable version is the joint-friendlier choice. Flagged for shoulder injuries by name. |
| A10 | **Dumbbell Front Raise** `dumbbell-front-raise` | Delts | Chest | Front Delt | Front Raise | None / Dumbbell | beginner | P | Still a common prescription; gets its own Front Raise pattern so it never fills a side-delt slot. |
| A11 | **Cable Rear Delt Fly** `cable-rear-delt-fly` | Delts | Upper Back, Traps | Rear Delt | Reverse Fly | Cable Machine / Machine | beginner | B | Rear-delt isolation with constant tension — the third rear-delt option beside the pec deck and dumbbells. |
| A12 | **Pull Ups** `pull-ups` | Lats | Upper Back, Biceps | — | Pull Up | Pull Up Bar / Bodyweight | intermediate (gated: lat-pull-down, straight-arm-pulldowns) | P B | The most-prescribed vertical pull was missing (only Weighted Pull Ups existed, gated as advanced). Weighted Pull Ups now lists it as a prerequisite. |
| A13 | **Machine High Row** `machine-high-row` | Lats | Upper Back, Biceps | — | Row | Machine / Machine | beginner | M B | Hammer-Strength-style high row: lat-biased row between a pulldown and a row. |
| A14 | **Single Arm Cable Row** `single-arm-cable-row` | Lats | Upper Back, Biceps | — | Row | Cable Machine / Machine | beginner | B | Unilateral lat row, elbow to hip — a bodybuilder lat favourite with a long stretch. |
| A15 | **Incline Dumbbell Row** `incline-dumbbell-row` | Upper Back | Lats, Delts, Biceps | — | Row | Bench / Dumbbell | beginner | P B | Chest-supported row for gyms without the machine; takes the lower back out of rowing. |
| A16 | **Inverted Row** `inverted-row` | Upper Back | Lats, Biceps | — | Row | Squat Rack / Bodyweight | beginner | P | The bodyweight horizontal pull and the regression path toward pull-ups. |
| A17 | **Meadows Row** `meadows-row` | Upper Back | Lats, Biceps, Delts | — | Row | None / Barbell | intermediate | B | Landmine single-arm row popularized in bodybuilding; big upper-back stretch. |
| A18 | **Barbell Curl** `barbell-curl` | Biceps | Forearms | — | Curl | None / Barbell | beginner | P B | The most common biceps exercise of all was missing. |
| A19 | **Dumbbell Curl** `dumbbell-curl` | Biceps | Forearms | — | Curl | None / Dumbbell | beginner | P B | Standing/alternating dumbbell curl — the default curl most programs write. |
| A20 | **Concentration Curl** `concentration-curl` | Biceps | — | Short Head | Curl | Bench / Dumbbell | beginner | B | Short-head-biased, strict isolation with no cheating possible. |
| A21 | **Spider Curl** `spider-curl` | Biceps | — | Short Head | Curl | Bench / Dumbbell | beginner | B | Short-head bias with the hardest point at peak contraction. |
| A22 | **Bayesian Cable Curl** `bayesian-cable-curl` | Biceps | — | Long Head | Curl | Cable Machine / Machine | beginner | B | Long-head stretch-biased curl (arm behind the torso); current evidence favours lengthened training. |
| A23 | **Machine Preacher Curl** `machine-preacher-curl` | Biceps | — | Short Head | Curl | Machine / Machine | beginner | M | The "biceps curl machine" in most gyms. |
| A24 | **Dumbbell Overhead Tricep Extension** `dumbbell-overhead-tricep-extension` | Triceps | — | Long Head | Tricep Extension | Bench / Dumbbell | beginner | P B | Long-head stretch with just a dumbbell — the cable version existed, the free-weight one did not. |
| A25 | **JM Press** `jm-press` | Triceps | Chest | Lateral Head, Medial Head | Tricep Extension | Bench / Barbell | advanced (gated: skull-crushers, close-grip-bench-press) | B | Hybrid press/extension favoured for heavy triceps work. Gated, and flagged for elbow injuries by name. |
| A26 | **Machine Dip** `machine-dip` | Triceps | Chest, Delts | Lateral Head, Medial Head | Dip | Machine / Machine | beginner | M | Seated dip machine — triceps-dominant, no shoulder-depth risk of bar dips. |
| A27 | **Machine Tricep Extension** `machine-tricep-extension` | Triceps | — | — | Tricep Extension | Machine / Machine | beginner | M | Standard selectorized triceps extension. |
| A28 | **Front Squat** `front-squat` | Quads | Glutes, Upper Back, Abs | — | Squat | Squat Rack / Barbell | advanced (gated: goblet-squat, hack-squat) | P | Core strength-program lift; quad-dominant, upright. Gated like the back squat. |
| A29 | **Safety Bar Squat** `safety-bar-squat` | Quads | Glutes, Adductors, Upper Back | — | Squat | Squat Rack / Barbell | advanced (gated: goblet-squat, leg-press, hack-squat, belt-squat) | P | Common in strength gyms for lifters with shoulder limits. Heavy axial, so gated like the back squat. |
| A30 | **Pendulum Squat** `pendulum-squat` | Quads | Glutes, Adductors | — | Squat | Machine / Machine | beginner | M B | Increasingly standard machine; a bodybuilder top-tier quad builder. |
| A31 | **Belt Squat** `belt-squat` | Quads | Glutes, Adductors | — | Squat | Machine / Machine | beginner | M | Squats the legs with no bar on the spine — beginner-safe loaded squatting. |
| A32 | **Dumbbell Reverse Lunge** `dumbbell-reverse-lunge` | Quads | Glutes, Adductors | — | Lunge | None / Dumbbell | beginner | P | The knee-friendliest lunge and one of the most prescribed. Deficit is a modifier, not a new exercise. |
| A33 | **Sissy Squat** `sissy-squat` | Quads | — | Rectus Femoris | Leg Extension | None / Bodyweight | intermediate | B | Rectus-femoris-biased quad isolation (knee extension with the hip extended). |
| A34 | **Pistol Squat** `pistol-squat` | Quads | Glutes, Calves | — | Squat | None / Bodyweight | advanced (gated: bulgarian-split-squat, goblet-squat) | P | Bodyweight single-leg strength standard. Gated behind split squats. |
| A35 | **Standing Leg Curl** `standing-leg-curl` | Hamstrings | Calves | Biceps Femoris | Leg Curl | Machine / Machine | beginner | M | The third common leg-curl machine (seated and lying already existed). |
| A36 | **Nordic Hamstring Curl** `nordic-hamstring-curl` | Hamstrings | Calves | Medial Hamstrings | Leg Curl | None / Bodyweight | advanced (gated: lying-leg-curl, seated-leg-curl) | P B | Best-evidenced hamstring-injury prevention exercise. Gated behind machine curls. |
| A37 | **Glute Ham Raise** `glute-ham-raise` | Hamstrings | Glutes, Calves | — | Leg Curl | Machine / Bodyweight | advanced (gated: lying-leg-curl, seated-leg-curl, back-extensions) | M P | GHD is a common strength-gym station; knee-flexion with hip extension. |
| A38 | **Stiff Leg Deadlift** `stiff-leg-deadlift` | Hamstrings | Glutes, Lower Back | Medial Hamstrings | Hip Hinge | None / Barbell | intermediate | B | Straighter-knee hinge than the RDL; a classic bodybuilding hamstring lift. |
| A39 | **Sumo Deadlift** `sumo-deadlift` | Glutes | Adductors, Quads, Lower Back | Gluteus Maximus | Hip Hinge | None / Barbell | advanced (gated: romanian-deadlifts, dumbbell-rdl, trap-bar-deadlift) | P | Competition deadlift stance with its own 1RM — kept as an exercise rather than a stance modifier (stance is not modelled). |
| A40 | **Trap Bar Deadlift** `trap-bar-deadlift` | Glutes | Quads, Hamstrings, Lower Back | Gluteus Maximus | Hip Hinge | None / Barbell | intermediate | P | The most-prescribed deadlift outside powerlifting: more forgiving, quad-assisted. |
| A41 | **Machine Hip Thrust** `machine-hip-thrust` | Glutes | Hamstrings | Gluteus Maximus | Hip Thrust | Machine / Machine | beginner | M | Glute-drive style machine — now standard in commercial gyms. |
| A42 | **Glute Bridge** `glute-bridge` | Glutes | Hamstrings | Gluteus Maximus | Hip Thrust | None / Bodyweight | beginner | P | Beginner hip-extension pattern and the hip thrust regression. |
| A43 | **Cable Glute Kickback** `cable-glute-kickback` | Glutes | Hamstrings | Gluteus Maximus | Hip Extension | Cable Machine / Machine | beginner | M B | Glute isolation; gets a new Hip Extension pattern so it is not filtered as a spinal-loaded hinge. |
| A44 | **Hip Adduction** `hip-adduction` | Adductors | — | — | Adduction | Machine / Machine | beginner | M | The adductor machine — one of the most common machines, and Adductors had only the Copenhagen plank. |
| A45 | **Captain's Chair Knee Raise** `captains-chair-knee-raise` | Abs | — | — | Crunch | Dip Station / Bodyweight | beginner | M | The vertical knee-raise station; now the prerequisite that earns the hanging leg raise. |
| A46 | **Reverse Crunch** `reverse-crunch` | Abs | — | — | Crunch | None / Bodyweight | beginner | P | Beginner-safe lower-ab flexion. |
| A47 | **Decline Sit Up** `decline-sit-up` | Abs | Obliques | — | Crunch | Bench / Bodyweight | intermediate | P | Loadable spinal flexion on the decline bench most gyms have. |
| A48 | **Ab Wheel Rollout** `ab-wheel-rollout` | Abs | Obliques, Lats | — | Plank | None / Bodyweight | intermediate | P B | Anti-extension standard; filed under Plank (the anti-extension family) but counted in reps. |
| A49 | **Cable Woodchop** `cable-woodchop` | Obliques | Abs | — | Rotation | Cable Machine / Machine | intermediate | P | Loaded rotation — Obliques had only isometric work and one carry. |
| A50 | **Rotary Torso Machine** `rotary-torso-machine` | Obliques | — | — | Rotation | Machine / Machine | beginner | M | Common selectorized rotation machine. |
| A51 | **Reverse Wrist Curls** `reverse-wrist-curls` | Forearms | — | — | Curl | Bench / Dumbbell | beginner | P | Extensor counterpart to wrist curls; balances the forearm. |
| A52 | **Dead Hang** `dead-hang` | Forearms | Lats | — | Carry | Pull Up Bar / Bodyweight · timed | beginner | P | Grip and shoulder-health staple; timed, so it logs seconds. |

### B. Metadata corrections to existing exercises (13)

| # | Exercise `id` | Field | Was | Now | Why |
|---|---|---|---|---|---|
| C1 | Barbell Back Squat `barbell-back-squat` | secondary | Glutes, **Hamstrings**, Lower Back | Glutes, **Adductors**, Lower Back | The hamstrings are biarticular and barely change length in a squat; training studies (e.g. Kubo et al., 2019) find squats grow the glutes and adductors, not the hamstrings. Crediting hamstring volume to squats hid an under-trained muscle from the coach. |
| C2 | Smith Machine Squat `smith-machine-squat` | secondary | Glutes, **Hamstrings** | Glutes, **Adductors** | Same reasoning as C1. |
| C3 | Leg Press `leg-press` | secondary | Glutes, **Hamstrings** | Glutes, **Adductors** | Same reasoning as C1; deep leg pressing loads adductor magnus. |
| C4 | Hack Squat `hack-squat` | secondary | Glutes | Glutes, **Adductors** | Consistency with the other squat patterns. |
| C5 | Barbell Rows `barbell-rows` | secondary | Lats, Biceps | Lats, Biceps, **Lower Back** | An unsupported bent-over row is a long isometric for the spinal erectors — the reason it is programmed away from deadlifts. |
| C6 | Barbell Overhead Press `barbell-overhead-press` | secondary | Triceps | Triceps, **Traps** | The upper traps upwardly rotate the scapula to finish every overhead rep. |
| C7 | Dumbbell Pullover `dumbbell-pullover` | secondary | Chest | Chest, **Triceps** | The triceps long head crosses the shoulder and extends it under load. |
| C8 | Back Extensions `back-extensions` | secondary | Glutes | Glutes, **Hamstrings** | A 45° extension is a hip-extension movement; the hamstrings share it with the glutes. |
| C9 | Back Extensions `back-extensions` | equipment | None | **Bench** | Needs a hyperextension bench / roman chair — "None" let a no-equipment plan prescribe it. |
| C10 | Bent Over One Arm Dumbbell Row `bent-over-db-row` | equipment | None | **Bench** | Its own setup puts one hand and one knee on a bench. |
| C11 | Preacher Curls `preacher-curls` | equipment | Machine | **Bench** | It is an EZ bar on a preacher bench. "Machine" banned it for home-gym plans; the true machine version is now `machine-preacher-curl`. |
| C12 | Standing Calf Raises `standing-calf-raises` | equipment / weight type | None / **Barbell** | **Machine / Machine** | Done on a standing calf machine ("shoulders under the pads", per its own instructions) — almost nobody calf-raises with a barbell. Setup text updated to match. |
| C13 | Weighted Pull Ups / Hanging Leg Raise | prerequisites | chin-ups, lat-pull-down / machine-crunch, cable-crunch | **+ pull-ups** / **+ captains-chair-knee-raise** | The plain versions now exist and are the natural step before each. |

Audited and **left as is**, with the reasoning recorded so it isn't re-litigated:

- `tricep-cable-pushdown` vs `cable-pushdown` look like duplicates but are distinguished by
  attachment in their instructions (rope vs. straight/V bar). Both ids carry history, so neither
  is removed or renamed; aliases now disambiguate them ("Rope Pushdown", "Bar Pushdown"), and the
  substitution engine still treats them as the same lift.
- `conventional-deadlift` is Glutes-primary, `face-pulls` Delts-primary and `farmer-carry`
  Traps-primary — each is defensible and changing a primary re-files a lift's whole history in
  every volume chart.
- `db-external-rotation` stays on the Rear Delt head: the taxonomy has no rotator cuff, and the
  posterior delt assists external rotation. A cuff muscle group is a taxonomy decision, not a
  catalog fix.

### C. Named variants (25) — added as modifiers, not exercises (`src/data/namedVariants.ts`)

| Named variant (aliases) | Resolves to | Modifier |
|---|---|---|
| Wide Grip Lat Pulldown (Wide Grip Pulldown) | Lat Pull Down | grip: wide |
| Close Grip Lat Pulldown (V Bar Pulldown, Close Grip Pulldown) | Lat Pull Down | grip: close |
| Neutral Grip Lat Pulldown (Neutral Grip Pulldown) | Lat Pull Down | grip: neutral |
| Reverse Grip Lat Pulldown (Underhand / Supinated Pulldown) | Lat Pull Down | grip: underhand |
| Wide Grip Pull Up | Pull Ups | grip: wide |
| Neutral Grip Pull Up (Hammer / Parallel Grip Pull Up) | Pull Ups | grip: neutral |
| Pendlay Row (Dead Stop Row) | Barbell Rows | technique: paused |
| Yates Row (Underhand / Reverse Grip Barbell Row) | Barbell Rows | grip: underhand |
| Wide Grip Cable Row (Wide Grip Seated Row) | Seated Cable Row | grip: wide |
| Wide Grip Bench Press | Flat Barbell Bench Press | grip: wide |
| Paused Bench Press (Pause Bench Press, Competition Pause Bench) | Flat Barbell Bench Press | technique: paused |
| Neutral Grip Dumbbell Press (Hammer Grip Dumbbell Press) | Dumbbell Bench Press | grip: neutral |
| Neutral Grip Dumbbell Shoulder Press | Seated Dumbbell Overhead Press | grip: neutral |
| Diamond Push Up (Close Grip Push Up) | Push Ups | grip: close |
| Deficit Push Up | Push Ups | technique: deficit |
| Reverse Grip Pushdown (Underhand Pushdown) | Cable Pushdown | grip: underhand |
| Paused Squat (Pause Squat) | Barbell Back Squat | technique: paused |
| Tempo Squat | Barbell Back Squat | technique: tempo |
| Deficit Deadlift | Conventional Deadlift | technique: deficit |
| Paused Deadlift | Conventional Deadlift | technique: paused |
| Deficit Romanian Deadlift (Deficit RDL) | Romanian Deadlifts | technique: deficit |
| Deficit Reverse Lunge | Dumbbell Reverse Lunge | technique: deficit |
| Rope Hammer Curl (Cable Hammer Curl) | Cable Curls | grip: neutral |
| Wide Grip Barbell Curl | Barbell Curl | grip: wide |
| Close Grip EZ Bar Curl | EZ Bar Curls | grip: close |

### D. New movement patterns (3, all Isolation category)

| Pattern | First exercise | Why it couldn't borrow an existing one |
|---|---|---|
| `Adduction` | Hip Adduction | The only candidate, `Abduction`, is the opposite joint action. |
| `Front Raise` | Dumbbell Front Raise | Filed under `Lateral Raise` it would fill side-delt slots with front-delt work pressing already covers. |
| `Hip Extension` | Cable Glute Kickback | `Hip Hinge` is banned by the lower-back injury filter and implies spinal load; `Hip Thrust` is a different movement. |

### E. Considered and deferred

| Candidate | Why not now | What it needs |
|---|---|---|
| **Assisted pull-up / dip machine** (very common machines) | The stack is *counterweight*: more weight is easier. Every progression branch would read it backwards, and e1RM needs the lifter's bodyweight. | A `loadSense: 'assistance'` flag on the exercise plus the body-weight log (Future milestones): effective load = bodyweight − assistance. |
| Stance variants (sumo/narrow leg press, wide/narrow hack squat, sumo/conventional goblet) | Stance is not a modelled modifier (`docs/set-variations.md` "Not done"). Sumo deadlift is added as an exercise because it carries its own 1RM. | A third variation dimension, `stance`, beside `grip` — same shape, same shift-table mechanism. |
| Power clean / hang clean / snatch | No pattern fits: filed under `Hip Hinge` they would become heavy-axial candidates for hamstring slots; under `Jump` they would compete with box jumps. | A `Power` (Olympic lift) pattern and an athletic slot template that asks for it. |
| Reverse hyper, pullover machine, shrug machine, donkey calf raise | Less common in commercial gyms; the movement is already covered (back extension, straight-arm pulldown, shrugs, standing calf). | Add on demand — aliases can route their names now. |
| Cardio machines (rower, bike, treadmill, sled) | Not lifting; the sport-support goal reads endurance hours from the profile instead. | Cardio awareness v2 (Future milestones). |
| Smith variants of every free-weight lift | An implement swap, not a new movement. Only the Smith incline press (a bodybuilding staple) is added. | The `family` field below would make implement swaps cheap without new rows. |

## Coverage after the audit

**Top 10 per muscle (bodybuilder's picks), by primary muscle in the catalog:**

| Muscle | Count | Catalog |
|---|---|---|
| Chest | 15 | flat/incline/decline barbell, flat & incline dumbbell, machine & incline machine press, Smith incline, pec deck, cable fly, low-to-high cable fly, flat & incline dumbbell fly, dips, push-ups |
| Delts | 18 | barbell/dumbbell/machine/kettlebell/Arnold/landmine/push press, dumbbell/cable/machine lateral raise, cable upright row, front raise, reverse pec deck, dumbbell & cable rear delt fly, face pull, Y raise, external rotation |
| Back (Lats + Upper Back) | 17 | pull-ups, chin-ups, weighted pull-ups, lat pulldown, straight-arm pulldown, pullover, machine high row, single-arm cable row, barbell/dumbbell/kettlebell/Meadows/T-bar/inverted row, seated cable row, chest-supported machine & incline dumbbell row |
| Biceps | 11 | barbell, dumbbell, EZ, incline, hammer, preacher, machine preacher, cable, Bayesian, spider, concentration |
| Triceps | 10 | rope & bar pushdown, cable & dumbbell overhead extension, skull crusher, JM press, close-grip bench, kickback, machine dip, machine extension |
| Quads | 19 | back/front/safety-bar/Smith/hack/pendulum/belt/goblet (DB & KB)/pistol squat, leg press, leg extension, sissy squat, Bulgarian, walking/reverse/front-rack lunge, step-up, box jump |
| Hamstrings | 10 | RDL (barbell, dumbbell, single-leg), stiff-leg deadlift, good morning, seated/lying/standing leg curl, Nordic, GHR |
| Glutes | 9 | hip thrust (barbell, machine), glute bridge, cable kickback, conventional/sumo/trap-bar deadlift, cable pull-through, kettlebell swing |
| Abs + Obliques | 15 | cable/machine crunch, hanging leg raise, captain's chair, reverse crunch, decline sit-up, ab wheel, plank, dead bug, Pallof, side plank, woodchop, rotary torso, suitcase carry, Turkish get-up |
| Calves · Traps · Forearms | 5 · 3 · 4 | Fewer than ten on purpose: the remaining "variants" bodybuilders use for these (toes in/out, smith vs machine shrug, plate pinch) are stance or implement swaps, not distinct movements. |

**Common gym machines:** chest press, incline chest press, pec deck / rear delt, shoulder press,
lateral raise, lat pulldown, seated cable row, chest-supported row, high row, cable station,
dip machine, triceps extension, preacher curl, ab crunch, rotary torso, back extension bench,
captain's chair, GHD, leg press, hack squat, pendulum squat, belt squat, Smith machine, leg
extension, seated / lying / standing leg curl, hip abduction, hip adduction, hip thrust, standing
calf, seated calf, T-bar row — all present. Missing only the assisted pull-up/dip machine (see E).

## Architecture changes

### Implemented

1. **Aliases** (`ALIASES`, `aliasesFor`, `catalogDefForName` in `exercises.ts`). The other names
   a catalog exercise is known by — "RDL", "OHP", "Pec Deck", "Hex Bar Deadlift", "Farmer's
   Walk". Compiled, never synced. Used in three places that previously only knew the exact
   catalog name:
   - **search** (`search.ts`): alias matching, plus spacing-insensitive words ("pulldown" finds
     "Lat Pull Down"), gym shorthand (db / bb / kb / sl) and an optional plural.
   - **creation** (`findExerciseByName`): typing an alias in the picker's create flow reuses the
     catalog identity instead of minting a duplicate custom exercise.
   - **healing** (`catalogDefFor`): a custom exercise someone created *before* the catalog had
     it — `rdl-1782…`, `sumo-deadlift-1782…`, `bent-over-one-arm-dumbbell-row-1782…` — now
     resolves to the catalog definition, so its muscles, difficulty, unit and instructions appear
     with no migration. New ids are `slugify(name)` for exactly this reason. A custom entry named
     by an alias also shadows its catalog namesake in the picker and the substitution pool, so
     the same lift is never offered twice.
2. **Named variants** (`namedVariants.ts`). Variant name → base exercise + grip/technique. The
   picker lists them once something is typed ("Wide Grip Lat Pulldown — Lat Pull Down · wide
   grip") and adding one creates the base exercise's slot with the modifier pinned
   (`Exercise.grip` / `Exercise.technique` already ride the program document), so the card
   pre-selects it, the engines compare it like for like, and the volume accounting sees the shift.
   No schema, sync or worker change.
3. **Three movement patterns** (section D) and the matching injury filters: upright rows are
   excluded for a shoulder issue and the JM press for an elbow issue (by name, because their
   patterns are otherwise safe), and barbell curls for a wrist issue.
4. **Invariant tests** (`catalog.test.ts`): no id/name/alias slug names two exercises; aliases
   resolve; every named variant points at a catalog exercise with a modifier its pattern offers
   and collides with no catalog name; every movement pattern has an exercise; the audit's
   staples can't silently disappear.

### Proposed (not built — each needs a product decision or another milestone first)

1. **Load sense** — `loadSense?: 'assistance'` on `ExerciseDef`, inverting progression for
   assisted machines. Blocked on the body-weight log; until then the honest answer is to leave
   those machines out (section E).
2. **Stance as a third variation dimension** — `stance: 'narrow' | 'wide' | 'sumo' | 'split'`
   beside `grip`, with a shift-table entry for squats and presses (wide stance → adductors and
   glutes up). Unlocks a dozen leg named variants without new rows.
3. **Exercise families** — `family?: string` on `ExerciseDef` grouping implement swaps of one
   movement (barbell / dumbbell / Smith / machine incline press). Would let a 1RM or a progress
   trend transfer approximately across a swap, let substitution prefer "same movement, different
   implement" for travel/home-gym mode, and replace the token-subset same-lift heuristic in
   `substitution.ts`.
4. **Laterality** — `unilateral?: true` so per-side sets can be counted and labelled ("per
   side"), and so a split squat's load isn't compared with a bilateral squat's.
5. **Equipment vocabulary** — `Bench` currently means flat bench, adjustable bench, preacher
   bench and hyperextension bench. Splitting it (and adding `Landmine`, `Trap Bar`, `GHD`)
   would make the equipment-access filter precise. Deferred because every value change must be
   threaded through `applyEquipmentAccess` and the metadata editor's dropdowns.
6. **Catalog revisions in the global layer** — the admin-curated global layer
   (`global_exercises`, audited) can already add exercises without a client release; a
   `catalogRevision` stamp on compiled entries would let the client tell the admin UI which
   global rows the compiled catalog has since absorbed.
