import { Hono, type Context } from "hono";
import type { HonoEnv } from "../middleware/auth";
import {
  requireAuth,
  requireAdmin,
  getSessionToken,
  assertSameOrigin,
} from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { hashPassword, verifyPassword } from "../auth/password";
import { createSession, resolveSession, revokeSession, sessionCookieOptions } from "../auth/session";
import { sha256Hex, randomToken } from "../lib/crypto";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { runEodPipeline } from "../pipeline/eod";
import { seedAcceptanceScenario } from "../pipeline/acceptance-seed";
import { confirmPaperOrder } from "../paper/engine";
import { DEMO_FEE_SCHEDULES } from "../paper/fees";
import {
  isDemoProvider,
  paperTradingAllowed,
  rejectDevCredentialsInProd,
  demoMarketFeaturesAllowed,
} from "../env";
import { parseCsv, validateAndMapRows, newSnapshotMeta, persistBars } from "../providers/import";
import { screenerCapabilities, runScreener } from "../screener/engine";
import { validateScreenerRequest } from "../screener/validate";
import type { ScreenerRunRequest } from "../screener/types";
import { seedBuiltinCalendar, seedCalendarRange } from "../calendar/hk";
import { importV1 } from "./import-v1";
import { financialScreenerCapabilities } from "../screener/financial";

const app = new Hono<HonoEnv>();

app.use("/api/*", async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const ok = await checkRateLimit(c.env.DB, `ip:${ip}`);
  if (!ok) return c.json({ error: "请求过于频繁" }, 429);
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    demo: isDemoProvider(c.env),
    watermark: c.env.DEMO_WATERMARK,
    paper: true,
  }),
);

app.get("/api/meta", (c) =>
  c.json({
    name: "观股记",
    market: "HK",
    paperOnly: true,
    demoWatermark: isDemoProvider(c.env) ? c.env.DEMO_WATERMARK : null,
    locale: "zh-Hans",
  }),
);

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) return c.json({ error: "请输入邮箱与密码" }, 400);
  if (rejectDevCredentialsInProd(c.env, body.email, body.password)) {
    return c.json({ error: "生产环境不可使用默认开发凭据" }, 403);
  }
  const user = await c.env.DB.prepare(
    "SELECT id, email, display_name, role, password_hash, status FROM users WHERE email = ?",
  )
    .bind(body.email.trim().toLowerCase())
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: "user" | "admin";
      password_hash: string;
      status: string;
    }>();
  if (!user || user.status !== "active") return c.json({ error: "账号或密码错误" }, 401);
  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return c.json({ error: "账号或密码错误" }, 401);
  const session = await createSession(c.env.DB, {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
  });
  c.header(
    "Set-Cookie",
    `${c.env.SESSION_COOKIE_NAME}=${session.token}; ${sessionCookieOptions(c.env, session.expiresAt)}`,
  );
  return c.json({ ok: true, csrfToken: session.csrfToken, user: { id: user.id, display_name: user.display_name, role: user.role } });
});

