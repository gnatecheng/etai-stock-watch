# 观股记 MVP 验收报告（PR #1 补强）

> 状态：**待验收 · 未合并 · 未部署**

## 执行命令与结果（实跑）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm test`（Vitest） | **19/19** 通过 |
| `npm run test:integration`（HTTP 回归） | 通过（bootstrap、401/403 边界、自选隔离、EOD→信号、模拟确认） |
| `npm run screenshots`（Playwright，已登录） | 5+1 张 PNG |

## 【自动化已验证】

- 日历：未写入 `calendar_hk` 的日期 **fail-closed**（不再 weekday 推断）
- 生产：`DATA_PROVIDER=demo` / 默认开发凭据登录 / bootstrap **代码级阻断**
- 模拟成交：信号日后下一 **可交易 session** 开盘价；无后续 bar → `pending`；禁止同日回填
- D1/SQLite：整手、费用、条件 `cash_cents >= cost` 更新、幂等键、资金不足拒绝
- 均线 20MA 演示策略：含非投资建议文案
- CSRF + 未登录 401 + 非管理员 403（HTTP 回归）

## 【人工抽检】

- 登录后移动截图（含水印）：见 `/opt/cursor/artifacts/ui-*.png`
- 信号页可展开理由、可点「确认模拟」；模拟仓页 PAPER 标识

## 【未支持 / 阻断（设计如此）】

- 生产无授权行情供应商 → 不产信号、不允许模拟成交
- 未配置显式港交所完整日历 → EOD/模拟 fail-closed
- 正式 vendor 接入、Cron 启用、子域名、部署

## 【仍需产品或用户决定】

- 港股行情供应商与邀请制分发授权
- Workers Free/Paid、`stocks.etais.dev` 是否启用
- 真实费率表与完整交易日历导入来源

## 缺陷修复摘要（本轮）

1. 日历运行时取消 weekday 猜测；成交路径联动 `calendar_hk`
2. `paperTradingAllowed` / 生产 demo 硬闸
3. 模拟单 `pending` 与条件资金更新（批处理）
4. UI：信号→确认模拟单；19 单元测试 + SQLite D1 + HTTP 回归
5. 登录后业务截图（Playwright）
