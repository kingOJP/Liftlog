import type { Env } from './types';
import { getAuthenticatedUser } from './auth';
import { getUserRole } from './roles';

// Custom exercises are stamped `${slug}-${Date.now()}` by the client
// (generateExerciseId) — a trailing 10+ digit timestamp marks user-created
// content, which enters the lifecycle queue for admin review.
const CUSTOM_ID_RE = /-\d{10,}$/;

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (request.method === 'GET')  return pull(user.id, env);
  if (request.method === 'POST') return push(request, user.id, env);
  return new Response('Method Not Allowed', { status: 405 });
}

const META_COLUMNS = `exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2,
                      secondary_muscle3, workout_type, equipment, weight_type`;

interface SetEntry {
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  /** 0-based exercise position within the workout (absent on legacy rows) */
  order?: number;
  /** Warm-up set — logged but excluded from the client's analytics (absent on working sets) */
  warmup?: boolean;
}

interface SessionDoc {
  guid: string;
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt: number | null;
  updatedAt: number;
  sets: SetEntry[];
}

// The user's sessions as documents: session_docs, or — until this user's
// first sync-v2 push — assembled from the legacy per-row tables. Legacy docs
// derive the same deterministic GUID the client derives (legacy-<startedAt>),
// so both sides agree on identity. Empty sessions (ghosts) are dropped.
async function loadSessionDocs(userId: string, env: Env): Promise<SessionDoc[]> {
  const docs = await env.DB.prepare(
    'SELECT guid, day_id, week_number, started_at, completed_at, updated_at, sets_json FROM session_docs WHERE user_id = ?',
  ).bind(userId).all();

  if (docs.results.length > 0) {
    return docs.results.map(r => ({
      guid:        r.guid as string,
      dayId:       r.day_id as number,
      weekNumber:  r.week_number as number,
      startedAt:   r.started_at as number,
      completedAt: (r.completed_at as number | null) ?? null,
      updatedAt:   r.updated_at as number,
      sets:        JSON.parse(r.sets_json as string) as SetEntry[],
    }));
  }

  const [sessions, setLogs] = await Promise.all([
    env.DB.prepare(
      'SELECT local_id, day_id, week_number, started_at, completed_at FROM workout_sessions WHERE user_id = ?',
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT session_id, exercise_id, set_number, weight, reps FROM set_logs WHERE user_id = ?',
    ).bind(userId).all(),
  ]);

  const setsBySession = new Map<number, SetEntry[]>();
  for (const r of setLogs.results) {
    const arr = setsBySession.get(r.session_id as number) ?? [];
    arr.push({
      exerciseId: r.exercise_id as string,
      setNumber:  r.set_number as number,
      weight:     r.weight as number,
      reps:       r.reps as number,
    });
    setsBySession.set(r.session_id as number, arr);
  }

  return sessions.results
    .map(r => ({
      guid:        `legacy-${r.started_at}`,
      dayId:       r.day_id as number,
      weekNumber:  r.week_number as number,
      startedAt:   r.started_at as number,
      completedAt: (r.completed_at as number | null) ?? null,
      updatedAt:   (r.completed_at as number | null) ?? (r.started_at as number),
      sets:        setsBySession.get(r.local_id as number) ?? [],
    }))
    .filter(d => d.sets.length > 0);
}

