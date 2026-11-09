import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  demoMarketFeaturesAllowed,
  paperTradingAllowed,
  providerReady,
  rejectDevCredentialsInProd,
} from "../src/env";

function mockEnv(overrides: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    APP_ENV: "development",
    DATA_PROVIDER: "demo",
    EOD_CRON_ENABLED: "false",
    DEMO_WATERMARK: "演示数据，非真实行情",
    SESSION_COOKIE_NAME: "esw_session",
    HK_TIMEZONE: "Asia/Hong_Kong",
    ...overrides,
  };
}

describe("production guards", () => {
  it("blocks demo provider in production", () => {
    const env = mockEnv({ APP_ENV: "production", DATA_PROVIDER: "demo" });
    expect(providerReady(env).ready).toBe(false);
    expect(demoMarketFeaturesAllowed(env).allowed).toBe(false);
    expect(paperTradingAllowed(env).allowed).toBe(false);
  });

  it("blocks demo bypass via casing", () => {
    const env = mockEnv({ APP_ENV: "production", DATA_PROVIDER: " Demo " });
    expect(providerReady(env).ready).toBe(false);
  });

  it("rejects default dev credentials in production", () => {
    const env = mockEnv({ APP_ENV: "production" });
    expect(rejectDevCredentialsInProd(env, "admin@local.dev", "dev-admin-change-me")).toBe(true);
  });

  it("allows demo in development", () => {
    const env = mockEnv({ APP_ENV: "development", DATA_PROVIDER: "demo" });
    expect(paperTradingAllowed(env).allowed).toBe(true);
  });

  it("fail-closed when provider none", () => {
    const env = mockEnv({ DATA_PROVIDER: "none" });
    expect(providerReady(env).ready).toBe(false);
  });
});
