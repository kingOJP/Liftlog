// Verifies OpenID Connect ID tokens (Sign in with Apple, Google) against the
// issuer's published JWKS: RS256 signature, issuer, audience and expiry. Keys
// are cached per isolate and refetched once when a token names an unknown kid
// (both issuers rotate keys).

export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
  name?: string;
}

export interface VerifyOptions {
  jwksUrl: string;
  issuers: string[];
  audiences: string[];
  now?: number;
}

export class IdTokenError extends Error {}

const CLOCK_SKEW_S = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
/** An unknown kid forces a refetch at most this often, so unauthenticated tokens can't hammer the provider. */
const JWKS_MIN_REFRESH_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { keys: (JsonWebKey & { kid?: string })[]; fetchedAt: number }>();

/** Test hook: forget cached key sets. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson<T>(s: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as T;
  } catch {
    throw new IdTokenError('malformed token');
  }
}

async function loadKeys(url: string, force: boolean): Promise<(JsonWebKey & { kid?: string })[]> {
  const hit = jwksCache.get(url);
  if (hit && Date.now() - hit.fetchedAt < (force ? JWKS_MIN_REFRESH_MS : JWKS_TTL_MS)) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) throw new IdTokenError(`JWKS fetch failed (${res.status})`);
  const { keys } = await res.json() as { keys: (JsonWebKey & { kid?: string })[] };
  jwksCache.set(url, { keys, fetchedAt: Date.now() });
  return keys;
}

export async function verifyIdToken(token: string, opts: VerifyOptions): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new IdTokenError('malformed token');
  const header = b64urlJson<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== 'RS256' || !header.kid) throw new IdTokenError('unsupported token algorithm');

  let jwk = (await loadKeys(opts.jwksUrl, false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await loadKeys(opts.jwksUrl, true)).find(k => k.kid === header.kid);
  if (!jwk) throw new IdTokenError('unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new IdTokenError('bad signature');

  const claims = b64urlJson<IdTokenClaims>(parts[1]);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!opts.issuers.includes(claims.iss)) throw new IdTokenError('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some(a => opts.audiences.includes(a))) throw new IdTokenError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new IdTokenError('token expired');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new IdTokenError('token issued in the future');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new IdTokenError('missing subject');
  return claims;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
