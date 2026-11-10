import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
const OUT = "/opt/cursor/artifacts";
const PERSIST = ".wrangler/staging-demo-shots";
const CONFIG = "wrangler.staging-demo.toml";

let dev;

async function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await rm(PERSIST, { recursive: true, force: true });
  execSync("npm run build:worker", { stdio: "pipe" });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST}`,
    { stdio: "pipe" },
  );
  const token = randomBytes(32).toString("base64url");
  const hash = await sha256Hex(token);
  const login = "screenshot-owner@staging.local";
  const sql = `.tmp/shot-act.sql`;
  await writeFile(
    sql,
    `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
VALUES ('soa_shot', '${login}', '${hash}', datetime('now', '+1 hour'), datetime('now'), 1);`,
  );
  execSync(
    `npx wrangler d1 execute etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST} --file ${sql}`,
    { stdio: "pipe" },
  );

  dev = spawn(
    "npx",
    ["wrangler", "dev", "--port", "8787", "--config", CONFIG, "--persist-to", PERSIST, "--var", "SITE_OWNER_LOGIN:screenshot-owner"],
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

  await fetch(`${BASE}/api/auth/activate-site-owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, login: "screenshot-owner", password: "Screenshot-Owner-10", displayName: "截图站主" }),
  });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "screenshot-owner", password: "Screenshot-Owner-10" }),
  });
  const loginBody = await loginRes.json();
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  await fetch(`${BASE}/api/admin/staging-demo/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, Origin: BASE },
  });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const tok = cookie.match(/esw_session=([^;]+)/)?.[1];
  if (tok) await page.context().addCookies([{ name: "esw_session", value: tok, url: BASE }]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/staging-demo-01-screener-mobile.png`, fullPage: true });
  await page.click('button[data-tab="financial"]');
  await sleep(400);
  await page.screenshot({ path: `${OUT}/staging-demo-02-financial-mobile.png`, fullPage: true });
  await page.click('button[data-tab="account"]');
  await sleep(400);
  await page.screenshot({ path: `${OUT}/staging-demo-03-account-demo-console.png`, fullPage: true });
  await browser.close();
  await writeFile(`${OUT}/staging-demo-screenshots.log`, `ok ${new Date().toISOString()} (no secrets logged)\n`);
  console.log(JSON.stringify({ ok: true, shots: ["staging-demo-01-screener-mobile.png", "staging-demo-02-financial-mobile.png", "staging-demo-03-account-demo-console.png"] }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
