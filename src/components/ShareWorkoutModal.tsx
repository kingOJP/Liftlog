import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import type { WorkoutDay } from '../data/program';
import { buildShareUrl } from '../data/share';
import { useDialog } from './useDialog';
import './ShareWorkoutModal.css';

interface Props {
  day: WorkoutDay;
  onClose: () => void;
}

// QR code for handing a workout to a friend: they scan it with their phone
// camera, the link opens LiftLog, and the workout imports into their account
// (their own history drives the weight recommendations, not the sharer's).
export default function ShareWorkoutModal({ day, onClose }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  // null when the payload exceeds what a QR code can carry (a day with many
  // long custom names). qr.make() throws 'code length overflow' in that case;
  // uncaught, that unmounted the whole workout screen.
  const svg = useMemo<string | null>(() => {
    try {
      const url = buildShareUrl(day);
      const qr = qrcode(0, 'M'); // type 0 = auto-size to the payload
      qr.addData(url);
      qr.make();
      return qr.createSvgTag({ scalable: true, margin: 2 });
    } catch {
      return null;
    }
  }, [day]);

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div
        className="share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <p className="share-modal-title" id="share-modal-title">Share “{day.label}”</p>
        {svg ? (
          <div
            className="share-modal-qr"
            role="img"
            aria-label={`QR code for sharing ${day.label}`}
            // qrcode-generator emits a self-contained inline SVG built only from
            // our own encoded payload — nothing user-controlled is injected raw.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="share-modal-hint share-modal-hint--error">
            This workout is too large to fit in a QR code. Shorten a few exercise
            names or share it as two smaller days.
          </p>
        )}
        {svg && (
          <p className="share-modal-hint">
            Have your friend scan this with their phone camera. The workout opens
            in their LiftLog with weights suggested from <em>their</em> training
            history — your numbers stay yours.
          </p>
        )}
        <button className="share-modal-close" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
