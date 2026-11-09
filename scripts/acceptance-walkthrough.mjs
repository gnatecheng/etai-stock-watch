import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
const ACCEPTANCE_NEXT_SESSION = "2024-08-29";
const ACCEPTANCE_SELL_SIGNAL_DATE = "2024-09-06";
const ACCEPTANCE_SELL_NEXT_SESSION = "2024-09-09";

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

async function waitReady() {
  const start = Date.now();
  while (Date.now() - start < 25000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("wrangler dev not ready on 8787");
}

let dev;

async function main() {
  await mkdir(OUT, { recursive: true });
  await writeFile(LOG, `# acceptance walkthrough ${new Date().toISOString()}\n`);

  dev = spawn("npx", ["wrangler", "dev", "--port", "8787"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  await waitReady();

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

  const turnBlk = await fetch(`${BASE}/api/screener/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ conditions: [{ type: "turnover", minHkd: 1 }] }),
  });
  await log(`screener API turnover when unsupported: ${turnBlk.status} ${JSON.stringify(await turnBlk.json())}`);
  if (turnBlk.status !== 400) throw new Error("Expected 400 for turnover in DEMO");

  await page.click('button[data-tab="screener"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/screen-01-screener-form.png`, fullPage: true });
  await page.locator('[data-f="priceEnabled"]').check();
  await page.locator('[data-f="priceMin"]').fill("250");
  await page.locator('[data-f="priceMax"]').fill("300");
  await page.locator('[data-f="maEnabled"]').check();
  await page.locator('[data-screener-run]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/screen-02-screener-hits.png`, fullPage: true });
  const hitCount = await page.locator("[data-screener-hit]").count();
  await log(`screener UI hits: ${hitCount}`);
  if (hitCount < 1) throw new Error("Expected screener hits for acceptance DEMO");

  await page.locator('[data-f="priceMin"]').fill("400");
  await page.locator('[data-f="priceMax"]').fill("500");
  await page.locator('[data-screener-run]').click();
  await page.waitForTimeout(800);
  const hitCount2 = await page.locator("[data-screener-hit]").count();
  await log(`screener after tighten (min 400): hits=${hitCount2}`);
  if (hitCount2 > 0) throw new Error("Expected empty after price tighten");

  await page.locator('[data-screener-reset]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-f="priceEnabled"]').check();
  await page.locator('[data-f="priceMin"]').fill("250");
  await page.locator('[data-f="priceMax"]').fill("300");
  await page.locator('[data-screener-run]').click();
  await page.waitForTimeout(800);
  await page.locator("[data-screener-hit] [data-watch]").first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/screen-03-screener-watchlist-add.png`, fullPage: true });

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

  const idemKey = `${buy.id}-${buy.trade_date}`;
  const pendingRes = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: buy.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: buy.trade_date,
      idempotencyKey: idemKey,
    }),
  });
  const pendingJson = await pendingRes.json();
  await log(`paper confirm idempotent: ${JSON.stringify(pendingJson)}`);
  if (pendingJson.status !== "pending") throw new Error("Expected pending after user confirm");

  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/accept-05-paper-pending.png`, fullPage: true });

  const csvBuyFill = `symbol,trade_date,open,high,low,close,volume\nDEMO:00700,${ACCEPTANCE_NEXT_SESSION},279.0,281.0,278.0,280.5,650000`;
  const imp = await fetch(`${BASE}/api/admin/import/bars`, {
    method: "POST",
    headers: { ...hdr(cookie, csrf), "Content-Type": "text/plain" },
    body: csvBuyFill,
  });
  await log(`import buy fill session: ${imp.status} ${await imp.text()}`);

  const eodBuy = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ tradeDate: ACCEPTANCE_NEXT_SESSION }),
  });
  const eodBuyJson = await eodBuy.json();
  await log(`EOD buy fill day: ${eodBuy.status} ${JSON.stringify(eodBuyJson)}`);
  if ((eodBuyJson.pending?.filled ?? 0) < 1) throw new Error("EOD should fill buy pending");

  const reconfirm = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: buy.instrument_id,
      side: "buy",
      quantity: 100,
      signalTradeDate: buy.trade_date,
      idempotencyKey: idemKey,
    }),
  });
  const reconfirmJson = await reconfirm.json();
  await log(`paper confirm after EOD (no fill via API): ${JSON.stringify(reconfirmJson)}`);
  if (reconfirmJson.status !== "filled") throw new Error("Order should be filled after EOD not API");

  const tradesAfterBuy = await (await fetch(`${BASE}/api/paper/positions`, { headers: { Cookie: cookie } })).json();
  await log(`after buy EOD: cash=${tradesAfterBuy.account?.cash_cents} pos=${JSON.stringify(tradesAfterBuy.positions)}`);

  await page.reload();
  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/accept-06-paper-filled-next-session.png`, fullPage: true });

  const csvSellPath = `symbol,trade_date,open,high,low,close,volume
