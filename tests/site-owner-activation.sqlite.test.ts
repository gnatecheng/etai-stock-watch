import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { activateSiteOwner, adminUserExists } from "../src/auth/site-owner";
import { randomToken } from "../src/lib/crypto";
import { createHash } from "node:crypto";
import type { Env } from "../src/env";

async function sha256Hex(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const env = {
  APP_ENV: "production",
  STAGING_DEMO_ENABLED: "true",
  DATA_PROVIDER: "demo",
  SITE_OWNER_ACTIVATION_ENABLED: "true",
  SITE_OWNER_LOGIN: "owner@staging.local",
  SITE_OWNER_LOGIN_DOMAIN: "staging.local",
  DEMO_WATERMARK: "DEMO",
  EOD_CRON_ENABLED: "false",
  SESSION_COOKIE_NAME: "esw",
  HK_TIMEZONE: "Asia/Hong_Kong",
} as unknown as Env;

describe("site owner activation", () => {
  let d1: D1Database;

  beforeAll(() => {
    ({ d1 } = freshMigratedDb());
  });

  async function insertPendingToken(d: D1Database, token: string, expired = false) {
    const hash = await sha256Hex(token);
    const exp = expired
      ? new Date(Date.now() - 60_000).toISOString()
      : new Date(Date.now() + 3600_000).toISOString();
    const id = `soa_${hash.slice(0, 14)}`;
    await d
      .prepare(
        `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
         VALUES (?, 'owner@staging.local', ?, ?, datetime('now'), 1)`,
      )
      .bind(id, hash, exp)
      .run();
  }

  it("rejects when admin exists", async () => {
    const { d1: db } = freshMigratedDb();
    await db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES ('u1', 'x@staging.local', 'X', 'h', 'admin', 'active', datetime('now'), datetime('now'))`,
      )
      .bind()
      .run();
    const t = randomToken(24);
    await insertPendingToken(db, t);
    const r = await activateSiteOwner(env, db, {
      token: t,
      login: "owner@staging.local",
      password: "long-password-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ADMIN_EXISTS");
  });

  it("consumes token atomically and rejects replay", async () => {
    const d2 = freshMigratedDb().d1;
    const token = randomToken(32);
    await insertPendingToken(d2, token);
    const pass = "Valid-Owner-Pass-10";
    const ok = await activateSiteOwner(env, d2, {
      token,
      login: "owner@staging.local",
      password: pass,
    });
    expect(ok.ok).toBe(true);
    expect(await adminUserExists(d2)).toBe(true);
    const replay = await activateSiteOwner(env, d2, {
      token,
      login: "owner@staging.local",
      password: pass,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("ADMIN_EXISTS");
  });

  it("rejects expired token", async () => {
    const d3 = freshMigratedDb().d1;
    const rawToken = randomToken(32);
    await insertPendingToken(d3, rawToken, true);
    const r = await activateSiteOwner(env, d3, {
      token: rawToken,
      login: "owner@staging.local",
      password: "Valid-Owner-Pass-10",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TOKEN_EXPIRED");
  });
});
