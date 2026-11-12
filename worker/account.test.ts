// The account lifecycle the App Store requires and a native wrapper needs:
// Sign in with Apple, one account per verified email across providers, the
// sign-in handoff from the system browser into the app's web view, sessions
// that stay signed in, and in-app account deletion.
//
// Each of these fails in a way nobody notices until review or until a user's
// data is in the wrong account, so the rules are pinned here rather than
// trusted to a manual test on one phone.

import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import worker from './index';
import { handleAuth } from './auth';
import { appleClientSecret } from './apple';
import { createTestEnv, signIn, syncRequest, pushBody } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;
let applePem = '';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer).toString('base64');
  applePem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
});

beforeEach(() => {
  env = createTestEnv();
  env.APPLE_CLIENT_ID = 'com.example.liftlog.web';
  env.APPLE_TEAM_ID = 'TEAM123456';
  env.APPLE_KEY_ID = 'KEY1234567';
  env.APPLE_PRIVATE_KEY = applePem;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function auth(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const url = new URL(`https://liftlog.test${path}`);
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('Cookie', init.cookie);
  return handleAuth(new Request(url, { ...init, headers }), env, url);
}

function setCookies(res: Response): Map<string, string> {
  const raw = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  return new Map(raw.map(c => [c.slice(0, c.indexOf('=')), c]));
}
function cookieValue(res: Response, name: string): string {
  const raw = setCookies(res).get(name)!;
  return raw.slice(raw.indexOf('=') + 1, raw.indexOf(';'));
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

interface AppleStub { claims?: Record<string, unknown>; tokenOk?: boolean; revokeOk?: boolean }

/** Stub Apple's token + revoke endpoints; returns the recorded request bodies. */
function stubApple(nonce: string, { claims = {}, tokenOk = true, revokeOk = true }: AppleStub = {}) {
  const calls: Array<{ href: string; body: URLSearchParams }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input.toString();
    calls.push({ href, body: new URLSearchParams(String(init?.body ?? '')) });
    if (href.endsWith('/auth/token')) {
      if (!tokenOk) return new Response('invalid_grant', { status: 400 });
      const idToken = `${b64url({ alg: 'RS256' })}.${b64url({
        iss: 'https://appleid.apple.com', aud: 'com.example.liftlog.web',
        exp: Math.floor(Date.now() / 1000) + 600, sub: '001.apple-sub', nonce,
        email: 'lifter@example.com', email_verified: 'true', ...claims,
      })}.sig`;
      return Response.json({ id_token: idToken, refresh_token: 'apple-refresh-1' });
    }
    if (href.endsWith('/auth/revoke')) return new Response(null, { status: revokeOk ? 200 : 500 });
    throw new Error(`unexpected fetch: ${href}`);
  }));
  return calls;
}

/** Run the Apple flow start → callback, the way a browser would. */
async function appleSignIn(opts: AppleStub & { native?: boolean; user?: string; tamperState?: boolean } = {}) {
  const start = await auth(`/api/auth/apple${opts.native ? '?native=1' : ''}`);
  const location = new URL(start.headers.get('Location')!);
  const state = location.searchParams.get('state')!;
  const nonce = location.searchParams.get('nonce')!;
  const calls = stubApple(nonce, opts);
  const form = new URLSearchParams({ code: 'apple-code', state: opts.tamperState ? 'w.forged' : state });
  if (opts.user) form.set('user', opts.user);
  const res = await auth('/api/auth/apple/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    cookie: `apple_oauth=${cookieValue(start, 'apple_oauth')}`,
  });
  return { start, res, calls };
}