app.post("/api/auth/invite", async (c) => {
  const body = await c.req.json<{
    inviteToken: string;
    email: string;
    password: string;
    displayName: string;
  }>();
  if (!body.inviteToken || !body.email || !body.password || !body.displayName) {
    return c.json({ error: "缺少字段" }, 400);
  }
  const tokenHash = await sha256Hex(body.inviteToken);
  const inv = await c.env.DB.prepare(
    `SELECT id, email, role, expires_at, used_at, revoked_at FROM invitations WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string | null;
      role: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
    }>();
  if (!inv || inv.revoked_at) return c.json({ error: "邀请无效" }, 400);
  if (inv.used_at) return c.json({ error: "邀请已使用" }, 400);
  if (new Date(inv.expires_at) < new Date()) return c.json({ error: "邀请已过期" }, 400);
  if (inv.email && inv.email.toLowerCase() !== body.email.trim().toLowerCase()) {
    return c.json({ error: "邮箱与邀请不匹配" }, 400);
  }
  const email = body.email.trim().toLowerCase();
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "邮箱已注册" }, 409);
  const userId = newId("usr");
  const pwdHash = await hashPassword(body.password);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(userId, email, body.displayName.trim(), pwdHash, inv.role, nowIso(), nowIso()),
    c.env.DB.prepare("UPDATE invitations SET used_at = ? WHERE id = ?").bind(nowIso(), inv.id),
    c.env.DB.prepare(
      `INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, ?, 'HKD', ?)`,
    ).bind(userId, 1_000_000_00, nowIso()),
    c.env.DB.prepare(
      `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, created_at)
       VALUES (?, ?, 'invite_accepted', 'user', ?, ?)`,
    ).bind(newId("aud"), userId, userId, nowIso()),
  ]);
  const session = await createSession(c.env.DB, {
    id: userId,
    email,
    display_name: body.displayName.trim(),
    role: inv.role as "user" | "admin",
  });
  c.header(
    "Set-Cookie",
    `${c.env.SESSION_COOKIE_NAME}=${session.token}; ${sessionCookieOptions(c.env, session.expiresAt)}`,
  );
  return c.json({ ok: true, csrfToken: session.csrfToken });
});

app.post("/api/auth/logout", async (c) => {
  const raw = getSessionToken(c);
  if (raw) {
    const h = await sha256Hex(raw);
    await revokeSession(c.env.DB, h);
  }
  c.header("Set-Cookie", `${c.env.SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
  return c.json({ ok: true });
});

app.get("/api/me", requireAuth, async (c) => {
  const u = c.get("user")!;
  return c.json({
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    csrfToken: u.csrf_token,
  });
});

function requireCsrf(c: Context<HonoEnv>): Response | null {
  if (!assertSameOrigin(c)) return c.json({ error: "来源校验失败" }, 403);
  const user = c.get("user");
  const token = c.req.header("X-CSRF-Token");
  if (!user || !token || token !== user.csrf_token) {
    return c.json({ error: "CSRF 校验失败" }, 403);
  }
  return null;
}

/** 条件筛选能力说明（单位、成交额是否可用）；不包含固定列表 */
app.get("/api/screener/capabilities", requireAuth, async (c) => {
  const caps = await screenerCapabilities(c.env, c.env.DB);
  return c.json(caps);
});

/** 用户设置条件后主动执行；多条件 AND；与策略信号无关 */
app.post("/api/screener/run", requireAuth, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const body = await c.req.json<ScreenerRunRequest>().catch(() => null);
  if (!body) return c.json({ error: "JSON 无效", code: "INVALID_BODY" }, 400);
  const caps = await screenerCapabilities(c.env, c.env.DB);
  const validated = validateScreenerRequest(body, caps);
  if (!validated.ok) {
    return c.json({ error: validated.message, code: validated.code }, 400);
  }
  const result = await runScreener(c.env, c.env.DB, validated.request);
  return c.json(result);
});

/** @deprecated 固定列表已移除；请使用 GET /api/screener/capabilities + POST /api/screener/run */
app.get("/api/screener", requireAuth, async (c) => {
  return c.json(
    {
      error: "筛选已改为用户条件表单；请先 GET /api/screener/capabilities，再 POST /api/screener/run",
      code: "SCREENER_MIGRATED",
    },
    410,
  );
});

app.get("/api/instruments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const inst = await c.env.DB.prepare("SELECT * FROM instruments WHERE id = ?").bind(id).first();
  if (!inst) return c.json({ error: "未找到" }, 404);
  const bars = await c.env.DB.prepare(
    "SELECT trade_date, close_cents, volume FROM bars_daily WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 30",
  )
    .bind(id)
    .all();
  const signals = await c.env.DB.prepare(
    "SELECT trade_date, direction, reasons_json, created_at FROM signals WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 10",
  )
    .bind(id)
    .all();
  const snap = await c.env.DB.prepare(
    "SELECT imported_at, provider FROM data_snapshots ORDER BY imported_at DESC LIMIT 1",
  ).first();
  return c.json({
    instrument: inst,
    bars: bars.results ?? [],
    signals: (signals.results ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      reasons: JSON.parse(String(s.reasons_json)),
    })),
    dataSource: snap,
    watermark: isDemoProvider(c.env) ? c.env.DEMO_WATERMARK : null,
  });
});

