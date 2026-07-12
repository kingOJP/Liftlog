import type { Env } from './types';
import { getAuthenticatedUser } from './auth';
import { getUserRole } from './roles';

// Admin API — custodianship of the Layer 1 (application-owned) exercise
// library. Every route requires the 'admin' role; every write lands an audit
// row (what / who / when / why) in global_exercise_audit.
//
//   GET  /api/admin/pending                 — list exercises awaiting review
//   POST /api/admin/pending/:id             — { action: 'approve'|'reject', note? }
//   PUT  /api/admin/exercises/:id           — edit a global exercise/metadata; body
//                                             { name?, sets?, repLow?, repHigh?, archived?,
//                                               metadata?: {...}, reason }
//   GET  /api/admin/audit?exerciseId=...    — change history

interface PendingReviewBody {
  action: 'approve' | 'reject';
  note?: string;
  /** admin-corrected fields applied at promotion time */
  name?: string;
  sets?: number;
  repLow?: number;
  repHigh?: number;
  metadata?: MetadataBody;
}

interface MetadataBody {
  primaryMuscle?: string | null;
  secondaryMuscle1?: string | null;
  secondaryMuscle2?: string | null;
  secondaryMuscle3?: string | null;
  workoutType?: string | null;
  equipment?: string | null;
  weightType?: string | null;
}

interface GlobalEditBody {
  name?: string;
  sets?: number;
  repLow?: number;
  repHigh?: number;
  archived?: boolean;
  metadata?: MetadataBody;
  reason: string;
}

export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (await getUserRole(user.id, env) !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parts = url.pathname.split('/').filter(Boolean); // ['api','admin',...]
  const section = parts[2];
  const id = parts[3] ? decodeURIComponent(parts[3]) : null;

  if (section === 'pending' && !id && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, name, submitted_by, source, metadata_json, created_at
       FROM pending_exercises WHERE status = 'pending' ORDER BY created_at`,
    ).all();
    return Response.json({ pending: rows.results });
  }

  if (section === 'pending' && id && request.method === 'POST') {
    return reviewPending(request, env, user.id, id);
  }

  if (section === 'exercises' && id && request.method === 'PUT') {
    return editGlobal(request, env, user.id, id);
  }

  if (section === 'audit' && request.method === 'GET') {
    const exerciseId = url.searchParams.get('exerciseId');
    const rows = exerciseId
      ? await env.DB.prepare(
          'SELECT * FROM global_exercise_audit WHERE exercise_id = ? ORDER BY changed_at DESC',
        ).bind(exerciseId).all()
      : await env.DB.prepare(
          'SELECT * FROM global_exercise_audit ORDER BY changed_at DESC LIMIT 200',
        ).all();
    return Response.json({ audit: rows.results });
  }

  return new Response('Not Found', { status: 404 });
}

async function reviewPending(request: Request, env: Env, adminId: string, id: string): Promise<Response> {
  let body: PendingReviewBody;
  try {
    body = await request.json() as PendingReviewBody;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return Response.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const pending = await env.DB.prepare(
    "SELECT id, name, metadata_json FROM pending_exercises WHERE id = ? AND status = 'pending'",
  ).bind(id).first<{ id: string; name: string; metadata_json: string | null }>();
  if (!pending) return Response.json({ error: 'No pending exercise with that id' }, { status: 404 });

  const now = Date.now();
  const status = body.action === 'approve' ? 'approved' : 'rejected';
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      'UPDATE pending_exercises SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?',
    ).bind(status, adminId, now, body.note ?? null, id),
    env.DB.prepare(
      `INSERT INTO global_exercise_audit (exercise_id, action, changed_by, changed_at, reason, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, body.action === 'approve' ? 'promote' : 'reject', adminId, now,
           body.note ?? null, pending.metadata_json),
  ];

  if (body.action === 'approve') {
    stmts.push(env.DB.prepare(
      `INSERT INTO global_exercises (id, name, sets, rep_low, rep_high, archived) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, sets = excluded.sets,
         rep_low = excluded.rep_low, rep_high = excluded.rep_high, archived = 0`,
    ).bind(id, body.name ?? pending.name, body.sets ?? 3, body.repLow ?? 8, body.repHigh ?? 12));

    const submitted = pending.metadata_json ? JSON.parse(pending.metadata_json) as MetadataBody : {};
    const meta = { ...submitted, ...body.metadata };
    stmts.push(env.DB.prepare(
      `INSERT INTO global_exercise_metadata
         (exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exercise_id) DO UPDATE SET
         primary_muscle = excluded.primary_muscle, secondary_muscle1 = excluded.secondary_muscle1,
         secondary_muscle2 = excluded.secondary_muscle2, secondary_muscle3 = excluded.secondary_muscle3,
         workout_type = excluded.workout_type, equipment = excluded.equipment,
         weight_type = excluded.weight_type`,
    ).bind(id, meta.primaryMuscle ?? null, meta.secondaryMuscle1 ?? null,
           meta.secondaryMuscle2 ?? null, meta.secondaryMuscle3 ?? null,
           meta.workoutType ?? null, meta.equipment ?? null, meta.weightType ?? null));
  }

  await env.DB.batch(stmts);
  return Response.json({ ok: true, status });
}

