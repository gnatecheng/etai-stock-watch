import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.ESW_BASE_URL ?? "http://127.0.0.1:8787";
const OUT = "/opt/cursor/artifacts";

async function main() {
  await mkdir(OUT, { recursive: true });
  await fetch(`${BASE}/api/admin/bootstrap`, { method: "POST" });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  });
  const loginBody = await loginRes.json();
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const tokenMatch = setCookie.match(/esw_session=([^;]+)/);
  for (const d of ["2024-08-06", "2024-08-12", "2024-08-19", "2024-08-26", "2024-09-02"]) {
    await fetch(`${BASE}/api/admin/eod/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: setCookie?.split(";")[0] ?? "",
        "X-CSRF-Token": loginBody.csrfToken,
        Origin: "http://127.0.0.1:8787",
      },
      body: JSON.stringify({ tradeDate: d }),
    });
  }
  const paperRes = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: setCookie?.split(";")[0] ?? "",
      "X-CSRF-Token": loginBody.csrfToken,
      Origin: "http://127.0.0.1:8787",
    },
    body: JSON.stringify({
      instrumentId: "inst_demo_00700",
      side: "buy",
      quantity: 100,
      signalTradeDate: "2024-08-15",
      idempotencyKey: `screenshot-demo-buy-${Date.now()}`,
    }),
  });
  const paperJson = await paperRes.json();
  console.log("paper-confirm", paperJson);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  if (tokenMatch) {
    await context.addCookies([
      { name: "esw_session", value: tokenMatch[1], url: BASE.replace(/\/$/, "") },
    ]);
  }
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const shots = [
    ["ui-logged-in-screener.png", "screener"],
    ["ui-signals-reasons.png", "signals"],
    ["ui-watchlist.png", "watchlist"],
    ["ui-paper-account.png", "paper"],
    ["ui-notifications.png", "account"],
  ];

  for (const [file, tab] of shots) {
    await page.click(`button[data-tab="${tab}"]`);
    await page.waitForTimeout(700);
    if (tab === "signals") {
      const btn = page.locator("[data-confirm]").first();
      if (await btn.count()) {
        page.once("dialog", (d) => d.accept());
        await btn.click();
        await page.waitForTimeout(500);
        await page.click(`button[data-tab="paper"]`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/ui-paper-after-confirm.png`, fullPage: true });
        await page.click(`button[data-tab="signals"]`);
      }
    }
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  }

  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/ui-paper-after-confirm.png`, fullPage: true });

  await browser.close();
  console.log(JSON.stringify({ ok: true, shots }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
