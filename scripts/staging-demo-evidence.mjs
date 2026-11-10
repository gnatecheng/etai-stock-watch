/**
 * STAGING DEMO 本地 HTTP 证据：激活/双用户隔离/筛选/财务（令牌仅存内存，不入报告）
 */
import { spawn, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
const PERSIST = ".wrangler/staging-demo-evidence";
const REPORT = "/opt/cursor/artifacts/staging-demo-http-report.json";
const LOG = "/opt/cursor/artifacts/staging-demo-http.log";
const CONFIG = "wrangler.staging-demo.toml";
const SITE_OWNER = "staging-owner";
const OWNER_PASS = "StagingOwner-Test-11";
const USER_PASS = "StagingUser-Test-22";

let dev;
const steps = [];

function step(name, expected, actual, pass, extra = {}) {
  steps.push({ step, expected, actual, pass, ...extra });
}

async function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* */
    }
    await sleep(250);
  }
  throw new Error("wrangler not ready");
}

async function j(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function log(line) {
  await writeFile(LOG, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

async function main() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await writeFile(LOG, `# staging-demo evidence ${new Date().toISOString()}\n`);
  await writeFile(REPORT, "{}");

  try {
    execSync(`pkill -f 'wrangler dev --port 8787' 2>/dev/null || true`, { shell: true });
  } catch {
    /* */
  }
  await rm(PERSIST, { recursive: true, force: true });
  execSync("npm run build", { cwd: process.cwd(), stdio: "pipe" });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST}`,
    { stdio: "pipe" },
  );

  const token = randomBytes(32).toString("base64url");
  const hash = await sha256Hex(token);
  const login = `${SITE_OWNER}@staging.local`;
  const exp = new Date(Date.now() + 3600_000).toISOString();
  const actId = `soa_ev_${hash.slice(0, 12)}`;
  const seedSql = `.tmp/staging-demo-act-${Date.now()}.sql`;
  await mkdir(".tmp", { recursive: true });
  await writeFile(
    seedSql,
    `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
VALUES ('${actId}', '${login}', '${hash}', '${exp}', datetime('now'), 1);`,
  );
  execSync(
    `npx wrangler d1 execute etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST} --file ${seedSql}`,
    { stdio: "pipe" },
  );
  await rm(seedSql, { force: true });

  dev = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      "8787",
      "--config",
      CONFIG,
      "--persist-to",
      PERSIST,
      "--var",
      `SITE_OWNER_LOGIN:${SITE_OWNER}`,
    ],
    { stdio: "ignore" },
  );
  await waitReady();

  const boot403 = await j("/api/admin/bootstrap", { method: "POST" });
  step("bootstrap forbidden", "403", String(boot403.status), boot403.status === 403);
  await log(`bootstrap ${boot403.status}`);

  const act1 = await j("/api/auth/activate-site-owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, login: SITE_OWNER, password: OWNER_PASS, displayName: "站主测试" }),
  });
  const cookie = act1.headers.get("set-cookie")?.split(";")[0] ?? "";
  const csrf = act1.data.csrfToken;
  step("owner activate", "200", String(act1.status), act1.status === 200);

  const replay = await j("/api/auth/activate-site-owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, login: SITE_OWNER, password: OWNER_PASS }),
  });
  step(
    "activate replay blocked",
    "409 ADMIN_EXISTS",
    `${replay.status} ${replay.data.code}`,
    replay.status === 409 && replay.data.code === "ADMIN_EXISTS",
  );

  const seed = await j("/api/admin/staging-demo/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf, Origin: BASE },
  });
  step("demo seed", "200", String(seed.status), seed.status === 200);

  const screener = await j("/api/screener/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      Origin: BASE,
    },
    body: JSON.stringify({ conditions: [{ type: "price_close", minHkd: 1, maxHkd: 5000 }] }),
  });
  const hits = screener.data.hits?.length ?? 0;
  step("price screener", "hits>=1", String(hits), hits >= 1);

  const finCaps = await j("/api/screener/financial-capabilities", { headers: { Cookie: cookie } });
  step("fin supported", "true", String(finCaps.data.supported), finCaps.data.supported === true);

  const invite = await j("/api/admin/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      Origin: BASE,
    },
    body: JSON.stringify({ email: "isolated-user@staging.local", role: "user" }),
  });
  const userToken = invite.data.inviteToken;
  step("invite user", "200", String(invite.status), invite.status === 200);

  const reg = await j("/api/auth/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteToken: userToken,
      email: "isolated-user@staging.local",
      password: USER_PASS,
      displayName: "隔离用户",
    }),
  });
  const userCookie = reg.headers.get("set-cookie")?.split(";")[0] ?? "";
  step("user register", "200", String(reg.status), reg.status === 200);

  await j("/api/watchlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: userCookie,
      "X-CSRF-Token": reg.data.csrfToken,
      Origin: BASE,
    },
    body: JSON.stringify({ instrumentId: "inst_demo_00700" }),
  });
  const adminWl = await j("/api/watchlists", { headers: { Cookie: cookie } });
  const userWl = await j("/api/watchlists", { headers: { Cookie: userCookie } });
  step("watchlist isolation", "admin 0 user 1", `${adminWl.data.items?.length ?? 0}/${userWl.data.items?.length ?? 0}`, adminWl.data.items?.length === 0 && userWl.data.items?.length === 1);

  const unauth = await j("/api/screener/capabilities");
  step("unauth screener", "401", String(unauth.status), unauth.status === 401);

  const logout = await j("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrf, Origin: BASE },
  });
  step("logout", "200", String(logout.status), logout.status === 200);

  const report = {
    generatedAt: new Date().toISOString(),
    credentialNote: "测试令牌未写入本报告",
    disclaimer: "未声称远程 staging 站主已完成激活",
    configuredOwnerLoginPattern: "*@staging.local",
    steps,
    summary: { passed: steps.filter((s) => s.pass).length, total: steps.length },
  };
  await writeFile(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.summary.passed === report.summary.total, report: REPORT, ...report.summary }));
}

main()
  .catch(async (e) => {
    await log(`FAIL ${e.message}`);
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
