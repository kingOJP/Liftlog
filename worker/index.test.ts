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
    expect(await res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
