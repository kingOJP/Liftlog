import { useState, useEffect } from 'react';
import type { WorkoutDay } from '../data/program';
import { getExerciseName } from '../data/programStore';
import { SHARED_DAY_ID } from '../data/share';
import { isQuickWorkout } from '../data/quickWorkout';
import { loadTrainingSnapshot } from '../data/analytics';
import type { Session, SetLog } from '../db/database';
import './HistoryView.css';

interface Props {
  program: WorkoutDay[];
  onBack: () => void;
  onEditSession: (sessionId: number, dayId: number) => void;
}

interface HistoryEntry {
  session: Session;
  sets: SetLog[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function HistoryView({ program, onBack, onEditSession }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(snapshot => {
      if (cancelled) return;
      // allSetsBySession so warm-ups show in history (they're excluded from
      // metrics, but the user logged them and wants to see them here).
      setEntries(snapshot.sessions.map(session => ({
        session,
        sets: snapshot.allSetsBySession.get(session.id!) ?? [],
      })));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="history-view">
      <header className="history-header">
        <button className="back-btn" onClick={onBack} aria-label="Back to dashboard">&#8592;</button>
        <span className="history-title">History</span>
      </header>

      <div className="history-list">
        {loading && <p className="history-empty">Loading…</p>}

        {!loading && entries.length === 0 && (
          <p className="history-empty">No workouts logged yet.</p>
        )}

        {entries.map(({ session, sets }) => {
          const day = program.find(d => d.id === session.dayId);
          const isExpanded = expandedId === session.id;

          const exerciseOrder = day?.exercises.map(e => e.id) ?? [];
          const grouped = sets.reduce<Record<string, SetLog[]>>((acc, s) => {
            (acc[s.exerciseId] ??= []).push(s);
            return acc;
          }, {});
          const orderedExercises = [
            ...exerciseOrder.filter(id => grouped[id]),
            ...Object.keys(grouped).filter(id => !exerciseOrder.includes(id)),
          ];

          const toggle = () => setExpandedId(isExpanded ? null : (session.id ?? null));

          return (
            <div
              key={session.id}
              className={`history-card${isExpanded ? ' expanded' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onClick={toggle}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
              }}
            >
              <div className="history-card-header">
                <div className="history-card-left">
                  <span className="history-date">{formatDate(session.completedAt!)}</span>
                  <span className="history-day-label">
                    {day
                      ? `${day.label} — ${day.muscleGroups}`
                      : isQuickWorkout(session.dayId)
                        ? 'Quick workout'
                        : session.dayId === SHARED_DAY_ID
                          ? 'Shared workout'
                          : `Day ${session.dayId}`}
                  </span>
                  <span className="history-summary">
                    {orderedExercises.length} exercise{orderedExercises.length !== 1 ? 's' : ''} · {sets.filter(s => !s.warmup).length} sets
                  </span>
                </div>
                <span className="history-chevron">{isExpanded ? '▲' : '▼'}</span>
              </div>

              {isExpanded && (
                <div className="history-detail">
                  {orderedExercises.map(exId => {
                    // Stored setNumber is positional (warm-ups included), so
                    // renumber at render: warm-ups carry a label, not a
                    // number, and "Set 1" is always the first working set —
                    // the same labeling ExerciseCard uses in the workout.
                    const rows = [...(grouped[exId] ?? [])].sort((a, b) => a.setNumber - b.setNumber);
                    let working = 0;
                    const labels = rows.map(s => (s.warmup ? 'Warm-up' : `Set ${++working}`));
                    return (
                      <div key={exId} className="history-exercise">
                        <span className="history-ex-name">{getExerciseName(exId)}</span>
                        <div className="history-sets">
                          {rows.map((s, i) => (
                            <div key={i} className={`history-set-row${s.warmup ? ' history-set-row--warmup' : ''}`}>
                              <span className="history-set-num">{labels[i]}</span>
                              <span className="history-set-weight">{s.weight} lbs</span>
                              <span className="history-set-reps">{s.reps} reps</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    className="edit-session-btn"
                    onClick={e => {
                      e.stopPropagation();
                      onEditSession(session.id!, session.dayId);
                    }}
                  >
                    Edit Session
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
