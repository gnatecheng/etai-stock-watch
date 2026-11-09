import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { appendFile, writeFile, mkdir, rm } from "node:fs/promises";
const BASE = "http://127.0.0.1:8788";
const LOG = "/opt/cursor/artifacts/production-gates-http.log";
const PERSIST = ".wrangler/prod-gate-test";
let dev;

async function waitReady(ms = 25000) {
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
  throw new Error("wrangler dev (production-test) not ready");
}

async function log(line) {
  const row = `${new Date().toISOString()} ${line}\n`;
  await appendFile(LOG, row);
  console.log(line);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function seedProdGateUser() {
  await rm(PERSIST, { recursive: true, force: true });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-db --local --config wrangler.production-test.toml --persist-to ${PERSIST}`,
    { cwd: process.cwd(), stdio: "pipe" },
  );
  const hash = execSync(
    `npx tsx -e "import { hashPassword } from './src/lib/crypto.ts'; hashPassword('ProdGate1!').then(h=>process.stdout.write(h))"`,
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  const id = "usr_prod_gate_test";
  const safeHash = hash.replace(/'/g, "''");
  const seedSql = `INSERT OR REPLACE INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at) VALUES ('${id}', 'prod-gate@example.com', 'Gate', '${safeHash}', 'admin', 'active', datetime('now'), datetime('now'));
INSERT OR IGNORE INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES ('${id}', 100000000, 'HKD', datetime('now'));`;
  const seedPath = ".tmp/prod-gate-seed.sql";
  await mkdir(".tmp", { recursive: true });
  await writeFile(seedPath, seedSql);
  execSync(
    `npx wrangler d1 execute etai-stock-watch-db --local --config wrangler.production-test.toml --persist-to ${PERSIST} --file ${seedPath}`,
    { cwd: process.cwd(), stdio: "pipe" },
  );
}

async function run() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await writeFile(LOG, `# production gates HTTP ${new Date().toISOString()}\n`);

  try {
    execSync("pkill -f 'wrangler dev.*8788'", { stdio: "ignore" });
  } catch {
    /* none */
  }
  await sleep(500);

  await seedProdGateUser();

  dev = spawn(
    "npx",
    ["wrangler", "dev", "--port", "8788", "--config", "wrangler.production-test.toml", "--persist-to", PERSIST],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  await waitReady();

  const boot = await fetch(`${BASE}/api/admin/bootstrap`, { method: "POST" });
  await log(`POST /api/admin/bootstrap → ${boot.status}`);
  assert(boot.status === 403, `bootstrap expected 403 got ${boot.status}`);

  const acc = await fetch(`${BASE}/api/admin/bootstrap-acceptance`, { method: "POST" });
  await log(`POST /api/admin/bootstrap-acceptance → ${acc.status}`);
  assert(acc.status === 403, `bootstrap-acceptance expected 403 got ${acc.status}`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  });
  await log(`POST /api/auth/login (dev creds) → ${login.status}`);
  assert(login.status === 403, `dev login expected 403 got ${login.status}`);

  const eodUnauth = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tradeDate: "2024-08-28" }),
  });
  await log(`POST /api/admin/eod/run unauth → ${eodUnauth.status}`);
  assert(eodUnauth.status === 401, "eod unauth should 401");

  const gateLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "prod-gate@example.com", password: "ProdGate1!" }),
  });
  const gateBody = await gateLogin.json();
  await log(`POST /api/auth/login (prod user) → ${gateLogin.status}`);
  assert(gateLogin.ok, "prod gate user login");
  const gateCookie = gateLogin.headers.get("set-cookie")?.split(";")[0] ?? "";

  const paper = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: gateCookie,
      "X-CSRF-Token": gateBody.csrfToken,
      Origin: "http://127.0.0.1:8788",
    },
    body: JSON.stringify({
      instrumentId: "inst_demo_00700",
      side: "buy",
      quantity: 100,
      signalTradeDate: "2024-08-28",
      idempotencyKey: "prod-gate-paper",
    }),
  });
  const paperJson = await paper.json().catch(() => ({}));
  await log(`POST /api/paper/confirm (prod+demo) → ${paper.status} ${JSON.stringify(paperJson)}`);
  assert(paper.status === 403, `paper confirm expected 403 got ${paper.status}`);

  const eod = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: gateCookie,
      "X-CSRF-Token": gateBody.csrfToken,
      Origin: "http://127.0.0.1:8788",
    },
    body: JSON.stringify({ tradeDate: "2024-08-28" }),
  });
  const eodJson = await eod.json().catch(() => ({}));
  await log(`POST /api/admin/eod/run (prod+demo) → ${eod.status} ${JSON.stringify(eodJson)}`);
  assert(eod.status === 403, `eod demo in prod expected 403 got ${eod.status}`);

  await log("DONE production gates ok");
  console.log(JSON.stringify({ ok: true, log: LOG }));
}

run()
  .catch(async (e) => {
    await appendFile(LOG, `FAIL ${e.message}\n`);
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
