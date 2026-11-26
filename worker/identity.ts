// Native sign-in (Sign in with Apple, Google ID tokens), identity linking and
// explicit account deletion. One LiftLog user owns many identities keyed by
// (provider, subject). Linking only ever ADDS an identity row: accounts are
// never merged by deleting data, and an identity that already belongs to
// another user is refused rather than moved.
import type { Env, User } from './types';
import { IdTokenError, sha256Hex, verifyIdToken } from './jwt';
import type { IdTokenClaims } from './jwt';
import { getAuthenticatedUser } from './auth';

export const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';
export const APPLE_ISSUER = 'https://appleid.apple.com';
export const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const LINK_PROMPT = 'Already use LiftLog? Sign in with Google to link';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LINK_TOKEN_MS = 15 * 60 * 1000;
export const DELETE_CONFIRMATION = 'delete-account';

export type Provider = 'google' | 'apple';

export interface VerifiedIdentity {
  provider: Provider;
  subject: string;
  email: string | null;
  /** verified AND a real address (never an Apple private relay) — the only kind that may auto-link */
  emailVerified: boolean;
  name?: string | null;
}

const truthy = (v: unknown) => v === true || v === 'true';
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function createSession(env: Env, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_SECONDS * 1000;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expiresAt),
    env.DB.prepare('DELETE FROM user_sessions WHERE expires_at < ?').bind(now),
  ]);
  return { token, expiresAt };
}

