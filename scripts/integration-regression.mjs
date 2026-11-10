import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
let dev;

async function waitReady(ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("wrangler dev not ready");
}

async function json(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  try {
    const { execSync } = await import("node:child_process");
    execSync("pkill -f 'wrangler dev --port 8787' 2>/dev/null || true", { shell: true });
    await sleep(800);
  } catch {
    /* */
  }
  dev = spawn("npx", ["wrangler", "dev", "--port", "8787"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitReady();
  const results = [];

  const boot = await json("/api/admin/bootstrap-acceptance", { method: "POST" });
  assert(boot.res.ok, "bootstrap-acceptance");
  results.push("bootstrap-acceptance");

  const login = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  });
  assert(login.res.ok, "admin login");
  const cookie = login.res.headers.get("set-cookie")?.split(";")[0] ?? "";
  const csrf = login.data.csrfToken;

  const sig = await json("/api/signals", { headers: { Cookie: cookie } });
  assert(
    (sig.data.items ?? []).some((s) => s.direction === "buy"),
    `buy signal required got ${JSON.stringify((sig.data.items ?? []).map((s) => s.direction))}`,
  );

  const unauth = await json("/api/screener/capabilities");
  assert(unauth.res.status === 401, "screener capabilities 401");

  const testEmail = `regtest-${Date.now()}@local.dev`;
  const invite = await json("/api/admin/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({ email: testEmail }),
  });
  assert(invite.res.ok, `invite create ${JSON.stringify(invite.data)}`);
  const reg = await fetch(`${BASE}/api/auth/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteToken: invite.data.inviteToken,
      email: testEmail,
      password: "regtest-pass",
      displayName: "回归测试",
    }),
  });
  assert(reg.ok, `invite register ${await reg.clone().text()}`);
  const userCookie = reg.headers.get("set-cookie") ?? "";
  const userCsrf = (await reg.json()).csrfToken;

  await json("/api/watchlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: userCookie,
      "X-CSRF-Token": userCsrf,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({ instrumentId: "inst_demo_00700" }),
  });
  const adminWl = await json("/api/watchlists", { headers: { Cookie: cookie } });
  const userWl = await json("/api/watchlists", { headers: { Cookie: userCookie } });
  assert(adminWl.data.items.length === 0, "admin watchlist isolated");
  const caps = await json("/api/screener/capabilities", { headers: { Cookie: userCookie } });
  assert(caps.res.ok, "screener capabilities");
  assert(caps.data.turnoverSupported === false, "demo turnover off");

  const screener = await json("/api/screener/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: userCookie,
      "X-CSRF-Token": userCsrf,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({
      conditions: [{ type: "price_close", minHkd: 1, maxHkd: 10000 }],
    }),
  });
  assert(screener.res.ok, `screener run ${JSON.stringify(screener.data)}`);

  const turnFail = await json("/api/screener/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: userCookie,
      "X-CSRF-Token": userCsrf,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({ conditions: [{ type: "turnover", minHkd: 1 }] }),
  });
  assert(turnFail.res.status === 400, "turnover rejected 400");
  assert(turnFail.data.code === "TURNOVER_NOT_SUPPORTED", "turnover code");

  assert(userWl.data.items.length === 1, "user watchlist");

  const jobs = await json("/api/jobs/latest", { headers: { Cookie: userCookie } });
  assert(jobs.res.status === 403, "non-admin jobs");

  const sigRow = sig.data.items.find((s) => s.direction === "buy");
  const paper = await json("/api/paper/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: userCookie,
      "X-CSRF-Token": userCsrf,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({
      instrumentId: sigRow.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: sigRow.trade_date,
      idempotencyKey: `reg-${sigRow.id}`,
    }),
  });
  assert(paper.res.ok, `paper confirm ${JSON.stringify(paper.data)}`);

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