DEMO:00700,2024-08-30,280.5,284.0,279.0,283.0,660000
DEMO:00700,2024-09-02,283.0,287.0,282.0,286.0,670000
DEMO:00700,2024-09-03,286.0,289.0,285.0,288.0,680000
DEMO:00700,2024-09-04,288.0,290.0,287.0,289.0,690000
DEMO:00700,2024-09-05,289.0,290.0,288.0,289.5,700000
DEMO:00700,${ACCEPTANCE_SELL_SIGNAL_DATE},289.0,290.0,265.0,268.0,750000`;
  await fetch(`${BASE}/api/admin/import/bars`, {
    method: "POST",
    headers: { ...hdr(cookie, csrf), "Content-Type": "text/plain" },
    body: csvSellPath,
  });
  const eodSellSig = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ tradeDate: ACCEPTANCE_SELL_SIGNAL_DATE }),
  });
  const sellSigJson = await eodSellSig.json();
  await log(`EOD sell signal day: ${eodSellSig.status} signals=${sellSigJson.signalsCreated}`);

  await page.click('button[data-tab="signals"]');
  await page.waitForTimeout(800);
  const sellBtn = page.locator('[data-confirm][data-side="sell"]').first();
  if ((await sellBtn.count()) === 0) throw new Error("No sell confirm after EOD");
  await sellBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/accept-08-signals-sell-confirm.png`, fullPage: true });

  const sigRes2 = await fetch(`${BASE}/api/signals`, { headers: { Cookie: cookie } });
  const sell = (await sigRes2.json()).items?.find((s) => s.direction === "sell");
  const sellKey = `${sell.id}-${sell.trade_date}`;
  const sellPending = await fetch(`${BASE}/api/paper/confirm`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({
      instrumentId: sell.instrument_id,
      side: "sell",
      quantity: 100,
      signalTradeDate: sell.trade_date,
      idempotencyKey: sellKey,
    }),
  });
  const sellPendingJson = await sellPending.json();
  await log(`sell paper pending: ${JSON.stringify(sellPendingJson)}`);

  await fetch(`${BASE}/api/admin/import/bars`, {
    method: "POST",
    headers: { ...hdr(cookie, csrf), "Content-Type": "text/plain" },
    body: `symbol,trade_date,open,high,low,close,volume\nDEMO:00700,${ACCEPTANCE_SELL_NEXT_SESSION},268.0,270.0,266.0,267.5,720000`,
  });
  const eodSellFill = await fetch(`${BASE}/api/admin/eod/run`, {
    method: "POST",
    headers: hdr(cookie, csrf),
    body: JSON.stringify({ tradeDate: ACCEPTANCE_SELL_NEXT_SESSION }),
  });
  const eodSellFillJson = await eodSellFill.json();
  await log(`EOD sell fill: ${JSON.stringify(eodSellFillJson)}`);
  if ((eodSellFillJson.pending?.filled ?? 0) < 1) throw new Error("EOD should fill sell pending");

  const afterSell = await (await fetch(`${BASE}/api/paper/positions`, { headers: { Cookie: cookie } })).json();
  await log(`after sell EOD: cash=${afterSell.account?.cash_cents} pos=${JSON.stringify(afterSell.positions)} trades=${afterSell.trades?.length}`);
  if ((afterSell.positions?.length ?? 0) > 0) throw new Error("Position should be flat after sell");

  await page.reload();
  await page.click('button[data-tab="paper"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/accept-09-paper-after-sell.png`, fullPage: true });

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

main()
  .catch(async (e) => {
    await appendFile(LOG, `FAIL ${e.message}\n`);
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    if (dev) dev.kill("SIGTERM");
  });