async function editGlobal(request: Request, env: Env, adminId: string, id: string): Promise<Response> {
  let body: GlobalEditBody;
  try {
    body = await request.json() as GlobalEditBody;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.reason || typeof body.reason !== 'string') {
    return Response.json({ error: 'A reason is required for every global edit' }, { status: 400 });
  }

  const before = await env.DB.prepare(
    'SELECT id, name, sets, rep_low, rep_high, archived FROM global_exercises WHERE id = ?',
  ).bind(id).first();

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  stmts.push(env.DB.prepare(
    `INSERT INTO global_exercises (id, name, sets, rep_low, rep_high, archived) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name     = COALESCE(excluded.name, global_exercises.name),
       sets     = COALESCE(excluded.sets, global_exercises.sets),
       rep_low  = COALESCE(excluded.rep_low, global_exercises.rep_low),
       rep_high = COALESCE(excluded.rep_high, global_exercises.rep_high),
       archived = COALESCE(excluded.archived, global_exercises.archived)`,
  ).bind(id, body.name ?? (before?.name ?? id), body.sets ?? (before?.sets ?? 3),
         body.repLow ?? (before?.rep_low ?? 8), body.repHigh ?? (before?.rep_high ?? 12),
         body.archived === undefined ? (before?.archived ?? 0) : (body.archived ? 1 : 0)));

  if (body.metadata) {
    const m = body.metadata;
    stmts.push(env.DB.prepare(
      `INSERT INTO global_exercise_metadata
         (exercise_id, primary_muscle, secondary_muscle1, secondary_muscle2, secondary_muscle3,
          workout_type, equipment, weight_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exercise_id) DO UPDATE SET
         primary_muscle = excluded.primary_muscle, secondary_muscle1 = excluded.secondary_muscle1,
         secondary_muscle2 = excluded.secondary_muscle2, secondary_muscle3 = excluded.secondary_muscle3,
         workout_type = excluded.workout_type, equipment = excluded.equipment,
         weight_type = excluded.weight_type`,
    ).bind(id, m.primaryMuscle ?? null, m.secondaryMuscle1 ?? null,
           m.secondaryMuscle2 ?? null, m.secondaryMuscle3 ?? null,
           m.workoutType ?? null, m.equipment ?? null, m.weightType ?? null));
  }

  stmts.push(env.DB.prepare(
    `INSERT INTO global_exercise_audit (exercise_id, action, changed_by, changed_at, reason, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.archived ? 'retire' : 'edit', adminId, now, body.reason,
         JSON.stringify({ before: before ?? null, after: body })));

  await env.DB.batch(stmts);
  return Response.json({ ok: true });
}