async function pull(userId: string, env: Env): Promise<Response> {
  const [sessionDocs, sessionTombstones, program, userExercises, userMeta,
         userTombstones, legacyTombstones, globalExercises, globalMeta, role, planRow,
         mergeRows] = await Promise.all([
    loadSessionDocs(userId, env),
    env.DB.prepare('SELECT guid FROM deleted_sessions WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare(
      'SELECT program_json, exercises_json FROM user_programs WHERE user_id = ?',
    ).bind(userId).first<{ program_json: string; exercises_json: string }>(),
    env.DB.prepare(
      'SELECT id, name, sets, rep_low, rep_high, archived FROM user_exercises WHERE user_id = ?',
    ).bind(userId).all(),
    env.DB.prepare(
      `SELECT ${META_COLUMNS} FROM exercise_metadata WHERE user_id = ?`,
    ).bind(userId).all(),
    env.DB.prepare('SELECT exercise_id FROM user_deleted_exercises WHERE user_id = ?').bind(userId).all(),
    // Deletions made while deletion was app-wide still apply to everyone.
    env.DB.prepare('SELECT exercise_id FROM deleted_exercises').all(),
    env.DB.prepare(
      'SELECT id, name, sets, rep_low, rep_high, archived FROM global_exercises',
    ).all(),
    env.DB.prepare(`SELECT ${META_COLUMNS} FROM global_exercise_metadata`).all(),
    getUserRole(userId, env),
    env.DB.prepare(
      'SELECT plan_json FROM training_plans WHERE user_id = ?',
    ).bind(userId).first<{ plan_json: string }>(),
    env.DB.prepare('SELECT from_id, to_id FROM exercise_merges').all(),
  ]);

  const deletedSessionGuids = new Set(sessionTombstones.results.map(r => r.guid as string));
  const liveDocs = sessionDocs.filter(d => !deletedSessionGuids.has(d.guid));

  // Flatten documents back into the wire's session/setLog arrays. The ids are
  // synthetic and only tie a doc's sets to it within this response.
  const wireSessions: unknown[] = [];
  const wireSetLogs: unknown[] = [];
  let nextLogId = 1;
  liveDocs.forEach((d, i) => {
    const id = i + 1;
    wireSessions.push({
      id,
      guid:        d.guid,
      dayId:       d.dayId,
      weekNumber:  d.weekNumber,
      startedAt:   d.startedAt,
      completedAt: d.completedAt ?? undefined,
      updatedAt:   d.updatedAt,
    });
    for (const s of d.sets) {
      wireSetLogs.push({ id: nextLogId++, sessionId: id, ...s });
    }
  });

  // The user's deleted set: their own tombstones plus the legacy app-wide ones
  // (deletions that happened before deletion became per-user).
  const deletedIds = new Set<string>([
    ...userTombstones.results.map(r => r.exercise_id as string),
    ...legacyTombstones.results.map(r => r.exercise_id as string),
  ]);

  // Layer 2 (user-owned) metadata. A user with no per-user rows yet is adopted
  // from the legacy app-wide table once; their next push snapshots the adopted
  // data into their own rows and the fallback goes inert.
  let metaRows = userMeta.results;
  if (metaRows.length === 0) {
    metaRows = (await env.DB.prepare(
      `SELECT ${META_COLUMNS} FROM app_exercise_metadata`,
    ).all()).results;
  }
  metaRows = metaRows.filter(r => !deletedIds.has(r.exercise_id as string));

  const rowToExercise = (r: Record<string, unknown>) => ({
    id:      r.id as string,
    name:    r.name,
    sets:    r.sets,
    repLow:  r.rep_low,
    repHigh: r.rep_high,
    ...(r.archived ? { archived: true } : {}),
  });

  // Layer 2 (user-owned) library, with the same one-time adoption fallback
  // chain: user rows → legacy app-wide table → legacy per-user JSON blob.
  let exercises: Array<{ id?: string }> | null = null;
  if (userExercises.results.length > 0) {
    exercises = userExercises.results.map(rowToExercise);
  } else {
    const appExercises = await env.DB.prepare(
      'SELECT id, name, sets, rep_low, rep_high, archived FROM app_exercises',
    ).all();
    if (appExercises.results.length > 0) {
      exercises = appExercises.results.map(rowToExercise);
    } else if (program?.exercises_json) {
      const legacy: unknown = JSON.parse(program.exercises_json);
      if (Array.isArray(legacy)) exercises = legacy as Array<{ id?: string }>;
    }
  }
  if (exercises) {
    exercises = exercises.filter(e => !deletedIds.has(e.id ?? ''));
  }

  // Layer 1 (application-owned): admin-curated global exercises flow to every
  // user unless the user's own copy or tombstone says otherwise.
  const haveIds = new Set((exercises ?? []).map(e => e.id));
  const globalAdds = globalExercises.results
    .filter(r => !r.archived && !deletedIds.has(r.id as string) && !haveIds.has(r.id as string))
    .map(rowToExercise);
  if (globalAdds.length > 0) {
    exercises = [...(exercises ?? []), ...globalAdds];
  }

  return Response.json({
    sessions: wireSessions,
    setLogs:  wireSetLogs,
    // Difficulty ratings — feature removed; empty array kept so stale cached
    // clients (which restore this field) don't crash on undefined.
    exerciseLogs: [],
    deletedSessionGuids: [...deletedSessionGuids],
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
    plan:      planRow?.plan_json ? JSON.parse(planRow.plan_json) : null,
    // Layer 1 metadata (admin-curated), kept separate from the user's own
    // overrides so the client can apply catalog < global < user precedence.
    globalExerciseMetadata: globalMeta.results
      .filter(r => !deletedIds.has(r.exercise_id as string))
      .map(r => ({
        exerciseId:       r.exercise_id,
        primaryMuscle:    r.primary_muscle    ?? null,
        secondaryMuscle1: r.secondary_muscle1 ?? null,
        secondaryMuscle2: r.secondary_muscle2 ?? null,
        secondaryMuscle3: r.secondary_muscle3 ?? null,
        workoutType:      r.workout_type      ?? null,
        equipment:        r.equipment         ?? null,
        weightType:       r.weight_type       ?? null,
      })),
    // Admin exercise merges (from→to id map) — clients remap their own data
    exerciseMerges: mergeRows.results.map(r => ({
      fromId: r.from_id as string,
      toId:   r.to_id as string,
    })),
    role,
  });
}

