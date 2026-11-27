// Native sign-in, identity linking and account deletion — and the rule above
// all of them: no sign-in path, link or migration may lose or hide a user's data.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker from './index';
import { createTestEnv, signIn, syncRequest } from './testkit';
import type { TestEnv } from './testkit';
import { ensureSchema } from './migrate';
import { resetJwksCache, sha256Hex } from './jwt';
import { APPLE_ISSUER, APPLE_JWKS, GOOGLE_JWKS, LINK_PROMPT } from './identity';

let keys: CryptoKeyPair;
let jwk: Record<string, unknown>;
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function sign(claims: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const apple = (sub: string, x: Record<string, unknown> = {}) =>
  sign({ iss: APPLE_ISSUER, aud: 'app.liftlog.ios', sub, exp: now() + 600, iat: now(), ...x });
const google = (sub: string, x: Record<string, unknown> = {}) =>
  sign({ iss: 'https://accounts.google.com', aud: 'ios-client', sub, exp: now() + 600, iat: now(), ...x });

let env: TestEnv;
async function post(path: string, body: unknown, token?: string, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://liftlog.test${path}`, { method, headers, body: JSON.stringify(body) }), env);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes vary per endpoint
  return { status: res.status, body: await res.json() as Record<string, any> };
}
async function pull(token: string) {
  const res = await worker.fetch(new Request('https://liftlog.test/api/sync', { headers: { Authorization: `Bearer ${token}` } }), env);
  return { status: res.status, text: await res.text() };
}
function seedHistory(userId: string, guids: string[]) {
  for (const [i, g] of guids.entries()) {
    env.raw.prepare(`INSERT INTO session_docs (user_id, guid, day_id, week_number, started_at, completed_at, updated_at, sets_json)
      VALUES (?, ?, 1, 1, ?, ?, ?, ?)`).run(userId, g, 1000 + i, 2000 + i, 3000 + i,
      JSON.stringify([{ exerciseId: 'barbell-back-squat', setNumber: 1, weight: 225, reps: 5 }]));
  }
  env.raw.prepare('INSERT INTO training_plans (user_id, plan_json, updated_at) VALUES (?, ?, ?)')
    .run(userId, JSON.stringify({ plans: [{ id: `plan-${userId}` }] }), 5);
  env.raw.prepare('INSERT INTO deleted_sessions (user_id, guid, deleted_at) VALUES (?, ?, ?)').run(userId, `tomb-${userId}`, 9);
}
const rows = (table: string, userId: string) =>
  (env.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
});

beforeEach(async () => {
  resetJwksCache();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === APPLE_JWKS || url === GOOGLE_JWKS) return Response.json({ keys: [jwk] });
    return new Response('nope', { status: 404 });
  }));
  env = { ...createTestEnv(), APPLE_BUNDLE_ID: 'app.liftlog.ios', GOOGLE_IOS_CLIENT_ID: 'ios-client' };
  // A Google web account with history, created before the identity table existed.
  signIn(env, 'g-owen', 'owen@example.com');
  seedHistory('g-owen', ['s1', 's2', 's3']);
  await ensureSchema(env);
});
afterEach(() => vi.unstubAllGlobals());

describe('migration 0010', () => {
  it('back-fills a Google identity for every existing account and touches no data', () => {
    expect(env.raw.prepare('SELECT provider, subject, user_id, email_verified FROM user_identities').all())
      .toEqual([{ provider: 'google', subject: 'g-owen', user_id: 'g-owen', email_verified: 1 }]);
    expect(rows('session_docs', 'g-owen')).toBe(3);
    expect(rows('training_plans', 'g-owen')).toBe(1);
    expect(rows('deleted_sessions', 'g-owen')).toBe(1);
  });
});

describe('bearer tokens', () => {
  it('authenticate native clients alongside the PWA cookie', async () => {
    expect((await worker.fetch(syncRequest('GET', 'liftlog_session=token-g-owen'), env)).status).toBe(200);
    expect((await pull('token-g-owen')).status).toBe(200);
    expect((await pull('not-a-token')).status).toBe(401);
  });
});

