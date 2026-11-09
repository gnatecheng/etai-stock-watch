# 观股记 MVP 验收报告（逐项证据）

> **待验收 · 未合并 · 未部署** · 分支 `cursor/etai-stock-watch-mvp-7d54` · PR #1

## 1. 执行命令与原始输出

```bash
npm run typecheck   # 通过
npm run build       # 通过
npm test            # 24 passed（见下表，非“全覆盖”）
npm run test:integration
npm run acceptance  # 截图 accept-01..07 + acceptance-walkthrough.log
```

`npm test` 末行示例：`Tests  24 passed (24)` — 仅覆盖下表所列场景。

完整场景映射：[acceptance-matrix.md](./acceptance-matrix.md)

## 2. 【自动化已验证】— 日志摘录

来源：`/opt/cursor/artifacts/acceptance-walkthrough.log`

```
signals: count=1 buy=sig_… date=2024-08-28
UI confirm status: … 状态 pending … 幂等键 sig_…-2024-08-28
paper confirm #2 (same idempotency): … "status":"filled" … fill 由 UI 同键重试
fill_trade_date":"2024-08-29" … signalDate":"2024-08-28"
duplicate confirm: … tradeCount=1
EOD dedupe: notifications 1 -> 1
```

证明：**信号日 2024-08-28**，成交 **2024-08-29 开盘价 279.00**，非信号当日收盘。

数据来源：`POST /api/admin/bootstrap-acceptance` → 标签 `合成演示行情（ACCEPTANCE_SCENARIO）`

## 3. 【人工抽检】— 本轮截图（仅 accept-*）

| 文件 | 场景 |
| --- | --- |
| `accept-01-watchlist-empty.png` | 自选空态 |
| `accept-02-watchlist-filled.png` | 筛选页 UI 加入自选后 |
| `accept-03-signals-buy-reasons.png` | buy 信号 + 理由 + **确认模拟买入** 按钮 |
| `accept-04-after-confirm-pending.png` | UI 确认后 pending 文案 |
| `accept-05-paper-pending.png` | 模拟仓 pending 订单 |
| `accept-06-paper-filled-next-session.png` | 导入下一 session 后 filled |
| `accept-07-notifications-inapp.png` | **站内提醒** 独立 Tab |

路径：`/opt/cursor/artifacts/accept-*.png`

## 4. 上轮“两笔同价”说明

| 项 | 说明 |
| --- | --- |
| 原因 | 旧 `capture-ui.mjs` 用 **随机幂等键** API 下单，与 UI 的 `sigId-tradeDate` 并存 → 两笔不同合法订单 |
| 约束 | `UNIQUE(user_id, idempotency_key)`；同键重复确认不增 `paper_trades` |
| 本轮 | 仅 walkthrough 同键；日志 `tradeCount=1` |

## 5. 【未支持 / 安全阻断】

- 生产 `APP_ENV=production`：bootstrap / demo 供应商 / 默认凭据（`env-guards.test.ts`）
- 无授权 vendor：`DATA_PROVIDER=none` → EOD/模拟拒绝
- 完整港交所日历、正式部署、外发提醒

## 6. 【仍需产品决定】

行情授权、Workers 套餐、子域名。
