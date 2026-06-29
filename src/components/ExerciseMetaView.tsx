import { useState } from 'react';
import {
  MUSCLE_GROUPS, WORKOUT_TYPES, EQUIPMENT_OPTIONS, WEIGHT_TYPES,
  type MuscleGroup, type WorkoutType, type Equipment, type WeightType,
} from '../db/database';
import { getExerciseMeta, saveExerciseMeta } from '../data/exercises';
import './ExerciseMetaView.css';

interface Props {
  exerciseId: string;
  exerciseName: string;
  onBack: () => void;
  onSaved?: () => void;
}

export default function ExerciseMetaView({ exerciseId, exerciseName, onBack, onSaved }: Props) {
  const initial = getExerciseMeta(exerciseId);

  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | ''>(initial.primaryMuscle ?? '');
  const [secondary1, setSecondary1] = useState<MuscleGroup | ''>(initial.secondaryMuscle1 ?? '');
  const [secondary2, setSecondary2] = useState<MuscleGroup | ''>(initial.secondaryMuscle2 ?? '');
  const [secondary3, setSecondary3] = useState<MuscleGroup | ''>(initial.secondaryMuscle3 ?? '');
  const [workoutType, setWorkoutType] = useState<WorkoutType | ''>(initial.workoutType ?? '');
  const [equipment, setEquipment] = useState<Equipment | ''>(initial.equipment ?? '');
  const [weightType, setWeightType] = useState<WeightType | ''>(initial.weightType ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (saving) return;
    setSaving(true);
    saveExerciseMeta(exerciseId, {
      primaryMuscle:    primaryMuscle || null,
      secondaryMuscle1: secondary1   || null,
      secondaryMuscle2: secondary2   || null,
      secondaryMuscle3: secondary3   || null,
      workoutType:      workoutType  || null,
      equipment:        equipment    || null,
      weightType:       weightType   || null,
    });
    setSaving(false);
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2000);
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
