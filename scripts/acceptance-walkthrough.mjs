import { chromium } from "playwright-core";
import { mkdir, writeFile, appendFile } from "node:fs/promises";

const BASE = process.env.ESW_BASE_URL ?? "http://127.0.0.1:8787";
const OUT = "/opt/cursor/artifacts";
const LOG = `${OUT}/acceptance-walkthrough.log`;

async function log(line) {
  const row = `${new Date().toISOString()} ${line}\n`;
  await appendFile(LOG, row);
  console.log(line);
}

function hdr(cookie, csrf, extra = {}) {
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    ...(csrf ? { "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:8787" } : {}),
    ...extra,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await writeFile(LOG, `# acceptance walkthrough ${new Date().toISOString()}\n`);

  const boot = await fetch(`${BASE}/api/admin/bootstrap-acceptance`, { method: "POST" });
  const bootJson = await boot.json();
  await log(`bootstrap-acceptance: ${boot.status} ${JSON.stringify(bootJson.eod ?? bootJson)}`);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@local.dev", password: "dev-admin-change-me" }),
  });
  const loginBody = await loginRes.json();
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  const csrf = loginBody.csrfToken;

  const sigRes = await fetch(`${BASE}/api/signals`, { headers: { Cookie: cookie } });
  const sigJson = await sigRes.json();
  const buy = (sigJson.items ?? []).find((s) => s.direction === "buy");
  await log(`signals: count=${sigJson.items?.length ?? 0} buy=${buy?.id ?? "none"} date=${buy?.trade_date ?? "-"}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const token = cookie.match(/esw_session=([^;]+)/)?.[1];
  if (token) await context.addCookies([{ name: "esw_session", value: token, url: "http://127.0.0.1:8787" }]);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });

  await page.click('button[data-tab="watchlist"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/accept-01-watchlist-empty.png`, fullPage: true });
  await log("screenshot accept-01-watchlist-empty");

  await page.click('button[data-tab="screener"]');
  await page.click('button[data-watch]', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.click('button[data-tab="watchlist"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/accept-02-watchlist-filled.png`, fullPage: true });
  await log("screenshot accept-02-watchlist-filled UI add");

  await page.click('button[data-tab="signals"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/accept-03-signals-buy-reasons.png`, fullPage: true });

  const confirm = page.locator("[data-confirm]").first();
  if ((await confirm.count()) === 0) throw new Error("No buy/sell confirm button — 验收失败");
  await confirm.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/accept-04-after-confirm-pending.png`, fullPage: true });

  const statusText = await page.locator("[data-confirm-status]").first().textContent();
  await log(`UI confirm status: ${statusText}`);

  const pendingRes = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: buy.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: buy.trade_date,
      idempotencyKey: `${buy.id}-${buy.trade_date}`,
    }),
  });
  const pendingJson = await pendingRes.json();
  await log(`paper confirm #1 (no next bar): ${JSON.stringify(pendingJson)}`);
  if (pendingJson.status !== "pending") await log("WARN expected pending before import");

  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/accept-05-paper-pending.png`, fullPage: true });

  const csv = `symbol,trade_date,open,high,low,close,volume\nDEMO:00700,2024-08-29,279.0,281.0,278.0,280.5,650000`;
  const imp = await fetch(`${BASE}/api/admin/import/bars`, {
    method: "POST",
    headers: { ...hdr(cookie, csrf), "Content-Type": "text/plain" },
    body: csv,
  });
  await log(`import next session: ${imp.status} ${await imp.text()}`);

  const fillRes = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: buy.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: buy.trade_date,
      idempotencyKey: `${buy.id}-${buy.trade_date}`,
    }),
  });
  const fillJson = await fillRes.json();
  await log(`paper confirm #2 (same idempotency): ${JSON.stringify(fillJson)}`);
  if (fillJson.status !== "filled") throw new Error("Expected filled after next session import");
  if (fillJson.orderId !== pendingJson.orderId) throw new Error("Idempotency order id mismatch");

  const orders = await (await fetch(`${BASE}/api/paper/orders`, { headers: { Cookie: cookie } })).json();
  await log(`orders: ${JSON.stringify(orders.items)}`);

  const dup = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: buy.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: buy.trade_date,
      idempotencyKey: `${buy.id}-${buy.trade_date}`,
    }),
  });
  const dupJson = await dup.json();
  const trades = await (
    await fetch(`${BASE}/api/paper/positions`, { headers: { Cookie: cookie } })
  ).json();
  await log(`duplicate confirm: ${JSON.stringify(dupJson)} tradeCount=${trades.trades?.length}`);
  if ((trades.trades?.length ?? 0) > 1) throw new Error("Duplicate trades — 重复扣款风险");

  await page.reload();
  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/accept-06-paper-filled-next-session.png`, fullPage: true });

  await page.click('button[data-tab="notifications"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/accept-07-notifications-inapp.png`, fullPage: true });

  const eod2 = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ tradeDate: buy.trade_date }),
  });
  const ntfBefore = (await (await fetch(`${BASE}/api/notifications`, { headers: { Cookie: cookie } })).json()).items
    .length;
  await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ tradeDate: buy.trade_date }),
  });
  const ntfAfter = (await (await fetch(`${BASE}/api/notifications`, { headers: { Cookie: cookie } })).json()).items
    .length;
  await log(`EOD dedupe: notifications ${ntfBefore} -> ${ntfAfter} (eod2=${eod2.status})`);
  if (ntfAfter > ntfBefore) throw new Error("Notification dedupe failed");

  await browser.close();
  await log("DONE ok");
}

main().catch(async (e) => {
  await appendFile(LOG, `FAIL ${e.message}\n`);
  console.error(e);
  process.exit(1);
});
