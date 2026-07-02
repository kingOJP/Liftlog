import type { Env } from './types';
import { getAuthenticatedUser } from './auth';

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (request.method === 'GET')  return pull(user.id, env);
  if (request.method === 'POST') return push(request, user.id, env);
  return new Response('Method Not Allowed', { status: 405 });
}

async function pull(userId: string, env: Env): Promise<Response> {
  const [sessions, setLogs, exerciseLogs, meta, program] = await Promise.all([
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
      `SELECT exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
              workout_type, equipment, weight_type
       FROM exercise_metadata WHERE user_id = ?`,
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT program_json, exercises_json FROM user_programs WHERE user_id = ?',
    ).bind(userId).first<{ program_json: string; exercises_json: string }>(),
  ]);

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
    exerciseMuscles: meta.results.map(r => ({
      exerciseId:       r.exercise_id,
      primaryMuscle:    r.primary_muscle    ?? null,
      secondaryMuscle1: r.secondary_muscle1 ?? null,
      secondaryMuscle2: r.secondary_muscle2 ?? null,
      secondaryMuscle3: r.secondary_muscle3 ?? null,
    })),
    exerciseDetails: meta.results.map(r => ({
      exerciseId:  r.exercise_id,
      workoutType: r.workout_type ?? null,
      equipment:   r.equipment    ?? null,
      weightType:  r.weight_type  ?? null,
    })),
    program:   program?.program_json   ? JSON.parse(program.program_json)   : null,
    exercises: program?.exercises_json ? JSON.parse(program.exercises_json) : null,
  });
}

interface PushPayload {
  sessions:      Array<{ id: number; dayId: number; weekNumber: number; startedAt: number; completedAt?: number }>;
  setLogs:       Array<{ id: number; sessionId: number; exerciseId: string; setNumber: number; weight: number; reps: number }>;
  exerciseLogs:  Array<{ id: number; sessionId: number; exerciseId: string; difficulty?: string }>;
  exerciseMuscles?: Array<{ exerciseId: string; primaryMuscle: string | null; secondaryMuscle1: string | null; secondaryMuscle2: string | null; secondaryMuscle3: string | null }>;
  exerciseDetails?: Array<{ exerciseId: string; workoutType: string | null; equipment: string | null; weightType: string | null }>;
  program:   unknown;
  exercises: unknown;
}

// Sanity limits — a personal training log is nowhere near these; anything
// beyond them is a bug or abuse, and rejecting beats writing garbage.
const MAX_SESSIONS = 20_000;
const MAX_SET_LOGS = 200_000;

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

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM workout_sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM set_logs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM exercise_logs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM exercise_metadata WHERE user_id = ?').bind(userId),
  ];

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

  // Merge exerciseMuscles + exerciseDetails into one row per exerciseId
  // These fields are optional — newer clients omit them (metadata is device-local)
  const metaMap = new Map<string, Record<string, unknown>>();
  for (const m of (data.exerciseMuscles ?? [])) {
    metaMap.set(m.exerciseId, { ...metaMap.get(m.exerciseId), ...m });
  }
  for (const d of (data.exerciseDetails ?? [])) {
    metaMap.set(d.exerciseId, { ...metaMap.get(d.exerciseId), ...d });
  }
  for (const [exId, m] of metaMap) {
    stmts.push(env.DB.prepare(
      `INSERT INTO exercise_metadata
         (exercise_id, user_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      exId, userId,
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
