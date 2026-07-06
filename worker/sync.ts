import type { Env } from './types';
import { getAuthenticatedUser } from './auth';

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (request.method === 'GET')  return pull(user.id, env);
  if (request.method === 'POST') return push(request, user.id, env);
  return new Response('Method Not Allowed', { status: 405 });
}

const META_COLUMNS = `exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2,
                      secondary_muscle3, workout_type, equipment, weight_type`;

async function pull(userId: string, env: Env): Promise<Response> {
  const [sessions, setLogs, exerciseLogs, program, appExercises, appMeta, tombstones] = await Promise.all([
    env.DB.prepare(
      'SELECT local_id, day_id, week_number, started_at, completed_at FROM workout_sessions WHERE user_id = ?',
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT local_id, session_id, exercise_id, set_number, weight, reps FROM set_logs WHERE user_id = ?',
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT local_id, session_id, exercise_id, difficulty FROM exercise_logs WHERE user_id = ?',
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT program_json, exercises_json FROM user_programs WHERE user_id = ?',
    ).bind(userId).first<{ program_json: string; exercises_json: string }>(),
    env.DB.prepare(
      'SELECT id, name, sets, rep_low, rep_high, archived FROM app_exercises',
    ).all(),
    env.DB.prepare(`SELECT ${META_COLUMNS} FROM app_exercise_metadata`).all(),
    env.DB.prepare('SELECT exercise_id FROM deleted_exercises').all(),
  ]);

  const deletedIds = new Set(tombstones.results.map(r => r.exercise_id as string));

  // Exercises + metadata are app-wide (shared by every account). Until the
  // first post-deploy push populates the global tables, fall back to this
  // user's legacy per-user copies. Tombstoned exercises are never returned.
  let metaRows = appMeta.results;
  if (metaRows.length === 0) {
    metaRows = (await env.DB.prepare(
      `SELECT ${META_COLUMNS} FROM exercise_metadata WHERE user_id = ?`,
    ).bind(userId).all()).results;
  }
  metaRows = metaRows.filter(r => !deletedIds.has(r.exercise_id as string));

  let exercises: unknown = null;
  if (appExercises.results.length > 0) {
    exercises = appExercises.results
      .filter(r => !deletedIds.has(r.id as string))
      .map(r => ({
        id:      r.id,
        name:    r.name,
        sets:    r.sets,
        repLow:  r.rep_low,
        repHigh: r.rep_high,
        ...(r.archived ? { archived: true } : {}),
      }));
  } else if (program?.exercises_json) {
    const legacy: unknown = JSON.parse(program.exercises_json);
    exercises = Array.isArray(legacy)
      ? legacy.filter((e: { id?: string }) => !deletedIds.has(e.id ?? ''))
      : legacy;
  }

  return Response.json({
    sessions: sessions.results.map(r => ({
      id:          r.local_id,
      dayId:       r.day_id,
      weekNumber:  r.week_number,
      startedAt:   r.started_at,
      completedAt: r.completed_at ?? undefined,
    })),
    setLogs: setLogs.results.map(r => ({
      id:         r.local_id,
      sessionId:  r.session_id,
      exerciseId: r.exercise_id,
      setNumber:  r.set_number,
      weight:     r.weight,
      reps:       r.reps,
    })),
    exerciseLogs: exerciseLogs.results.map(r => ({
      id:         r.local_id,
      sessionId:  r.session_id,
      exerciseId: r.exercise_id,
      difficulty: r.difficulty ?? undefined,
    })),
    exerciseMuscles: metaRows.map(r => ({
      exerciseId:       r.exercise_id,
      primaryMuscle:    r.primary_muscle    ?? null,
      secondaryMuscle1: r.secondary_muscle1 ?? null,
      secondaryMuscle2: r.secondary_muscle2 ?? null,
      secondaryMuscle3: r.secondary_muscle3 ?? null,
    })),
    exerciseDetails: metaRows.map(r => ({
      exerciseId:  r.exercise_id,
      workoutType: r.workout_type ?? null,
      equipment:   r.equipment    ?? null,
      weightType:  r.weight_type  ?? null,
    })),
    deletedExerciseIds: [...deletedIds],
    program:   program?.program_json ? JSON.parse(program.program_json) : null,
    exercises,
  });
}

interface PushExercise {
  id: string; name: string; sets: number; repLow: number; repHigh: number; archived?: boolean;
}

interface PushPayload {
  sessions:      Array<{ id: number; dayId: number; weekNumber: number; startedAt: number; completedAt?: number }>;
  setLogs:       Array<{ id: number; sessionId: number; exerciseId: string; setNumber: number; weight: number; reps: number }>;
  exerciseLogs:  Array<{ id: number; sessionId: number; exerciseId: string; difficulty?: string }>;
  exerciseMuscles?: Array<{ exerciseId: string; primaryMuscle: string | null; secondaryMuscle1: string | null; secondaryMuscle2: string | null; secondaryMuscle3: string | null }>;
  exerciseDetails?: Array<{ exerciseId: string; workoutType: string | null; equipment: string | null; weightType: string | null }>;
  deletedExerciseIds?: string[];
  program:   unknown;
  exercises: PushExercise[] | null;
}

// Sanity limits — a personal training log is nowhere near these; anything
// beyond them is a bug or abuse, and rejecting beats writing garbage.
const MAX_SESSIONS  = 20_000;
const MAX_SET_LOGS  = 200_000;
const MAX_EXERCISES = 10_000;

