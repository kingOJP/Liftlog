// worker/auth.ts — the OAuth handshake and session lifecycle.
//
// The parts worth pinning down are the ones that fail silently or fail open:
// the CSRF state cookie, the cookie flags, and getAuthenticatedUser's expiry
// check (the single gate in front of every user's training data).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAuth, getAuthenticatedUser } from './auth';
import { createTestEnv, signIn } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;

beforeEach(() => { env = createTestEnv(); });
afterEach(() => { vi.unstubAllGlobals(); });

function call(path: string, cookie?: string): Promise<Response> {
  const url = new URL(`https://liftlog.test${path}`);
  return handleAuth(new Request(url, { headers: cookie ? { Cookie: cookie } : {} }), env, url);
}

/**
 * All Set-Cookie headers as a name → attributes-string map. Every assertion
 * about the auth flow needs them individually, and plain `.get('Set-Cookie')`
 * folds them into one comma-joined string. `getSetCookie` exists on the Headers
 * both Node and workerd ship; the cast is only because this file is typechecked
 * against @cloudflare/workers-types, whose Headers declaration predates it.
 */
function cookies(res: Response): Map<string, string> {
  const raw = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  return new Map(raw.map(c => [c.slice(0, c.indexOf('=')), c]));
}

function cookieValue(res: Response, name: string): string {
  const raw = cookies(res).get(name)!;
  return raw.slice(raw.indexOf('=') + 1, raw.indexOf(';'));
}

