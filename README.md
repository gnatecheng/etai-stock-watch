# 观股记（etai-stock-watch）

港股收盘后筛选、可解释信号与 **PAPER 模拟交易**（邀请制）。独立 Cloudflare Worker + D1，与 [etais.dev](https://etais.dev) 主站及 `etai-access-log` / `etai-apk` **隔离**。

> **演示数据，非真实行情** — 默认 `DATA_PROVIDER=demo`，界面持久水印。  
> **未部署** — 本仓库仅含代码、迁移与占位 `wrangler.toml` 绑定。

## 状态

| 类别 | 说明 |
| --- | --- |
| 已实现并本地验证 | `npm run typecheck` / `build` / `test`（9/9）；`wrangler dev` + bootstrap + 跨用户自选隔离抽检 |
| 未做 | 云端部署、正式行情授权、子域名绑定、生产 Cron 启用 |

最近本地检查（代理执行）：`npm test` 9/9；`POST /api/admin/bootstrap` → EOD completed；筛选 3 只演示标的；用户 B 自选对管理员不可见。

详见 [docs/implementation-plan.md](./docs/implementation-plan.md)（已定 vs 待定）。

## 技术栈

- **API**：Cloudflare Workers + [Hono](https://hono.dev) + D1
- **UI**：Vite 原生 TS，简体中文，移动优先
- **测试**：Vitest

## 快速开始（本地）

```bash
npm ci
npm run db:migrate:local
npm run dev
```

1. 浏览器打开 Wrangler 提示的本地 URL（通常 `http://localhost:8787`）。
2. **开发引导**（非 production）：

```bash
curl -X POST http://localhost:8787/api/admin/bootstrap
```

3. 使用返回信息中的默认管理员（或 `wrangler.toml` / Secrets 中的 `BOOTSTRAP_*`）登录：`admin@local.dev` / `dev-admin-change-me`（**仅本地，部署前必须修改**）。
4. 管理员创建邀请：`POST /api/admin/invitations`（需先登录并带 CSRF 头）。

### 命令

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | Worker + Client TS 检查 |
| `npm run build` | 构建静态资源与 Worker |
| `npm test` | 单元测试 |
| `npm run db:migrate:local` | 本地 D1 迁移 |
| `npm run db:migrate:remote` | 远程 D1 迁移（需真实 `database_id`） |

## 配置（占位）

`wrangler.toml` 中：

- `database_id = "00000000-..."` — 部署前在 Cloudflare 创建 **新** D1 并替换
- `EOD_CRON_ENABLED = "false"` — 供应商与日历批准前保持关闭
- `DATA_PROVIDER = "demo"` — 生产须改为正式 provider 并配置 `MARKET_DATA_API_KEY`

可选 Secrets（勿提交）：`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`、`MARKET_DATA_API_KEY`

## 数据导入

管理员 `POST /api/admin/import/bars`，body 为 CSV：

```csv
symbol,trade_date,open,high,low,close,volume
DEMO:00700,2024-08-01,320.0,322.0,318.0,321.0,1000000
```

须先存在 `instruments` 记录；校验 OHLCV 与 provenance 快照。

## 安全说明

- 邀请令牌仅存哈希；邀请链接中的明文令牌**勿**写入日志/截图
- 写操作需 `Origin` 校验 + `X-CSRF-Token`
- 自选/模拟仓接口强制 `user_id` 归属
- 生产禁用 `/api/admin/bootstrap`

## 扩展（未实现）

 heavier  workloads 可引入 Queue 分批、R2 原始日线归档、Durable Objects 协调 — 首版 intentionally 仅 D1 + Worker。

## 免责声明

本工程为技术演示，**不构成投资建议**，不承诺收益。模拟成交规则见 `src/paper/engine.ts`（信号日后下一可交易 Session 开盘价）。
