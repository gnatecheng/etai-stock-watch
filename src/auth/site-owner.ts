import { hashPassword } from "./password";
import { sha256Hex } from "../lib/crypto";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import type { Env } from "../env";
import { configuredSiteOwnerLogin, normalizeLoginId } from "./login-id";
import { createSession, sessionCookieOptions } from "./session";

export type ActivateSiteOwnerInput = {
  token: string;
  login: string;
  password: string;
  displayName?: string;
};

export type ActivateSiteOwnerResult =
  | {
      ok: true;
      userId: string;
      session: { token: string; csrfToken: string; expiresAt: string };
    }
  | { ok: false; status: number; code: string; message: string };

export async function adminUserExists(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1")
    .bind()
    .first();
  return !!row;
}

function activationEnabled(env: Env): boolean {
  return env.SITE_OWNER_ACTIVATION_ENABLED === "true";
}

export async function activationStatus(
  env: Env,
  db: D1Database,
): Promise<{
  activationEnabled: boolean;
  pending: boolean;
  configuredLogin: string | null;
  stagingDemo: boolean;
}> {
  const configuredLogin = configuredSiteOwnerLogin(env);
  const enabled = activationEnabled(env);
  const pending = enabled && (await adminUserExists(db)) === false;
  return {
    activationEnabled: enabled,
    pending,
    configuredLogin: pending ? configuredLogin : null,
    stagingDemo: env.STAGING_DEMO_ENABLED === "true",
  };
}

export async function activateSiteOwner(
  env: Env,
  db: D1Database,
  input: ActivateSiteOwnerInput,
): Promise<ActivateSiteOwnerResult> {
  if (!activationEnabled(env)) {
    return {
      ok: false,
      status: 403,
      code: "ACTIVATION_DISABLED",
      message: "站主激活未启用",
    };
  }

  const expectedLogin = configuredSiteOwnerLogin(env);
  if (!expectedLogin) {
    return {
      ok: false,
      status: 503,
      code: "SITE_OWNER_NOT_CONFIGURED",
      message: "站主登录标识未配置（SITE_OWNER_LOGIN）",
    };
  }

  const login = normalizeLoginId(input.login, env);
  if (login !== expectedLogin) {
    return {
      ok: false,
      status: 403,
      code: "LOGIN_MISMATCH",
      message: "登录标识与部署配置不匹配",
    };
  }

  if (!input.token?.trim() || input.password.length < 10) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      message: "激活令牌无效或密码不足 10 位",
    };
  }

  if (await adminUserExists(db)) {
    return {
      ok: false,
      status: 409,
      code: "ADMIN_EXISTS",
      message: "管理员已存在，拒绝公开抢占",
    };
  }

  const tokenHash = await sha256Hex(input.token.trim());
  const row = await db
    .prepare(
      `SELECT id, login_id, expires_at, consumed_at, superseded_at FROM site_owner_activation
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      login_id: string;
      expires_at: string;
      consumed_at: string | null;
      superseded_at: string | null;
    }>();

  if (!row || row.superseded_at) {
    return { ok: false, status: 400, code: "TOKEN_INVALID", message: "激活令牌无效" };
  }
  if (row.consumed_at) {
    return { ok: false, status: 400, code: "TOKEN_USED", message: "激活令牌已使用" };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, status: 400, code: "TOKEN_EXPIRED", message: "激活令牌已过期" };
  }
  if (normalizeLoginId(row.login_id, env) !== expectedLogin) {
    return { ok: false, status: 400, code: "TOKEN_LOGIN_MISMATCH", message: "令牌与站主标识不匹配" };
  }

  const pwdHash = await hashPassword(input.password);
  const userId = newId("usr");
  const ts = nowIso();
  const display = (input.displayName?.trim() || "站主").slice(0, 64);

  const consume = db
    .prepare(
      `UPDATE site_owner_activation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND superseded_at IS NULL`,
    )
    .bind(ts, row.id);

  const insertUser = db
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`,
    )
    .bind(userId, login, display, pwdHash, ts, ts);

  const paper = db
    .prepare(`INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, ?, 'HKD', ?)`)
    .bind(userId, 1_000_000_00, ts);

  const audit = db
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, created_at)
       VALUES (?, ?, 'site_owner_activated', 'user', ?, ?)`,
    )
    .bind(newId("aud"), userId, userId, ts);

  const results = await db.batch([consume, insertUser, paper, audit]);
  const consumed = results[0]?.meta?.changes ?? 0;
  if (consumed !== 1) {
    return {
      ok: false,
      status: 409,
      code: "TOKEN_CONSUME_RACE",
      message: "激活令牌已被使用（并发拒绝）",
    };
  }

  const session = await createSession(db, {
    id: userId,
    email: login,
    display_name: display,
    role: "admin",
  });

  return {
    ok: true,
    userId,
    session: { token: session.token, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
  };
}

export function siteOwnerActivationCookieHeader(env: Env, token: string, expiresAt: string): string {
  return `${env.SESSION_COOKIE_NAME}=${token}; ${sessionCookieOptions(env, expiresAt)}`;
}
