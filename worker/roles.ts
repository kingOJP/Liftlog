import type { Env } from './types';

export type Role = 'user' | 'admin' | 'tester';

/** Absent / unknown → 'user'. */
export function normalizeRole(role: unknown): Role {
  return role === 'admin' || role === 'tester' ? role : 'user';
}

// Role resolution: absent row = standard user. Roles are assigned manually in
// D1 for now (INSERT INTO user_roles ...); an admin UI can come later.
// Request handlers get the role for free on the authenticated User (auth.ts
// joins it with the session lookup); this stays for callers that only hold a
// user id.
export async function getUserRole(userId: string, env: Env): Promise<Role> {
  const row = await env.DB.prepare(
    'SELECT role FROM user_roles WHERE user_id = ?',
  ).bind(userId).first<{ role: string }>();
  return normalizeRole(row?.role);
}
