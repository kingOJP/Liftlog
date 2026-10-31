// How to do each exercise.
//
// Compiled catalog data on the same footing as difficultyFor(): app-owned,
// never synced, never a user override. Text only, by decision — no links or
// media to rot, and it works offline in a gym with no signal. Each entry is a
// one-line setup, three to five cues in the order a coach would say them, and
// the faults most people actually make. Custom exercises have no entry and
// the UI says so ("No instructions yet") rather than showing an empty sheet.
//
// Written for someone who has never been shown the movement. Plain words over
// anatomy; every cue is something you can check on yourself mid-set.

import { catalogDefFor } from './exercises';

export interface ExerciseInstructions {
  /** where you stand / sit / grip before the first rep */
  setup: string;
  /** what to do and feel, in order */
  cues: string[];
  /** the common ways it goes wrong */
  faults?: string[];
}

const INSTRUCTIONS: Record<string, ExerciseInstructions> = {
  // ── Chest ────────────────────────────────────────────────────────────────
  'flat-barbell-bench-press': {
    setup: 'Lie on the bench with eyes under the bar, feet flat on the floor, shoulder blades pulled back and down. Grip a little wider than shoulder width.',
    cues: [
      'Unrack and hold the bar over your shoulders with straight arms.',
      'Lower under control to your lower chest, elbows about 45° from your sides.',
      'Touch lightly, then press back up and slightly toward your face.',
      'Keep your shoulder blades pinned and your hips on the bench the whole time.',
    ],
    faults: ['Elbows flared straight out to the sides', 'Bouncing the bar off the chest', 'Hips lifting off the bench on hard reps'],
  },
  'incline-barbell-press': {
    setup: 'Set the bench to 30–45°. Eyes under the bar, shoulder blades back and down, feet planted.',
    cues: [
      'Lower the bar to your upper chest, just below the collarbones.',
      'Keep your elbows under the bar, not flared out.',
      'Press up and slightly back so the bar finishes over your shoulders.',
      'Chest stays up — don’t let the shoulders roll forward at the top.',
    ],
    faults: ['Bench set too steep (becomes a shoulder press)', 'Bar drifting toward the neck'],
  },
  'dumbbell-bench-press': {
    setup: 'Sit with the dumbbells on your thighs, kick them up as you lie back. Feet flat, shoulder blades pulled together.',
    cues: [
      'Start with the dumbbells over your shoulders, palms facing your feet.',
      'Lower slowly until your elbows are level with the bench.',
      'Press up and slightly in — the dumbbells come close without clanging.',
      'Keep your wrists stacked over your elbows all the way through.',
    ],
    faults: ['Dropping the dumbbells too deep and straining the shoulders', 'Losing shoulder-blade position at the bottom'],
  },
  'incline-dumbbell-press': {
    setup: 'Bench at 30–45°. Dumbbells start at shoulder height, palms facing forward, shoulder blades back.',
    cues: [
      'Press up and slightly inward until your arms are straight.',
      'Lower under control until the dumbbells are level with your upper chest.',
      'Keep your elbows roughly 45° from your sides.',
      'Ribs down, lower back lightly on the bench — don’t turn it into a flat press.',
    ],
    faults: ['Arching so much the incline disappears', 'Elbows flared to 90°'],
  },
  'machine-chest-press': {
    setup: 'Adjust the seat so the handles sit at mid-chest. Back flat against the pad, feet planted.',
    cues: [
      'Pull your shoulder blades back into the pad before you push.',
      'Press until your arms are nearly straight — not locked.',
      'Return slowly until you feel a stretch across the chest.',
      'Keep your chest up; the pad holds your back, your shoulders stay down.',
    ],
    faults: ['Shoulders rounding forward at the end of the press', 'Letting the stack slam between reps'],
  },
  'pec-deck-fly': {
    setup: 'Seat high enough that the handles are level with your chest. Slight bend in the elbows, back against the pad.',
    cues: [
      'Squeeze the handles together in a wide arc, like hugging a tree.',
      'Pause for a beat when they meet, feeling the chest contract.',
      'Open back out slowly until you feel a stretch — no further.',
      'Keep the same slight elbow bend for the whole rep.',
    ],
    faults: ['Turning it into a press by bending the elbows', 'Opening too far and straining the shoulders'],
  },
  'cable-fly': {
    setup: 'Pulleys at about chest height, one handle in each hand. Step forward into a staggered stance, slight lean, elbows slightly bent.',
    cues: [
      'Bring your hands together in front of your chest in a wide arc.',
      'Squeeze the chest at the front, hands almost touching.',
      'Let the handles travel back slowly until you feel a stretch.',
      'Your elbow angle doesn’t change — the shoulders do the moving.',
    ],
    faults: ['Pressing the handles instead of sweeping them', 'Shrugging the shoulders up'],
  },
  'dumbbell-fly': {
    setup: 'Lie on a flat bench with the dumbbells over your chest, palms facing each other, elbows slightly bent.',
    cues: [
      'Open your arms out wide in an arc, keeping the elbow bend fixed.',
      'Stop when you feel a stretch across the chest — about chest level.',
      'Bring the dumbbells back up along the same arc and squeeze.',
      'Go lighter than you think; this is a stretch exercise, not a press.',
    ],
    faults: ['Lowering too deep', 'Straightening and bending the elbows (it becomes a press)'],
  },
  'weighted-dips': {
    setup: 'Hang from parallel bars with straight arms, weight on a dip belt. Lean slightly forward, feet crossed behind you.',
    cues: [
      'Lower until your upper arms are about parallel to the floor.',
      'Keep leaning forward to load the chest; upright targets the triceps.',
      'Press back up until your arms are straight, shoulders down.',
      'Control the bottom — no dropping into the stretch.',
    ],
    faults: ['Going so deep the front of the shoulder pinches', 'Shoulders shrugging up toward the ears'],
  },
  'push-ups': {
    setup: 'Hands a little wider than your shoulders, body in a straight line from head to heels, toes on the floor.',
    cues: [
      'Lower your chest toward the floor with elbows about 45° from your sides.',
      'Keep your hips in line — brace like you’re about to be poked in the stomach.',
      'Press back up until your arms are straight.',
      'Too hard? Put your hands on a bench. Too easy? Add a pause or raise your feet.',
    ],
    faults: ['Hips sagging or piking up', 'Neck craning forward'],
  },

  // ── Delts ────────────────────────────────────────────────────────────────
  'barbell-overhead-press': {
    setup: 'Bar racked at upper-chest height. Grip just outside your shoulders, elbows slightly in front of the bar, feet hip width.',
    cues: [
      'Squeeze your glutes and brace your stomach before you press.',
      'Press straight up, moving your head back slightly to let the bar pass.',
      'Finish with the bar over the middle of your foot, arms locked, head through.',
      'Lower back to the collarbones under control.',
    ],
    faults: ['Leaning back and turning it into an incline press', 'Bar drifting forward away from the face'],
  },
  'seated-db-overhead-press': {
    setup: 'Bench upright or just short of it. Dumbbells at shoulder height, palms forward, feet planted.',
    cues: [
      'Press up until your arms are straight, dumbbells coming slightly together.',
      'Lower until the dumbbells are at about ear level.',
      'Keep your ribs down — no arching off the backrest.',
      'Wrists stacked over elbows throughout.',
    ],
    faults: ['Flaring the lower back off the pad', 'Half reps that never reach ear level'],
  },
  'machine-shoulder-press': {
    setup: 'Seat set so the handles start at about shoulder height. Back against the pad, feet planted.',
    cues: [
      'Press up until your arms are nearly straight.',
      'Lower slowly to shoulder height, elbows pointing down and slightly forward.',
      'Keep your head neutral and your shoulders down away from your ears.',
    ],
    faults: ['Starting the handles too low and straining the shoulders', 'Shrugging on every rep'],
  },
  'kettlebell-single-arm-press': {
    setup: 'Clean the kettlebell to the rack position: bell resting on the back of the forearm, elbow tucked, wrist straight.',
    cues: [
      'Brace your stomach and squeeze the glute on the pressing side.',
      'Press straight up, rotating the palm to face forward as you go.',
      'Finish with your bicep by your ear and the bell stacked over your shoulder.',
      'Lower back into the rack under control — don’t let it drop.',
    ],
    faults: ['Leaning away from the bell', 'Wrist bending back under the load'],
  },
  'dumbbell-lateral-raises': {
    setup: 'Stand tall with a dumbbell in each hand at your sides, slight bend in the elbows, slight lean forward.',
    cues: [
      'Raise your arms out to the sides until they’re about shoulder height.',
      'Lead with the elbows, not the hands — pinkies slightly higher than thumbs.',
      'Pause a beat at the top, then lower slowly.',
      'Keep your shoulders down; no shrugging the weight up.',
    ],
    faults: ['Swinging the weight up with the hips', 'Going above shoulder height'],
  },
  'cable-lateral-raises': {
    setup: 'Low pulley, handle in the hand furthest from the machine, cable crossing in front of your body.',
    cues: [
      'Raise the arm out to the side until the hand is at shoulder height.',
      'Lead with the elbow and keep a slight bend in it.',
      'Lower slowly — the cable keeps tension on the whole way down.',
      'Stay tall; don’t lean away to help the weight up.',
    ],
    faults: ['Shrugging the shoulder up', 'Using momentum from the torso'],
  },
  'machine-lateral-raise': {
    setup: 'Adjust the seat so your shoulders line up with the machine’s pivot. Arms against the pads at your sides.',
    cues: [
      'Push the pads out and up with your elbows until your arms are about parallel.',
      'Pause at the top, then lower under control.',
      'Keep your torso still and your shoulders down.',
    ],
    faults: ['Driving with the hands instead of the elbows', 'Heaving the stack up with the body'],
  },
  'face-pulls': {
    setup: 'Rope on a high pulley. Hold the ends with palms facing in, step back until your arms are straight.',
    cues: [
      'Pull the rope toward your face, elbows high and wide.',
      'Finish with your hands beside your ears, like flexing your biceps.',
      'Squeeze your shoulder blades together at the back.',
      'Return slowly to straight arms.',
    ],
    faults: ['Pulling to the chest instead of the face', 'Leaning back to move heavier weight'],
  },
  'reverse-pec-deck': {
    setup: 'Face the pad with the handles set in front of you at shoulder height. Slight bend in the elbows.',
    cues: [
      'Sweep your arms back in a wide arc until they’re in line with your shoulders.',
      'Squeeze your shoulder blades together at the end.',
      'Return slowly without letting the handles pull your shoulders forward.',
    ],
    faults: ['Bending the elbows and rowing the weight', 'Shrugging as the arms go back'],
  },
  'dumbbell-rear-delt-fly': {
    setup: 'Hinge at the hips until your torso is nearly parallel to the floor (or lie face down on an incline bench). Dumbbells hanging, palms facing each other.',
    cues: [
      'Raise the dumbbells out to the sides, leading with the elbows.',
      'Stop when your arms are level with your shoulders.',
      'Squeeze the back of the shoulders at the top, then lower slowly.',
      'Keep your neck neutral — look at the floor, not forward.',
    ],
    faults: ['Standing up as the weight goes up', 'Swinging the dumbbells'],
  },
  'db-y-raise': {
    setup: 'Lie face down on an incline bench with light dumbbells hanging, thumbs pointing up.',
    cues: [
      'Raise your arms up and out so they form a Y with your body.',
      'Lead with the thumbs; keep your shoulders away from your ears.',
      'Pause at the top, then lower slowly.',
      'Very light weight — if you have to swing, it’s too heavy.',
    ],
    faults: ['Shrugging the shoulders up', 'Lifting the chest off the bench'],
  },
  'db-external-rotation': {
    setup: 'Lie on your side with a light dumbbell in your top hand, elbow bent to 90° and tucked against your ribs.',
    cues: [
      'Rotate your forearm up toward the ceiling, keeping the elbow pinned to your side.',
      'Stop when the forearm is just past vertical.',
      'Lower slowly back to the start.',
      'Light and slow — this is about control, not load.',
    ],
    faults: ['Elbow drifting away from the ribs', 'Rushing the lowering half'],
  },

  // ── Traps ────────────────────────────────────────────────────────────────
  'barbell-shrugs': {
    setup: 'Stand holding the bar in front of your thighs, arms straight, shoulders relaxed.',
    cues: [
      'Shrug your shoulders straight up toward your ears.',
      'Hold the top for a second.',
      'Lower slowly until you feel a stretch.',
      'Straight up and down — don’t roll the shoulders in circles.',
    ],
    faults: ['Rolling the shoulders', 'Bending the elbows to help'],
  },
  'dumbbell-shrugs': {
    setup: 'Stand tall with a dumbbell in each hand at your sides, palms facing in.',
    cues: [
      'Shrug straight up toward your ears, keeping the arms straight.',
      'Pause at the top and squeeze.',
      'Lower slowly all the way down.',
    ],
    faults: ['Rolling the shoulders', 'Using the legs to bounce the weight'],
  },

  // ── Back ─────────────────────────────────────────────────────────────────
  'barbell-rows': {
    setup: 'Hinge at the hips until your torso is around 45° or lower, knees soft, bar hanging below your shoulders. Grip just outside your knees.',
    cues: [
      'Brace your stomach and keep your back flat.',
      'Pull the bar to your lower ribs, elbows travelling back past your torso.',
      'Squeeze your shoulder blades together at the top.',
      'Lower under control without letting your torso rise.',
    ],
    faults: ['Standing up as you pull (a hip heave)', 'Rounding the lower back'],
  },
  'bent-over-db-row': {
    setup: 'One hand and one knee on a bench, the other foot on the floor. Dumbbell hanging straight down, back flat.',
    cues: [
      'Pull the dumbbell to your hip, elbow going back and up.',
      'Keep your shoulders square to the floor — don’t twist.',
      'Squeeze at the top, then lower all the way to a stretch.',
    ],
    faults: ['Rotating the torso to lift more', 'Pulling to the shoulder instead of the hip'],
  },
  'kettlebell-single-arm-row': {
    setup: 'Hinge at the hips with one hand braced on a bench or your knee, kettlebell hanging from the other hand.',
    cues: [
      'Row the bell to your hip, elbow close to your side.',
      'Keep your hips and shoulders square — no twisting for extra reach.',
      'Pause at the top, then lower under control.',
    ],
    faults: ['Shrugging the shoulder up', 'Rotating the torso'],
  },
  'seated-cable-row': {
    setup: 'Sit with feet on the platform, knees slightly bent, torso upright, holding the handle with straight arms.',
    cues: [
      'Pull the handle to your lower chest, elbows going straight back.',
      'Squeeze your shoulder blades together at the end.',
      'Let your arms straighten fully and your shoulders reach forward on the return.',
      'Torso stays upright — a little lean is fine, a rocking chair is not.',
    ],
    faults: ['Leaning back to finish the rep', 'Short reps that never reach a stretch'],
  },
  'chest-supported-row': {
    setup: 'Chest against the pad, feet planted, handles held with straight arms.',
    cues: [
      'Pull the handles back until your elbows pass your torso.',
      'Squeeze your shoulder blades together at the top.',
      'Lower slowly until your arms are straight and your shoulders are stretched forward.',
      'Keep your chest glued to the pad — no lifting off to cheat.',
    ],
    faults: ['Chest coming off the pad', 'Shrugging instead of pulling'],
  },
  't-bar-row': {
    setup: 'Straddle the bar, hinge at the hips with a flat back, and grip the handle below your chest.',
    cues: [
      'Pull the handle to your chest, elbows driving back.',
      'Squeeze your shoulder blades together at the top.',
      'Lower under control until your arms are straight.',
      'Keep the hip hinge the whole set — don’t stand up as you pull.',
    ],
    faults: ['Jerking the weight with the hips', 'Rounding the lower back'],
  },
  'lat-pull-down': {
    setup: 'Sit with your thighs under the pads. Grip the bar a bit wider than shoulder width, lean back slightly.',
    cues: [
      'Pull the bar down to your upper chest, elbows driving down and back.',
      'Think about pulling your elbows into your back pockets.',
      'Squeeze at the bottom, then let the bar rise slowly to a full stretch.',
      'Keep your chest up; don’t curl your torso forward.',
    ],
    faults: ['Pulling behind the neck', 'Leaning way back and rowing it'],
  },
  'straight-arm-pulldowns': {
    setup: 'Face a high pulley with a bar or rope, arms straight, slight hinge at the hips.',
    cues: [
      'Sweep your arms down in an arc until your hands reach your thighs.',
      'Keep your elbows almost straight the whole way.',
      'Squeeze your lats at the bottom, then let the arms rise slowly.',
    ],
    faults: ['Bending the elbows (it becomes a tricep pushdown)', 'Bobbing the torso'],
  },
  'dumbbell-pullover': {
    setup: 'Lie across or along a bench, holding one dumbbell with both hands over your chest, arms nearly straight.',
    cues: [
      'Lower the dumbbell in an arc behind your head until you feel a stretch in the lats.',
      'Keep a slight, fixed bend in the elbows.',
      'Pull it back over your chest along the same arc.',
      'Ribs stay down — don’t let the lower back arch to go further.',
    ],
    faults: ['Bending the elbows into a tricep extension', 'Arching the back excessively'],
  },
  'weighted-pull-ups': {
    setup: 'Hang from the bar with palms facing away, a little wider than shoulder width, weight on a dip belt.',
    cues: [
      'Start each rep from a dead hang with shoulders pulled down.',
      'Pull your chest toward the bar, elbows driving down.',
      'Get your chin clearly over the bar, then lower all the way down under control.',
    ],
    faults: ['Kipping or swinging', 'Half reps from a bent-arm start'],
  },
  'chin-ups': {
    setup: 'Hang from the bar with palms facing you, hands about shoulder width apart.',
    cues: [
      'Pull your shoulders down first, then drive your elbows toward your ribs.',
      'Pull until your chin is over the bar.',
      'Lower slowly all the way to straight arms.',
      'Not there yet? Use a band or a machine assist and keep the same form.',
    ],
    faults: ['Swinging the legs', 'Stopping short at the bottom'],
  },

  // ── Posterior chain / hinges ─────────────────────────────────────────────
  'conventional-deadlift': {
    setup: 'Bar over the middle of your feet, feet hip width. Hinge down and grip just outside your legs, shins touching the bar, back flat, chest up.',
    cues: [
      'Take the slack out of the bar — pull until you feel it tight — before you drive.',
      'Push the floor away with your legs; the hips and shoulders rise together.',
      'Keep the bar dragging up your shins and thighs.',
      'Finish tall with glutes squeezed — no leaning back.',
      'Lower by pushing the hips back first, then bending the knees once the bar passes them.',
    ],
    faults: ['Rounding the lower back off the floor', 'Hips shooting up first', 'Bar drifting away from the legs'],
  },
  'romanian-deadlifts': {
    setup: 'Stand holding the bar against your thighs, feet hip width, knees soft.',
    cues: [
      'Push your hips straight back as the bar slides down your thighs.',
      'Keep your back flat and the bar close — it should brush your legs.',
      'Stop when you feel a strong stretch in the hamstrings, usually around the knees or just below.',
      'Drive the hips forward to stand, squeezing the glutes at the top.',
    ],
    faults: ['Bending the knees and squatting it', 'Rounding the back to reach lower'],
  },
  'dumbbell-rdl': {
    setup: 'Stand with a dumbbell in each hand in front of your thighs, feet hip width, knees soft.',
    cues: [
      'Hips back, dumbbells sliding down the front of your legs.',
      'Back flat, chest up, eyes on the floor a few feet ahead.',
      'Lower until the hamstrings are stretched, then stand by driving the hips forward.',
    ],
    faults: ['Dumbbells drifting forward away from the legs', 'Turning it into a squat'],
  },
  'single-leg-rdl': {
    setup: 'Stand on one leg with a dumbbell in the opposite hand (or both hands). Soft knee on the standing leg.',
    cues: [
      'Hinge forward, pushing the standing hip back as the free leg extends behind you.',
      'Keep the hips level — the back foot points at the floor, not the wall.',
      'Lower until you feel the hamstring stretch, then drive the hip forward to stand.',
      'Go slow; balance is part of the exercise.',
    ],
    faults: ['Hips opening to the side', 'Rounding the back'],
  },
  'good-mornings': {
    setup: 'Bar on your upper back as for a squat, feet hip width, knees soft.',
    cues: [
      'Push your hips back and let your torso tip forward, back flat.',
      'Stop when you feel a strong hamstring stretch — usually torso near parallel.',
      'Drive the hips forward to stand tall.',
      'Keep it light; this is a hinge, not a squat with a bar on your neck.',
    ],
    faults: ['Rounding the back', 'Bending the knees too much'],
  },
  'cable-pull-through': {
    setup: 'Face away from a low pulley with the rope between your legs, feet shoulder width, a step forward from the stack.',
    cues: [
      'Push your hips back and let the rope pull your hands between your legs.',
      'Keep your back flat and knees soft.',
      'Drive the hips forward and squeeze the glutes to stand tall.',
      'Your arms stay straight — they’re just hooks.',
    ],
    faults: ['Pulling with the arms', 'Squatting instead of hinging'],
  },
  'kettlebell-swing': {
    setup: 'Kettlebell on the floor a foot in front of you. Hinge, grip it with both hands, shoulders above the hips, back flat.',
    cues: [
      'Hike the bell back between your legs like snapping a football.',
      'Snap your hips forward hard; the arms just follow the bell up to about chest height.',
      'At the top: stand tall, glutes squeezed, ribs down.',
      'Let the bell fall and hinge again as the forearms reach your thighs.',
    ],
    faults: ['Squatting the swing', 'Lifting the bell with the arms and shoulders', 'Leaning back at the top'],
  },
  'back-extensions': {
    setup: 'Set the pad at the top of your thighs, feet locked in. Cross your arms or hold a plate at your chest.',
    cues: [
      'Lower your torso by hinging at the hips, back flat.',
      'Rise until your body forms a straight line — not past it.',
      'Squeeze the glutes and hamstrings at the top.',
      'Move slowly; no bouncing at the bottom.',
    ],
    faults: ['Hyperextending the lower back at the top', 'Rounding at the bottom'],
  },
  'hip-thrusts': {
    setup: 'Upper back on a bench, bar across your hips (pad it), feet flat and about shoulder width.',
    cues: [
      'Drive through your heels and push your hips up until they’re level with your knees and shoulders.',
      'Squeeze the glutes hard at the top; keep your ribs down and chin tucked.',
      'Shins should be vertical at the top — adjust your feet if not.',
      'Lower under control and tap, don’t rest.',
    ],
    faults: ['Arching the lower back instead of extending the hips', 'Feet too far forward (hamstrings take over)'],
  },

  // ── Quads / squats / lunges ──────────────────────────────────────────────
  'barbell-back-squat': {
    setup: 'Bar on your upper back, hands just outside your shoulders. Step back, feet shoulder width, toes slightly out.',
    cues: [
      'Take a big breath and brace your stomach before each rep.',
      'Sit down between your legs, knees tracking over your toes.',
      'Go as deep as you can keep a flat back — aim for thighs at least parallel.',
      'Drive up through the whole foot, chest and hips rising together.',
    ],
    faults: ['Knees caving inward', 'Chest dropping and hips shooting up', 'Heels lifting'],
  },
  'smith-machine-squat': {
    setup: 'Bar on your upper back, feet slightly in front of the bar so you can sit straight down.',
    cues: [
      'Unhook, brace, and sit down until your thighs are at least parallel.',
      'Knees track over the toes; let the fixed bar path guide you.',
      'Drive up through the heels and mid-foot.',
    ],
    faults: ['Feet directly under the bar (forces the knees forward)', 'Bouncing out of the bottom'],
  },
  'hack-squat': {
    setup: 'Back and shoulders against the pads, feet shoulder width in the middle of the platform.',
    cues: [
      'Release the safeties and lower under control until your thighs are at least parallel.',
      'Keep your whole foot on the platform.',
      'Drive up without locking the knees out hard at the top.',
    ],
    faults: ['Heels lifting (feet too low)', 'Slamming into the bottom'],
  },
  'leg-press': {
    setup: 'Sit with your back and hips flat against the pad, feet shoulder width in the middle of the platform.',
    cues: [
      'Lower the platform until your knees are around 90° or a little deeper.',
      'Keep your hips on the seat — if your lower back rounds off, you went too deep.',
      'Press through the whole foot until your legs are nearly straight.',
      'Don’t lock the knees at the top.',
    ],
    faults: ['Lower back lifting off the pad', 'Knees caving in', 'Locking out hard'],
  },
  'goblet-squat': {
    setup: 'Hold a dumbbell vertically against your chest, elbows pointing down, feet shoulder width.',
    cues: [
      'Sit straight down between your knees, elbows inside them at the bottom.',
      'Keep your chest tall and the weight glued to it.',
      'Drive up through the whole foot.',
    ],
    faults: ['Leaning forward and letting the weight pull you down', 'Knees caving in'],
  },
  'kettlebell-goblet-squat': {
    setup: 'Hold the kettlebell by the horns against your chest, elbows down, feet shoulder width.',
    cues: [
      'Sit down between your legs, elbows brushing the inside of your knees.',
      'Stay tall through the chest, bell tight to the body.',
      'Drive up through the whole foot and stand tall.',
    ],
    faults: ['Rounding forward over the bell', 'Heels lifting'],
  },
  'bulgarian-split-squat': {
    setup: 'Rear foot on a bench behind you, front foot far enough forward that your knee stays over the foot at the bottom.',
    cues: [
      'Lower straight down until your back knee is just off the floor.',
      'Keep most of your weight on the front foot.',
      'Drive up through the front heel.',
      'A slight forward lean loads the glute more; upright loads the quad more.',
    ],
    faults: ['Front foot too close (knee far past toes)', 'Pushing off the back foot'],
  },
  'walking-lunges': {
    setup: 'Stand tall with dumbbells at your sides (or bodyweight), enough space to step forward.',
    cues: [
      'Step forward and lower until both knees are around 90°, back knee just off the floor.',
      'Keep your torso upright and your front knee over the foot.',
      'Drive through the front foot and step straight into the next lunge.',
    ],
    faults: ['Short steps that drive the knee past the toes', 'Leaning forward'],
  },
  'kettlebell-front-rack-lunge': {
    setup: 'Kettlebell in the rack position (bell on the forearm, elbow tucked), feet hip width.',
    cues: [
      'Step back into a reverse lunge until the back knee is just off the floor.',
      'Stay tall — the bell will try to pull you forward; don’t let it.',
      'Drive through the front foot to return to standing.',
      'Alternate sides, or do all reps on one side.',
    ],
    faults: ['Leaning toward the bell', 'Front knee caving inward'],
  },
  'dumbbell-step-up': {
    setup: 'Stand facing a box or bench about knee height, dumbbells at your sides.',
    cues: [
      'Place your whole foot on the box and drive through it to stand up.',
      'Don’t push off the trailing foot — it comes up for the ride.',
      'Lower slowly back down under control.',
      'Finish all reps on one leg before switching.',
    ],
    faults: ['Bouncing off the back leg', 'Knee caving in on the step'],
  },
  'leg-extension': {
    setup: 'Sit with your back against the pad and the roller on your shins just above the ankles. Knees in line with the machine’s pivot.',
    cues: [
      'Straighten your legs until they’re fully extended.',
      'Pause a beat at the top and squeeze the quads.',
      'Lower slowly — the way down counts.',
    ],
    faults: ['Kicking the weight up', 'Hips lifting off the seat'],
  },

  // ── Hamstrings / glutes / hips ───────────────────────────────────────────
  'seated-leg-curl': {
    setup: 'Sit with the back pad snug, thigh pad locked down, roller above your heels. Knees in line with the pivot.',
    cues: [
      'Curl your heels down and back as far as they’ll go.',
      'Pause at the bottom and squeeze the hamstrings.',
      'Return slowly until your legs are nearly straight.',
    ],
    faults: ['Hips sliding forward', 'Letting the weight yank the legs back up'],
  },
  'lying-leg-curl': {
    setup: 'Lie face down with the roller above your heels and your knees just off the edge of the pad.',
    cues: [
      'Curl your heels toward your glutes.',
      'Keep your hips pressed into the pad — no lifting.',
      'Lower slowly to nearly straight legs.',
    ],
    faults: ['Hips popping up off the bench', 'Jerking the weight up'],
  },
  'hip-abduction': {
    setup: 'Sit with your back against the pad and the pads against the outside of your knees.',
    cues: [
      'Push your knees apart against the pads.',
      'Hold the open position for a second.',
      'Return slowly without letting the stack rest.',
      'Lean slightly forward to feel more in the glutes.',
    ],
    faults: ['Rocking the torso', 'Bouncing the pads'],
  },
  'banded-hip-abduction': {
    setup: 'Band just above your knees, feet hip width, knees slightly bent (standing, seated or side-lying).',
    cues: [
      'Push your knees apart against the band.',
      'Hold at the widest point, then return slowly.',
      'Keep your feet planted and your torso still.',
    ],
    faults: ['Leaning side to side', 'Letting the band snap the knees back in'],
  },

  // ── Calves ───────────────────────────────────────────────────────────────
  'standing-calf-raises': {
    setup: 'Balls of your feet on the edge of a step or platform, heels hanging off, shoulders under the pads or a dumbbell in hand.',
    cues: [
      'Lower your heels until you feel a full stretch in the calves.',
      'Rise up onto your toes as high as you can.',
      'Pause at the top for a second.',
      'Slow on the way down — no bouncing.',
    ],
    faults: ['Bouncing out of the stretch', 'Bending the knees to help'],
  },
  'seated-calf-raises': {
    setup: 'Sit with the pads on your lower thighs and the balls of your feet on the platform.',
    cues: [
      'Lower your heels for a full stretch.',
      'Press up onto your toes and pause at the top.',
      'Lower slowly, three seconds down.',
    ],
    faults: ['Short, bouncy reps', 'Rocking the weight with the body'],
  },
  'leg-press-calf-raise': {
    setup: 'On the leg press, legs straight (not locked), balls of your feet on the bottom edge of the platform.',
    cues: [
      'Let your heels drop for a full stretch.',
      'Push the platform away with your toes as far as you can.',
      'Pause at the top and lower slowly.',
    ],
    faults: ['Bending the knees to push', 'Partial reps'],
  },
  'single-leg-calf-raise': {
    setup: 'Ball of one foot on a step, heel hanging off, the other foot tucked behind. Hold something for balance.',
    cues: [
      'Lower the heel slowly until you feel a full stretch.',
      'Rise onto your toes as high as you can.',
      'Pause at the top; take two or three seconds to lower.',
      'Tendon work likes it slow and heavy — don’t rush.',
    ],
    faults: ['Bouncing', 'Ankle rolling outward at the top'],
  },

  // ── Triceps ──────────────────────────────────────────────────────────────
  'close-grip-bench-press': {
    setup: 'Lie on the bench, grip about shoulder width (not narrower), shoulder blades back, feet planted.',
    cues: [
      'Lower the bar to your lower chest with elbows tucked close to your sides.',
      'Press back up, keeping the elbows in.',
      'Wrists straight, bar over the forearms.',
    ],
    faults: ['Grip too narrow (hurts the wrists)', 'Elbows flaring'],
  },
  'skull-crushers': {
    setup: 'Lie on a bench holding an EZ bar or dumbbells over your shoulders, arms straight.',
    cues: [
      'Bend only at the elbows, lowering the weight toward your forehead or just behind it.',
      'Keep your upper arms still and pointing at the ceiling.',
      'Extend back to straight without locking out hard.',
    ],
    faults: ['Elbows flaring out', 'Upper arms drifting back and forth (it becomes a pullover)'],
  },
  'overhead-tricep-ext': {
    setup: 'Face away from a high pulley holding a rope overhead, elbows bent and pointing forward, slight forward lean.',
    cues: [
      'Extend your arms forward and up until they’re straight.',
      'Keep your elbows close to your head — they shouldn’t drift apart.',
      'Return slowly until you feel the stretch behind the arms.',
    ],
    faults: ['Elbows flaring wide', 'Arching the back to lift more'],
  },
  'tricep-cable-pushdown': {
    setup: 'Face a high pulley with a rope, elbows tucked at your sides and bent to about 90°.',
    cues: [
      'Push the rope down until your arms are straight, spreading the ends apart at the bottom.',
      'Keep your elbows pinned to your sides.',
      'Return slowly to 90° — no higher.',
    ],
    faults: ['Elbows drifting forward', 'Leaning on the weight with the whole body'],
  },
  'cable-pushdown': {
    setup: 'Face a high pulley with a straight or V bar, elbows at your sides bent to about 90°.',
    cues: [
      'Push the bar down until your arms are straight.',
      'Squeeze the triceps at the bottom.',
      'Let the bar rise slowly to about chest height, elbows staying put.',
    ],
    faults: ['Shoulders rounding forward to help', 'Elbows swinging out and back'],
  },
  'cable-kick-backs': {
    setup: 'Low pulley, handle in one hand. Hinge forward with the upper arm held parallel to the floor, elbow bent.',
    cues: [
      'Straighten the arm behind you until it’s in line with your torso.',
      'Pause and squeeze, then bend the elbow slowly back to 90°.',
      'The upper arm never moves — only the forearm swings.',
    ],
    faults: ['Dropping the elbow', 'Swinging the weight'],
  },

  // ── Biceps / forearms ────────────────────────────────────────────────────
  'ez-bar-curls': {
    setup: 'Stand tall holding the EZ bar on the angled grips, arms straight, elbows at your sides.',
    cues: [
      'Curl the bar up to shoulder height, keeping your elbows by your ribs.',
      'Squeeze at the top, then lower slowly all the way to straight.',
      'Shoulders stay back and down — no swinging the torso.',
    ],
    faults: ['Elbows drifting forward', 'Using the hips to swing the bar up'],
  },
  'incline-db-curls': {
    setup: 'Sit on an incline bench around 45–60°, dumbbells hanging straight down at your sides, palms forward.',
    cues: [
      'Curl both dumbbells up without letting your elbows move forward.',
      'Squeeze at the top, then lower slowly to a full stretch.',
      'Keep your shoulders back against the bench.',
    ],
    faults: ['Elbows swinging forward', 'Shoulders rolling forward at the top'],
  },
  'hammer-curls': {
    setup: 'Stand tall with dumbbells at your sides, palms facing in toward your thighs.',
    cues: [
      'Curl the dumbbells up keeping the thumbs on top, like swinging a hammer.',
      'Elbows stay at your sides.',
      'Lower slowly to straight arms.',
    ],
    faults: ['Swinging from the shoulders', 'Half reps that never straighten'],
  },
  'preacher-curls': {
    setup: 'Sit with your upper arms flat on the pad, armpits at the top edge, holding the bar with an underhand grip.',
    cues: [
      'Curl the bar up until your forearms are vertical.',
      'Lower slowly until your arms are nearly straight — stop just short of locking out.',
      'Keep your upper arms glued to the pad the whole time.',
    ],
    faults: ['Lifting the elbows off the pad', 'Bouncing out of the bottom'],
  },
  'cable-curls': {
    setup: 'Face a low pulley with a straight bar, arms straight, elbows at your sides.',
    cues: [
      'Curl the bar to shoulder height, elbows staying at your ribs.',
      'Squeeze at the top.',
      'Lower slowly — the cable keeps tension all the way down.',
    ],
    faults: ['Leaning back as the bar comes up', 'Elbows drifting forward'],
  },
  'reverse-curls': {
    setup: 'Stand holding a bar with an overhand grip (knuckles up), arms straight, elbows at your sides.',
    cues: [
      'Curl the bar up, keeping your wrists straight and knuckles pointing up.',
      'Elbows stay by your sides.',
      'Lower slowly all the way to straight.',
    ],
    faults: ['Wrists bending back', 'Swinging the torso'],
  },
  'wrist-curls': {
    setup: 'Sit with your forearms resting on your thighs or a bench, wrists hanging over the edge, palms up, holding a bar or dumbbells.',
    cues: [
      'Let the weight roll down to your fingertips.',
      'Curl it back up by flexing the wrists as far as they go.',
      'Keep your forearms still — only the wrists move.',
    ],
    faults: ['Lifting the forearms off the support', 'Going too heavy and using tiny range'],
  },

  // ── Core ─────────────────────────────────────────────────────────────────
  'cable-crunch': {
    setup: 'Kneel facing a high pulley, rope held beside your head, hips stacked over your knees.',
    cues: [
      'Crunch down by rounding your spine, bringing your elbows toward your thighs.',
      'Keep your hips still — don’t sit back onto your heels.',
      'Return slowly until your torso is upright and your abs are stretched.',
    ],
    faults: ['Pulling with the arms', 'Hinging at the hips instead of curling the spine'],
  },
  'hanging-leg-raise': {
    setup: 'Hang from a bar with straight arms, shoulders pulled down slightly, legs together.',
    cues: [
      'Raise your legs (knees bent to start, straight when stronger) until your thighs pass parallel.',
      'Curl your pelvis up at the top — that’s the part that works the abs.',
      'Lower slowly without swinging.',
    ],
    faults: ['Swinging to generate momentum', 'Only moving at the hips and never curling the pelvis'],
  },
  'machine-crunch': {
    setup: 'Sit with your back against the pad and the handles or chest pad in position, feet planted.',
    cues: [
      'Crunch forward by rounding your upper back toward your hips.',
      'Pause and squeeze at the bottom.',
      'Return slowly until your abs are fully stretched.',
    ],
    faults: ['Pulling with the arms', 'Rocking at the hips'],
  },
  'plank': {
    setup: 'Forearms on the floor, elbows under your shoulders, feet together, body in one straight line.',
    cues: [
      'Squeeze your glutes and tuck your pelvis slightly so your lower back is flat.',
      'Push the floor away through your forearms; don’t sag between the shoulders.',
      'Breathe normally — holding your breath isn’t bracing.',
      'Stop the set when the hips start to sag; a sloppy plank trains nothing.',
    ],
    faults: ['Hips sagging or piking up', 'Head dropping toward the floor'],
  },
  'side-plank': {
    setup: 'Lie on your side, forearm on the floor with the elbow under your shoulder, feet stacked or staggered.',
    cues: [
      'Lift your hips until your body is a straight line from head to feet.',
      'Push the floor away through the forearm; keep the shoulder stacked over the elbow.',
      'Hold still — no sagging hips, no rotating forward or back.',
    ],
    faults: ['Hips dropping toward the floor', 'Torso rolling forward'],
  },
  'copenhagen-plank': {
    setup: 'Lie on your side with your top leg resting on a bench (knee or ankle on it), bottom leg underneath, forearm under your shoulder.',
    cues: [
      'Lift your hips and squeeze the top leg down into the bench to hold yourself up.',
      'Body in one straight line, bottom leg lifted off the floor.',
      'Start with the knee on the bench — it’s much easier than the ankle.',
      'Stop early if the groin cramps; build the time gradually.',
    ],
    faults: ['Hips sagging', 'Resting the bottom leg on the floor'],
  },
  'dead-bug': {
    setup: 'Lie on your back with arms pointing at the ceiling and hips and knees bent to 90°. Press your lower back into the floor.',
    cues: [
      'Slowly lower one arm overhead and the opposite leg toward the floor.',
      'Only go as far as you can keep your lower back pressed down.',
      'Return and switch sides, exhaling as you extend.',
      'Slow is the point — count three seconds out and three back.',
    ],
    faults: ['Lower back arching off the floor', 'Rushing the reps'],
  },
  'pallof-press': {
    setup: 'Stand side-on to a cable at chest height, both hands on the handle at your sternum, feet shoulder width.',
    cues: [
      'Press the handle straight out in front of your chest.',
      'Resist the cable pulling you toward the machine — stay perfectly square.',
      'Hold for a beat with arms straight, then bring it back to your chest.',
      'Brace your stomach and squeeze your glutes the whole set.',
    ],
    faults: ['Torso rotating toward the stack', 'Leaning away to compensate'],
  },
  'kettlebell-turkish-get-up': {
    setup: 'Lie on your back with the kettlebell pressed up in one hand, same-side knee bent, opposite arm and leg out at 45°.',
    cues: [
      'Roll up onto your free elbow, then your hand, eyes on the bell the whole way.',
      'Lift the hips, sweep the straight leg back under you to a kneeling position.',
      'Stand up with the arm locked out, then reverse every step back to the floor.',
      'Learn it with a shoe balanced on your fist before adding any weight.',
    ],
    faults: ['Bending the pressing arm', 'Rushing the transitions', 'Looking away from the bell'],
  },

  // ── Carries ──────────────────────────────────────────────────────────────
  'farmer-carry': {
    setup: 'Deadlift a heavy dumbbell or kettlebell in each hand. Stand tall, shoulders back and down.',
    cues: [
      'Walk with short, quick steps, staying tall.',
      'Keep your ribs down and your stomach braced — don’t lean back.',
      'Grip hard; don’t let the weights swing.',
      'Set them down with a hinge, not a round.',
    ],
    faults: ['Shoulders rolling forward', 'Leaning to one side or back'],
  },
  'kettlebell-suitcase-carry': {
    setup: 'Deadlift one heavy kettlebell in one hand, like picking up a suitcase. Stand tall.',
    cues: [
      'Walk tall and level — the bell will try to pull you sideways; don’t let it.',
      'Brace your stomach and keep your shoulders square.',
      'Short, controlled steps; switch hands halfway.',
    ],
    faults: ['Leaning away from the bell', 'Letting the loaded shoulder drop'],
  },

  // ── Power ────────────────────────────────────────────────────────────────
  'pogo-hops': {
    setup: 'Stand tall, feet hip width, knees nearly straight, arms relaxed.',
    cues: [
      'Bounce on the balls of your feet using your ankles, knees nearly locked.',
      'Spend as little time on the ground as you can — think hot floor.',
      'Stay tall; the height comes from the calves and ankles, not the knees.',
      'Keep sets short and crisp; stop when the bounce gets slow.',
    ],
    faults: ['Bending the knees to jump higher', 'Landing on the heels'],
  },
  'box-jump': {
    setup: 'Stand a short step from a box you can land on softly, feet hip width.',
    cues: [
      'Dip quickly, swing your arms, and jump onto the box.',
      'Land softly with both feet flat, knees over toes, in a quarter squat.',
      'Stand up fully on the box, then step down — don’t jump down.',
      'Pick a box height you land softly on, not the highest one you can reach.',
    ],
    faults: ['Landing in a deep squat (box too high)', 'Jumping down off the box'],
  },
};

/**
 * Instructions for an exercise, resolving timestamped custom copies of a
 * catalog exercise (back-extensions-1782… → back-extensions). Null for a
 * custom exercise with no catalog namesake — the UI says "No instructions
 * yet" rather than inventing something.
 */
export function instructionsFor(id: string): ExerciseInstructions | null {
  const direct = INSTRUCTIONS[id];
  if (direct) return direct;
  const def = catalogDefFor(id);
  return def ? (INSTRUCTIONS[def.id] ?? null) : null;
}

/** Catalog ids with an entry — exported for the catalog invariant test. */
export const INSTRUCTED_IDS: ReadonlySet<string> = new Set(Object.keys(INSTRUCTIONS));