describe('ID-token verification', () => {
  it('rejects a wrong audience, an expired token, a forged signature and an unknown key', async () => {
    const bad = [
      await google('g-owen', { aud: 'someone-else' }),
      await google('g-owen', { exp: now() - 3600 }),
      (await google('g-owen')).replace(/\.[^.]+$/, '.' + b64url(new Uint8Array(256))),
      await sign({ iss: 'https://accounts.google.com', aud: 'ios-client', sub: 'x', exp: now() + 600 }, 'k-unknown'),
    ];
    for (const idToken of bad) expect((await post('/api/auth/google/native', { idToken })).status).toBe(401);
  });
  it('an unknown key forces at most one JWKS refetch per window', async () => {
    const forged = await sign({ iss: 'https://accounts.google.com', aud: 'ios-client', sub: 'x', exp: now() + 600 }, 'k-unknown');
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/google/native', { idToken: forged })).status).toBe(401);
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(c => c[0] === GOOGLE_JWKS);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('checks the Apple nonce when the token carries one', async () => {
    const identityToken = await apple('a-1', { nonce: await sha256Hex('raw-nonce'), email: 'owen@example.com', email_verified: 'true' });
    expect((await post('/api/auth/apple', { identityToken, rawNonce: 'wrong' })).status).toBe(401);
    expect((await post('/api/auth/apple', { identityToken, rawNonce: 'raw-nonce' })).status).toBe(200);
  });
  it('turns native Apple sign-in off until the bundle id is configured', async () => {
    env = { ...env, APPLE_BUNDLE_ID: undefined };
    expect((await post('/api/auth/apple', { identityToken: await apple('a-1') })).status).toBe(503);
  });
});

describe('no lost data: Google web account → iPhone', () => {
  it('native Google sign-in lands on the same account with its full history', async () => {
    const r = await post('/api/auth/google/native', { idToken: await google('g-owen', { email: 'owen@example.com', email_verified: true }) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ user: { id: 'g-owen' }, created: false });
    const { text } = await pull(r.body.token);
    for (const g of ['s1', 's2', 's3', 'tomb-g-owen', 'plan-g-owen']) expect(text).toContain(g);
  });

  it('Apple with the same verified email auto-links to the Google account', async () => {
    const r = await post('/api/auth/apple', { identityToken: await apple('a-owen', { email: 'Owen@Example.com', email_verified: 'true' }) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ user: { id: 'g-owen' }, linked: 'auto', created: false });
    expect((await pull(r.body.token)).text).toContain('s3');
    // and the next Apple sign-in resolves straight from the identity table
    const again = await post('/api/auth/apple', { identityToken: await apple('a-owen') });
    expect(again.body.user.id).toBe('g-owen');
  });

  it('Hide My Email never creates a duplicate: it asks, and Google sign-in links it', async () => {
    const identityToken = await apple('a-hidden', { email: 'xyz@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true' });
    const first = await post('/api/auth/apple', { identityToken });
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ status: 'link_required', prompt: LINK_PROMPT });
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });

    const linked = await post('/api/auth/google/native', { idToken: await google('g-owen', { email: 'owen@example.com', email_verified: true }), linkToken: first.body.linkToken });
    expect(linked.body).toMatchObject({ user: { id: 'g-owen' }, linked: 'explicit' });
    const viaApple = await post('/api/auth/apple', { identityToken });
    expect(viaApple.status).toBe(200);
    expect(viaApple.body.user.id).toBe('g-owen');
    expect((await pull(viaApple.body.token)).text).toContain('s1');
    expect(rows('session_docs', 'g-owen')).toBe(3);
  });

  it('a link token is single-use and expires', async () => {
    const first = await post('/api/auth/apple', { identityToken: await apple('a-x') });
    await post('/api/auth/apple/create', { linkToken: first.body.linkToken });
    expect((await post('/api/auth/apple/create', { linkToken: first.body.linkToken })).status).toBe(410);
    expect((await post('/api/auth/google/native', { idToken: await google('g-owen'), linkToken: 'made-up' })).status).toBe(410);
  });

  it('a genuinely new Apple user creates an account only when they say so', async () => {
    const first = await post('/api/auth/apple', { identityToken: await apple('a-new', { email: 'new@example.com', email_verified: 'true' }), name: 'New' });
    expect(first.status).toBe(409);
    const created = await post('/api/auth/apple/create', { linkToken: first.body.linkToken });
    expect(created.body).toMatchObject({ user: { id: 'apple:a-new', name: 'New' }, created: true });
    expect(rows('session_docs', 'g-owen')).toBe(3);
  });
});

