// worker/admin.ts — the audited Layer 1 (application-owned) write path.
//
// Everything here writes data that is served to EVERY user on pull, which is
// exactly why it is role-gated and why every change must carry a reason into
// global_exercise_audit. Those two properties are the ones worth pinning down:
// a regression in either is invisible to the person who causes it and visible
// to everybody else.

import { describe, it, expect, beforeEach } from 'vitest';
import { handleAdmin } from './admin';
import { createTestEnv, signIn, setRole } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;
let admin: string;

beforeEach(() => {
  env = createTestEnv();
  admin = signIn(env, 'admin-1', 'admin@example.com');
  setRole(env, 'admin-1', 'admin');
});

function call(method: string, path: string, cookie: string | null, body?: unknown): Promise<Response> {
  const url = new URL(`https://liftlog.test${path}`);
  return handleAdmin(new Request(url, {
    method,
    headers: cookie ? { Cookie: cookie, 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, url);
}

const audit = () =>
  env.raw.prepare('SELECT exercise_id, action, changed_by, reason FROM global_exercise_audit').all() as
    Array<{ exercise_id: string; action: string; changed_by: string; reason: string }>;

describe('the role gate', () => {
  it('rejects an anonymous caller', async () => {
    expect((await call('GET', '/api/admin/pending', null)).status).toBe(401);
  });

  it('rejects a signed-in standard user', async () => {
    const user = signIn(env, 'user-9', 'u@example.com');
    expect((await call('GET', '/api/admin/pending', user)).status).toBe(403);
  });

  it('rejects a tester — the role exists, the privilege does not', async () => {
    const tester = signIn(env, 'user-8', 't@example.com');
    setRole(env, 'user-8', 'tester');
    expect((await call('GET', '/api/admin/pending', tester)).status).toBe(403);
  });

  it('lets an admin through', async () => {
    expect((await call('GET', '/api/admin/pending', admin)).status).toBe(200);
  });

  it('404s an unknown admin route rather than falling through', async () => {
    expect((await call('GET', '/api/admin/nonsense', admin)).status).toBe(404);
  });

  // The gate runs before routing, so an unauthorized caller cannot even learn
  // which admin routes exist.
  it('checks the role before the route, even for a route that does not exist', async () => {
    const user = signIn(env, 'user-9', 'u@example.com');
    expect((await call('GET', '/api/admin/nonsense', user)).status).toBe(403);
  });
});

describe('exercise merges', () => {
  const merge = (fromId: string, toId: string, reason = 'duplicate') =>
    call('POST', '/api/admin/merges', admin, { fromId, toId, reason });

  it('records a merge and returns it on the merges listing', async () => {
    expect((await merge('bench-press-1700000000000', 'bench-press')).status).toBe(200);
    const data = await (await call('GET', '/api/admin/merges', admin)).json() as
      { merges: Array<{ from_id: string; to_id: string; merged_by: string }> };
    expect(data.merges).toEqual([expect.objectContaining({
      from_id: 'bench-press-1700000000000', to_id: 'bench-press', merged_by: 'admin-1',
    })]);
  });

  it('writes an audit row naming the admin and the reason', async () => {
    await merge('a', 'b', 'same movement, different capitalisation');
    expect(audit()).toEqual([expect.objectContaining({
      exercise_id: 'a', action: 'merge', changed_by: 'admin-1',
      reason: 'same movement, different capitalisation',
    })]);
  });

  it('requires a reason — an unexplained global change is not allowed', async () => {
    const res = await call('POST', '/api/admin/merges', admin, { fromId: 'a', toId: 'b' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'A reason is required for every merge' });
  });

  it('requires both ids', async () => {
    expect((await call('POST', '/api/admin/merges', admin, { fromId: '  ', toId: 'b', reason: 'r' })).status).toBe(400);
  });

  it('refuses a self-merge', async () => {
    const res = await merge('a', 'a');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Cannot merge an exercise into itself' });
  });

  it('refuses a merge that would make client-side resolution loop', async () => {
    await merge('a', 'b');
    await merge('b', 'c');
    const res = await merge('c', 'a'); // c → a → b → c
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Merge would create a cycle' });
  });

  it('allows re-pointing an existing merge (a chain, not a cycle)', async () => {
    await merge('a', 'b');
    expect((await merge('a', 'c')).status).toBe(200);
    const data = await (await call('GET', '/api/admin/merges', admin)).json() as
      { merges: Array<{ from_id: string; to_id: string }> };
    expect(data.merges).toEqual([expect.objectContaining({ from_id: 'a', to_id: 'c' })]);
  });

  it('rejects invalid JSON', async () => {
    const url = new URL('https://liftlog.test/api/admin/merges');
    const res = await handleAdmin(new Request(url, {
      method: 'POST', headers: { Cookie: admin }, body: '{oops',
    }), env, url);
    expect(res.status).toBe(400);
  });
});

describe('the pending custom-exercise queue', () => {
  function queue(id: string, name: string, submittedBy = 'user-7') {
    env.raw.prepare(
      `INSERT INTO pending_exercises (id, name, submitted_by, source, metadata_json, status, created_at)
       VALUES (?, ?, ?, 'user', '{}', 'pending', ?)`,
    ).run(id, name, submittedBy, Date.now());
  }

  const review = (id: string, action: string, note?: string) =>
    call('POST', `/api/admin/pending/${encodeURIComponent(id)}`, admin, { action, note });

  it('lists only exercises still awaiting review', async () => {
    queue('new-lift-1700000000000', 'New Lift');
    const data = await (await call('GET', '/api/admin/pending', admin)).json() as
      { pending: Array<{ id: string; name: string }> };
    expect(data.pending).toEqual([expect.objectContaining({ id: 'new-lift-1700000000000', name: 'New Lift' })]);
  });

  it('promotes an approved exercise into the global layer', async () => {
    queue('new-lift-1700000000000', 'New Lift');
    expect((await review('new-lift-1700000000000', 'approve')).status).toBe(200);

    const globals = env.raw.prepare('SELECT id, name FROM global_exercises').all();
    expect(globals).toEqual([expect.objectContaining({ name: 'New Lift' })]);
  });

  it('leaves the global layer untouched on a rejection', async () => {
    queue('junk-1700000000000', 'asdf');
    expect((await review('junk-1700000000000', 'reject')).status).toBe(200);
    expect(env.raw.prepare('SELECT id FROM global_exercises').all()).toHaveLength(0);
  });

  it('takes a reviewed exercise off the queue either way', async () => {
    queue('a-1700000000000', 'A');
    queue('b-1700000000000', 'B');
    await review('a-1700000000000', 'approve');
    await review('b-1700000000000', 'reject');
    const data = await (await call('GET', '/api/admin/pending', admin)).json() as { pending: unknown[] };
    expect(data.pending).toHaveLength(0);
  });

  it('audits the decision as a promotion, carrying the reviewer note', async () => {
    queue('new-lift-1700000000000', 'New Lift');
    await review('new-lift-1700000000000', 'approve', 'good movement, well classified');
    expect(audit()).toEqual([expect.objectContaining({
      exercise_id: 'new-lift-1700000000000', action: 'promote',
      changed_by: 'admin-1', reason: 'good movement, well classified',
    })]);
  });

  it('audits a rejection under its own action', async () => {
    queue('junk-1700000000000', 'asdf');
    await review('junk-1700000000000', 'reject', 'not a distinct movement');
    expect(audit()).toEqual([expect.objectContaining({ action: 'reject' })]);
  });

  // Documents current behaviour, and it is an inconsistency: merges and global
  // edits both refuse an unexplained change, but a promotion — which publishes
  // an exercise to every user — takes an optional note. Worth aligning.
  it('currently accepts a promotion with no explanation at all', async () => {
    queue('unexplained-1700000000000', 'Unexplained');
    expect((await review('unexplained-1700000000000', 'approve')).status).toBe(200);
    expect(audit()).toEqual([expect.objectContaining({ reason: null })]);
  });

  it('promotes an approved exercise with no invented rep range', async () => {
    queue('new-lift-1700000000000', 'New Lift');
    await review('new-lift-1700000000000', 'approve');
    // A dose belongs to the prescription, not the movement — the global row
    // must not carry a 3 × 8–12 that follows the exercise into every program.
    expect(env.raw.prepare('SELECT sets, rep_low, rep_high FROM global_exercises').all())
      .toEqual([{ sets: null, rep_low: null, rep_high: null }]);
  });

  it('rejects an action that is neither approve nor reject', async () => {
    queue('x-1700000000000', 'X');
    const res = await review('x-1700000000000', 'maybe');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "action must be 'approve' or 'reject'" });
  });

  it('404s a review of something not in the queue', async () => {
    expect((await review('never-submitted', 'approve')).status).toBe(404);
  });
});

describe('editing a global exercise', () => {
  beforeEach(() => {
    env.raw.prepare(
      'INSERT INTO global_exercises (id, name, sets, rep_low, rep_high, archived) VALUES (?, ?, ?, ?, ?, 0)',
    ).run('face-pulls', 'Face Pulls', 3, 15, 20);
  });

  const edit = (body: unknown) => call('PUT', '/api/admin/exercises/face-pulls', admin, body);

  it('renames the exercise for every user', async () => {
    expect((await edit({ name: 'Cable Face Pull', reason: 'match the catalog' })).status).toBe(200);
    const row = env.raw.prepare('SELECT name FROM global_exercises WHERE id = ?').get('face-pulls');
    expect(row).toMatchObject({ name: 'Cable Face Pull' });
  });

  it('requires a reason', async () => {
    const res = await edit({ name: 'Whatever' });
    expect(res.status).toBe(400);
  });

  it('audits the edit against the exercise it changed', async () => {
    await edit({ archived: true, reason: 'superseded by the rope variant' });
    expect(audit()).toEqual([expect.objectContaining({
      exercise_id: 'face-pulls', changed_by: 'admin-1', reason: 'superseded by the rope variant',
    })]);
  });

  it('writes metadata into the global metadata layer', async () => {
    await edit({ metadata: { primaryMuscle: 'Delts', equipment: 'Cable' }, reason: 'classify it' });
    const row = env.raw.prepare(
      'SELECT primary_muscle, equipment FROM global_exercise_metadata WHERE exercise_id = ?',
    ).get('face-pulls');
    expect(row).toMatchObject({ primary_muscle: 'Delts', equipment: 'Cable' });
  });
});

describe('the audit log', () => {
  it('filters to one exercise when asked', async () => {
    await call('POST', '/api/admin/merges', admin, { fromId: 'a', toId: 'b', reason: 'r1' });
    await call('POST', '/api/admin/merges', admin, { fromId: 'c', toId: 'd', reason: 'r2' });

    const all = await (await call('GET', '/api/admin/audit', admin)).json() as { audit: unknown[] };
    const one = await (await call('GET', '/api/admin/audit?exerciseId=a', admin)).json() as
      { audit: Array<{ exercise_id: string }> };
    expect(all.audit).toHaveLength(2);
    expect(one.audit).toEqual([expect.objectContaining({ exercise_id: 'a' })]);
  });
});