describe('starting the OAuth flow', () => {
  it('redirects to Google with the app\'s client id and callback', async () => {
    const res = await call('/api/auth/google');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe('https://liftlog.test/api/auth/google/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
  });

  it('issues a CSRF state cookie matching the state it sent to Google', async () => {
    const res = await call('/api/auth/google');
    const sent = new URL(res.headers.get('Location')!).searchParams.get('state');
    expect(cookieValue(res, 'oauth_state')).toBe(sent);
  });

  it('keeps the state cookie HttpOnly, Secure and short-lived', async () => {
    const cookie = cookies(await call('/api/auth/google')).get('oauth_state')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=600');
  });

  it('derives the callback from the request host, not a hardcoded origin', async () => {
    const url = new URL('https://preview.liftlog.test/api/auth/google');
    const res = await handleAuth(new Request(url), env, url);
    expect(new URL(res.headers.get('Location')!).searchParams.get('redirect_uri'))
      .toBe('https://preview.liftlog.test/api/auth/google/callback');
  });
});

describe('the OAuth callback', () => {
  const GOOGLE_USER = { sub: 'google-123', email: 'lifter@example.com', name: 'A Lifter' };

  /** Stub the two Google endpoints the callback talks to. */
  function stubGoogle({ tokenOk = true, userOk = true } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input.toString();
      if (href.includes('oauth2.googleapis.com/token')) {
        return tokenOk
          ? Response.json({ access_token: 'at-1' })
          : new Response('nope', { status: 400 });
      }
      if (href.includes('googleapis.com/oauth2/v3/userinfo')) {
        return userOk ? Response.json(GOOGLE_USER) : new Response('nope', { status: 401 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    }));
  }

  const callback = (query: string, cookie?: string) =>
    call(`/api/auth/google/callback${query}`, cookie);

  it('creates the user and a session, then redirects home', async () => {
    stubGoogle();
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(env.raw.prepare('SELECT id, email FROM users').all())
      .toEqual([{ id: 'google-123', email: 'lifter@example.com' }]);
    expect(env.raw.prepare('SELECT user_id FROM user_sessions').all())
      .toEqual([{ user_id: 'google-123' }]);
  });

  it('sets a session cookie the browser cannot read and a user cookie it can', async () => {
    stubGoogle();
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    expect(cookies(res).get('liftlog_session')).toContain('HttpOnly');
    // The client reads this one to render the signed-in account.
    expect(cookies(res).get('liftlog_user')).not.toContain('HttpOnly');
  });

  it('never puts the session token in the JS-readable cookie', async () => {
    stubGoogle();
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    const token = cookieValue(res, 'liftlog_session');
    expect(cookies(res).get('liftlog_user')).not.toContain(token);
    expect(decodeURIComponent(cookies(res).get('liftlog_user')!)).toContain('lifter@example.com');
  });

  it('clears the state cookie once it has been spent', async () => {
    stubGoogle();
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    expect(cookies(res).get('oauth_state')).toContain('Max-Age=0');
  });

  it('re-signing in updates the profile instead of duplicating the account', async () => {
    stubGoogle();
    await callback('?code=c&state=s', 'oauth_state=s');
    await callback('?code=c2&state=s2', 'oauth_state=s2');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(1);
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(2);
  });

  it.each([
    ['a mismatched state cookie (CSRF)', '?code=c&state=s', 'oauth_state=different'],
    ['no state cookie at all',           '?code=c&state=s', undefined],
    ['a missing code',                   '?state=s',        'oauth_state=s'],
    ['a missing state',                  '?code=c',         'oauth_state=s'],
  ])('refuses %s', async (_label, query, cookie) => {
    stubGoogle();
    const res = await callback(query, cookie);
    expect(res.status).toBe(302);
    // An absolute URL: Response.redirect throws on a bare path in the Workers
    // runtime, which would turn an auth failure into a 500.
    expect(res.headers.get('Location')).toBe('https://liftlog.test/?error=auth_failed');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(0);
  });

  it('fails closed when Google rejects the code exchange', async () => {
    stubGoogle({ tokenOk: false });
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    expect(res.headers.get('Location')).toContain('error=auth_failed');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(0);
  });

  it('fails closed when the userinfo call fails', async () => {
    stubGoogle({ userOk: false });
    const res = await callback('?code=c&state=s', 'oauth_state=s');
    expect(res.headers.get('Location')).toContain('error=auth_failed');
    expect(env.raw.prepare('SELECT id FROM users').all()).toHaveLength(0);
  });
});

describe('getAuthenticatedUser', () => {
  const request = (cookie?: string) =>
    new Request('https://liftlog.test/api/sync', { headers: cookie ? { Cookie: cookie } : {} });

  it('resolves a live session to its user', async () => {
    const cookie = signIn(env, 'user-1', 'a@example.com');
    expect(await getAuthenticatedUser(request(cookie), env))
      .toMatchObject({ id: 'user-1', email: 'a@example.com' });
  });

  it('returns null with no cookie, and for an unknown token', async () => {
    expect(await getAuthenticatedUser(request(), env)).toBeNull();
    expect(await getAuthenticatedUser(request('liftlog_session=made-up'), env)).toBeNull();
  });

  it('returns null once the session has expired', async () => {
    const cookie = signIn(env);
    env.raw.prepare('UPDATE user_sessions SET expires_at = ?').run(Date.now() - 1);
    expect(await getAuthenticatedUser(request(cookie), env)).toBeNull();
  });

  it('finds the session cookie among unrelated cookies', async () => {
    const cookie = signIn(env);
    expect(await getAuthenticatedUser(request(`other=1; ${cookie}; another=2`), env)).not.toBeNull();
  });
});

describe('/api/auth/me and logout', () => {
  it('reports the signed-in account', async () => {
    const cookie = signIn(env, 'user-1', 'a@example.com');
    const res = await call('/api/auth/me', cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'user-1', email: 'a@example.com' });
  });

  it('401s when nobody is signed in', async () => {
    expect((await call('/api/auth/me')).status).toBe(401);
  });

  it('destroys the session server-side, not just the cookie', async () => {
    const cookie = signIn(env);
    const res = await call('/api/auth/logout', cookie);
    expect(res.status).toBe(302);
    expect(env.raw.prepare('SELECT token FROM user_sessions').all()).toHaveLength(0);
    // A replayed cookie is worthless afterwards.
    expect((await call('/api/auth/me', cookie)).status).toBe(401);
  });

  it('expires both cookies on the way out', async () => {
    const res = await call('/api/auth/logout', signIn(env));
    expect(cookies(res).get('liftlog_session')).toContain('Max-Age=0');
    expect(cookies(res).get('liftlog_user')).toContain('Max-Age=0');
  });

  it('is harmless when called without a session', async () => {
    expect((await call('/api/auth/logout')).status).toBe(302);
  });

  it('404s an unknown auth route', async () => {
    expect((await call('/api/auth/nope')).status).toBe(404);
  });
});