describe('linking from a signed-in session', () => {
  it('attaches Apple to the current account', async () => {
    const r = await post('/api/auth/link', { provider: 'apple', identityToken: await apple('a-later') }, 'token-g-owen');
    expect(r.body).toMatchObject({ linked: 'explicit' });
    expect(r.body.identities.map((i: { provider: string }) => i.provider)).toEqual(['google', 'apple']);
    expect((await post('/api/auth/apple', { identityToken: await apple('a-later') })).body.user.id).toBe('g-owen');
  });

  it('refuses to move an identity that belongs to another account, leaving both intact', async () => {
    signIn(env, 'g-other', 'other@example.com');
    seedHistory('g-other', ['o1']);
    await post('/api/auth/link', { provider: 'apple', identityToken: await apple('a-shared') }, 'token-g-other');
    const r = await post('/api/auth/link', { provider: 'apple', identityToken: await apple('a-shared') }, 'token-g-owen');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('identity_in_use');
    expect(rows('session_docs', 'g-owen')).toBe(3);
    expect(rows('session_docs', 'g-other')).toBe(1);
    expect((await post('/api/auth/apple', { identityToken: await apple('a-shared') })).body.user.id).toBe('g-other');
  });

  it('a Google login linked to an Apple-created account resolves there on the web too', async () => {
    const first = await post('/api/auth/apple', { identityToken: await apple('a-solo') });
    const made = await post('/api/auth/apple/create', { linkToken: first.body.linkToken });
    await post('/api/auth/link', { provider: 'google', idToken: await google('g-solo') }, made.body.token);
    const viaGoogle = await post('/api/auth/google/native', { idToken: await google('g-solo') });
    expect(viaGoogle.body).toMatchObject({ user: { id: 'apple:a-solo' }, created: false });
  });
});

describe('account deletion', () => {
  it('is explicit: no confirmation, nothing deleted', async () => {
    expect((await post('/api/account', {}, 'token-g-owen', 'DELETE')).status).toBe(400);
    expect((await post('/api/account', { confirm: 'delete-account' }, 'token-g-owen', 'POST')).status).toBe(405);
    expect(rows('session_docs', 'g-owen')).toBe(3);
  });

  it('removes every row the user owns and nothing anyone else owns', async () => {
    signIn(env, 'g-other', 'other@example.com');
    seedHistory('g-other', ['o1']);
    await post('/api/auth/link', { provider: 'apple', identityToken: await apple('a-owen2') }, 'token-g-owen');
    const r = await post('/api/account', { confirm: 'delete-account' }, 'token-g-owen', 'DELETE');
    expect(r.body).toEqual({ deleted: true });
    for (const t of ['session_docs', 'training_plans', 'deleted_sessions', 'user_identities', 'user_sessions']) {
      expect(rows(t, 'g-owen')).toBe(0);
    }
    expect(env.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'g-owen'").get()).toEqual({ n: 0 });
    expect(rows('session_docs', 'g-other')).toBe(1);
    expect(rows('training_plans', 'g-other')).toBe(1);
    expect((await pull('token-g-owen')).status).toBe(401);
  });
});
