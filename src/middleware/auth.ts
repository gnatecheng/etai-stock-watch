import type { Context, Next } from "hono";
import type { Env } from "../env";
import { resolveSession, type SessionUser } from "../auth/session";

export type HonoEnv = { Bindings: Env; Variables: { user?: SessionUser & { csrf_token: string } } };

export function getSessionToken(c: Context<HonoEnv>): string | undefined {
  const name = c.env.SESSION_COOKIE_NAME;
  const cookie = c.req.header("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

export async function requireAuth(c: Context<HonoEnv>, next: Next) {
  const user = await resolveSession(c.env.DB, getSessionToken(c));
  if (!user) return c.json({ error: "未登录" }, 401);
  c.set("user", user);
  await next();
}

export async function requireAdmin(c: Context<HonoEnv>, next: Next) {
  const user = c.get("user");
  if (!user || user.role !== "admin") return c.json({ error: "需要管理员权限" }, 403);
  await next();
}

export function assertSameOrigin(c: Context<HonoEnv>): boolean {
  const origin = c.req.header("Origin");
  const host = c.req.header("Host");
  if (!origin) return c.env.APP_ENV === "development";
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}
