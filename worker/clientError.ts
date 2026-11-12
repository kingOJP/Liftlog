// Client crash reports.
//
// A render crash or an unhandled rejection on someone's phone used to be
// invisible: the error boundary showed a recovery screen and the only record
// was a console nobody could read. The client now posts a small report here
// and it lands in the worker logs (wrangler tail / the dashboard's Logs tab,
// kept by `observability` in wrangler.jsonc). Nothing is stored in D1.
//
// Signed-in users only, and bounded — this is a log line, not an ingest API.

import type { Env } from './types';
import { getAuthenticatedUser } from './auth';

const MAX_BODY_BYTES = 8 * 1024;

function clip(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

export async function handleClientError(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'Too large' }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid report' }, { status: 400 });
  }

  // The account id (not the email) is enough to find the affected user.
  console.error('Client error:', JSON.stringify({
    user: user.id,
    kind: clip(body.kind, 40),
    message: clip(body.message, 500),
    stack: clip(body.stack, 4000),
    screen: clip(body.screen, 60),
    version: clip(body.version, 60),
    userAgent: clip(request.headers.get('User-Agent'), 300),
  }));
  return new Response(null, { status: 204 });
}
