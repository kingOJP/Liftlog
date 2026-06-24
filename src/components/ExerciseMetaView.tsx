import { useState, useEffect } from 'react';
import {
  MUSCLE_GROUPS, WORKOUT_TYPES, EQUIPMENT_OPTIONS, WEIGHT_TYPES,
  type MuscleGroup, type WorkoutType, type Equipment, type WeightType,
  getExerciseMuscles, saveExerciseMuscles,
  getExerciseDetails, saveExerciseDetails,
} from '../db/database';
import './ExerciseMetaView.css';

interface Props {
  exerciseId: string;
  exerciseName: string;
  onBack: () => void;
}

export default function ExerciseMetaView({ exerciseId, exerciseName, onBack }: Props) {
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | ''>('');
  const [secondary1, setSecondary1] = useState<MuscleGroup | ''>('');
  const [secondary2, setSecondary2] = useState<MuscleGroup | ''>('');
  const [secondary3, setSecondary3] = useState<MuscleGroup | ''>('');
  const [workoutType, setWorkoutType] = useState<WorkoutType | ''>('');
  const [equipment, setEquipment] = useState<Equipment | ''>('');
  const [weightType, setWeightType] = useState<WeightType | ''>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      getExerciseMuscles(exerciseId),
      getExerciseDetails(exerciseId),
    ]).then(([muscles, details]) => {
      if (muscles) {
        setPrimaryMuscle(muscles.primaryMuscle ?? '');
        setSecondary1(muscles.secondaryMuscle1 ?? '');
        setSecondary2(muscles.secondaryMuscle2 ?? '');
        setSecondary3(muscles.secondaryMuscle3 ?? '');
      }
      if (details) {
        setWorkoutType(details.workoutType ?? '');
        setEquipment(details.equipment ?? '');
        setWeightType(details.weightType ?? '');
      }
      setLoading(false);
    });
  }, [exerciseId]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    await Promise.all([
      saveExerciseMuscles({
        exerciseId,
        primaryMuscle: primaryMuscle || null,
        secondaryMuscle1: secondary1 || null,
        secondaryMuscle2: secondary2 || null,
        secondaryMuscle3: secondary3 || null,
      }),
      saveExerciseDetails({
        exerciseId,
        workoutType: workoutType || null,
        equipment: equipment || null,
        weightType: weightType || null,
      }),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="exercise-meta-view">
        <header className="exercise-meta-header">
          <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
          <div className="exercise-meta-title-group">
            <span className="exercise-meta-eyebrow">Exercise</span>
            <span className="exercise-meta-name">{exerciseName}</span>
          </div>
        </header>
        <p className="exercise-meta-loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="exercise-meta-view">
      <header className="exercise-meta-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <div className="exercise-meta-title-group">
          <span className="exercise-meta-eyebrow">Exercise</span>
          <span className="exercise-meta-name">{exerciseName}</span>
        </div>
      </header>

      <div className="exercise-meta-body">
        <section className="meta-section">
          <span className="meta-label">Workout Type</span>
          <select
            className="meta-select"
            value={workoutType}
            onChange={e => setWorkoutType(e.target.value as WorkoutType | '')}
          >
            <option value="">— Not set —</option>
            {WORKOUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <span className="meta-label">Equipment</span>
          <select
            className="meta-select"
            value={equipment}
            onChange={e => setEquipment(e.target.value as Equipment | '')}
          >
            <option value="">— Not set —</option>
            {EQUIPMENT_OPTIONS.map(eq => <option key={eq} value={eq}>{eq}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <span className="meta-label">Weight Type</span>
          <select
            className="meta-select"
            value={weightType}
            onChange={e => setWeightType(e.target.value as WeightType | '')}
          >
            <option value="">— Not set —</option>
            {WEIGHT_TYPES.map(wt => <option key={wt} value={wt}>{wt}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <span className="meta-label">Primary Muscle</span>
          <select
            className="meta-select"
            value={primaryMuscle}
            onChange={e => setPrimaryMuscle(e.target.value as MuscleGroup | '')}
          >
            <option value="">— Not set —</option>
            {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </section>

        <section className="meta-section">
          <span className="meta-label">Secondary Muscles</span>
          <div className="secondary-muscles">
            <select
              className="meta-select"
              value={secondary1}
              onChange={e => setSecondary1(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              className="meta-select"
              value={secondary2}
              onChange={e => setSecondary2(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              className="meta-select"
              value={secondary3}
              onChange={e => setSecondary3(e.target.value as MuscleGroup | '')}
            >
              <option value="">— None —</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </section>
      </div>

      <div className="exercise-meta-footer">
        <button
          className="meta-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
