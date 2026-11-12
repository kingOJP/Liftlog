// Sign in with Apple — the web (OAuth) flow.
//
// App Store guideline 4.8: an app that offers a third-party sign-in (Google)
// must offer an equivalent that limits data collection — in practice, Sign in
// with Apple. The web flow is used everywhere: in the browser/PWA directly,
// and inside a native wrapper through the system browser sheet.
//
// Configured by four values (see docs/ios-launch.md); with any of them missing
// the provider reports itself unavailable and the login screen hides it.

import type { Env } from './types';

const APPLE_ISSUER = 'https://appleid.apple.com';

export function appleConfigured(env: Env): boolean {
  return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
}

export function appleAuthorizeUrl(env: Env, redirectUri: string, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id:     env.APPLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: 'code',
    // Asking for name/email forces form_post: Apple will not put them in a URL.
    response_mode: 'form_post',
    scope:         'name email',
    state,
    nonce,
  });
  return `${APPLE_ISSUER}/auth/authorize?${params}`;
}

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0)));
}

/**
 * Apple's "client secret" is a short-lived ES256 JWT signed with the .p8 key
 * from the developer portal. The secret may be stored with literal "\n"
 * sequences (how a multi-line value survives a one-line secret prompt).
 */
export async function appleClientSecret(env: Env, now = Date.now()): Promise<string> {
  const pem = env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
  const der = Uint8Array.from(
    atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')),
    c => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const iat = Math.floor(now / 1000);
  const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }))}.${b64url(JSON.stringify({
    iss: env.APPLE_TEAM_ID, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: env.APPLE_CLIENT_ID,
  }))}`;
  // WebCrypto emits the raw r||s signature JWS expects (not DER).
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

export interface AppleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  refreshToken: string | null;
}

/**
 * Trade the authorization code for the id token. The token arrives straight
 * from Apple's token endpoint over TLS, authenticated by our client secret, so
 * its claims are validated (issuer, audience, expiry, nonce) without fetching
 * Apple's signing keys — the direct-channel case of OpenID Connect §3.1.3.7.
 * It must never be accepted from anywhere else (e.g. the form post) this way.
 */
export async function exchangeAppleCode(
  env: Env, code: string, redirectUri: string, nonce: string, now = Date.now(),
): Promise<AppleIdentity | null> {
  const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.APPLE_CLIENT_ID!,
      client_secret: await appleClientSecret(env, now),
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }),
  });
  if (!res.ok) {
    console.error('Apple token exchange failed:', res.status, await res.text());
    return null;
  }
  const body = await res.json() as { id_token?: string; refresh_token?: string };
  const payloadPart = body.id_token?.split('.')[1];
  if (!payloadPart) return null;

  let claims: {
    iss?: string; aud?: string; exp?: number; sub?: string; nonce?: string;
    email?: string; email_verified?: boolean | string;
  };
  try { claims = JSON.parse(b64urlDecode(payloadPart)); } catch { return null; }

  if (claims.iss !== APPLE_ISSUER || claims.aud !== env.APPLE_CLIENT_ID) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
  if (claims.nonce !== nonce) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) return null;

  return {
    subject: claims.sub,
    email: claims.email,
    // Apple sends this claim as a boolean or as the string "true".
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    refreshToken: body.refresh_token ?? null,
  };
}

/** Revoke the app's authorization for a user (required on account deletion). */
export async function revokeAppleToken(env: Env, refreshToken: string): Promise<void> {
  if (!appleConfigured(env)) return;
  const res = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:       env.APPLE_CLIENT_ID!,
      client_secret:   await appleClientSecret(env),
      token:           refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Apple revoke answered ${res.status}`);
}
