/**
 * 本地财务筛选 HTTP 闭环（开发环境 + 合成 fin_report_versions）
 */
import { spawn, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
const OUT = "/opt/cursor/artifacts/financial-screener-http-report.json";
const PERSIST = ".wrangler/fin-screen-http";

const KEY = randomBytes(24).toString("hex");
let dev;

async function waitReady() {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* retry */
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

function step(name, expected, actual, pass, extra = {}) {
  return { step: name, expected, actual, pass, ...extra };
}

async function main() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  try {
    execSync("pkill -f 'wrangler dev --port 8787' 2>/dev/null || true", { shell: true });
  } catch {
    /* */
  }
  await sleep(500);
  execSync("npm run build:worker", { cwd: process.cwd(), stdio: "pipe" });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-db --local --persist-to ${PERSIST}`,
    { cwd: process.cwd(), stdio: "pipe" },
  );
  dev = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      "8787",
      "--persist-to",
      PERSIST,
      "--var",
      `IMPORT_MACHINE_API_KEY:${KEY}`,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitReady();

  const steps = [];

  await fetch(`${BASE}/api/admin/bootstrap-acceptance`, { method: "POST" });
  const login = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const csrf = login.data.csrfToken;

  let caps = await j("/api/screener/financial-capabilities", { headers: { Cookie: cookie } });
  steps.push(
    step(
      "capabilities 无财务数据",
      "supported=false",
      String(caps.data.supported),
      caps.data.supported === false && caps.data.publishedFinVersions === 0,
    ),
  );

  const batch = await j("/api/import/v1/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      batchType: "financial",
      source: "fin-http-test",
      idempotencyKey: `fin-http-${Date.now()}`,
    }),
  });
  const batchId = batch.data.batchId;
  const row = {
    symbol: "DEMO:00700",
    report_family: "akshare_hk_analysis_indicator_em",
    period_end: "2023-12-31",
    period_type: "annual",
    accounting_standard: "HKFRS",
    currency: "HKD",
    unit_label: "百万港元",
    announced_at: "2024-03-01",
    metrics: { operating_revenue: 5000, net_profit_attr_parent: 800, roe: 15 },
  };
  await j(`/api/import/v1/batches/${batchId}/stage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      rows: [{ seq: 1, payloadType: "financial", payload: row }],
    }),
  });
  const val = await j(`/api/import/v1/batches/${batchId}/validate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
  });
  steps.push(step("validate financial", "ok=true", String(val.data.ok), val.data.ok === true));
  const pub = await j(`/api/import/v1/batches/${batchId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
  });
  steps.push(step("publish financial", "200", String(pub.status), pub.status === 200));

  caps = await j("/api/screener/financial-capabilities", { headers: { Cookie: cookie } });
  steps.push(
    step(
      "capabilities 有数据",
      "supported=true",
      String(caps.data.supported),
      caps.data.supported === true && caps.data.publishedFinVersions >= 1,
      { notMapped: caps.data.notMapped?.map((x) => x.key) },
    ),
  );

  const run = await j("/api/screener/financial-run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      Origin: BASE,
    },
    body: JSON.stringify({
      asOfDate: "2024-06-01",
      conditions: [{ metric: "operating_revenue", min: 1000 }],
    }),
  });
  steps.push(
    step(
      "financial-run 命中",
      "hits>=1",
      String(run.data.hits?.length ?? 0),
      run.status === 200 && (run.data.hits?.length ?? 0) >= 1,
    ),
  );

  const badMetric = await j("/api/screener/financial-run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      Origin: BASE,
    },
    body: JSON.stringify({
      asOfDate: "2024-06-01",
      conditions: [{ metric: "pe_ttm", min: 1 }],
    }),
  });
  steps.push(
    step(
      "拒绝未映射 pe_ttm",
      "400 METRIC_NOT_MAPPED",
      `${badMetric.status} ${badMetric.data.code ?? ""}`,
      badMetric.status === 400 && badMetric.data.code === "METRIC_NOT_MAPPED",
    ),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    credentialNote: "随机 IMPORT_MACHINE_API_KEY 未写入本报告",
    productionNote:
      "APP_ENV=production 且 DATA_DISTRIBUTION_LICENSED≠true 时 capabilities.supported 恒为 false（见 tests/fin-screener.sqlite.test.ts）",
    akShareMappingNote:
      "PE/TTM/pb/market_cap 列于 notMapped；不伪造 announced_at",
    steps,
    summary: {
      passed: steps.filter((s) => s.pass).length,
      total: steps.length,
    },
  };
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.summary.passed === report.summary.total, report: OUT, ...report.summary }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
