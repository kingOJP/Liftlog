import type { Env, User } from './types';
import { normalizeRole } from './roles';
import { appleConfigured, appleAuthorizeUrl, exchangeAppleCode, revokeAppleToken } from './apple';

const COOKIE_SESSION = 'liftlog_session';
const COOKIE_USER = 'liftlog_user';
const COOKIE_STATE = 'oauth_state';
const COOKIE_APPLE = 'apple_oauth';

// Sessions slide: every authenticated request that finds the session more
// than a day old pushes the expiry back out (see renewSession). Someone who
// opens the app at least once a quarter is never signed out — a fixed 30-day
// expiry used to send every user back through OAuth once a month.
const SESSION_SECONDS = 90 * 24 * 60 * 60;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const HANDOFF_MS = 2 * 60 * 1000;

type Provider = 'google' | 'apple';

interface Identity {
  provider: Provider;
  subject: string;
  email: string;
  emailVerified: boolean;
  /** null when the provider did not send one (Apple only sends it once) */
  name: string | null;
  refreshToken?: string | null;
}

function getRedirectUri(url: URL, provider: Provider): string {
  return `${url.protocol}//${url.host}/api/auth/${provider}/callback`;
}

// Response.redirect() requires an absolute URL in the Workers runtime — a
// bare path throws, turning an auth failure into a 500.
function redirectTo(url: URL, path: string): Response {
  return Response.redirect(new URL(path, url.origin).toString(), 302);
}

function nativeScheme(env: Env): string {
  const scheme = env.NATIVE_CALLBACK_SCHEME ?? 'liftlog';
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? scheme : 'liftlog';
}

/** A sign-in that failed: back to the login screen (or back into the app). */
function authFailed(env: Env, url: URL, native: boolean): Response {
  if (native) {
    return new Response(null, { status: 302, headers: { Location: `${nativeScheme(env)}://auth?error=auth_failed` } });
  }
  return redirectTo(url, '/?error=auth_failed');
}

// The state value records whether the flow started inside the native app
// ("n.") or on the web ("w."), so the callback knows where to deliver the
// finished sign-in without trusting a query parameter it was handed.
function newState(native: boolean): string {
  return `${native ? 'n' : 'w'}.${crypto.randomUUID()}`;
}

export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  switch (url.pathname) {
    case '/api/auth/providers':       return Response.json({ google: true, apple: appleConfigured(env) });
    case '/api/auth/google':          return startGoogle(env, url);
    case '/api/auth/google/callback': return handleGoogleCallback(request, env, url);
    case '/api/auth/apple':           return startApple(env, url);
    case '/api/auth/apple/callback':  return handleAppleCallback(request, env, url);
    case '/api/auth/exchange':        return exchangeHandoff(env, url);
    case '/api/auth/me':              return getMe(request, env);
    case '/api/auth/logout':          return logout(request, env);
    case '/api/auth/account':         return deleteAccount(request, env);
    default: return new Response('Not Found', { status: 404 });
  }
}

// ── Google ──────────────────────────────────────────────────────────────────

function startGoogle(env: Env, url: URL): Response {
  const state = newState(url.searchParams.get('native') === '1');
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  getRedirectUri(url, 'google'),
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

async function handleGoogleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request.headers.get('Cookie') ?? '');
  const native = state?.startsWith('n.') ?? false;

  if (!code || !state || cookies[COOKIE_STATE] !== state) {
    return authFailed(env, url, false);
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  getRedirectUri(url, 'google'),
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text());
    return authFailed(env, url, native);
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Get Google user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    return authFailed(env, url, native);
  }

  const gUser = await userRes.json() as { sub: string; email: string; name?: string; email_verified?: boolean };

  const userId = await resolveUser(env, {
    provider: 'google',
    subject: gUser.sub,
    email: gUser.email,
    // Absent on older responses; only an explicit `false` blocks linking.
    emailVerified: gUser.email_verified !== false,
    name: gUser.name ?? null,
  });
  if (!userId) return authFailed(env, url, native);

  return finishSignIn(env, url, userId, native, COOKIE_STATE, 'Lax');
}

// ── Apple ───────────────────────────────────────────────────────────────────

