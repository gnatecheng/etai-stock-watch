/**
 * 激活页表单提交回归（Playwright）：字段/校验/持久错误，不含真实秘密
 */
import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:8787";
const PERSIST = ".wrangler/activation-ui";
const CONFIG = "wrangler.staging-demo.toml";
const REPORT = "/opt/cursor/artifacts/activation-ui-regression.json";

async function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

let dev;
const steps = [];

async function main() {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await rm(PERSIST, { recursive: true, force: true });
  execSync("npm run build", { stdio: "pipe", cwd: process.cwd() });
  execSync(
    `npx wrangler d1 migrations apply etai-stock-watch-staging-db --local --config ${CONFIG} --persist-to ${PERSIST}`,
    { stdio: "pipe" },
  );

  const token = randomBytes(32).toString("base64url");
  const hash = await sha256Hex(token);
  const login = "owner@staging.local";
  const sql = `.tmp/act-ui.sql`;
  await writeFile(
    sql,
    `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
VALUES ('soa_ui', '${login}', '${hash}', datetime('now', '+2 hours'), datetime('now'), 1);`,
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
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* */
    }
    await sleep(250);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const actForm = page.locator("#activateForm");
  if ((await actForm.count()) === 0) {
    const link = page.locator("#toActivate");
    if (await link.count()) await link.click();
  }
  await page.waitForSelector("#activateForm input[name=login]", { timeout: 20000 });

  async function captureActivateRequest(runSubmit) {
    const respP = page.waitForResponse(
      (r) => r.url().includes("/api/auth/activate-site-owner") && r.request().method() === "POST",
      { timeout: 15000 },
    );
    await runSubmit();
    const resp = await respP;
    const req = resp.request();
    const body = JSON.parse(req.postData() || "{}");
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status(), body, data };
  }

  // 1) 令牌有值、密码空：先客户端校验（持久 #activateError），再 API 等价
  await page.fill('input[name="login"]', "owner@staging.local");
  await page.fill('input[name="token"]', token);
  await page.fill('input[name="password"]', "");
  await page.evaluate(() => {
    const f = document.getElementById("activateForm");
    if (f instanceof HTMLFormElement) f.requestSubmit();
  });
  await sleep(200);
  const err1 = (await page.locator("#activateError").textContent())?.trim() ?? "";
  const errVisible1 = await page.locator("#activateError").isVisible();
  steps.push({
    case: "UI password empty before API",
    inlineError: err1,
    inlineErrorVisible: errVisible1,
    pass: errVisible1 && err1.includes("PASSWORD_TOO_SHORT"),
  });

  // 若客户端已拦截，API 可能未调用；用 API 直接验证 f5141ff 等价 JSON
  const legacyEmptyPass = await fetch(`${BASE}/api/auth/activate-site-owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: "owner@staging.local",
      token,
      password: "",
    }),
  });
  const legacyJson = await legacyEmptyPass.json();
  steps.push({
    case: "API password empty string",
    network: `${legacyEmptyPass.status} ${legacyJson.code}`,
    errorText: legacyJson.error,
    pass: legacyEmptyPass.status === 400 && legacyJson.code === "PASSWORD_TOO_SHORT",
  });

  // 2) 错误令牌
  const r2 = await captureActivateRequest(async () => {
    await page.fill('input[name="password"]', "ValidPass-Word-10");
    await page.fill('input[name="token"]', "not-the-real-token");
    await page.click('#activateForm button[type="submit"]');
  });
  const err2 = await page.locator("#activateError").textContent();
  await sleep(3000);
  const errStill2 = await page.locator("#activateError").textContent();
  steps.push({
    case: "wrong token persistent error",
    network: `${r2.status} ${r2.data?.code}`,
    errorText: r2.data?.error,
    inlineError: err2,
    persistentAfter3s: errStill2 === err2 && !!errStill2,
    pass:
      r2.status === 400 &&
      r2.data?.code === "TOKEN_INVALID" &&
      !!err2?.includes("TOKEN_INVALID") &&
      errStill2 === err2,
  });

  // 3) 成功路径（单行令牌 + 密码）
  await page.goto(BASE, { waitUntil: "networkidle" });
  const r3 = await captureActivateRequest(async () => {
    await page.fill('input[name="login"]', "owner@staging.local");
    await page.fill('input[name="token"]', token);
    await page.fill('input[name="password"]', "ValidPass-Word-10");
    await page.click('#activateForm button[type="submit"]');
  });
  steps.push({
    case: "happy path single-line token",
    network: `${r3.status}`,
    pass: r3.status === 200 && r3.data?.ok === true,
  });

  await browser.close();
  await writeFile(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), steps }, null, 2));
  const failed = steps.filter((s) => !s.pass);
  console.log(JSON.stringify({ ok: failed.length === 0, report: REPORT, failed: failed.length }));
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
