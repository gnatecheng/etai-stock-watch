# 需求 → 测试 → 断言 → 结果映射

执行时间以本地代理最后一次 `npm test` / `npm run acceptance` 为准。  
**24/24 单元/集成用例通过 ≠ 全部产品能力已上线**（见【未支持】列）。

| 需求 | 测试文件 / 用例 | 关键断言 | 类型 |
| --- | --- | --- | --- |
| 显式日历 fail-closed | `calendar.test.ts` missing db | `assertCalendarCoverage` false | 自动 ✅ |
| 休市 EOD 跳过 | `eod-calendar.sqlite.test.ts` skips closed | status `skipped` | 自动 ✅ |
| 半日市日历存在 | `eod-calendar.sqlite.test.ts` half-day row | session `half` | 自动 ✅ |
| 缺日历 EOD | `eod-calendar.sqlite.test.ts` fail-closed | status `failed` | 自动 ✅ |
| 下一 session 前 pending | `paper-pending-retry.sqlite.test.ts` | status pending → filled | 自动 ✅ |
| 成交日 > 信号日 | `paper-pending-retry` + `paper-engine.test.ts` | open on 2024-08-29 | 自动 ✅ |
| 幂等键 UNIQUE | `d1-paper.sqlite.test.ts` idempotent | same orderId | 自动 ✅ |
| 资金不足 | `d1-paper.sqlite.test.ts` concurrent | code INSUFFICIENT_FUNDS | 自动 ✅ |
| 费用生效日 | `fees.test.ts` expired schedule | total 0 | 自动 ✅ |
| 整手 | `d1-paper` INVALID_LOT path / engine | roundLots | 自动 ✅ |
| 生产 demo 阻断 | `env-guards.test.ts` | providerReady false | 自动 ✅ |
| 默认凭据生产拒绝 | `env-guards.test.ts` | rejectDevCredentialsInProd | 自动 ✅ |
| 20MA 合成 buy | `demo-scenario-ma.test.ts` | direction buy | 自动 ✅ |
| 跨用户自选 | `integration-regression.mjs` | admin wl 0, user wl 1 | 自动 ✅ |
| 非管理员 jobs 403 | `integration-regression.mjs` | HTTP 403 | 自动 ✅ |
| EOD 通知去重 | `acceptance-walkthrough.mjs` | count unchanged | 自动 ✅ |
| UI 买入确认控件 | `acceptance-walkthrough.mjs` | `[data-confirm]` 存在 | 自动 ✅ |
| UI 自选空/非空 | walkthrough accept-01/02 | 截图 | 人工抽检 📷 |
| UI 站内提醒页 | walkthrough accept-07 | 非账户页 | 人工抽检 📷 |
| 生产 bootstrap | 仅 `APP_ENV=production` 403 | 无自动生产环境 | 阻断 🛑 |
| 正式 vendor | provider none | fail-closed | 阻断 🛑 |
| 并发两笔不同幂等键抢资金 | 未做压力 harness | 仅条件 UPDATE 单测 | 部分 ⚠️ |

## 重复成交说明（上轮两笔同价）

- **根因**：`capture-ui.mjs` 在 Playwright 之外额外 `fetch` 了一次 `paper/confirm`，且使用时间戳幂等键 `screenshot-demo-buy-${Date.now()}`，与 UI 使用的 `${signalId}-${tradeDate}` 不同 → **两笔合法不同订单**，非 UNIQUE 失效。
- **约束**：`paper_orders (user_id, idempotency_key)` UNIQUE；重复提交相同键返回同一 `orderId`，`paper_trades` 仍一条（见 walkthrough 日志 `tradeCount=1`）。
- **本轮**：验收脚本禁止额外随机幂等键；仅 UI 确认 + 同键重试成交。

## 命令

```bash
npm run typecheck
npm test                    # 期望 24 passed
npm run test:integration
npm run acceptance          # 截图 + accept-*.png + walkthrough.log
```
