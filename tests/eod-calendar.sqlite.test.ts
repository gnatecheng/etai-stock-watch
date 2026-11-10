import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { seedBuiltinCalendar } from "../src/calendar/hk";
import { runEodPipeline } from "../src/pipeline/eod";
import type { Env } from "../src/env";

function mockEnv(d1: D1Database): Env {
  return {
    DB: d1,
    ASSETS: {} as Fetcher,
    APP_ENV: "development",
    DATA_PROVIDER: "demo",
    EOD_CRON_ENABLED: "false",
    DEMO_WATERMARK: "demo",
    SESSION_COOKIE_NAME: "esw_session",
    HK_TIMEZONE: "Asia/Hong_Kong",
  };
}

describe("EOD calendar gates", () => {
  let d1: D1Database;
  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedBuiltinCalendar(d1);
    await d1
      .prepare(
        "INSERT OR IGNORE INTO calendar_hk (trade_date, session_type, note) VALUES ('2024-08-28', 'full', 'test')",
      )
      .bind()
      .run();
  });

  it("fail-closed when calendar missing", async () => {
    const r = await runEodPipeline(mockEnv(d1), "2099-03-01");
    expect(r.status).toBe("failed");
    expect(r.message).toContain("fail-closed");
  });

  it("skips closed session in calendar", async () => {
    const r = await runEodPipeline(mockEnv(d1), "2024-12-25");
    expect(r.status).toBe("skipped");
  });

  it("half-day row present in builtin calendar", async () => {
    const half = await d1
      .prepare("SELECT session_type FROM calendar_hk WHERE trade_date = ?")
      .bind("2024-02-09")
      .first<{ session_type: string }>();
    expect(half?.session_type).toBe("half");
  });
});