describe('Sign in with Apple', () => {
  it('is advertised only when all four Apple settings are present', async () => {
    expect(await (await auth('/api/auth/providers')).json()).toEqual({ google: true, apple: true });
    delete env.APPLE_PRIVATE_KEY;
    expect(await (await auth('/api/auth/providers')).json()).toEqual({ google: true, apple: false });
    // …and the start URL refuses rather than sending anyone to a broken page.
    expect((await auth('/api/auth/apple')).headers.get('Location')).toContain('error=auth_failed');
  });

  it('asks Apple for name and email by form post, with a state cookie that survives the cross-site POST', async () => {
    const res = await auth('/api/auth/apple');
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('scope')).toBe('name email');
    expect(location.searchParams.get('redirect_uri')).toBe('https://liftlog.test/api/auth/apple/callback');
    // A Lax cookie is not sent on Apple's cross-site POST back to us.
    const cookie = setCookies(res).get('apple_oauth')!;
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('creates the account and session, keeping the name Apple only sends once', async () => {
    const { res, calls } = await appleSignIn({ user: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lifter' } }) });
    expect(res.status).toBe(303);            // POST → GET "/"
    expect(res.headers.get('Location')).toBe('/');
    expect(env.raw.prepare('SELECT id, email, name FROM users').all())
      .toEqual([{ id: 'apple:001.apple-sub', email: 'lifter@example.com', name: 'Ada Lifter' }]);
    expect(setCookies(res).get('liftlog_session')).toContain('HttpOnly');
    expect(decodeURIComponent(setCookies(res).get('liftlog_user')!)).toContain('Ada Lifter');
    // The refresh token is kept: deletion has to revoke it.
    expect(env.raw.prepare('SELECT refresh_token FROM user_identities').all())
      .toEqual([{ refresh_token: 'apple-refresh-1' }]);
    // The exchange authenticated with a signed client secret, not a blank.
    expect(calls[0].body.get('client_secret')!.split('.')).toHaveLength(3);
  });

  it('a later sign-in without the name keeps the stored one', async () => {
    await appleSignIn({ user: JSON.stringify({ name: { firstName: 'Ada' } }) });
    await appleSignIn();
    expect(env.raw.prepare('SELECT name FROM users').all()).toEqual([{ name: 'Ada' }]);
    expect(env.raw.prepare('SELECT subject FROM user_identities').all()).toHaveLength(1);
  });

  it.each([
    ['a forged state',            { tamperState: true }],
    ['a rejected code',           { tokenOk: false }],
    ['a token for another app',   { claims: { aud: 'com.someone.else' } }],
    ['a token from another issuer', { claims: { iss: 'https://evil.example' } }],
    ['an expired token',          { claims: { exp: 1 } }],
    ['a replayed token (wrong nonce)', { claims: { nonce: 'not-ours' } }],
    ['a token with no email',     { claims: { email: undefined } }],
  ])('refuses %s', async (_label, opts) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await appleSignIn(opts);
    expect(res.headers.get('Location')).toContain('error=auth_failed');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(0);
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(0);
  });

  it('signs the client secret as a five-minute ES256 JWT for this app', async () => {
    const [header, payload, sig] = (await appleClientSecret(env, 1_700_000_000_000)).split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: 'TEAM123456', iat: 1_700_000_000, exp: 1_700_000_300,
      aud: 'https://appleid.apple.com', sub: 'com.example.liftlog.web',
    });
    expect(Buffer.from(sig, 'base64url')).toHaveLength(64);   // raw r||s, not DER
  });

  it('accepts a key stored with literal \\n sequences (a one-line secret)', async () => {
    env.APPLE_PRIVATE_KEY = applePem.replace(/\n/g, '\\n');
    expect((await appleClientSecret(env)).split('.')).toHaveLength(3);
  });
});

