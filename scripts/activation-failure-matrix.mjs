/**
 * 激活失败矩阵（随机 fixture，不打印令牌）
 */
import { spawn, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
const PERSIST = ".wrangler/activation-matrix";
const CONFIG = "wrangler.staging-demo.toml";
const REPORT = "/opt/cursor/artifacts/activation-failure-matrix.json";

async function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function j(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let dev;

async function main() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  try {
    execSync("pkill -f 'wrangler dev --port 8787' 2>/dev/null || true", { shell: true });
  } catch {
    /* */
  }
  await sleep(500);
  await rm(PERSIST, { recursive: true, force: true });
  execSync("npm run build:worker", { stdio: "pipe" });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST}`,
    { stdio: "pipe" },
  );

  const token = randomBytes(24).toString("base64url");
  const hash = await sha256Hex(token);
  const login = "owner@staging.local";
  const sql = `.tmp/act-matrix.sql`;
  await writeFile(
    sql,
    `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
VALUES ('soa_matrix', '${login}', '${hash}', datetime('now', '+1 hour'), datetime('now'), 1);`,
  );
  execSync(
    `npx wrangler d1 execute etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST} --file ${sql}`,
    { stdio: "pipe" },
  );

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
      "SITE_OWNER_LOGIN:owner@staging.local",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* */
    }
    await sleep(250);
  }

  const steps = [];

  const cases = [
    {
      name: "token missing (password only)",
      body: { login: "owner@staging.local", token: "", password: "ValidPass-10" },
      expectStatus: 400,
      expectCode: "TOKEN_MISSING",
    },
    {
      name: "password too short",
      body: { login: "owner@staging.local", token, password: "short" },
      expectStatus: 400,
      expectCode: "PASSWORD_TOO_SHORT",
    },
    {
      name: "wrong token",
      body: { login: "owner@staging.local", token: "wrong-token-value", password: "ValidPass-10" },
      expectStatus: 400,
      expectCode: "TOKEN_INVALID",
    },
    {
      name: "login mismatch",
      body: { login: "other@staging.local", token, password: "ValidPass-10" },
      expectStatus: 403,
      expectCode: "LOGIN_MISMATCH",
    },
    {
      name: "full token file paste (comments + line)",
      body: {
        login: "owner@staging.local",
        token: `# comment\n# more\n${token}`,
        password: "ValidPass-10",
      },
      expectStatus: 200,
      expectCode: undefined,
    },
  ];

  for (const c of cases) {
    const r = await j("/api/auth/activate-site-owner", c.body);
    const pass =
      r.status === c.expectStatus && (c.expectCode ? r.data.code === c.expectCode : r.data.ok === true);
    steps.push({
      case: c.name,
      expected: `${c.expectStatus} ${c.expectCode ?? "ok"}`,
      actual: `${r.status} ${r.data.code ?? ""}`,
      errorText: r.data.error ?? r.data.message ?? "",
      pass,
    });
    if (c.expectStatus === 200) break;
  }

  await writeFile(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), steps }, null, 2));
  const failed = steps.filter((s) => !s.pass);
  console.log(
    JSON.stringify({
      ok: failed.length === 0,
      report: REPORT,
      failed: failed.length,
      note: "令牌未写入报告",
    }),
  );
  if (failed.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
