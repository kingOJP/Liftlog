import type { Role } from './roles';

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ASSETS: Fetcher;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  /** resolved with the session in one query (absent row = 'user') */
  role: Role;
}
