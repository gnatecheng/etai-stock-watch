/**
 * 导入 API HTTP 闭环证据 — 本地随机测试凭据，不写入报告正文
 */
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:8787";
const OUT = "/opt/cursor/artifacts";
const LOG = `${OUT}/import-machine-http.log`;
const REPORT = `${OUT}/import-machine-http-report.json`;
const KEY = `test-import-${randomBytes(16).toString("hex")}`;
const PERSIST = ".wrangler/import-machine-test";

let dev;
const steps = [];

function record(step, expected, actual, pass, extra = {}) {
  steps.push({ step, expected, actual, pass, ...extra });
}

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* */
    }
    await sleep(300);
  }
  throw new Error("wrangler dev not ready");
}

async function json(method, path, headers, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

async function main() {
  await mkdir(OUT, { recursive: true });
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
    { cwd: process.cwd(), stdio: "ignore" },
  );
  await waitReady();

  // 1 无凭据
  const r1 = await json("POST", "/api/import/v1/batches", { "Content-Type": "application/json" }, {
    batchType: "bars_daily",
    source: "t",
    idempotencyKey: "unauth",
  });
  record("POST /batches 无 Authorization", "401", String(r1.status), r1.status === 401, {
    code: r1.data.code,
  });

  // 2 错误凭据
  const r2 = await json(
    "POST",
    "/api/import/v1/batches",
    { "Content-Type": "application/json", Authorization: "Bearer wrong-key" },
    { batchType: "bars_daily", source: "t", idempotencyKey: "bad" },
  );
  record("POST /batches 错误 Bearer", "401", String(r2.status), r2.status === 401);

  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };

  // 3 admin 会话不能代替机器凭据（bootstrap 无 auth 但 import 需 Bearer）
  await fetch(`${BASE}/api/admin/bootstrap-acceptance`, { method: "POST" });
  const login = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
    })
  ).json();
  const cookie = (await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  })).headers.get("set-cookie");
  const r3 = await fetch(`${BASE}/api/import/v1/batches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie?.split(";")[0] ?? "",
      "X-CSRF-Token": login.csrfToken,
    },
    body: JSON.stringify({ batchType: "bars_daily", source: "t", idempotencyKey: "cookie-only" }),
  });
  record("POST /batches 仅用户 Cookie", "401", String(r3.status), r3.status === 401);

  // 4 失败批次不发布
  const failKey = `fail-${Date.now()}`;
  const cFail = await json("POST", "/api/import/v1/batches", auth, {
    batchType: "bars_daily",
    source: "http-test",
    idempotencyKey: failKey,
    tradeDateScope: "2024-08-29",
    scopeComplete: true,
  });
  const failBatchId = cFail.data.batchId;
  await json("POST", `/api/import/v1/batches/${failBatchId}/stage`, auth, {
    rows: [
      {
        seq: 1,
        payloadType: "bar",
        payload: {
          symbol: "DEMO:00700",
          trade_date: "2024-08-28",
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        },
      },
    ],
  });
  const vFail = await json("POST", `/api/import/v1/batches/${failBatchId}/validate`, auth, {});
  const pubFail = await json("POST", `/api/import/v1/batches/${failBatchId}/publish`, auth, {
    provider: "test",
    provenance: { demo: true },
  });
  record("失败 validate", "ok=false", String(vFail.data.ok), vFail.data.ok === false);
  record("失败 publish", "400", String(pubFail.status), pubFail.status === 400);

  // 5 成功批次 + 分批 stage + 重放
  const okKey = `ok-${Date.now()}`;
  const c1 = await json("POST", "/api/import/v1/batches", auth, {
    batchType: "bars_daily",
    source: "http-test",
    idempotencyKey: okKey,
    tradeDateScope: "2024-08-29",
    scopeComplete: true,
    rowCountExpected: 1,
  });
  const okBatchId = c1.data.batchId;
  const idem2 = await json("POST", "/api/import/v1/batches", auth, {
    batchType: "bars_daily",
    source: "http-test",
    idempotencyKey: okKey,
    tradeDateScope: "2024-08-29",
  });
  record("create 幂等", "created=false", String(idem2.data.created), idem2.data.created === false);

  const barPayload = {
    symbol: "DEMO:00700",
    trade_date: "2024-08-29",
    open: 279,
    high: 281,
    low: 278,
    close: 280.5,
    volume: 650000,
  };
  const s1 = await json("POST", `/api/import/v1/batches/${okBatchId}/stage`, auth, {
    rows: [{ seq: 1, payloadType: "bar", payload: barPayload }],
  });
  const sReplay = await json("POST", `/api/import/v1/batches/${okBatchId}/stage`, auth, {
    rows: [{ seq: 1, payloadType: "bar", payload: barPayload }],
  });
  record("stage 首批", "accepted>=1", String(s1.data.accepted), (s1.data.accepted ?? 0) >= 1);
  record("stage 重放 seq", "accepted=0", String(sReplay.data.accepted), sReplay.data.accepted === 0);

  const vOk = await json("POST", `/api/import/v1/batches/${okBatchId}/validate`, auth, {});
  const pub1 = await json("POST", `/api/import/v1/batches/${okBatchId}/publish`, auth, {
    provider: "akshare-machine-test",
    provenance: { synthetic: true, demo: true },
  });
  const pub2 = await json("POST", `/api/import/v1/batches/${okBatchId}/publish`, auth, {
    provider: "akshare-machine-test",
    provenance: { synthetic: true, demo: true },
  });
  record("validate 成功", "ok=true", String(vOk.data.ok), vOk.data.ok === true);
  record("publish 首次", "200 ok", String(pub1.status), pub1.status === 200 && pub1.data.ok === true);
  record("publish 重复", "200 幂等", String(pub2.status), pub2.status === 200);

  // 6 financial 批次（财务筛选数据）
  const finKey = `fin-${Date.now()}`;
  const cf = await json("POST", "/api/import/v1/batches", auth, {
    batchType: "financial",
    source: "synthetic-http",
    idempotencyKey: finKey,
  });
  const finBatch = cf.data.batchId;
  await json("POST", `/api/import/v1/batches/${finBatch}/stage`, auth, {
    rows: [
      {
        seq: 1,
        payloadType: "financial",
        payload: {
          symbol: "DEMO:00700",
          report_family: "akshare_hk_analysis_indicator_em",
          period_end: "2023-12-31",
          period_type: "annual",
          currency: "HKD",
          unit_label: "百万港元",
          announced_at: "2024-03-15",
          metrics: {
            operating_revenue: 5000,
            net_profit_attr_parent: 800,
            basic_eps: 2.5,
            roe: 15,
            gross_margin: 40,
          },
        },
      },
    ],
  });
  await json("POST", `/api/import/v1/batches/${finBatch}/validate`, auth, {});
  await json("POST", `/api/import/v1/batches/${finBatch}/publish`, auth, {
    provenance: { synthetic: true, demo: true },
  });

  const passCount = steps.filter((s) => s.pass).length;
  const report = {
    generatedAt: new Date().toISOString(),
    credentialNote: "IMPORT_MACHINE_API_KEY 为本次运行随机生成，未写入本文件",
    endpointBase: BASE,
    summary: { total: steps.length, passed: passCount, failed: steps.length - passCount },
    steps,
  };

  const logText = [
    `# import-machine-http ${report.generatedAt}`,
    `summary: ${passCount}/${steps.length} passed`,
    ...steps.map((s) => `${s.pass ? "PASS" : "FAIL"} ${s.step} expected=${s.expected} actual=${s.actual}`),
  ].join("\n");

  await writeFile(LOG, logText);
  await writeFile(REPORT, JSON.stringify(report, null, 2));

  if (passCount !== steps.length) {
    throw new Error(`import machine HTTP: ${passCount}/${steps.length} passed — see ${REPORT}`);
  }
  console.log(JSON.stringify({ ok: true, report: REPORT, log: LOG, passed: passCount }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