describe('one account per verified email', () => {
  function stubGoogle(user: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input.toString();
      if (href.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
      if (href.includes('userinfo')) return Response.json(user);
      throw new Error(`unexpected fetch: ${href}`);
    }));
  }
  const googleCallback = () => auth('/api/auth/google/callback?code=c&state=w.s', { cookie: 'oauth_state=w.s' });

  it('Apple with the same verified email signs in to the existing Google account', async () => {
    signIn(env, 'google-123', 'lifter@example.com');
    const { res } = await appleSignIn();
    expect(res.status).toBe(303);
    expect(env.raw.prepare('SELECT id FROM users').all()).toEqual([{ id: 'google-123' }]);
    expect(env.raw.prepare("SELECT user_id FROM user_identities WHERE provider = 'apple'").all())
      .toEqual([{ user_id: 'google-123' }]);
  });

  it('Google with the same verified email signs in to an account Apple created', async () => {
    await appleSignIn();
    stubGoogle({ sub: 'google-9', email: 'Lifter@Example.com', name: 'A Lifter', email_verified: true });
    await googleCallback();
    expect(env.raw.prepare('SELECT id FROM users').all()).toEqual([{ id: 'apple:001.apple-sub' }]);
  });

  it('a hidden (relay) Apple email is its own account', async () => {
    signIn(env, 'google-123', 'lifter@example.com');
    await appleSignIn({ claims: { email: 'abc123@privaterelay.appleid.com' } });
    expect(env.raw.prepare('SELECT id FROM users ORDER BY id').all())
      .toEqual([{ id: 'apple:001.apple-sub' }, { id: 'google-123' }]);
  });

  it('never links — or duplicates — on an email the provider has not verified', async () => {
    signIn(env, 'someone-else', 'lifter@example.com');
    stubGoogle({ sub: 'google-attacker', email: 'lifter@example.com', email_verified: false });
    const res = await googleCallback();
    expect(res.headers.get('Location')).toContain('error=auth_failed');
    expect(env.raw.prepare('SELECT id FROM users').all()).toEqual([{ id: 'someone-else' }]);
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(1);   // only the fixture's
  });

  it('an account from before identities existed keeps its id and is back-filled', async () => {
    signIn(env, 'google-123', 'old@example.com');
    stubGoogle({ sub: 'google-123', email: 'new@example.com', name: 'Renamed' });
    await googleCallback();
    expect(env.raw.prepare('SELECT id, email, name FROM users').all())
      .toEqual([{ id: 'google-123', email: 'new@example.com', name: 'Renamed' }]);
    expect(env.raw.prepare('SELECT provider, subject, user_id FROM user_identities').all())
      .toEqual([{ provider: 'google', subject: 'google-123', user_id: 'google-123' }]);
  });
});

describe('native app sign-in handoff', () => {
  it('returns to the app with a one-time code instead of setting a cookie the web view cannot see', async () => {
    const { res } = await appleSignIn({ native: true });
    const location = res.headers.get('Location')!;
    expect(location).toMatch(/^liftlog:\/\/auth\?code=[0-9a-f]{64}$/);
    expect(setCookies(res).has('liftlog_session')).toBe(false);
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(0);
  });

  it('the web view trades the code for a session exactly once', async () => {
    const { res } = await appleSignIn({ native: true });
    const code = new URL(res.headers.get('Location')!).searchParams.get('code')!;

    const first = await auth(`/api/auth/exchange?code=${code}`);
    expect(first.headers.get('Location')).toBe('/');
    expect(setCookies(first).get('liftlog_session')).toContain('HttpOnly');
    expect(decodeURIComponent(setCookies(first).get('liftlog_user')!)).toContain('lifter@example.com');

    const replay = await auth(`/api/auth/exchange?code=${code}`);
    expect(replay.headers.get('Location')).toContain('error=auth_failed');
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(1);
  });

  it('refuses an expired or unknown code', async () => {
    signIn(env, 'u1');
    env.raw.prepare("INSERT INTO auth_handoffs (code, user_id, expires_at) VALUES ('old', 'u1', ?)").run(Date.now() - 1);
    for (const code of ['old', 'made-up', '']) {
      const res = await auth(`/api/auth/exchange?code=${code}`);
      expect(res.headers.get('Location')).toContain('error=auth_failed');
    }
  });

  it('uses the configured URL scheme, and only a well-formed one', async () => {
    env.NATIVE_CALLBACK_SCHEME = 'com.example.liftlog';
    expect((await appleSignIn({ native: true })).res.headers.get('Location')).toMatch(/^com\.example\.liftlog:\/\/auth\?code=/);
    env.NATIVE_CALLBACK_SCHEME = 'https://evil.example/?x=';
    expect((await appleSignIn({ native: true })).res.headers.get('Location')).toMatch(/^liftlog:\/\/auth\?code=/);
  });

  it('a web sign-in is unaffected by the native flag being absent', async () => {
    const start = await auth('/api/auth/google');
    expect(new URL(start.headers.get('Location')!).searchParams.get('state')).toMatch(/^w\./);
    const native = await auth('/api/auth/google?native=1');
    expect(new URL(native.headers.get('Location')!).searchParams.get('state')).toMatch(/^n\./);
  });
});

