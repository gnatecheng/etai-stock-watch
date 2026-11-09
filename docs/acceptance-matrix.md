# 需求 → 测试 → 断言 → 结果映射

> 最后一轮：`npm test` **29 passed**；`npm run test:integration`；`npm run test:production-gates`；`npm run acceptance`。  
> **通过数 ≠ 全部产品能力已上线**（见【结果】列）。

| # | 场景 | 预期 | 实际 | 测试 / 断言 | 日志 / 截图 | 结果 |
|---|------|------|------|-------------|-------------|------|
| 1 | 用户确认 → pending（不 API 成交） | `confirm` 仅 pending | pending | `paper-pending-retry.sqlite.test.ts` | — | ✅ |
| 2 | EOD 推进已确认单 | 下一 session 行情入库后 filled | `pending.filled≥1` | walkthrough + `pending-eod` | `/opt/cursor/artifacts/acceptance-walkthrough.log` | ✅ |
| 3 | 禁止同日/前瞻回填 | fillDate > signalDate | 断言 trade_date | `paper-engine.test.ts`, sell test | — | ✅ |
| 4 | 重复 EOD / 并发填单 | 至多一笔成交 | `job_runs` fill 锁 | `paper-eod-concurrent.sqlite.test.ts` | — | ✅ |
| 5 | 资金争用 | 第二单 INSUFFICIENT_FUNDS | rejected | `d1-paper`, concurrent test | — | ✅ |
| 6 | 卖出门槛 / 超卖 | INSUFFICIENT_SHARES | rejected | `paper-eod-concurrent` | — | ✅ |
| 7 | 卖出闭环 | 现金↑ 持仓清零 | pos.length=0 | `paper-sell-eod.sqlite.test.ts` | accept-08/09 | ✅ |
| 8 | 合成 sell 20MA | 2024-09-06 sell | direction sell | `demo-scenario-ma.test.ts` | — | ✅ |
| 9 | 日历 fail-closed | 缺日历 failed | status failed | `eod-calendar.sqlite.test.ts` | — | ✅ |
| 10 | 休市 / 半日市 | closed skip / half 存在 | 单测 | 同上 | — | ✅ |
| 11 | 跨用户隔离 | 自选 / jobs 403 | HTTP | `integration-regression.mjs` | — | ✅ |
| 12 | 未登录 401 | screener 401 | HTTP 401 | integration | — | ✅ |
| 13 | 生产 bootstrap | 403 | HTTP 403 | `test:production-gates` | `production-gates-http.log` | ✅ |
| 14 | 生产 dev 凭据 | 403 | HTTP 403 | 同上 | 同上 | ✅ |
| 15 | 生产 demo 纸交易 / EOD | 403 BLOCKED | HTTP 403 | 同上（真实 wrangler `APP_ENV=production`） | 同上 | ✅ |
| 16 | 供应商未授权 | provider none fail | 单元 | `env-guards.test.ts` | — | ✅ |
| 17 | UI 买入理由 → 确认 | 截图 + pending 文案 | Playwright | acceptance | accept-03/04 | ✅ |
| 18 | EOD 通知幂等 | count 不变 | walkthrough | acceptance-walkthrough.log | ✅ |
| 19 | 真实 Cloudflare D1 并发 | — | 未跑 remote D1 | — | — | 未覆盖 🛑 |
| 20 | 正式行情 vendor 生产 EOD | fail-closed | 仅单测 + 生产 HTTP 阻断 demo | `env-guards` | — | 部分 ⚠️ |

## EOD 已确认订单语义（本轮）

1. **不从信号自动建单**；仅用户/UI/API `POST /api/paper/confirm` 创建 `pending`（或幂等返回已有单）。
2. **`runEodPipeline(tradeDate)`** 在信号批次之后调用 `processPendingPaperOrdersOnEod`：当 `fillDate = 下一可交易 session` 且 `fillDate ≤ tradeDate`、行情已入库时，以 **次日开盘价** 成交。
3. **幂等**：订单 `status` 迁移 + `job_runs.idempotency_key = paper|fill|{orderId}` 互斥；重复 EOD 不重复扣款/成交。
4. **重试**：EOD 任务键已完成时仍执行 pending 扫描（信号跳过，填单可补跑）。
5. **安全**：缺行情保持 pending；缺/无效日历、休市、供应商未就绪时 EOD 失败且不填单。

## 并发测试环境说明

| 环境 | 证明范围 | 限制 |
|------|----------|------|
| SQLite（`better-sqlite3` 模拟 D1） | 填单逻辑、条件 UPDATE、`job_runs` UNIQUE 锁 | 非真实 D1 时钟/多 Worker 副本 |
| `wrangler dev` + 本地 D1 | HTTP 集成、验收 UI、生产 vars | 单进程 miniflare |
| `APP_ENV=production` + `wrangler.production-test.toml` | bootstrap/凭据/demo 纸交易/EOD HTTP 403 | 不连接正式 vendor |

## 命令

```bash
npm run typecheck
npm test                         # 29 passed
npm run test:integration
npm run test:production-gates    # 日志 → /opt/cursor/artifacts/production-gates-http.log
npm run acceptance               # accept-*.png + acceptance-walkthrough.log
```

## 截图索引

| 文件 | 说明 |
|------|------|
| `accept-01` … `accept-07` | 自选 / 信号 / pending / filled / 提醒 |
| `accept-08-signals-sell-confirm.png` | 合成行情卖出信号 + UI 确认 |
| `accept-09-paper-after-sell.png` | EOD 卖出后空仓 |