app.get("/api/watchlists", requireAuth, async (c) => {
  const u = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.instrument_id, i.symbol, i.name_zh FROM watchlists w
     JOIN instruments i ON i.id = w.instrument_id WHERE w.user_id = ?`,
  )
    .bind(u.id)
    .all();
  return c.json({ items: rows.results ?? [] });
});

app.post("/api/watchlists", requireAuth, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const u = c.get("user")!;
  const body = await c.req.json<{ instrumentId: string }>();
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO watchlists (id, user_id, instrument_id, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(newId("wl"), u.id, body.instrumentId, nowIso())
    .run();
  return c.json({ ok: true });
});

app.delete("/api/watchlists/:instrumentId", requireAuth, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const u = c.get("user")!;
  await c.env.DB.prepare("DELETE FROM watchlists WHERE user_id = ? AND instrument_id = ?")
    .bind(u.id, c.req.param("instrumentId"))
    .run();
  return c.json({ ok: true });
});

app.get("/api/signals", requireAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*, i.symbol, i.name_zh FROM signals s
     JOIN instruments i ON i.id = s.instrument_id
     ORDER BY s.trade_date DESC LIMIT 100`,
  ).all();
  return c.json({
    items: (rows.results ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      reasons: JSON.parse(String(s.reasons_json)),
    })),
  });
});

app.get("/api/notifications", requireAuth, async (c) => {
  const u = c.get("user")!;
  const rows = await c.env.DB.prepare(
    "SELECT id, title, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(u.id)
    .all();
  return c.json({ items: rows.results ?? [] });
});

app.post("/api/paper/confirm", requireAuth, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const allow = paperTradingAllowed(c.env);
  if (!allow.allowed) {
    return c.json({ error: allow.reason, code: "BLOCKED" }, 403);
  }
  const u = c.get("user")!;
  const body = await c.req.json<{
    instrumentId: string;
    side: "buy" | "sell";
    quantity: number;
    signalTradeDate: string;
    idempotencyKey: string;
  }>();
  const inst = await c.env.DB.prepare("SELECT board_lot FROM instruments WHERE id = ?")
    .bind(body.instrumentId)
    .first<{ board_lot: number }>();
  if (!inst) return c.json({ error: "标的无效" }, 400);
  const bars = await c.env.DB.prepare(
    "SELECT trade_date, open_cents, close_cents, volume FROM bars_daily WHERE instrument_id = ? ORDER BY trade_date",
  )
    .bind(body.instrumentId)
    .all();
  const feesRows = await c.env.DB.prepare("SELECT * FROM fee_schedules").all();
  const fees =
    (feesRows.results?.length ?? 0) > 0
      ? (feesRows.results as unknown as typeof DEMO_FEE_SCHEDULES)
      : DEMO_FEE_SCHEDULES;
  const result = await confirmPaperOrder(
    c.env.DB,
    {
      userId: u.id,
      instrumentId: body.instrumentId,
      side: body.side,
      quantity: body.quantity,
      boardLot: inst.board_lot,
      signalTradeDate: body.signalTradeDate,
      idempotencyKey: body.idempotencyKey,
    },
    (bars.results ?? []) as { trade_date: string; open_cents: number; close_cents: number; volume: number }[],
    fees,
  );
  if (!result.ok) return c.json({ error: result.message, code: result.code }, 400);
  return c.json({
    ok: true,
    orderId: result.orderId,
    status: result.status,
    paper: true,
    label: "模拟交易",
  });
});

