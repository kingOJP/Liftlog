// worker/index.ts — the router and the one place errors are caught.
//
// Small surface, but two things here are load-bearing: everything that is not
// an API route must fall through to the static assets (get this wrong and the
// PWA serves JSON at "/"), and a thrown handler must become a 500 rather than
// taking the isolate down.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker from './index';
import { createTestEnv, signIn } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;

beforeEach(() => { env = createTestEnv(); });
afterEach(() => { vi.restoreAllMocks(); });

const get = (path: string, cookie?: string) =>
  worker.fetch(new Request(`https://liftlog.test${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  }), env);

describe('routing', () => {
  it('sends /api/auth to the auth handler', async () => {
    const res = await get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('accounts.google.com');
  });

  it('sends /api/sync to the sync handler', async () => {
    expect((await get('/api/sync')).status).toBe(401);
    expect((await get('/api/sync', signIn(env))).status).toBe(200);
  });

  it('sends /api/admin to the admin handler', async () => {
    expect((await get('/api/admin/pending')).status).toBe(401);
  });

  // The app is a PWA served from the same origin: anything that is not an API
  // route is the client, and must come back as an asset.
  it.each(['/', '/index.html', '/icons/icon-192x192.png', '/anything-else'])(
    'falls through to the static assets for %s',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('asset');
    },
  );

  it('does not treat a path that merely contains "api" as an API route', async () => {
    expect(await (await get('/rapid/api')).text()).toBe('asset');
  });
});

describe('pages the app renders for signed-out visitors', () => {
  // App Store Connect needs a public privacy-policy URL and a support URL.
  // They are screens of the single-page app, so the shell must come back for
  // them whatever the hosting fallback is configured to do.
  it.each(['/privacy', '/terms', '/support', '/privacy/'])('serves the app shell for %s', async (path) => {
    const seen: string[] = [];
    env.ASSETS = { fetch: async (req: Request) => { seen.push(new URL(req.url).pathname); return new Response('shell'); } } as unknown as Fetcher;
    expect(await (await get(path)).text()).toBe('shell');
    expect(seen).toEqual(['/']);
  });
});

describe('API responses', () => {
  it('are never cacheable and never sniffed', async () => {
    const res = await get('/api/sync', signIn(env));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answer an unknown API path with JSON, not the app shell', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('client crash reports', () => {
  const report = (cookie: string | undefined, body: string, method = 'POST') =>
    worker.fetch(new Request('https://liftlog.test/api/client-error', {
      method, headers: cookie ? { Cookie: cookie } : {}, body: method === 'POST' ? body : undefined,
    }), env);

  it('land in the worker log with the account id, clipped', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await report(signIn(env), JSON.stringify({ kind: 'render', message: 'x'.repeat(2000), screen: 'workout' }));
    expect(res.status).toBe(204);
    const logged = JSON.parse(log.mock.calls[0][1] as string) as Record<string, string>;
    expect(logged.user).toBe('user-1');
    expect(logged.screen).toBe('workout');
    expect(logged.message).toHaveLength(500);
    // The email stays out of the logs; the id is enough to find the account.
    expect(log.mock.calls[0][1]).not.toContain('a@example.com');
  });

  it.each([
    ['a signed-out caller', undefined, '{}', 'POST', 401],
    ['an oversized body',   'COOKIE',  JSON.stringify({ message: 'x'.repeat(9000) }), 'POST', 413],
    ['a non-JSON body',     'COOKIE',  'not json', 'POST', 400],
    ['a GET',               'COOKIE',  '', 'GET', 405],
  ])('refuse %s', async (_label, cookieFlag, body, method, status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await report(cookieFlag ? signIn(env) : undefined, body, method)).status).toBe(status);
  });
});

describe('error handling', () => {
  it('turns a thrown handler into a 500 rather than an unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A D1 that fails the way a real outage would.
    const broken = {
      ...env,
      DB: { prepare: () => { throw new Error('D1 unavailable'); } } as unknown as D1Database,
    };
    const res = await worker.fetch(
      new Request('https://liftlog.test/api/sync', { headers: { Cookie: 'liftlog_session=x' } }),
      broken,
    );
    expect(res.status).toBe(500);
    // The stack trace goes to the log, never to the client (audit M1).
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('D1 unavailable');
  });
});
