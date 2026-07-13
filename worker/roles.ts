import type { Env } from './types';

export type Role = 'user' | 'admin' | 'tester';

// Role resolution: absent row = standard user. Roles are assigned manually in
// D1 for now (INSERT INTO user_roles ...); an admin UI can come later.
export async function getUserRole(userId: string, env: Env): Promise<Role> {
  const row = await env.DB.prepare(
    'SELECT role FROM user_roles WHERE user_id = ?',
  ).bind(userId).first<{ role: string }>();
  const role = row?.role;
  return role === 'admin' || role === 'tester' ? role : 'user';
}