app.get("/api/paper/orders", requireAuth, async (c) => {
  const u = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.instrument_id, o.side, o.quantity, o.status, o.idempotency_key,
            o.fill_trade_date, o.fill_price_cents, o.requested_at, o.meta_json, i.symbol
     FROM paper_orders o JOIN instruments i ON i.id = o.instrument_id
     WHERE o.user_id = ? ORDER BY o.requested_at DESC LIMIT 30`,
  )
    .bind(u.id)
    .all();
  return c.json({
    items: (rows.results ?? []).map((o: Record<string, unknown>) => {
      let signalDate: string | undefined;
      try {
        const meta = JSON.parse(String(o.meta_json ?? "{}"));
        signalDate = meta.signalDate;
      } catch {
        /* ignore */
      }
      return { ...o, signalDate };
    }),
  });
});

app.get("/api/paper/positions", requireAuth, async (c) => {
  const u = c.get("user")!;
  const acct = await c.env.DB.prepare("SELECT cash_cents, currency FROM paper_accounts WHERE user_id = ?")
    .bind(u.id)
    .first();
  const pos = await c.env.DB.prepare(
    `SELECT p.*, i.symbol, i.name_zh FROM paper_positions p
     JOIN instruments i ON i.id = p.instrument_id WHERE p.user_id = ?`,
  )
    .bind(u.id)
    .all();
  const trades = await c.env.DB.prepare(
    "SELECT * FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(u.id)
    .all();
  return c.json({
    account: acct,
    positions: pos.results ?? [],
    trades: trades.results ?? [],
    paper: true,
    disclaimer: "仅为模拟盘，非真实成交",
  });
});

app.get("/api/jobs/latest", requireAuth, requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 20",
  ).all();
  return c.json({ items: rows.results ?? [] });
});

app.post("/api/admin/eod/run", requireAuth, requireAdmin, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const allowed = demoMarketFeaturesAllowed(c.env);
  if (!allowed.allowed && c.env.APP_ENV === "production") {
    return c.json({ status: "failed", message: allowed.reason }, 403);
  }
  const body = (await c.req.json<{ tradeDate?: string }>().catch(() => ({
    tradeDate: undefined,
  }))) as { tradeDate?: string };
  const result = await runEodPipeline(c.env, body.tradeDate);
  return c.json(result);
});

app.post("/api/admin/invitations", requireAuth, requireAdmin, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const u = c.get("user")!;
  const body = await c.req.json<{ email?: string; role?: string; expiresInDays?: number }>();
  const raw = randomToken(24);
  const tokenHash = await sha256Hex(raw);
  const days = body.expiresInDays ?? 7;
  const exp = new Date();
  exp.setUTCDate(exp.getUTCDate() + days);
  const id = newId("inv");
  await c.env.DB.prepare(
    `INSERT INTO invitations (id, token_hash, email, role, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, tokenHash, body.email?.toLowerCase() ?? null, body.role ?? "user", u.id, exp.toISOString(), nowIso())
    .run();
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, created_at)
     VALUES (?, ?, 'invitation_created', 'invitation', ?, ?)`,
  )
    .bind(newId("aud"), u.id, id, nowIso())
    .run();
  return c.json({ id, inviteToken: raw, expiresAt: exp.toISOString() });
});

app.post("/api/admin/invitations/:id/revoke", requireAuth, requireAdmin, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const u = c.get("user")!;
  await c.env.DB.prepare("UPDATE invitations SET revoked_at = ? WHERE id = ?")
    .bind(nowIso(), c.req.param("id"))
    .run();
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, created_at)
     VALUES (?, ?, 'invitation_revoked', 'invitation', ?, ?)`,
  )
    .bind(newId("aud"), u.id, c.req.param("id"), nowIso())
    .run();
  return c.json({ ok: true });
});