describe('staying signed in', () => {
  const sync = (cookie: string) => worker.fetch(syncRequest('GET', cookie), env);
  const expiry = () => (env.raw.prepare('SELECT expires_at FROM user_sessions').get() as { expires_at: number }).expires_at;

  it('pushes the expiry back out when the session is more than a day old', async () => {
    const cookie = signIn(env);                       // fixture session: 1 day left
    const res = await sync(cookie);
    expect(res.status).toBe(200);
    expect(expiry()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect(setCookies(res).get('liftlog_session')).toContain('Max-Age=7776000');
    expect(setCookies(res).get('liftlog_user')).toContain('Max-Age=7776000');
  });

  it('does not write on every request once renewed', async () => {
    const cookie = signIn(env);
    await sync(cookie);
    const renewedTo = expiry();
    const res = await sync(cookie);
    expect(setCookies(res).has('liftlog_session')).toBe(false);
    expect(expiry()).toBe(renewedTo);
  });

  it('never resurrects an expired session', async () => {
    const cookie = signIn(env);
    env.raw.prepare('UPDATE user_sessions SET expires_at = ?').run(Date.now() - 1);
    const res = await sync(cookie);
    expect(res.status).toBe(401);
    expect(setCookies(res).has('liftlog_session')).toBe(false);
  });
});

describe('deleting the account', () => {
  const del = (cookie: string | undefined, body: unknown = { confirm: 'DELETE' }, method = 'DELETE') =>
    worker.fetch(new Request('https://liftlog.test/api/auth/account', {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    }), env);

  /** Every table with a user_id column, straight from the live schema. */
  function userTables(): string[] {
    const tables = env.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    return tables.map(t => t.name).filter(name =>
      (env.raw.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).some(c => c.name === 'user_id'));
  }

  async function seed(userId: string, email: string): Promise<string> {
    const cookie = signIn(env, userId, email);
    const res = await worker.fetch(syncRequest('POST', cookie, pushBody({
      sessions: [{ id: 1, guid: `g-${userId}`, dayId: 1, weekNumber: 1, startedAt: 1000, completedAt: 2000, updatedAt: 2000 }],
      setLogs: [{ id: 1, sessionId: 1, exerciseId: 'bench-press', setNumber: 1, weight: 100, reps: 8 }],
      program: [{ id: 1, label: 'Day 1', muscleGroups: 'Chest', exercises: [] }],
      programUpdatedAt: 5,
      exercises: [{ id: 'my-lift-1782000000000', name: 'My Lift' }],
      deletedSessionGuids: ['gone'],
      deletedExerciseIds: ['old-lift'],
      plan: { version: 1, plans: [], updatedAt: 5 },
    })), env);
    expect(res.status, await res.clone().text()).toBe(200);
    return cookie;
  }

  it('removes every row the account owns and leaves other accounts untouched', async () => {
    const mine = await seed('u-mine', 'mine@example.com');
    await seed('u-other', 'other@example.com');

    const res = await del(mine);
    expect(res.status).toBe(200);

    for (const table of userTables()) {
      const left = env.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get('u-mine') as { n: number };
      expect(left.n, `${table} still holds the deleted account's rows`).toBe(0);
    }
    expect(env.raw.prepare('SELECT id FROM users').all()).toEqual([{ id: 'u-other' }]);
    expect(env.raw.prepare("SELECT COUNT(*) AS n FROM session_docs WHERE user_id = 'u-other'").get()).toEqual({ n: 1 });
    // The custom exercise that was waiting for review goes with its author.
    expect(env.raw.prepare("SELECT COUNT(*) AS n FROM pending_exercises WHERE submitted_by = 'u-mine'").get()).toEqual({ n: 0 });
  });

  it('the deletion list covers every user table in the schema', async () => {
    // A table added later with a user_id column must be added to USER_TABLES;
    // with foreign keys off (as a misconfigured database would be) the cascade
    // is not there to catch it.
    env.raw.exec('PRAGMA foreign_keys = OFF');
    const mine = await seed('u-mine', 'mine@example.com');
    env.raw.prepare("INSERT INTO user_identities (provider, subject, user_id, created_at) VALUES ('google', 's', 'u-mine', 1)").run();
    env.raw.prepare("INSERT INTO auth_handoffs (code, user_id, expires_at) VALUES ('c', 'u-mine', 1)").run();
    env.raw.prepare("INSERT INTO user_roles (user_id, role) VALUES ('u-mine', 'tester')").run();
    await del(mine);
    for (const table of userTables()) {
      const left = env.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get('u-mine') as { n: number };
      expect(left.n, `${table} is missing from USER_TABLES`).toBe(0);
    }
  });

  it('signs the device out and the old session stops working', async () => {
    const cookie = await seed('u-mine', 'mine@example.com');
    const res = await del(cookie);
    expect(setCookies(res).get('liftlog_session')).toContain('Max-Age=0');
    expect(setCookies(res).get('liftlog_user')).toContain('Max-Age=0');
    expect((await worker.fetch(syncRequest('GET', cookie), env)).status).toBe(401);
  });

  it('revokes the Apple authorization, and still deletes if Apple is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await appleSignIn();
    const { token } = env.raw.prepare('SELECT token FROM user_sessions').get() as { token: string };
    const calls = stubApple('n', { revokeOk: false });
    const res = await del(`liftlog_session=${token}`);
    expect(res.status).toBe(200);
    expect(calls.map(c => c.href)).toEqual(['https://appleid.apple.com/auth/revoke']);
    expect(calls[0].body.get('token')).toBe('apple-refresh-1');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(0);
  });

  it('keeps reviewed exercises and audit history, without the account id', async () => {
    const cookie = await seed('u-admin', 'admin@example.com');
    env.raw.prepare("UPDATE pending_exercises SET status = 'approved', reviewed_by = 'u-admin' WHERE submitted_by = 'u-admin'").run();
    env.raw.prepare("INSERT INTO global_exercise_audit (exercise_id, action, changed_by, changed_at) VALUES ('x', 'edit', 'u-admin', 1)").run();
    await del(cookie);
    expect(env.raw.prepare('SELECT submitted_by, reviewed_by FROM pending_exercises').all())
      .toEqual([{ submitted_by: 'deleted-user', reviewed_by: 'deleted-user' }]);
    expect(env.raw.prepare('SELECT changed_by FROM global_exercise_audit').all()).toEqual([{ changed_by: 'deleted-user' }]);
  });

  it.each([
    ['no session',            undefined, { confirm: 'DELETE' }, 'DELETE', 401],
    ['no confirmation',       'COOKIE',  {},                    'DELETE', 400],
    ['the wrong confirmation', 'COOKIE', { confirm: 'yes' },    'DELETE', 400],
    ['a POST',                'COOKIE',  { confirm: 'DELETE' }, 'POST',   405],
    ['a GET (link, prefetch)', 'COOKIE', undefined,             'GET',    405],
  ])('refuses %s', async (_label, cookieFlag, body, method, status) => {
    const cookie = await seed('u-mine', 'mine@example.com');
    const res = await del(cookieFlag ? cookie : undefined, body, method);
    expect(res.status).toBe(status);
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(1);
  });
});