async function identityOwner(env: Env, provider: Provider, subject: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?')
    .bind(provider, subject).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function attachIdentity(env: Env, userId: string, id: VerifiedIdentity): Promise<'attached' | 'already' | 'conflict'> {
  const owner = await identityOwner(env, id.provider, id.subject);
  if (owner === userId) return 'already';
  if (owner) return 'conflict';
  await env.DB.prepare(
    `INSERT INTO user_identities (provider, subject, user_id, email, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id.provider, id.subject, userId, id.email, id.emailVerified ? 1 : 0, Date.now()).run();
  return 'attached';
}

/** Distinct users holding a verified identity with this email. */
async function usersWithVerifiedEmail(env: Env, email: string | null): Promise<string[]> {
  if (!email) return [];
  const rows = await env.DB.prepare(
    'SELECT DISTINCT user_id FROM user_identities WHERE email_verified = 1 AND lower(email) = lower(?)',
  ).bind(email).all<{ user_id: string }>();
  return rows.results.map(r => r.user_id);
}

export function appleIdentity(c: IdTokenClaims, name?: string | null): VerifiedIdentity {
  const privateRelay = truthy(c.is_private_email) || (c.email ?? '').endsWith('@privaterelay.appleid.com');
  return { provider: 'apple', subject: c.sub, email: c.email ?? null, emailVerified: truthy(c.email_verified) && !privateRelay, name: name ?? null };
}

export function googleIdentity(c: IdTokenClaims): VerifiedIdentity {
  return { provider: 'google', subject: c.sub, email: c.email ?? null, emailVerified: truthy(c.email_verified), name: c.name ?? null };
}

/**
 * The Google sign-in rule, shared by the web OAuth callback and the native SDK:
 * an existing Google identity → its user; a legacy account keyed by the Google
 * sub → that account; a verified email matching exactly one account (e.g. one
 * created with Apple) → link; otherwise a new account keyed by the Google sub,
 * exactly as the web flow always created them.
 */
export async function resolveGoogleUser(env: Env, id: VerifiedIdentity): Promise<{ userId: string; created: boolean; linked: 'auto' | null }> {
  let userId = await identityOwner(env, 'google', id.subject);
  let created = false;
  let linked: 'auto' | null = null;
  if (!userId) {
    const legacy = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id.subject).first<{ id: string }>();
    if (legacy) {
      userId = legacy.id;
    } else {
      const matches = id.emailVerified ? await usersWithVerifiedEmail(env, id.email) : [];
      if (matches.length === 1) {
        userId = matches[0];
        linked = 'auto';
      } else {
        userId = id.subject;
        created = true;
        await env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(userId, id.email ?? '', id.name ?? null).run();
      }
    }
    await attachIdentity(env, userId, id);
  }
  if (userId === id.subject && id.email) {
    await env.DB.prepare('UPDATE users SET email = ?, name = COALESCE(?, name) WHERE id = ?').bind(id.email, id.name ?? null, userId).run();
  }
  return { userId, created, linked };
}

async function userRow(env: Env, userId: string) {
  return env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(userId)
    .first<{ id: string; email: string; name: string | null }>();
}

async function identities(env: Env, userId: string) {
  const rows = await env.DB.prepare('SELECT provider, email FROM user_identities WHERE user_id = ? ORDER BY created_at')
    .bind(userId).all<{ provider: Provider; email: string | null }>();
  return rows.results;
}

async function sessionResponse(env: Env, userId: string, extra: Record<string, unknown>): Promise<Response> {
  const session = await createSession(env, userId);
  return json({ ...session, user: await userRow(env, userId), identities: await identities(env, userId), ...extra });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (request.method !== 'POST' && request.method !== 'DELETE') return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 8192 ? v : null);

async function verifyApple(env: Env, token: string, rawNonce: string | null): Promise<IdTokenClaims> {
  const claims = await verifyIdToken(token, { jwksUrl: APPLE_JWKS, issuers: [APPLE_ISSUER], audiences: [env.APPLE_BUNDLE_ID!] });
  // The app sends SHA-256(rawNonce) to Apple and the raw value here, so a
  // captured identity token cannot be replayed without the nonce.
  if (claims.nonce !== undefined && (!rawNonce || (await sha256Hex(rawNonce)) !== claims.nonce)) {
    throw new IdTokenError('nonce mismatch');
  }
  return claims;
}

async function verifyGoogle(env: Env, token: string): Promise<IdTokenClaims> {
  const audiences = [env.GOOGLE_IOS_CLIENT_ID, env.GOOGLE_CLIENT_ID].filter((a): a is string => !!a);
  return verifyIdToken(token, { jwksUrl: GOOGLE_JWKS, issuers: GOOGLE_ISSUERS, audiences });
}

async function consumeLinkToken(env: Env, token: string): Promise<VerifiedIdentity | null> {
  const row = await env.DB.prepare('SELECT * FROM link_tokens WHERE token = ? AND expires_at > ?').bind(token, Date.now())
    .first<{ provider: Provider; subject: string; email: string | null; email_verified: number; name: string | null }>();
  await env.DB.prepare('DELETE FROM link_tokens WHERE token = ? OR expires_at < ?').bind(token, Date.now()).run();
  return row ? { provider: row.provider, subject: row.subject, email: row.email, emailVerified: row.email_verified === 1, name: row.name } : null;
}

function authError(err: unknown): Response {
  if (err instanceof IdTokenError) return json({ error: 'invalid_token', detail: err.message }, 401);
  throw err;
}

/** POST /api/auth/apple { identityToken, rawNonce?, name? } */
async function appleSignIn(request: Request, env: Env): Promise<Response> {
  if (!env.APPLE_BUNDLE_ID) return json({ error: 'apple_sign_in_not_configured' }, 503);
  const body = await readJson(request);
  const token = str(body?.identityToken);
  if (!token) return json({ error: 'identityToken required' }, 400);
  let id: VerifiedIdentity;
  try {
    id = appleIdentity(await verifyApple(env, token, str(body?.rawNonce)), str(body?.name));
  } catch (err) { return authError(err); }

  const owner = await identityOwner(env, 'apple', id.subject);
  if (owner) return sessionResponse(env, owner, { created: false, linked: null });

  const matches = id.emailVerified ? await usersWithVerifiedEmail(env, id.email) : [];
  if (matches.length === 1) {
    await attachIdentity(env, matches[0], id);
    return sessionResponse(env, matches[0], { created: false, linked: 'auto' });
  }
  // Hide-my-email, an unverified or unmatched address, or an ambiguous match:
  // never create a second account silently — ask.
  const linkToken = crypto.randomUUID();
  const expiresAt = Date.now() + LINK_TOKEN_MS;
  await env.DB.prepare(
    'INSERT INTO link_tokens (token, provider, subject, email, email_verified, name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(linkToken, 'apple', id.subject, id.email, id.emailVerified ? 1 : 0, id.name ?? null, expiresAt).run();
  return json({ status: 'link_required', linkToken, expiresAt, email: id.email, prompt: LINK_PROMPT }, 409);
}

/** POST /api/auth/google/native { idToken, linkToken? } */
async function googleNativeSignIn(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const token = str(body?.idToken);
  if (!token) return json({ error: 'idToken required' }, 400);
  let id: VerifiedIdentity;
  try { id = googleIdentity(await verifyGoogle(env, token)); } catch (err) { return authError(err); }
  const { userId, created, linked } = await resolveGoogleUser(env, id);
  const linkToken = str(body?.linkToken);
  if (linkToken) {
    const pending = await consumeLinkToken(env, linkToken);
    if (!pending) return json({ error: 'link_token_expired' }, 410);
    if ((await attachIdentity(env, userId, pending)) === 'conflict') return json({ error: 'identity_in_use' }, 409);
    return sessionResponse(env, userId, { created, linked: 'explicit' });
  }
  return sessionResponse(env, userId, { created, linked });
}

/** POST /api/auth/apple/create { linkToken } — the explicit "I'm new to LiftLog" answer. */
async function appleCreate(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const token = str(body?.linkToken);
  if (!token) return json({ error: 'linkToken required' }, 400);
  const pending = await consumeLinkToken(env, token);
  if (!pending) return json({ error: 'link_token_expired' }, 410);
  const existing = await identityOwner(env, pending.provider, pending.subject);
  if (existing) return sessionResponse(env, existing, { created: false, linked: null });
  const userId = `${pending.provider}:${pending.subject}`;
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)').bind(userId, pending.email ?? '', pending.name ?? null).run();
  await attachIdentity(env, userId, pending);
  return sessionResponse(env, userId, { created: true, linked: null });
}

/** POST /api/auth/link { provider, identityToken | idToken, rawNonce? } — link from a signed-in session. */
async function linkFromSession(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson(request);
  const provider = body?.provider;
  let id: VerifiedIdentity;
  try {
    if (provider === 'apple') {
      if (!env.APPLE_BUNDLE_ID) return json({ error: 'apple_sign_in_not_configured' }, 503);
      const token = str(body?.identityToken);
      if (!token) return json({ error: 'identityToken required' }, 400);
      id = appleIdentity(await verifyApple(env, token, str(body?.rawNonce)), str(body?.name));
    } else if (provider === 'google') {
      const token = str(body?.idToken);
      if (!token) return json({ error: 'idToken required' }, 400);
      id = googleIdentity(await verifyGoogle(env, token));
    } else {
      return json({ error: 'provider must be apple or google' }, 400);
    }
  } catch (err) { return authError(err); }
  const result = await attachIdentity(env, user.id, id);
  if (result === 'conflict') {
    return json({ error: 'identity_in_use', detail: 'That sign-in already belongs to another LiftLog account. Nothing was changed.' }, 409);
  }
  return json({ linked: result === 'attached' ? 'explicit' : null, identities: await identities(env, user.id) });
}

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
  return m ? m[1] : null;
}

export async function handleNativeAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
  const post = request.method === 'POST';
  switch (url.pathname) {
    case '/api/auth/apple': return post ? appleSignIn(request, env) : json({ error: 'Method Not Allowed' }, 405);
    case '/api/auth/apple/create': return post ? appleCreate(request, env) : json({ error: 'Method Not Allowed' }, 405);
    case '/api/auth/google/native': return post ? googleNativeSignIn(request, env) : json({ error: 'Method Not Allowed' }, 405);
    case '/api/auth/link':
    case '/api/auth/identities':
    case '/api/auth/native/logout': {
      const user = await getAuthenticatedUser(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      if (url.pathname === '/api/auth/identities') return json({ identities: await identities(env, user.id) });
      if (!post) return json({ error: 'Method Not Allowed' }, 405);
      if (url.pathname === '/api/auth/link') return linkFromSession(request, env, user);
      const token = bearer(request);
      if (token) await env.DB.prepare('DELETE FROM user_sessions WHERE token = ?').bind(token).run();
      return json({ ok: true });
    }
    default: return null;
  }
}

/** Every user-owned table. global_exercise_audit stays: it is the application's record of admin edits. */
const USER_TABLES = [
  'session_docs', 'deleted_sessions', 'workout_sessions', 'set_logs', 'exercise_logs', 'exercise_metadata',
  'user_programs', 'training_plans', 'user_exercises', 'user_deleted_exercises', 'user_roles',
  'user_identities', 'user_sessions',
];

/** DELETE /api/account { confirm: "delete-account" } — explicit, user-initiated only. */
export async function handleAccount(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
  const body = await readJson(request);
  if (body?.confirm !== DELETE_CONFIRMATION) {
    return json({ error: `confirmation required: send {"confirm":"${DELETE_CONFIRMATION}"}` }, 400);
  }
  await env.DB.batch([
    ...USER_TABLES.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)),
    env.DB.prepare('DELETE FROM pending_exercises WHERE submitted_by = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ deleted: true });
}
