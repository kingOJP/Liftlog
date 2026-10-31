import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { instructionsFor } from '../data/instructions';
import { getExerciseMeta } from '../data/exercises';
import './InstructionSheet.css';

interface SheetProps {
  exerciseId: string;
  exerciseName: string;
  onClose: () => void;
}

/**
 * "How do I do this?" — a bottom sheet with the setup line, the cues and the
 * common faults for an exercise (data/instructions.ts). Opened from the ⓘ
 * on every surface that names an exercise: the workout card, the pickers,
 * the day editor, the exercise detail screen and the plan review. Text only
 * by decision, so it works in a basement gym with no signal.
 */
export default function InstructionSheet({ exerciseId, exerciseName, onClose }: SheetProps) {
  const info = instructionsFor(exerciseId);
  const meta = getExerciseMeta(exerciseId);
  const line = [meta.primaryMuscle, meta.workoutType, meta.equipment].filter(Boolean).join(' · ');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title-group">
            <span className="sheet-eyebrow">How to do it</span>
            <h2 id="sheet-title" className="sheet-title">{exerciseName}</h2>
            {line && <span className="sheet-meta">{line}</span>}
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {info ? (
            <>
              <section className="sheet-section">
                <span className="sheet-label">Setup</span>
                <p className="sheet-text">{info.setup}</p>
              </section>
              <section className="sheet-section">
                <span className="sheet-label">Cues</span>
                <ol className="sheet-cues">
                  {info.cues.map(c => <li key={c}>{c}</li>)}
                </ol>
              </section>
              {info.faults && info.faults.length > 0 && (
                <section className="sheet-section">
                  <span className="sheet-label">Watch out for</span>
                  <ul className="sheet-faults">
                    {info.faults.map(f => <li key={f}>{f}</li>)}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <p className="sheet-empty">
              No instructions yet — this is an exercise you added yourself. The built-in
              exercises each carry a setup line, cues and common faults.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ButtonProps {
  onClick: () => void;
  name: string;
  className?: string;
}

/** The ⓘ that opens the sheet. Stops propagation so it works inside tappable rows. */
export function InfoButton({ onClick, name, className = '' }: ButtonProps) {
  return (
    <button
      type="button"
      className={`info-btn ${className}`.trim()}
      onClick={e => { e.stopPropagation(); onClick(); }}
      aria-label={`How to do ${name}`}
      title="How to do it"
    >
      i
    </button>
  );
}
