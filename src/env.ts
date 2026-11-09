export type AppRole = "user" | "admin";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  DATA_PROVIDER: string;
  EOD_CRON_ENABLED: string;
  DEMO_WATERMARK: string;
  SESSION_COOKIE_NAME: string;
  HK_TIMEZONE: string;
  /** Workers Secret — 生产引导邀请/会话 */
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  /** 可选：正式行情供应商密钥（未配置则 fail-closed） */
  MARKET_DATA_API_KEY?: string;
}

export function isProduction(env: Env): boolean {
  return env.APP_ENV === "production";
}

export function isDemoProvider(env: Env): boolean {
  return env.DATA_PROVIDER === "demo";
}

export function isCronEnabled(env: Env): boolean {
  return env.EOD_CRON_ENABLED === "true";
}

export function providerReady(env: Env): { ready: boolean; reason?: string } {
  if (env.DATA_PROVIDER === "demo") {
    if (isProduction(env)) {
      return { ready: false, reason: "生产环境未配置正式行情供应商" };
    }
    return { ready: true };
  }
  if (!env.MARKET_DATA_API_KEY) {
    return { ready: false, reason: "缺少 MARKET_DATA_API_KEY" };
  }
  return { ready: true };
}
