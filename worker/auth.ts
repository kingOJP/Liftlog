import type { Env, User } from './types';

const COOKIE_SESSION = 'liftlog_session';
const COOKIE_USER = 'liftlog_user';
const COOKIE_STATE = 'oauth_state';
const SESSION_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getRedirectUri(url: URL): string {
  return `${url.protocol}//${url.host}/api/auth/google/callback`;
}

// Response.redirect() requires an absolute URL in the Workers runtime — a
// bare path throws, turning an auth failure into a 500.
function redirectTo(url: URL, path: string): Response {
  return Response.redirect(new URL(path, url.origin).toString(), 302);
}

export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  switch (url.pathname) {
    case '/api/auth/google':          return startOAuth(env, url);
    case '/api/auth/google/callback': return handleCallback(request, env, url);
    case '/api/auth/me':              return getMe(request, env);
    case '/api/auth/logout':          return logout(request, env);
    default: return new Response('Not Found', { status: 404 });
  }
}

function startOAuth(env: Env, url: URL): Response {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  getRedirectUri(url),
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'online',
    prompt:        'select_account',
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
  headers.append('Set-Cookie',
    `${COOKIE_STATE}=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);

  return new Response(null, { status: 302, headers });
}

async function handleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request.headers.get('Cookie') ?? '');

  if (!code || !state || cookies[COOKIE_STATE] !== state) {
    return redirectTo(url, '/?error=auth_failed');
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  getRedirectUri(url),
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text());
    return redirectTo(url, '/?error=auth_failed');
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Get Google user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    return redirectTo(url, '/?error=auth_failed');
  }

  const gUser = await userRes.json() as { sub: string; email: string; name: string };

  // Upsert user record
  await env.DB.prepare(
    `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).bind(gUser.sub, gUser.email, gUser.name).run();

  // Create session
  const token     = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;

  await env.DB.prepare(
    `INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
  ).bind(token, gUser.sub, expiresAt).run();

  // Non-sensitive user info readable by JS (no passwords, no session token)
  const userJson = encodeURIComponent(JSON.stringify({ email: gUser.email, name: gUser.name }));

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie',
    `${COOKIE_SESSION}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Path=/`);
  headers.append('Set-Cookie',
    `${COOKIE_USER}=${userJson}; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Path=/`);
  headers.append('Set-Cookie',
    `${COOKIE_STATE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`);

  return new Response(null, { status: 302, headers });
}

async function getMe(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ id: user.id, email: user.email, name: user.name });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = parseCookies(request.headers.get('Cookie') ?? '')[COOKIE_SESSION];
  if (token) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
  }

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie',
    `${COOKIE_SESSION}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`);
  headers.append('Set-Cookie',
    `${COOKIE_USER}=; Secure; SameSite=Lax; Max-Age=0; Path=/`);

  return new Response(null, { status: 302, headers });
}

export async function getAuthenticatedUser(request: Request, env: Env): Promise<User | null> {
  const token = parseCookies(request.headers.get('Cookie') ?? '')[COOKIE_SESSION];
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name
     FROM user_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
  ).bind(token, Date.now()).first<User>();

  return row ?? null;
}

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}
