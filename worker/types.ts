import type { Role } from './roles';

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ASSETS: Fetcher;
  // Sign in with Apple (worker/apple.ts). All four or the provider is off.
  /** the Services ID (e.g. com.example.liftlog.web) */
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  /** contents of the .p8 key (secret) */
  APPLE_PRIVATE_KEY?: string;
  /** URL scheme the native app registers for the sign-in handoff (default "liftlog") */
  NATIVE_CALLBACK_SCHEME?: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  /** resolved with the session in one query (absent row = 'user') */
  role: Role;
}
