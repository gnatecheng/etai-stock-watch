import type { Env } from "../env";

/** 登录标识规范化：无 @ 时追加 SITE_OWNER_LOGIN_DOMAIN（默认 staging.local） */
export function normalizeLoginId(raw: string | null | undefined, env: Env): string {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return "";
  if (t.includes("@")) return t;
  const domain = (env.SITE_OWNER_LOGIN_DOMAIN ?? "staging.local").trim().toLowerCase();
  return `${t}@${domain}`;
}

export function configuredSiteOwnerLogin(env: Env): string | null {
  const v = env.SITE_OWNER_LOGIN?.trim();
  if (!v) return null;
  return normalizeLoginId(v, env);
}
