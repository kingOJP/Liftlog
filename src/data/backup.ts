import { dumpIDB, restoreIDB } from '../db/database';
import { getStoredProgram, saveStoredProgram, getExerciseLibrary, saveExerciseLibrary } from './programStore';

const BACKUP_VERSION = 1;

interface BackupFile {
  version: number;
  exportedAt: number;
  program: ReturnType<typeof getStoredProgram>;
  exercises: ReturnType<typeof getExerciseLibrary>;
  idb: Awaited<ReturnType<typeof dumpIDB>>;
}

export async function exportData(): Promise<void> {
  const [idb] = await Promise.all([dumpIDB()]);

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    program: getStoredProgram(),
    exercises: getExerciseLibrary(),
    idb,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `liftlog-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importData(file: File): Promise<void> {
  const text = await file.text();
  let backup: BackupFile;

  try {
    backup = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error('File is not valid JSON.');
  }

  if (backup.version !== BACKUP_VERSION || !backup.idb || !backup.program) {
    throw new Error('File does not appear to be a LiftLog backup.');
  }

  saveStoredProgram(backup.program);
  saveExerciseLibrary(backup.exercises ?? []);
  await restoreIDB(backup.idb);
}