app.post("/api/admin/import/bars", requireAuth, requireAdmin, async (c) => {
  const csrfErr = requireCsrf(c);
  if (csrfErr) return csrfErr;
  const body = await c.req.text();
  const rows = parseCsv(body);
  const instRows = await c.env.DB.prepare("SELECT id, symbol FROM instruments").all<{ id: string; symbol: string }>();
  const map = new Map((instRows.results ?? []).map((r) => [r.symbol, r.id]));
  const meta = newSnapshotMeta("csv", rows.length);
  await c.env.DB.prepare(
    `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(meta.id, meta.provider, meta.provider_version, meta.imported_at, meta.row_count, meta.provenance_json)
    .run();
  const bars = validateAndMapRows(rows, map, meta.id);
  await persistBars(c.env.DB, bars, meta.id);
  return c.json({ ok: true, imported: bars.length, snapshotId: meta.id });
});

app.post("/api/admin/bootstrap", async (c) => {
  if (c.env.APP_ENV === "production") {
    return c.json({ error: "生产环境禁止 bootstrap" }, 403);
  }
  await seedBuiltinCalendar(c.env.DB);
  await seedCalendarRange(c.env.DB, "2024-06-01", "2024-10-31");
  for (const f of DEMO_FEE_SCHEDULES) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO fee_schedules (id, name, rate_bps, flat_cents, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(f.id, f.name, f.rate_bps, f.flat_cents, f.effective_from)
      .run();
  }
  const email = c.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@local.dev";
  const password = c.env.BOOTSTRAP_ADMIN_PASSWORD ?? "dev-admin-change-me";
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!existing) {
    const id = newId("usr");
    const hash = await hashPassword(password);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, '管理员', ?, 'admin', 'active', ?, ?)`,
      ).bind(id, email, hash, nowIso(), nowIso()),
      c.env.DB.prepare(
        `INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, ?, 'HKD', ?)`,
      ).bind(id, 1_000_000_00, nowIso()),
    ]);
  }
  const eodRuns = [];
  for (const d of ["2024-08-05", "2024-08-15", "2024-08-22", "2024-09-03"]) {
    eodRuns.push(await runEodPipeline(c.env, d));
  }
  return c.json({ ok: true, eod: eodRuns, note: "仅本地/开发引导" });
});

app.post("/api/admin/bootstrap-acceptance", async (c) => {
  if (c.env.APP_ENV === "production") {
    return c.json({ error: "生产环境禁止 bootstrap" }, 403);
  }
  for (const f of DEMO_FEE_SCHEDULES) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO fee_schedules (id, name, rate_bps, flat_cents, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(f.id, f.name, f.rate_bps, f.flat_cents, f.effective_from)
      .run();
  }
  const email = c.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@local.dev";
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!existing) {
    const id = newId("usr");
    const hash = await hashPassword(c.env.BOOTSTRAP_ADMIN_PASSWORD ?? "dev-admin-change-me");
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, '管理员', ?, 'admin', 'active', ?, ?)`,
      ).bind(id, email, hash, nowIso(), nowIso()),
      c.env.DB.prepare(
        `INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, ?, 'HKD', ?)`,
      ).bind(id, 1_000_000_00, nowIso()),
    ]);
  }
  await c.env.DB.prepare("DELETE FROM paper_trades").run();
  await c.env.DB.prepare("DELETE FROM paper_orders").run();
  await c.env.DB.prepare("DELETE FROM paper_positions").run();
  await c.env.DB.prepare("DELETE FROM notifications").run();
  await c.env.DB.prepare("DELETE FROM signals").run();
  await c.env.DB.prepare("DELETE FROM job_runs").run();
  await c.env.DB.prepare("DELETE FROM watchlists").run();
  const scenario = await seedAcceptanceScenario(c.env);
  return c.json({ ok: true, scenario, note: "合成验收场景；下一 session 需 CSV 导入后重试确认" });
});

app.get("/api/screener/financial-capabilities", requireAuth, async (c) => {
  const caps = await financialScreenerCapabilities(c.env, c.env.DB);
  return c.json(caps);
});

app.route("/api/import/v1", importV1);

export default app;
