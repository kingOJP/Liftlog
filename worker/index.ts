import type { Env } from './types';
import { handleAuth, renewSession } from './auth';
import { handleSync } from './sync';
import { handleAdmin } from './admin';
import { handleClientError } from './clientError';

// Paths the single-page app renders itself (src/components/LegalView.tsx).
// They must resolve for a signed-out visitor following a link — App Store
// Connect asks for a public privacy-policy URL and a support URL — so the
// worker serves the app shell for them rather than relying on a hosting
// fallback setting.
const APP_ROUTES = new Set(['/privacy', '/terms', '/support']);

// API responses are per-user JSON: never cached, never framed, never sniffed.
function apiHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/auth')) {
        return apiHeaders(await handleAuth(request, env, url));
      }
      if (url.pathname === '/api/sync') {
        return apiHeaders(await renewSession(request, env, await handleSync(request, env)));
      }
      if (url.pathname.startsWith('/api/admin')) {
        return apiHeaders(await renewSession(request, env, await handleAdmin(request, env, url)));
      }
      if (url.pathname === '/api/client-error') {
        return apiHeaders(await handleClientError(request, env));
      }
      if (url.pathname.startsWith('/api/')) {
        return apiHeaders(Response.json({ error: 'Not found' }, { status: 404 }));
      }
    } catch (err) {
      // The stack goes to the logs (wrangler tail / the dashboard), never to
      // the client: a 500 body used to carry the message and stack trace.
      const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error('Worker error:', message);
      return apiHeaders(Response.json({ error: 'Internal server error' }, { status: 500 }));
    }

    if (request.method === 'GET' && APP_ROUTES.has(url.pathname.replace(/\/+$/, ''))) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
