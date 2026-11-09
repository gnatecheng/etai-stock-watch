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
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  MARKET_DATA_API_KEY?: string;
}

const DEV_DEFAULT_EMAIL = "admin@local.dev";
const DEV_DEFAULT_PASSWORD = "dev-admin-change-me";

export function normalizeProvider(env: Env): string {
  return (env.DATA_PROVIDER ?? "none").trim().toLowerCase();
}

export function isProduction(env: Env): boolean {
  return env.APP_ENV === "production";
}

export function isDemoProvider(env: Env): boolean {
  return normalizeProvider(env) === "demo";
}

export function isCronEnabled(env: Env): boolean {
  return env.EOD_CRON_ENABLED === "true";
}

export function providerReady(env: Env): { ready: boolean; reason?: string } {
  const provider = normalizeProvider(env);
  if (provider === "demo") {
    if (isProduction(env)) {
      return { ready: false, reason: "生产环境禁止使用演示行情供应商" };
    }
    return { ready: true };
  }
  if (provider === "none" || provider === "") {
    return { ready: false, reason: "行情供应商未配置" };
  }
  if (!env.MARKET_DATA_API_KEY) {
    return { ready: false, reason: "缺少 MARKET_DATA_API_KEY" };
  }
  return { ready: true };
}

/** 生产无授权供应商时禁止 EOD 信号与模拟成交 */
export function demoMarketFeaturesAllowed(env: Env): { allowed: boolean; reason?: string } {
  if (isProduction(env) && isDemoProvider(env)) {
    return { allowed: false, reason: "生产环境不可使用演示数据产生信号或模拟成交" };
  }
  const ready = providerReady(env);
  if (!ready.ready) {
    return { allowed: false, reason: ready.reason ?? "供应商未就绪" };
  }
  return { allowed: true };
}

export function paperTradingAllowed(env: Env): { allowed: boolean; reason?: string } {
  return demoMarketFeaturesAllowed(env);
}

export function isDevDefaultCredential(email: string, password: string): boolean {
  return (
    email.trim().toLowerCase() === DEV_DEFAULT_EMAIL &&
    password === DEV_DEFAULT_PASSWORD
  );
}

export function rejectDevCredentialsInProd(env: Env, email: string, password: string): boolean {
  return isProduction(env) && isDevDefaultCredential(email, password);
}
