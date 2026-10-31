import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadTrainingSnapshot, e1rmSeries, sessionTimestamp, epley1RM } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import { assessSnapshot, STATUS_INFO } from '../data/progress';
import { getPhaseResolver, getTrainingGoal } from '../data/planStore';
import { shortDateLabel } from '../data/program';
import { unitFor } from '../data/exercises';
import { fmtWeight, toDisplay, unitLabelFor } from '../data/units';
import { LineChart } from './charts';
import { useDialog } from './useDialog';
import './InstructionSheet.css';
import './ExerciseHistorySheet.css';

interface Props {
  exerciseId: string;
  exerciseName: string;
  onClose: () => void;
}

interface SessionRow {
  ts: number;
  sets: Array<{ weight: number; reps: number; warmup?: boolean }>;
  note?: string;
}

/**
 * Everything the app knows about one lift, in one place (audit F13): every
 * session with its sets and note, the strength and volume trends, the
 * all-time bests, and the progress engine's verdict with its evidence and
 * recent PRs. Opened from the workout card's "Last time" line, a Progress row
 * on Metrics, and the exercise detail screen — as a sheet, so an open workout
 * stays open underneath it.
 */
export default function ExerciseHistorySheet({ exerciseId, exerciseName, onClose }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [showAll, setShowAll] = useState(false);
  const timed = unitFor(exerciseId) === 'seconds';

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(s => { if (!cancelled) setSnapshot(s); }).catch(() => {});
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { cancelled = true; document.body.style.overflow = prev; };
  }, []);

  const view = useMemo(() => {
    if (!snapshot) return null;
    const rows: SessionRow[] = [];
    for (const session of snapshot.sessions) {
      const sets = (snapshot.allSetsBySession.get(session.id!) ?? [])
        .filter(s => s.exerciseId === exerciseId)
        .sort((a, b) => a.setNumber - b.setNumber);
      if (sets.length === 0) continue;
      rows.push({ ts: sessionTimestamp(session), sets, note: session.note });
    }
    rows.sort((a, b) => b.ts - a.ts);

    const e1rm = (e1rmSeries(snapshot).get(exerciseId) ?? [])
      .map(p => ({ label: shortDateLabel(p.ts), value: Math.round(toDisplay(p.value)) }));
    const volume = [...rows].reverse().map(r => ({
      label: shortDateLabel(r.ts),
      value: Math.round(toDisplay(r.sets.filter(s => !s.warmup).reduce((n, s) => n + s.weight * s.reps, 0))),
    }));

    let heaviest = 0; let bestE1rm = 0; let mostReps = 0;
    for (const r of rows) for (const s of r.sets) {
      if (s.warmup) continue;
      heaviest = Math.max(heaviest, s.weight);
      mostReps = Math.max(mostReps, s.reps);
      if (s.weight > 0 && s.reps <= 12) bestE1rm = Math.max(bestE1rm, epley1RM(s.weight, s.reps));
    }
    const progress = assessSnapshot(snapshot, getTrainingGoal(), () => true, getPhaseResolver()).get(exerciseId) ?? null;
    return { rows, e1rm, volume, heaviest, bestE1rm, mostReps, progress };
  }, [snapshot, exerciseId]);

  const LIMIT = 20;
  const shown = view ? (showAll ? view.rows : view.rows.slice(0, LIMIT)) : [];
  const fmtSets = (sets: SessionRow['sets']) => {
    const work = sets.filter(s => !s.warmup);
    if (timed) return work.map(s => `${s.reps}s`).join(', ');
    const weights = new Set(work.map(s => s.weight));
    if (weights.size === 1) return `${fmtWeight(work[0].weight)} × ${work.map(s => s.reps).join(', ')}`;
    return work.map(s => `${toDisplay(s.weight)}×${s.reps}`).join(', ');
  };

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-sheet-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title-group">
            <span className="sheet-eyebrow">History</span>
            <h2 id="history-sheet-title" className="sheet-title">{exerciseName}</h2>
            {view && (
              <span className="sheet-meta">
                {view.rows.length} session{view.rows.length !== 1 ? 's' : ''}
                {view.progress ? ` · ${STATUS_INFO[view.progress.status].label}` : ''}
              </span>
            )}
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {!view && <p className="sheet-empty">Loading…</p>}
          {view && view.rows.length === 0 && (
            <p className="sheet-empty">Nothing logged for this exercise yet.</p>
          )}
          {view && view.rows.length > 0 && (
            <>
              <div className="xh-bests">
                {!timed && view.heaviest > 0 && (
                  <div className="xh-best"><span className="xh-best-value">{fmtWeight(view.heaviest)}</span><span className="xh-best-label">Heaviest set</span></div>
                )}
                {!timed && view.bestE1rm > 0 && (
                  <div className="xh-best"><span className="xh-best-value">{fmtWeight(Math.round(view.bestE1rm))}</span><span className="xh-best-label">Best est. 1RM</span></div>
                )}
                <div className="xh-best"><span className="xh-best-value">{view.mostReps}{timed ? 's' : ''}</span><span className="xh-best-label">{timed ? 'Longest hold' : 'Most reps in a set'}</span></div>
              </div>

              {view.progress && (
                <section className="sheet-section">
                  <span className="sheet-label">Right now</span>
                  <p className="sheet-text">{view.progress.evidence[0]}</p>
                  {view.progress.recentPRs.length > 0 && (
                    <ul className="xh-prs">
                      {view.progress.recentPRs.slice(0, 5).map(pr => (
                        <li key={`${pr.ts}-${pr.label}`}><span className="xh-pr-date">{shortDateLabel(pr.ts)}</span> {pr.label}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {!timed && view.e1rm.length >= 2 && (
                <section className="sheet-section">
                  <span className="sheet-label">Estimated 1RM</span>
                  <LineChart data={view.e1rm} unit={unitLabelFor()} />
                </section>
              )}
              {!timed && view.volume.length >= 2 && view.volume.some(p => p.value > 0) && (
                <section className="sheet-section">
                  <span className="sheet-label">Volume load per session</span>
                  <LineChart data={view.volume} unit={unitLabelFor()} />
                </section>
              )}

              <section className="sheet-section">
                <span className="sheet-label">Sessions</span>
                <ul className="xh-sessions">
                  {shown.map(r => (
                    <li key={r.ts} className="xh-session">
                      <span className="xh-session-date">{shortDateLabel(r.ts)}</span>
                      <span className="xh-session-sets">{fmtSets(r.sets)}</span>
                      {r.sets.some(s => s.warmup) && <span className="xh-session-warm">+ warm-up</span>}
                      {r.note && <span className="xh-session-note">{r.note}</span>}
                    </li>
                  ))}
                </ul>
                {view.rows.length > LIMIT && !showAll && (
                  <button className="xh-more" onClick={() => setShowAll(true)}>
                    Show all {view.rows.length} sessions
                  </button>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
