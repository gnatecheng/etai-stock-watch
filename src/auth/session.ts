import type { Env, AppRole } from "../env";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { randomToken, sha256Hex } from "../lib/crypto";

const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: AppRole;
}

export async function createSession(
  db: D1Database,
  user: SessionUser,
): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(16);
  const tokenHash = await sha256Hex(token);
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + SESSION_DAYS);
  const expiresAt = expires.toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId("ses"), user.id, tokenHash, csrfToken, expiresAt, nowIso())
    .run();
  return { token, csrfToken, expiresAt };
}

export async function revokeSession(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
    .bind(nowIso(), tokenHash)
    .run();
}

export async function resolveSession(
  db: D1Database,
  rawToken: string | undefined,
): Promise<(SessionUser & { csrf_token: string; session_id: string }) | null> {
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await db
    .prepare(
      `SELECT s.id as session_id, s.csrf_token, s.expires_at, s.revoked_at,
              u.id, u.email, u.display_name, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      session_id: string;
      csrf_token: string;
      expires_at: string;
      revoked_at: string | null;
      id: string;
      email: string;
      display_name: string;
      role: AppRole;
      status: string;
    }>();
  if (!row || row.revoked_at || row.status !== "active") return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return {
    session_id: row.session_id,
    csrf_token: row.csrf_token,
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
  };
}

export function sessionCookieOptions(env: Env, expiresAt: string): string {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  const secure = env.APP_ENV !== "development" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
