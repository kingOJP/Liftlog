import type { ExerciseMuscles, ExerciseDetails } from '../db/database';

// Fill in null values and call seedExerciseData() once to populate IndexedDB.
// Existing records are never overwritten — safe to run multiple times.

export const EXERCISE_MUSCLES_SEED: ExerciseMuscles[] = [
  // Chest
  { exerciseId: 'incline-barbell-press',    primaryMuscle: 'Chest',      secondaryMuscle1: 'Front Delts', secondaryMuscle2: 'Triceps',    secondaryMuscle3: null        },
  { exerciseId: 'dumbbell-bench-press',     primaryMuscle: 'Chest',      secondaryMuscle1: 'Front Delts', secondaryMuscle2: 'Triceps',    secondaryMuscle3: null        },
  { exerciseId: 'cable-fly',               primaryMuscle: 'Chest',      secondaryMuscle1: 'Front Delts', secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Front Delts
  { exerciseId: 'seated-db-overhead-press', primaryMuscle: 'Front Delts', secondaryMuscle1: 'Side Delts', secondaryMuscle2: 'Triceps',    secondaryMuscle3: null        },
  { exerciseId: 'barbell-overhead-press',   primaryMuscle: 'Front Delts', secondaryMuscle1: 'Side Delts', secondaryMuscle2: 'Triceps',    secondaryMuscle3: null        },

  // Side Delts
  { exerciseId: 'cable-lateral-raises-d1',  primaryMuscle: 'Side Delts', secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'cable-lateral-raises',     primaryMuscle: 'Side Delts', secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'dumbbell-lateral-raises',  primaryMuscle: 'Side Delts', secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Rear Delts
  { exerciseId: 'face-pulls-d2',            primaryMuscle: 'Rear Delts', secondaryMuscle1: 'Upper Back',  secondaryMuscle2: 'Traps',      secondaryMuscle3: null        },
  { exerciseId: 'face-pulls-d4',            primaryMuscle: 'Rear Delts', secondaryMuscle1: 'Upper Back',  secondaryMuscle2: 'Traps',      secondaryMuscle3: null        },

  // Upper Back
  { exerciseId: 'bent-over-db-row',         primaryMuscle: 'Upper Back', secondaryMuscle1: 'Lats',        secondaryMuscle2: 'Rear Delts', secondaryMuscle3: 'Biceps'    },
  { exerciseId: 'barbell-rows',             primaryMuscle: 'Upper Back', secondaryMuscle1: 'Lats',        secondaryMuscle2: 'Biceps',     secondaryMuscle3: null        },

  // Lats
  { exerciseId: 'lat-pulldown-d2',          primaryMuscle: 'Lats',       secondaryMuscle1: 'Upper Back',  secondaryMuscle2: 'Biceps',     secondaryMuscle3: null        },
  { exerciseId: 'lat-pull-down',            primaryMuscle: 'Lats',       secondaryMuscle1: 'Upper Back',  secondaryMuscle2: 'Biceps',     secondaryMuscle3: null        },
  { exerciseId: 'cable-pull-down-d2',       primaryMuscle: 'Lats',       secondaryMuscle1: 'Upper Back',  secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'straight-arm-pulldowns',   primaryMuscle: 'Lats',       secondaryMuscle1: 'Upper Back',  secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'weighted-pull-ups',        primaryMuscle: 'Lats',       secondaryMuscle1: 'Upper Back',  secondaryMuscle2: 'Biceps',     secondaryMuscle3: null        },

  // Lower Back
  { exerciseId: 'back-extensions',          primaryMuscle: 'Lower Back', secondaryMuscle1: 'Glutes',      secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Triceps
  { exerciseId: 'overhead-tricep-ext',      primaryMuscle: 'Triceps',    secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'tricep-cable-pushdown',    primaryMuscle: 'Triceps',    secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'tricep-pushdowns-d4',      primaryMuscle: 'Triceps',    secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'cable-pushdown',           primaryMuscle: 'Triceps',    secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'cable-kick-backs',         primaryMuscle: 'Triceps',    secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Biceps
  { exerciseId: 'incline-db-curls',         primaryMuscle: 'Biceps',     secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'hammer-curls',             primaryMuscle: 'Biceps',     secondaryMuscle1: 'Forearms',    secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Forearms
  { exerciseId: 'reverse-curls',            primaryMuscle: 'Forearms',   secondaryMuscle1: 'Biceps',      secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Quads
  { exerciseId: 'leg-press',                primaryMuscle: 'Quads',      secondaryMuscle1: 'Glutes',      secondaryMuscle2: 'Hamstrings', secondaryMuscle3: null        },
  { exerciseId: 'leg-extension',            primaryMuscle: 'Quads',      secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Hamstrings
  { exerciseId: 'romanian-deadlifts',       primaryMuscle: 'Hamstrings', secondaryMuscle1: 'Glutes',      secondaryMuscle2: 'Lower Back', secondaryMuscle3: null        },

  // Glutes
  { exerciseId: 'hip-thrusts',              primaryMuscle: 'Glutes',     secondaryMuscle1: 'Hamstrings',  secondaryMuscle2: null,         secondaryMuscle3: null        },

  // Calves
  { exerciseId: 'seated-calf-raises',       primaryMuscle: 'Calves',     secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
  { exerciseId: 'standing-calf-raises',     primaryMuscle: 'Calves',     secondaryMuscle1: null,          secondaryMuscle2: null,         secondaryMuscle3: null        },
];

export const EXERCISE_DETAILS_SEED: ExerciseDetails[] = [
  // Chest
  { exerciseId: 'incline-barbell-press',    workoutType: 'Chest Press',     equipment: 'Bench',            weightType: 'Barbell'   },
  { exerciseId: 'dumbbell-bench-press',     workoutType: 'Chest Press',     equipment: 'Bench',            weightType: 'Dumbbell'  },
  { exerciseId: 'cable-fly',               workoutType: 'Fly',             equipment: 'Cable Machine',    weightType: 'Cable'     },

  // Front Delts
  { exerciseId: 'seated-db-overhead-press', workoutType: 'Overhead Press',  equipment: 'Bench',            weightType: 'Dumbbell'  },
  { exerciseId: 'barbell-overhead-press',   workoutType: 'Overhead Press',  equipment: 'Squat Rack',       weightType: 'Barbell'   },

  // Side Delts
  { exerciseId: 'cable-lateral-raises-d1',  workoutType: 'Lateral Raise',   equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'cable-lateral-raises',     workoutType: 'Lateral Raise',   equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'dumbbell-lateral-raises',  workoutType: 'Lateral Raise',   equipment: 'None',             weightType: 'Dumbbell'  },

  // Rear Delts
  { exerciseId: 'face-pulls-d2',            workoutType: 'Face Pull',       equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'face-pulls-d4',            workoutType: 'Face Pull',       equipment: 'Cable Machine',    weightType: 'Cable'     },

  // Upper Back
  { exerciseId: 'bent-over-db-row',         workoutType: 'Row',             equipment: 'None',             weightType: 'Dumbbell'  },
  { exerciseId: 'barbell-rows',             workoutType: 'Row',             equipment: 'None',             weightType: 'Barbell'   },

  // Lats
  { exerciseId: 'lat-pulldown-d2',          workoutType: 'Pull Down',       equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'lat-pull-down',            workoutType: 'Pull Down',       equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'cable-pull-down-d2',       workoutType: 'Pull Down',       equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'straight-arm-pulldowns',   workoutType: 'Pull Down',       equipment: 'Cable Machine',    weightType: 'Cable'     },
  { exerciseId: 'weighted-pull-ups',        workoutType: 'Pull Up',         equipment: 'Pull Up Bar',      weightType: 'Bodyweight'},

  // Lower Back
  { exerciseId: 'back-extensions',          workoutType: 'Hip Hinge',       equipment: 'None',             weightType: 'Bodyweight'},

  // Triceps
  { exerciseId: 'overhead-tricep-ext',      workoutType: 'Tricep Extension', equipment: 'Cable Machine',   weightType: 'Cable'     },
  { exerciseId: 'tricep-cable-pushdown',    workoutType: 'Tricep Extension', equipment: 'Cable Machine',   weightType: 'Cable'     },
  { exerciseId: 'tricep-pushdowns-d4',      workoutType: 'Tricep Extension', equipment: 'Cable Machine',   weightType: 'Cable'     },
  { exerciseId: 'cable-pushdown',           workoutType: 'Tricep Extension', equipment: 'Cable Machine',   weightType: 'Cable'     },
  { exerciseId: 'cable-kick-backs',         workoutType: 'Tricep Extension', equipment: 'Cable Machine',   weightType: 'Cable'     },

  // Biceps
  { exerciseId: 'incline-db-curls',         workoutType: 'Curl',            equipment: 'Bench',            weightType: 'Dumbbell'  },
  { exerciseId: 'hammer-curls',             workoutType: 'Curl',            equipment: 'None',             weightType: 'Dumbbell'  },

  // Forearms
  { exerciseId: 'reverse-curls',            workoutType: 'Curl',            equipment: 'None',             weightType: 'EZ Bar'    },

  // Quads
  { exerciseId: 'leg-press',                workoutType: 'Leg Press',       equipment: 'Leg Press Machine', weightType: 'Machine'  },
  { exerciseId: 'leg-extension',            workoutType: 'Leg Extension',   equipment: 'Leg Press Machine', weightType: 'Machine'  },

  // Hamstrings
  { exerciseId: 'romanian-deadlifts',       workoutType: 'Hip Hinge',       equipment: 'None',             weightType: 'Barbell'   },

  // Glutes
  { exerciseId: 'hip-thrusts',              workoutType: 'Hip Thrust',      equipment: 'Bench',            weightType: 'Barbell'   },

  // Calves
  { exerciseId: 'seated-calf-raises',       workoutType: 'Calf Raise',      equipment: 'None',             weightType: 'Machine'   },
  { exerciseId: 'standing-calf-raises',     workoutType: 'Calf Raise',      equipment: 'None',             weightType: 'Barbell'   },
];
