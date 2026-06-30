import type { Env } from './types';
import { handleAuth } from './auth';
import { handleSync } from './sync';

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
    } catch (err) {
      const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error('Worker error:', message);
      return Response.json({ error: 'Internal server error', detail: message }, { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
