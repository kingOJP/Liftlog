import type { Env } from './types';
import { handleAuth } from './auth';
import { handleSync } from './sync';
import { handleAdmin } from './admin';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/auth')) {
        return await handleAuth(request, env, url);
      }
      if (url.pathname === '/api/sync') {
        return await handleSync(request, env);
      }
      if (url.pathname.startsWith('/api/admin')) {
        return await handleAdmin(request, env, url);
      }
    } catch (err) {
      // Log the full error server-side, but never echo messages/stack traces
      // back to the client — they can leak internals (queries, table names).
      const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error('Worker error:', message);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
