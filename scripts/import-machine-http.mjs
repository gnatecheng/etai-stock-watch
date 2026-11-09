import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { appendFile, mkdir } from "node:fs/promises";

const BASE = "http://127.0.0.1:8787";
const KEY = "local-machine-import-test-key";
const LOG = "/opt/cursor/artifacts/import-machine-http.log";
let dev;

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* */
    }
    await sleep(250);
  }
  throw new Error("dev not ready");
}

async function main() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  dev = spawn(
    "npx",
    ["wrangler", "dev", "--port", "8787", "--var", `IMPORT_MACHINE_API_KEY:${KEY}`],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  await waitReady();

  const unauth = await fetch(`${BASE}/api/import/v1/batches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchType: "bars_daily", source: "t", idempotencyKey: "x" }),
  });
  await appendFile(LOG, `unauth ${unauth.status}\n`);
  if (unauth.status !== 401 && unauth.status !== 503) throw new Error(`expected 401/503 got ${unauth.status}`);

  const hdr = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  await fetch(`${BASE}/api/admin/bootstrap-acceptance`, { method: "POST" });
  const create = await (
    await fetch(`${BASE}/api/import/v1/batches`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({
        batchType: "bars_daily",
        source: "http-test",
        idempotencyKey: `http-${Date.now()}`,
        tradeDateScope: "2024-08-29",
        scopeComplete: true,
      }),
    })
  ).json();
  await appendFile(LOG, `create ${JSON.stringify(create)}\n`);

  console.log(JSON.stringify({ ok: true, log: LOG }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => dev?.kill("SIGTERM"));