async function startApple(env: Env, url: URL): Promise<Response> {
  if (!appleConfigured(env)) return redirectTo(url, '/?error=auth_failed');
  const state = newState(url.searchParams.get('native') === '1');
  const nonce = crypto.randomUUID();

  const headers = new Headers({
    Location: appleAuthorizeUrl(env, getRedirectUri(url, 'apple'), state, nonce),
  });
  // SameSite=None: Apple returns with a cross-site POST (form_post is the only
  // response mode that carries name/email), and a Lax cookie is not sent on one.
  headers.append('Set-Cookie',
    `${COOKIE_APPLE}=${state}:${nonce}; HttpOnly; Secure; SameSite=None; Max-Age=600; Path=/`);
  return new Response(null, { status: 302, headers });
}

async function handleAppleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST' || !appleConfigured(env)) return authFailed(env, url, false);

  const form = await request.formData();
  const code  = form.get('code');
  const state = form.get('state');
  const cookies = parseCookies(request.headers.get('Cookie') ?? '');
  const [cookieState, nonce] = (cookies[COOKIE_APPLE] ?? '').split(':');

  if (typeof code !== 'string' || typeof state !== 'string' || !cookieState || cookieState !== state || !nonce) {
    return authFailed(env, url, false);
  }
  const native = state.startsWith('n.');

  const result = await exchangeAppleCode(env, code, getRedirectUri(url, 'apple'), nonce);
  if (!result) return authFailed(env, url, native);

  // Apple sends the person's name exactly once — on the first authorization,
  // as a JSON form field beside the code — and never in the id token.
  let name: string | null = null;
  const userField = form.get('user');
  if (typeof userField === 'string') {
    try {
      const parsed = JSON.parse(userField) as { name?: { firstName?: string; lastName?: string } };
      const joined = [parsed.name?.firstName, parsed.name?.lastName]
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' ').trim();
      if (joined) name = joined.slice(0, 120);
    } catch { /* malformed field: carry on without a name */ }
  }

  const userId = await resolveUser(env, {
    provider: 'apple',
    subject: result.subject,
    email: result.email,
    emailVerified: result.emailVerified,
    name,
    refreshToken: result.refreshToken,
  });
  if (!userId) return authFailed(env, url, native);

  return finishSignIn(env, url, userId, native, COOKIE_APPLE, 'None');
}

// ── Accounts ────────────────────────────────────────────────────────────────

/**
 * The LiftLog account a provider identity signs in to, created if needed.
 *
 * One email is one account: a second provider that vouches for the same
 * verified address lands in the existing account rather than starting an empty
 * one beside it (the client also keys its local-data isolation on the email).
 * An address the provider has NOT verified is never used to link — and since
 * it can't safely create a second account with the same email either, a brand
 * new identity with an unverified address is refused.
 */
