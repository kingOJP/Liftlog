import type { Role } from './roles';

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ASSETS: Fetcher;
  /** Sign in with Apple audience (the iOS bundle id); native Apple sign-in is off when unset */
  APPLE_BUNDLE_ID?: string;
  /** OAuth client id of the iOS Google Sign-In SDK; accepted as an ID-token audience */
  GOOGLE_IOS_CLIENT_ID?: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  /** resolved with the session in one query (absent row = 'user') */
  role: Role;
}