interface PushExercise {
  id: string; name: string; sets: number; repLow: number; repHigh: number; archived?: boolean;
}

interface PushPayload {
  // guid/updatedAt are absent from stale cached clients — the server derives
  // the same deterministic fallbacks the client would (legacy-<startedAt>,
  // completedAt) so identities agree across versions.
  sessions:      Array<{ id: number; guid?: string; dayId: number; weekNumber: number; startedAt: number; completedAt?: number; updatedAt?: number }>;
  setLogs:       Array<{ id: number; sessionId: number; exerciseId: string; setNumber: number; weight: number; reps: number; order?: number; warmup?: boolean }>;
  /** Dead feature (difficulty ratings) — accepted for wire compatibility, ignored */
  exerciseLogs:  unknown[];
  deletedSessionGuids?: string[];
  exerciseMuscles?: Array<{ exerciseId: string; primaryMuscle: string | null; secondaryMuscle1: string | null; secondaryMuscle2: string | null; secondaryMuscle3: string | null }>;
  exerciseDetails?: Array<{ exerciseId: string; workoutType: string | null; equipment: string | null; weightType: string | null }>;
  deletedExerciseIds?: string[];
  program:   unknown;
  exercises: PushExercise[] | null;
  /** training journey document — whole-document LWW by updatedAt */
  plan?: { version: number; plans: unknown[]; updatedAt: number } | null;
}