async function resolveUser(env: Env, identity: Identity): Promise<string | null> {
  const { provider, subject, email, name } = identity;
  if (!subject || !email) return null;
  const now = Date.now();

  const known = await env.DB.prepare(
    `SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?`,
  ).bind(provider, subject).first<{ user_id: string }>();

  let userId = known?.user_id ?? null;

  // Google accounts from before user_identities: users.id IS the subject.
  if (!userId && provider === 'google') {
    const legacy = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(subject).first<{ id: string }>();
    userId = legacy?.id ?? null;
  }

  if (!userId) {
    const sameEmail = await env.DB.prepare(
      `SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1`,
    ).bind(email).first<{ id: string }>();
    if (sameEmail) {
      if (!identity.emailVerified) return null;
      userId = sameEmail.id;
    }
  }

  const stmts: D1PreparedStatement[] = [];
  if (!userId) {
    userId = provider === 'google' ? subject : `${provider}:${subject}`;
    stmts.push(env.DB.prepare(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`)
      .bind(userId, email, name));
  } else if (provider === 'google') {
    // Google is the profile of record for the accounts it created; keep a
    // stored name when this sign-in carries none.
    stmts.push(env.DB.prepare(
      `UPDATE users SET email = ?, name = COALESCE(?, name) WHERE id = ?`,
    ).bind(email, name, userId));
  } else if (name) {
    stmts.push(env.DB.prepare(`UPDATE users SET name = COALESCE(name, ?) WHERE id = ?`)
      .bind(name, userId));
  }

  stmts.push(env.DB.prepare(
    `INSERT INTO user_identities (provider, subject, user_id, refresh_token, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET
       refresh_token = COALESCE(excluded.refresh_token, user_identities.refresh_token)`,
  ).bind(provider, subject, userId, identity.refreshToken ?? null, now));

  await env.DB.batch(stmts);
  return userId;
}

/** Cookies for a live session. The user cookie is readable by JS on purpose:
 *  non-sensitive profile info only (no session token). */
async function sessionCookies(env: Env, userId: string, token: string): Promise<string[]> {
  const user = await env.DB.prepare(`SELECT email, name FROM users WHERE id = ?`)
    .bind(userId).first<{ email: string; name: string | null }>();
  const userJson = encodeURIComponent(JSON.stringify({ email: user?.email ?? '', name: user?.name ?? '' }));
  return [
    `${COOKIE_SESSION}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Path=/`,
    `${COOKIE_USER}=${userJson}; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Path=/`,
  ];
}

// Create the session — and sweep out expired ones while we're here. Sign-in is
// the one event every account produces regularly, so it doubles as the purge
// schedule without a cron trigger (nothing reads an expired row; this only
// keeps the tables from growing forever).
async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const now   = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
      .bind(token, userId, now + SESSION_SECONDS * 1000),
    env.DB.prepare(`DELETE FROM user_sessions WHERE expires_at < ?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_handoffs WHERE expires_at < ?`).bind(now),
  ]);
  return token;
}

/**
 * Deliver a finished sign-in. On the web that is the session cookie. Inside a
 * native app the OAuth pages run in the system browser, whose cookies the
 * app's web view cannot see — so the browser is sent back into the app with a
 * one-time code, and the web view trades it for the cookie at /exchange.
 */
async function finishSignIn(
  env: Env, url: URL, userId: string, native: boolean,
  stateCookie: string, stateSameSite: 'Lax' | 'None',
): Promise<Response> {
  const clearState = `${stateCookie}=; HttpOnly; Secure; SameSite=${stateSameSite}; Max-Age=0; Path=/`;

  if (native) {
    const code = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    await env.DB.prepare(`INSERT INTO auth_handoffs (code, user_id, expires_at) VALUES (?, ?, ?)`)
      .bind(code, userId, Date.now() + HANDOFF_MS).run();
    const headers = new Headers({ Location: `${nativeScheme(env)}://auth?code=${code}` });
    headers.append('Set-Cookie', clearState);
    return new Response(null, { status: 302, headers });
  }

  const token = await createSession(env, userId);
  const headers = new Headers({ Location: '/' });
  for (const c of await sessionCookies(env, userId, token)) headers.append('Set-Cookie', c);
  headers.append('Set-Cookie', clearState);
  // 303 after Apple's POST callback, so the browser GETs "/" next.
  return new Response(null, { status: stateSameSite === 'None' ? 303 : 302, headers });
}

// The native app's web view lands here with the one-time code. Single use,
// two minutes, deleted before the session exists.
async function exchangeHandoff(env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  if (!code) return redirectTo(url, '/?error=auth_failed');

  const row = await env.DB.prepare(
    `DELETE FROM auth_handoffs WHERE code = ? AND expires_at > ? RETURNING user_id`,
  ).bind(code, Date.now()).first<{ user_id: string }>();
  if (!row) return redirectTo(url, '/?error=auth_failed');

  const token = await createSession(env, row.user_id);
  const headers = new Headers({ Location: '/' });
  for (const c of await sessionCookies(env, row.user_id, token)) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

async function getMe(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ id: user.id, email: user.email, name: user.name });
}

function clearedSessionCookies(): string[] {
  return [
    `${COOKIE_SESSION}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`,
    `${COOKIE_USER}=; Secure; SameSite=Lax; Max-Age=0; Path=/`,
  ];
}

// POST only: a GET that signs the user out can be triggered by a prefetch, a
// link preview or any page that can make the browser navigate (CSRF). The
// Settings screen submits a form; the 303 turns the POST into a GET of "/".
async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const token = parseCookies(request.headers.get('Cookie') ?? '')[COOKIE_SESSION];
  if (token) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
  }

  const headers = new Headers({ Location: '/' });
  for (const c of clearedSessionCookies()) headers.append('Set-Cookie', c);

  return new Response(null, { status: 303, headers });
}

