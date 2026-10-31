import type { Env } from './types';
import { getAuthenticatedUser } from './auth';
import type { Role } from './roles';
import { isPlanDoc, mergePlanDocs, planDocClock } from './planMerge';
import type { PlanDocLike } from './planMerge';

// Custom exercises are stamped `${slug}-${Date.now()}` by the client
// (generateExerciseId) — a trailing 10+ digit timestamp marks user-created
// content, which enters the lifecycle queue for admin review.
const CUSTOM_ID_RE = /-\d{10,}$/;

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (request.method === 'GET')  return pull(request, user.id, user.role, env);
  if (request.method === 'POST') return push(request, user.id, env);
  return new Response('Method Not Allowed', { status: 405 });
}

const META_COLUMNS = `exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2,
                      secondary_muscle3, workout_type, equipment, weight_type, updated_at`;

interface SetEntry {
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  /** 0-based exercise position within the workout (absent on legacy rows) */
  order?: number;
  repLow?: number;
  repHigh?: number;
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
  /** free-text session note (absent/null when none) */
  note?: string | null;
  sets: SetEntry[];
}

// The user's sessions as documents: session_docs, or — until this user's
// first sync-v2 push — assembled from the legacy per-row tables. Legacy docs
// derive the same deterministic GUID the client derives (legacy-<startedAt>),
// so both sides agree on identity. Empty sessions (ghosts) are dropped.
async function loadSessionDocs(userId: string, env: Env): Promise<SessionDoc[]> {
  const docs = await env.DB.prepare(
    'SELECT guid, day_id, week_number, started_at, completed_at, updated_at, sets_json, note FROM session_docs WHERE user_id = ?',
  ).bind(userId).all();

  if (docs.results.length > 0) {
    return docs.results.map(r => ({
      guid:        r.guid as string,
      dayId:       r.day_id as number,
      weekNumber:  r.week_number as number,
      startedAt:   r.started_at as number,
      completedAt: (r.completed_at as number | null) ?? null,
      updatedAt:   r.updated_at as number,
      note:        (r.note as string | null) ?? null,
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

// ── Conditional pull ────────────────────────────────────────────────────────
// The client pulls every 60 s while open. Almost every one of those pulls
// finds nothing new, yet used to download the whole history. The ETag is a
// fingerprint of everything a pull serves — per-user clocks and row counts
// (a count catches a delete that no clock records), the global layers'
// audit clock, the merge table, the role — so an unchanged account costs one
// small 304. It is computed BEFORE the data is read: if a push lands in
// between, the data is newer than the tag and the next pull re-fetches,
// never the other way round.
async function computeEtag(userId: string, env: Env): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*)        FROM session_docs           WHERE user_id = ?1) AS docs,
       (SELECT MAX(updated_at) FROM session_docs           WHERE user_id = ?1) AS docs_at,
       (SELECT MAX(deleted_at) FROM deleted_sessions       WHERE user_id = ?1) AS dead_at,
       (SELECT updated_at      FROM user_programs          WHERE user_id = ?1) AS prog_at,
       (SELECT COUNT(*)        FROM user_exercises         WHERE user_id = ?1) AS lib,
       (SELECT MAX(updated_at) FROM user_exercises         WHERE user_id = ?1) AS lib_at,
       (SELECT COUNT(*)        FROM exercise_metadata      WHERE user_id = ?1) AS meta,
       (SELECT MAX(updated_at) FROM exercise_metadata      WHERE user_id = ?1) AS meta_at,
       (SELECT COUNT(*)        FROM user_deleted_exercises WHERE user_id = ?1) AS tombs,
       (SELECT MAX(deleted_at) FROM user_deleted_exercises WHERE user_id = ?1) AS tombs_at,
       (SELECT updated_at      FROM training_plans         WHERE user_id = ?1) AS plan_at,
       (SELECT MAX(changed_at) FROM global_exercise_audit)                     AS global_at,
       (SELECT COUNT(*)        FROM global_exercises)                          AS globals,
       (SELECT COUNT(*)        FROM exercise_merges)                           AS merges,
       (SELECT role            FROM user_roles             WHERE user_id = ?1) AS role`,
  ).bind(userId).first<Record<string, unknown>>();
  const parts = Object.values(row ?? {}).map(v => (v == null ? '0' : String(v)));
  // The account is part of the tag so a tag can never validate across users.
  return `W/"${userId}.${parts.join('.')}"`;
}

async function pull(request: Request, userId: string, role: Role, env: Env): Promise<Response> {
  const etag = await computeEtag(userId, env);
  const headers = { ETag: etag, 'Cache-Control': 'no-store' };
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  const [sessionDocs, sessionTombstones, program, userExercises, userMeta,
         userTombstones, legacyTombstones, globalExercises, globalMeta, planRow,
         mergeRows] = await Promise.all([
    loadSessionDocs(userId, env),
    env.DB.prepare('SELECT guid FROM deleted_sessions WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare(
      'SELECT program_json, exercises_json, updated_at FROM user_programs WHERE user_id = ?',
    ).bind(userId).first<{ program_json: string; exercises_json: string; updated_at: number }>(),
    env.DB.prepare(
      'SELECT id, name, sets, rep_low, rep_high, archived, updated_at FROM user_exercises WHERE user_id = ?',
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
    env.DB.prepare(
      `SELECT exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2,
              secondary_muscle3, workout_type, equipment, weight_type FROM global_exercise_metadata`,
    ).all(),
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
      ...(d.note ? { note: d.note } : {}),
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
      `SELECT exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2,
              secondary_muscle3, workout_type, equipment, weight_type, 0 AS updated_at
       FROM app_exercise_metadata`,
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
    ...(typeof r.updated_at === 'number' && r.updated_at > 0 ? { updatedAt: r.updated_at } : {}),
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
      // the override's clock rides on the details row (one clock per exercise)
      ...(typeof r.updated_at === 'number' && r.updated_at > 0 ? { updatedAt: r.updated_at } : {}),
    })),
    deletedExerciseIds: [...deletedIds],
    program:   program?.program_json ? JSON.parse(program.program_json) : null,
    programUpdatedAt: program?.updated_at ?? 0,
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
  }, { headers });
}

interface PushExercise {
  id: string; name: string; archived?: boolean;
  /** clock of the last local edit — a push only replaces an older server copy */
  updatedAt?: number;
  /** @deprecated wire-compatibility only — older clients still send these */
  sets?: number; repLow?: number; repHigh?: number;
}

interface PushMuscles {
  exerciseId: string;
  primaryMuscle: string | null; secondaryMuscle1: string | null;
  secondaryMuscle2: string | null; secondaryMuscle3: string | null;
}
interface PushDetails {
  exerciseId: string;
  workoutType: string | null; equipment: string | null; weightType: string | null;
  /** the override's clock (one per exercise, carried on the details row) */
  updatedAt?: number;
}

interface PushPayload {
  // guid/updatedAt are absent from stale cached clients — the server derives
  // the same deterministic fallbacks the client would (legacy-<startedAt>,
  // completedAt) so identities agree across versions.
  sessions:      Array<{ id: number; guid?: string; dayId: number; weekNumber: number; startedAt: number; completedAt?: number | null; updatedAt?: number; note?: string | null }>;
  setLogs:       Array<{ id: number; sessionId: number; exerciseId: string; setNumber: number; weight: number; reps: number; order?: number; warmup?: boolean; repLow?: number; repHigh?: number }>;
  /** Dead feature (difficulty ratings) — accepted for wire compatibility, ignored */
  exerciseLogs:  unknown[];
  deletedSessionGuids?: string[];
  exerciseMuscles?: PushMuscles[];
  exerciseDetails?: PushDetails[];
  deletedExerciseIds?: string[];
  /** exercises the user explicitly brought back after deleting — lifts their tombstones */
  restoredExerciseIds?: string[];
  program?:  unknown[] | null;
  /** clock of the program's last local edit; absent from older clients */
  programUpdatedAt?: number;
  exercises: PushExercise[] | null;
  /** training journey document — plans LWW by updatedAt, profile by its own clock */
  plan?: PlanDocLike | null;
}

// Sanity limits — a personal training log is nowhere near these; anything
// beyond them is a bug or abuse, and rejecting beats writing garbage.
const MAX_SESSIONS   = 20_000;
const MAX_SET_LOGS   = 200_000;
const MAX_EXERCISES  = 10_000;
const MAX_PLANS      = 200;
const MAX_PLAN_BYTES = 1_000_000;
const MAX_PROGRAM_BYTES = 512_000;
const MAX_NOTE_CHARS = 2_000;

const isOptString = (v: unknown) => v === undefined || v === null || typeof v === 'string';
const isOptNumber = (v: unknown) => v === undefined || typeof v === 'number';

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
        (s.completedAt != null && typeof s.completedAt !== 'number') ||
        (s.guid !== undefined && typeof s.guid !== 'string') ||
        !isOptNumber(s.updatedAt) || !isOptString(s.note)) {
      return 'malformed session';
    }
    if (typeof s.note === 'string' && s.note.length > MAX_NOTE_CHARS) return 'session note too long';
  }
  for (const [key, list] of [['deletedSessionGuids', data.deletedSessionGuids]] as const) {
    if (list == null) continue;
    if (!Array.isArray(list)) return `${key} must be an array`;
    if (list.length > MAX_SESSIONS) return 'too many deleted session guids';
    if (list.some(g => typeof g !== 'string')) return 'malformed deleted session guid';
  }
  for (const s of data.setLogs) {
    if (typeof s.id !== 'number' || typeof s.sessionId !== 'number' ||
        typeof s.exerciseId !== 'string' || typeof s.setNumber !== 'number' ||
        typeof s.weight !== 'number' || typeof s.reps !== 'number' ||
        !isOptNumber(s.order) ||
        (s.warmup !== undefined && typeof s.warmup !== 'boolean') ||
        !isOptNumber(s.repLow) || !isOptNumber(s.repHigh)) {
      return 'malformed set log';
    }
  }
  if (data.exercises != null) {
    if (!Array.isArray(data.exercises)) return 'exercises must be an array';
    if (data.exercises.length > MAX_EXERCISES) return 'too many exercises';
    for (const e of data.exercises) {
      // Identity only. sets/repLow/repHigh moved onto the prescription
      // (data/dosage.ts) and current clients no longer send them; requiring
      // them here rejected every push those clients made. They stay accepted
      // and stored for older clients that still read the columns.
      if (typeof e.id !== 'string' || typeof e.name !== 'string' ||
          !isOptNumber(e.sets) || !isOptNumber(e.repLow) || !isOptNumber(e.repHigh) ||
          !isOptNumber(e.updatedAt)) {
        return 'malformed exercise';
      }
    }
  }
  for (const [key, list] of [
    ['deletedExerciseIds', data.deletedExerciseIds],
    ['restoredExerciseIds', data.restoredExerciseIds],
  ] as const) {
    if (list == null) continue;
    if (!Array.isArray(list)) return `${key} must be an array`;
    if (list.length > MAX_EXERCISES) return `too many ${key}`;
    if (list.some(id => typeof id !== 'string')) return `malformed ${key.replace('Ids', ' id')}`;
  }
  // Metadata rows used to be unvalidated: a non-array value threw inside
  // .map and surfaced as a 500, a non-string field landed in a TEXT column.
  if (data.exerciseMuscles != null) {
    if (!Array.isArray(data.exerciseMuscles)) return 'exerciseMuscles must be an array';
    if (data.exerciseMuscles.length > MAX_EXERCISES) return 'too many exerciseMuscles';
    for (const m of data.exerciseMuscles) {
      if (typeof m !== 'object' || m === null || typeof m.exerciseId !== 'string' ||
          !isOptString(m.primaryMuscle) || !isOptString(m.secondaryMuscle1) ||
          !isOptString(m.secondaryMuscle2) || !isOptString(m.secondaryMuscle3)) {
        return 'malformed exerciseMuscles';
      }
    }
  }
  if (data.exerciseDetails != null) {
    if (!Array.isArray(data.exerciseDetails)) return 'exerciseDetails must be an array';
    if (data.exerciseDetails.length > MAX_EXERCISES) return 'too many exerciseDetails';
    for (const d of data.exerciseDetails) {
      if (typeof d !== 'object' || d === null || typeof d.exerciseId !== 'string' ||
          !isOptString(d.workoutType) || !isOptString(d.equipment) || !isOptString(d.weightType) ||
          !isOptNumber(d.updatedAt)) {
        return 'malformed exerciseDetails';
      }
    }
  }
  if (data.program != null) {
    if (!Array.isArray(data.program)) return 'program must be an array';
    if (JSON.stringify(data.program).length > MAX_PROGRAM_BYTES) return 'program too large';
  }
  if (!isOptNumber(data.programUpdatedAt)) return 'malformed programUpdatedAt';
  if (data.plan != null) {
    if (!isPlanDoc(data.plan)) return 'malformed plan';
    if (data.plan.plans.length > MAX_PLANS) return 'too many plans';
    if (JSON.stringify(data.plan).length > MAX_PLAN_BYTES) return 'plan too large';
  }
  return null;
}

// D1 batches are atomic, but a request this size is best kept in one. If a
// push ever outgrows a single batch, the chunks are ordered so every upsert
// lands before anything destructive: a failure mid-way leaves extra data,
// never a tombstone without the merge that accompanied it.
const BATCH_MAX = 500;

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
  // deleted exercise — and no user's deletion touches anyone else. The one
  // way back is explicit: an exercise the user re-added by hand (or that an
  // admin merge made the survivor) arrives in restoredExerciseIds and has
  // its per-user tombstone lifted. Legacy app-wide tombstones cannot be
  // lifted per user and stay in force.
  const [existingUser, existingLegacy, existingPlan] = await Promise.all([
    env.DB.prepare('SELECT exercise_id FROM user_deleted_exercises WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare('SELECT exercise_id FROM deleted_exercises').all(),
    env.DB.prepare('SELECT plan_json FROM training_plans WHERE user_id = ?').bind(userId)
      .first<{ plan_json: string }>(),
  ]);
  const clientDeleted = new Set(data.deletedExerciseIds ?? []);
  const restored = new Set((data.restoredExerciseIds ?? []).filter(id => !clientDeleted.has(id)));
  const userTombs = new Set(existingUser.results.map(r => r.exercise_id as string));
  const liftedTombs = [...restored].filter(id => userTombs.has(id));
  for (const id of liftedTombs) userTombs.delete(id);

  const tombstoned = new Set([
    ...userTombs,
    ...existingLegacy.results.map(r => r.exercise_id as string),
  ]);
  const newTombstones = [...clientDeleted].filter(id => !tombstoned.has(id));
  for (const id of newTombstones) tombstoned.add(id);

  // Session tombstones follow the same rule, per user.
  const existingSessionTombs = await env.DB.prepare(
    'SELECT guid FROM deleted_sessions WHERE user_id = ?',
  ).bind(userId).all();
  const deadSessions = new Set(existingSessionTombs.results.map(r => r.guid as string));
  const newSessionTombs = (data.deletedSessionGuids ?? []).filter(g => !deadSessions.has(g));
  for (const g of newSessionTombs) deadSessions.add(g);

  const upserts: D1PreparedStatement[] = [];
  const destructive: D1PreparedStatement[] = [];
  const now = Date.now();

  for (const id of liftedTombs) {
    destructive.push(env.DB.prepare(
      'DELETE FROM user_deleted_exercises WHERE user_id = ? AND exercise_id = ?',
    ).bind(userId, id));
  }
  for (const id of newTombstones) {
    destructive.push(env.DB.prepare(
      'INSERT OR IGNORE INTO user_deleted_exercises (user_id, exercise_id, deleted_at) VALUES (?, ?, ?)',
    ).bind(userId, id, now));
    // Rows written before the tombstone existed — scrubbed once, here, rather
    // than re-issuing a DELETE for every tombstone on every push.
    destructive.push(env.DB.prepare('DELETE FROM user_exercises WHERE user_id = ? AND id = ?').bind(userId, id));
    destructive.push(env.DB.prepare('DELETE FROM exercise_metadata WHERE exercise_id = ? AND user_id = ?').bind(id, userId));
  }
  for (const g of newSessionTombs) {
    destructive.push(env.DB.prepare(
      'INSERT OR IGNORE INTO deleted_sessions (user_id, guid, deleted_at) VALUES (?, ?, ?)',
    ).bind(userId, g, now));
    destructive.push(env.DB.prepare(
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
    arr.push({ exerciseId: s.exerciseId, setNumber: s.setNumber, weight: s.weight, reps: s.reps, order: s.order, warmup: s.warmup, repLow: s.repLow, repHigh: s.repHigh });
    setsBySession.set(s.sessionId, arr);
  }

  for (const s of data.sessions) {
    const guid = s.guid ?? `legacy-${s.startedAt}`;
    if (deadSessions.has(guid)) continue;
    const sets = setsBySession.get(s.id) ?? [];
    if (sets.length === 0) continue; // ghost/empty session — never store
    const updatedAt = s.updatedAt ?? s.completedAt ?? s.startedAt;
    upserts.push(env.DB.prepare(
      `INSERT INTO session_docs (user_id, guid, day_id, week_number, started_at, completed_at, updated_at, sets_json, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, guid) DO UPDATE SET
         day_id       = excluded.day_id,
         week_number  = excluded.week_number,
         started_at   = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at   = excluded.updated_at,
         sets_json    = excluded.sets_json,
         note         = excluded.note
       WHERE excluded.updated_at > session_docs.updated_at`,
    ).bind(userId, guid, s.dayId, s.weekNumber, s.startedAt, s.completedAt ?? null, updatedAt, JSON.stringify(sets), s.note?.trim() ? s.note.trim() : null));
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
  // Per row, a copy only replaces one that is not newer (unstamped rows carry
  // 0 on both sides, so legacy clients keep their last-push-wins behaviour).
  if (data.exercises) {
    for (const e of data.exercises) {
      if (tombstoned.has(e.id)) continue;
      upserts.push(env.DB.prepare(
        `INSERT INTO user_exercises (user_id, id, name, sets, rep_low, rep_high, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           name       = excluded.name,
           sets       = excluded.sets,
           rep_low    = excluded.rep_low,
           rep_high   = excluded.rep_high,
           archived   = excluded.archived,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= user_exercises.updated_at`,
      // The rep columns are NOT NULL and only an older client reads them, so
      // an identity-only entry stores the same 3 × 8–12 the pre-dosage library
      // used as its fallback. Nothing on a current client reads these back.
      ).bind(userId, e.id, e.name, e.sets ?? 3, e.repLow ?? 8, e.repHigh ?? 12, e.archived ? 1 : 0, e.updatedAt ?? 0));
    }

    // Exercise lifecycle: a custom exercise (timestamped id) enters the review
    // queue the first time any user pushes it. INSERT OR IGNORE keeps the
    // first submission; approval/rejection is an admin action (/api/admin).
    const musclesById = new Map((data.exerciseMuscles ?? []).map(m => [m.exerciseId, m]));
    const detailsById = new Map((data.exerciseDetails ?? []).map(d => [d.exerciseId, d]));
    for (const e of data.exercises) {
      if (tombstoned.has(e.id) || !CUSTOM_ID_RE.test(e.id)) continue;
      const meta: Record<string, unknown> = { ...musclesById.get(e.id), ...detailsById.get(e.id) };
      delete meta.updatedAt;
      upserts.push(env.DB.prepare(
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
  // yet can't erase it — and a row only yields to one at least as new.
  for (const [exId, m] of metaMap) {
    if (tombstoned.has(exId)) continue;
    upserts.push(env.DB.prepare(
      `INSERT INTO exercise_metadata
         (exercise_id, user_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exercise_id, user_id) DO UPDATE SET
         primary_muscle    = excluded.primary_muscle,
         secondary_muscle1 = excluded.secondary_muscle1,
         secondary_muscle2 = excluded.secondary_muscle2,
         secondary_muscle3 = excluded.secondary_muscle3,
         workout_type      = excluded.workout_type,
         equipment         = excluded.equipment,
         weight_type       = excluded.weight_type,
         updated_at        = excluded.updated_at
       WHERE excluded.updated_at >= exercise_metadata.updated_at`,
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
      typeof m.updatedAt === 'number' ? m.updatedAt : 0,
    ));
  }

  // The program document. Two guards:
  //  • A copy only replaces one that is not newer (clock >= stored). Unstamped
  //    pushes (older clients, never-edited programs) carry 0 and keep their
  //    last-push-wins behaviour against an unstamped row, but can no longer
  //    overwrite an edit a current client made.
  //  • An UNSTAMPED empty program is a wipe, not a decision: an empty array is
  //    truthy, and `if (data.program)` once persisted a wiped program that every
  //    device then re-pulled. A stamped empty program is the user deleting
  //    their last day on purpose, and is stored like any other edit.
  if (Array.isArray(data.program) && data.exercises &&
      (data.program.length > 0 || data.programUpdatedAt != null)) {
    upserts.push(env.DB.prepare(
      `INSERT INTO user_programs (user_id, program_json, exercises_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         program_json   = excluded.program_json,
         exercises_json = excluded.exercises_json,
         updated_at     = excluded.updated_at
       WHERE excluded.updated_at >= user_programs.updated_at`,
    ).bind(userId, JSON.stringify(data.program), JSON.stringify(data.exercises), data.programUpdatedAt ?? 0));
  }

  // Training journey: the same merge the client applies on pull (planMerge.ts)
  // — the newer plans document wins, the newer profile wins — then the merged
  // document is stored. Reading the current row first means the decision is
  // made in one place rather than approximated with a WHERE clause.
  if (data.plan) {
    let current: PlanDocLike | null = null;
    if (existingPlan?.plan_json) {
      try {
        const parsed: unknown = JSON.parse(existingPlan.plan_json);
        if (isPlanDoc(parsed)) current = parsed;
      } catch { /* an unreadable row is replaced */ }
    }
    const { doc, changed } = mergePlanDocs(current, data.plan);
    if (changed) {
      upserts.push(env.DB.prepare(
        `INSERT INTO training_plans (user_id, plan_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           plan_json  = excluded.plan_json,
           updated_at = excluded.updated_at`,
      ).bind(userId, JSON.stringify(doc), planDocClock(doc)));
    }
  }

  const stmts = [...upserts, ...destructive];
  for (let i = 0; i < stmts.length; i += BATCH_MAX) {
    await env.DB.batch(stmts.slice(i, i + BATCH_MAX));
  }

  return Response.json({ ok: true });
}
