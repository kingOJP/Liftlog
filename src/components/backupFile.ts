// Getting a backup out of (and back into) the browser. The document itself is
// built and merged by data/backup.ts; this is only the file plumbing.

import { buildBackup, isBackupFile, restoreBackup } from '../data/backup';
import type { RestoreResult } from '../data/backup';

/**
 * Hand the user a backup file. An installed iOS PWA has no downloads folder —
 * an `<a download>` there opens a blank preview — so the share sheet ("Save to
 * Files") is tried first wherever files can be shared, with the ordinary
 * download as the fallback.
 */
export async function saveBackupFile(owner: string | null): Promise<void> {
  const backup = await buildBackup(owner);
  const json = JSON.stringify(backup);
  const name = `liftlog-backup-${new Date(backup.exportedAt).toISOString().slice(0, 10)}.json`;

  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'LiftLog backup' });
      return;
    }
  } catch (err) {
    // Dismissing the share sheet is a choice, not a failure.
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Read a chosen file and merge it in. Throws with a user-readable message. */
export async function restoreBackupFile(file: File, signedInEmail: string): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a LiftLog backup.");
  }
  if (!isBackupFile(parsed)) throw new Error("That file isn't a LiftLog backup.");
  if (parsed.owner && parsed.owner !== signedInEmail) {
    throw new Error(`That backup belongs to ${parsed.owner}. Sign in with that account to restore it.`);
  }
  return restoreBackup(parsed);
}