// Every table that holds a user's own rows. Deleting the users row would
// cascade to all of them, but the list is spelled out so the deletion does
// not depend on foreign-key enforcement being switched on.
const USER_TABLES = [
  'user_sessions', 'auth_handoffs', 'user_identities',
  'session_docs', 'deleted_sessions',
  'workout_sessions', 'set_logs', 'exercise_logs',
  'user_programs', 'training_plans',
  'user_exercises', 'exercise_metadata', 'user_deleted_exercises',
  'user_roles',
] as const;

/**
 * Permanently delete the signed-in account and everything stored for it
 * (App Store guideline 5.1.1(v): an app that creates accounts must let the
 * user delete them in the app). DELETE with an explicit confirmation body —
 * never reachable by a link, a form on another site or a stray request.
 */
async function deleteAccount(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'DELETE' } });
  }
  const user = await getAuthenticatedUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object' || (body as { confirm?: unknown }).confirm !== 'DELETE') {
    return Response.json({ error: 'Confirmation required' }, { status: 400 });
  }

  // Read the Apple tokens before the rows that hold them are gone.
  const appleTokens = await env.DB.prepare(
    `SELECT refresh_token FROM user_identities
     WHERE user_id = ? AND provider = 'apple' AND refresh_token IS NOT NULL`,
  ).bind(user.id).all<{ refresh_token: string }>();

  await env.DB.batch([
    ...USER_TABLES.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)),
    // Custom exercises still waiting for review go with the account; reviewed
    // ones and admin audit rows are app-owned history and only lose the name.
    env.DB.prepare(`DELETE FROM pending_exercises WHERE submitted_by = ? AND status = 'pending'`).bind(user.id),
    env.DB.prepare(`UPDATE pending_exercises SET submitted_by = 'deleted-user' WHERE submitted_by = ?`).bind(user.id),
    env.DB.prepare(`UPDATE pending_exercises SET reviewed_by = 'deleted-user' WHERE reviewed_by = ?`).bind(user.id),
    env.DB.prepare(`UPDATE global_exercise_audit SET changed_by = 'deleted-user' WHERE changed_by = ?`).bind(user.id),
    env.DB.prepare(`UPDATE exercise_merges SET merged_by = 'deleted-user' WHERE merged_by = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id),
  ]);

  // Apple requires the app's authorization to be revoked on deletion. Best
  // effort: the account is already gone, and a failure here must not make the
  // user think it wasn't.
  for (const row of appleTokens.results) {
    try {
      await revokeAppleToken(env, row.refresh_token);
    } catch (err) {
      console.error('Apple token revocation failed:', err instanceof Error ? err.message : String(err));
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const c of clearedSessionCookies()) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// Sessions seen by getAuthenticatedUser during this request, so the router can
// renew them on the way out without a second lookup.
const seenSessions = new WeakMap<Request, { token: string; userId: string; expiresAt: number }>();

export async function getAuthenticatedUser(request: Request, env: Env): Promise<User | null> {
  const token = parseCookies(request.headers.get('Cookie') ?? '')[COOKIE_SESSION];
  if (!token) return null;

  // One query resolves the session, the account and its role — every API
  // request goes through here, and the role used to cost a second round trip.
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, r.role, s.expires_at
     FROM user_sessions s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
  ).bind(token, Date.now()).first<{ id: string; email: string; name: string | null; role: string | null; expires_at: number }>();

  if (!row) return null;
  seenSessions.set(request, { token, userId: row.id, expiresAt: row.expires_at });
  return { id: row.id, email: row.email, name: row.name, role: normalizeRole(row.role) };
}

/**
 * Slide the session: if this request authenticated with a session issued (or
 * last renewed) more than a day ago, push its expiry back out and re-issue the
 * cookies on the response. At most one write a day per device.
 */
export async function renewSession(request: Request, env: Env, response: Response): Promise<Response> {
  const seen = seenSessions.get(request);
  if (!seen || !response.ok && response.status !== 304) return response;
  const now = Date.now();
  if (seen.expiresAt - now > SESSION_SECONDS * 1000 - RENEW_AFTER_MS) return response;

  await env.DB.prepare(`UPDATE user_sessions SET expires_at = ? WHERE token = ?`)
    .bind(now + SESSION_SECONDS * 1000, seen.token).run();
  const renewed = new Response(response.body, response);
  for (const c of await sessionCookies(env, seen.userId, seen.token)) renewed.headers.append('Set-Cookie', c);
  return renewed;
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