// Sanity limits — a personal training log is nowhere near these; anything
// beyond them is a bug or abuse, and rejecting beats writing garbage.
const MAX_SESSIONS  = 20_000;
const MAX_SET_LOGS  = 200_000;
const MAX_EXERCISES = 10_000;
const MAX_PLANS      = 200;
const MAX_PLAN_BYTES = 1_000_000;
const MAX_PROGRAM_BYTES = 1_000_000;

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
        typeof s.weekNumber !== 'number' || typeof s.startedAt !== 'number' ||
        (s.guid !== undefined && typeof s.guid !== 'string') ||
        (s.updatedAt !== undefined && typeof s.updatedAt !== 'number')) {
      return 'malformed session';
    }
  }
  if (data.deletedSessionGuids != null) {
    if (!Array.isArray(data.deletedSessionGuids)) return 'deletedSessionGuids must be an array';
    if (data.deletedSessionGuids.length > MAX_SESSIONS) return 'too many deleted session guids';
    if (data.deletedSessionGuids.some(g => typeof g !== 'string')) return 'malformed deleted session guid';
  }
  for (const s of data.setLogs) {
    if (typeof s.id !== 'number' || typeof s.sessionId !== 'number' ||
        typeof s.exerciseId !== 'string' || typeof s.setNumber !== 'number' ||
        typeof s.weight !== 'number' || typeof s.reps !== 'number' ||
        (s.order !== undefined && typeof s.order !== 'number') ||
        (s.warmup !== undefined && typeof s.warmup !== 'boolean')) {
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
  if (data.program != null) {
    if (!Array.isArray(data.program)) return 'program must be an array';
    if (JSON.stringify(data.program).length > MAX_PROGRAM_BYTES) return 'program too large';
  }
  if (data.plan != null) {
    if (typeof data.plan !== 'object') return 'malformed plan';
    if (data.plan.version !== 1 || !Array.isArray(data.plan.plans) ||
        typeof data.plan.updatedAt !== 'number') {
      return 'malformed plan';
    }
    if (data.plan.plans.length > MAX_PLANS) return 'too many plans';
    if (JSON.stringify(data.plan).length > MAX_PLAN_BYTES) return 'plan too large';
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

  // Exercise deletions are permanent but scoped to this user: union the
  // client's tombstones with the user's own (plus the read-only legacy
  // app-wide set), so no stale copy from another device can resurrect a
  // deleted exercise — and no user's deletion touches anyone else.
  const [existingUser, existingLegacy] = await Promise.all([
    env.DB.prepare('SELECT exercise_id FROM user_deleted_exercises WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare('SELECT exercise_id FROM deleted_exercises').all(),
  ]);
  const tombstoned = new Set([
    ...existingUser.results.map(r => r.exercise_id as string),
    ...existingLegacy.results.map(r => r.exercise_id as string),
  ]);
  const newTombstones = (data.deletedExerciseIds ?? []).filter(id => !tombstoned.has(id));
  for (const id of newTombstones) tombstoned.add(id);

  // Session tombstones follow the same rule, per user.
  const existingSessionTombs = await env.DB.prepare(
    'SELECT guid FROM deleted_sessions WHERE user_id = ?',
  ).bind(userId).all();
  const deadSessions = new Set(existingSessionTombs.results.map(r => r.guid as string));
  const newSessionTombs = (data.deletedSessionGuids ?? []).filter(g => !deadSessions.has(g));
  for (const g of newSessionTombs) deadSessions.add(g);

  const stmts: D1PreparedStatement[] = [];
  const now = Date.now();

  for (const id of newTombstones) {
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO user_deleted_exercises (user_id, exercise_id, deleted_at) VALUES (?, ?, ?)',
    ).bind(userId, id, now));
  }
  for (const g of newSessionTombs) {
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO deleted_sessions (user_id, guid, deleted_at) VALUES (?, ?, ?)',
    ).bind(userId, g, now));
    stmts.push(env.DB.prepare(
      'DELETE FROM session_docs WHERE user_id = ? AND guid = ?',
    ).bind(userId, g));
  }

  // Merge sessions per document: newer updated_at wins, everything else is
  // left alone — two devices logging different workouts both keep theirs.
  // Documents replace the old delete-all-and-reinsert, which silently dropped
  // whichever device pushed first.
  const setsBySession = new Map<number, SetEntry[]>();
  for (const s of data.setLogs) {
    const arr = setsBySession.get(s.sessionId) ?? [];
    // undefined order/warmup are dropped by JSON.stringify, keeping legacy docs unchanged
    arr.push({ exerciseId: s.exerciseId, setNumber: s.setNumber, weight: s.weight, reps: s.reps, order: s.order, warmup: s.warmup });
    setsBySession.set(s.sessionId, arr);
  }

  for (const s of data.sessions) {
    const guid = s.guid ?? `legacy-${s.startedAt}`;
    if (deadSessions.has(guid)) continue;
    const sets = setsBySession.get(s.id) ?? [];
    if (sets.length === 0) continue; // ghost/empty session — never store
    const updatedAt = s.updatedAt ?? s.completedAt ?? s.startedAt;
    stmts.push(env.DB.prepare(
      `INSERT INTO session_docs (user_id, guid, day_id, week_number, started_at, completed_at, updated_at, sets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, guid) DO UPDATE SET
         day_id       = excluded.day_id,
         week_number  = excluded.week_number,
         started_at   = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at   = excluded.updated_at,
         sets_json    = excluded.sets_json
       WHERE excluded.updated_at > session_docs.updated_at`,
    ).bind(userId, guid, s.dayId, s.weekNumber, s.startedAt, s.completedAt ?? null, updatedAt, JSON.stringify(sets)));
  }

  // The legacy per-row tables (workout_sessions/set_logs/exercise_logs) are
  // deliberately left untouched: the pull fallback only reads them while
  // session_docs is empty for the user, so once docs exist they're inert.
  // Deleting them here would risk losing history if a client pushed after a
  // failed pull (before ever merging the legacy data).

  // Layer 2: the user's own exercise library. UPSERT each pushed exercise per
  // user, never delete-and-replace — a client whose local library is missing
  // an exercise another of this user's devices just added must not erase it.
  // Deletion happens exclusively through tombstones, which every read filters.
  if (data.exercises) {
    for (const e of data.exercises) {
      if (tombstoned.has(e.id)) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO user_exercises (user_id, id, name, sets, rep_low, rep_high, archived) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           name     = excluded.name,
           sets     = excluded.sets,
           rep_low  = excluded.rep_low,
           rep_high = excluded.rep_high,
           archived = excluded.archived`,
      ).bind(userId, e.id, e.name, e.sets, e.repLow, e.repHigh, e.archived ? 1 : 0));
    }
    // Tombstoned rows may still exist from before this push carried the
    // tombstone — scrub them (reads already filter, this is hygiene).
    for (const id of tombstoned) {
      stmts.push(env.DB.prepare('DELETE FROM user_exercises WHERE user_id = ? AND id = ?').bind(userId, id));
    }

    // Exercise lifecycle: a custom exercise (timestamped id) enters the review
    // queue the first time any user pushes it. INSERT OR IGNORE keeps the
    // first submission; approval/rejection is an admin action (/api/admin).
    const musclesById = new Map((data.exerciseMuscles ?? []).map(m => [m.exerciseId, m]));
    const detailsById = new Map((data.exerciseDetails ?? []).map(d => [d.exerciseId, d]));
    for (const e of data.exercises) {
      if (tombstoned.has(e.id) || !CUSTOM_ID_RE.test(e.id)) continue;
      const meta = { ...musclesById.get(e.id), ...detailsById.get(e.id) };
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO pending_exercises (id, name, submitted_by, source, metadata_json, status, created_at)
         VALUES (?, ?, ?, 'user', ?, 'pending', ?)`,
      ).bind(e.id, e.name, userId, Object.keys(meta).length > 1 ? JSON.stringify(meta) : null, now));
    }
  }

  // Merge exerciseMuscles + exerciseDetails into one per-user row per
  // exerciseId — Layer 2 metadata overrides. Editing metadata personalizes the
  // exercise for this user only; it never touches anyone else's coaching.
  const metaMap = new Map<string, Record<string, unknown>>();
  for (const m of (data.exerciseMuscles ?? [])) {
    metaMap.set(m.exerciseId, { ...metaMap.get(m.exerciseId), ...m });
  }
  for (const d of (data.exerciseDetails ?? [])) {
    metaMap.set(d.exerciseId, { ...metaMap.get(d.exerciseId), ...d });
  }
  // Same rule as the library: upsert per exercise, never delete-and-replace,
  // so a push from a device that hasn't pulled another device's fresh metadata
  // yet can't erase it. Tombstoned rows are scrubbed explicitly below.
  for (const [exId, m] of metaMap) {
    if (tombstoned.has(exId)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO exercise_metadata
         (exercise_id, user_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exercise_id, user_id) DO UPDATE SET
         primary_muscle    = excluded.primary_muscle,
         secondary_muscle1 = excluded.secondary_muscle1,
         secondary_muscle2 = excluded.secondary_muscle2,
         secondary_muscle3 = excluded.secondary_muscle3,
         workout_type      = excluded.workout_type,
         equipment         = excluded.equipment,
         weight_type       = excluded.weight_type`,
    ).bind(
      exId,
      userId,
      (m.primaryMuscle    as string | null) ?? null,
      (m.secondaryMuscle1 as string | null) ?? null,
      (m.secondaryMuscle2 as string | null) ?? null,
      (m.secondaryMuscle3 as string | null) ?? null,
      (m.workoutType      as string | null) ?? null,
      (m.equipment        as string | null) ?? null,
      (m.weightType       as string | null) ?? null,
    ));
  }
  for (const id of tombstoned) {
    stmts.push(env.DB.prepare('DELETE FROM exercise_metadata WHERE exercise_id = ? AND user_id = ?').bind(id, userId));
  }

  // SAFEGUARD: never let an empty program overwrite a stored one. An empty
  // array is truthy in JS, so the old `if (data.program)` happily persisted a
  // wiped program into user_programs, from where every device re-pulled it.
  // A program with zero days is only valid for a brand-new account that has
  // never stored one — and that case writes nothing here anyway (no data to
  // lose). Requiring at least one day makes a bad/empty push a no-op instead
  // of destroying the server's copy. The library still persists via the
  // per-row user_exercises upserts above, independent of this row.
  if (Array.isArray(data.program) && data.program.length > 0 && data.exercises) {
    stmts.push(env.DB.prepare(
      `INSERT INTO user_programs (user_id, program_json, exercises_json) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         program_json   = excluded.program_json,
         exercises_json = excluded.exercises_json`,
    ).bind(userId, JSON.stringify(data.program), JSON.stringify(data.exercises)));
  }

  // Training journey: upsert only when the pushed document is newer — the
  // same last-write-wins the client applies on pull, enforced on both ends.
  if (data.plan) {
    stmts.push(env.DB.prepare(
      `INSERT INTO training_plans (user_id, plan_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan_json  = excluded.plan_json,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > training_plans.updated_at`,
    ).bind(userId, JSON.stringify(data.plan), data.plan.updatedAt));
  }

  // D1 batch limit is 1000 statements; chunk to be safe
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }

  return Response.json({ ok: true });
}