function validatePush(data: PushPayload): string | null {
  if (typeof data !== 'object' || data === null) return 'payload must be an object';
  if (!Array.isArray(data.sessions) || !Array.isArray(data.setLogs) || !Array.isArray(data.exerciseLogs)) {
    return 'sessions, setLogs and exerciseLogs must be arrays';
  }
  if (data.sessions.length > MAX_SESSIONS) return 'too many sessions';
  if (data.setLogs.length > MAX_SET_LOGS) return 'too many set logs';
  if (data.exerciseLogs.length > MAX_SET_LOGS) return 'too many exercise logs';

  for (const s of data.sessions) {
    if (typeof s.id !== 'number' || typeof s.dayId !== 'number' ||
        typeof s.weekNumber !== 'number' || typeof s.startedAt !== 'number') {
      return 'malformed session';
    }
  }
  for (const s of data.setLogs) {
    if (typeof s.id !== 'number' || typeof s.sessionId !== 'number' ||
        typeof s.exerciseId !== 'string' || typeof s.setNumber !== 'number' ||
        typeof s.weight !== 'number' || typeof s.reps !== 'number') {
      return 'malformed set log';
    }
  }
  if (data.exercises != null) {
    if (!Array.isArray(data.exercises)) return 'exercises must be an array';
    if (data.exercises.length > MAX_EXERCISES) return 'too many exercises';
    for (const e of data.exercises) {
      if (typeof e.id !== 'string' || typeof e.name !== 'string' ||
          typeof e.sets !== 'number' || typeof e.repLow !== 'number' ||
          typeof e.repHigh !== 'number') {
        return 'malformed exercise';
      }
    }
  }
  if (data.deletedExerciseIds != null) {
    if (!Array.isArray(data.deletedExerciseIds)) return 'deletedExerciseIds must be an array';
    if (data.deletedExerciseIds.length > MAX_EXERCISES) return 'too many deleted exercise ids';
    if (data.deletedExerciseIds.some(id => typeof id !== 'string')) return 'malformed deleted exercise id';
  }
  return null;
}

async function push(request: Request, userId: string, env: Env): Promise<Response> {
  let data: PushPayload;
  try {
    data = await request.json() as PushPayload;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const invalid = validatePush(data);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  // Deletions are permanent: union the client's tombstones with the server's,
  // so no stale library copy — from any device or account — can resurrect a
  // deleted exercise.
  const existing = await env.DB.prepare('SELECT exercise_id FROM deleted_exercises').all();
  const tombstoned = new Set(existing.results.map(r => r.exercise_id as string));
  const newTombstones = (data.deletedExerciseIds ?? []).filter(id => !tombstoned.has(id));
  for (const id of newTombstones) tombstoned.add(id);

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM workout_sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM set_logs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM exercise_logs WHERE user_id = ?').bind(userId),
  ];

  const now = Date.now();
  for (const id of newTombstones) {
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO deleted_exercises (exercise_id, deleted_at) VALUES (?, ?)',
    ).bind(id, now));
  }

  for (const s of data.sessions) {
    stmts.push(env.DB.prepare(
      `INSERT INTO workout_sessions (local_id, user_id, day_id, week_number, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(s.id, userId, s.dayId, s.weekNumber, s.startedAt, s.completedAt ?? null));
  }

  for (const s of data.setLogs) {
    stmts.push(env.DB.prepare(
      `INSERT INTO set_logs (local_id, user_id, session_id, exercise_id, set_number, weight, reps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(s.id, userId, s.sessionId, s.exerciseId, s.setNumber, s.weight, s.reps));
  }

  for (const s of data.exerciseLogs) {
    stmts.push(env.DB.prepare(
      `INSERT INTO exercise_logs (local_id, user_id, session_id, exercise_id, difficulty)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(s.id, userId, s.sessionId, s.exerciseId, s.difficulty ?? null));
  }

  // App-wide exercise library: replace wholesale with the pushed copy, minus
  // anything tombstoned. (Clients pull before they push, so the pushed library
  // already includes exercises other accounts added.)
  if (data.exercises) {
    stmts.push(env.DB.prepare('DELETE FROM app_exercises'));
    for (const e of data.exercises) {
      if (tombstoned.has(e.id)) continue;
      stmts.push(env.DB.prepare(
        'INSERT INTO app_exercises (id, name, sets, rep_low, rep_high, archived) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(e.id, e.name, e.sets, e.repLow, e.repHigh, e.archived ? 1 : 0));
    }
  }

  // Merge exerciseMuscles + exerciseDetails into one app-wide row per exerciseId
  const metaMap = new Map<string, Record<string, unknown>>();
  for (const m of (data.exerciseMuscles ?? [])) {
    metaMap.set(m.exerciseId, { ...metaMap.get(m.exerciseId), ...m });
  }
  for (const d of (data.exerciseDetails ?? [])) {
    metaMap.set(d.exerciseId, { ...metaMap.get(d.exerciseId), ...d });
  }
  stmts.push(env.DB.prepare('DELETE FROM app_exercise_metadata'));
  for (const [exId, m] of metaMap) {
    if (tombstoned.has(exId)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO app_exercise_metadata
         (exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      exId,
      (m.primaryMuscle    as string | null) ?? null,
      (m.secondaryMuscle1 as string | null) ?? null,
      (m.secondaryMuscle2 as string | null) ?? null,
      (m.secondaryMuscle3 as string | null) ?? null,
      (m.workoutType      as string | null) ?? null,
      (m.equipment        as string | null) ?? null,
      (m.weightType       as string | null) ?? null,
    ));
  }

  if (data.program && data.exercises) {
    stmts.push(env.DB.prepare(
      `INSERT INTO user_programs (user_id, program_json, exercises_json) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         program_json   = excluded.program_json,
         exercises_json = excluded.exercises_json`,
    ).bind(userId, JSON.stringify(data.program), JSON.stringify(data.exercises)));
  }

  // D1 batch limit is 1000 statements; chunk to be safe
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }

  return Response.json({ ok: true });
}
