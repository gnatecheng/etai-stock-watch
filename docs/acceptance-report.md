# 观股记 MVP 验收报告（逐项证据）

> **待产品复验 · 未合并 · Agent 未远程部署** · 分支 `cursor/etai-stock-watch-mvp-7d54` · [PR #1](https://github.com/gnatecheng/etai-stock-watch/pull/1)

## 1. 自动化命令（本地）

```bash
npm run typecheck          # 通过
npm test                   # 51 passed（含 fin-screener.sqlite.test.ts）
npm run test:import-machine    # 11/11 → import-machine-http-report.json
npm run test:financial-screen  # financial-screener-http-report.json
npm run test:capacity        # capacity-500x3y-report.json（910 情景交易日，非官方历）
npm run test:integration
npm run test:production-gates
npm run acceptance
npm run package:staging      # staging zip + sha256
```

矩阵：[acceptance-matrix.md](./acceptance-matrix.md)

## 2. 导入机 HTTP（替换原 404-only 日志）

- 报告：`/opt/cursor/artifacts/import-machine-http-report.json`
- 日志：`/opt/cursor/artifacts/import-machine-http.log`（**不含** Bearer 密钥）
- 覆盖：无凭据/错凭据/仅 Cookie 401、失败 validate 不 publish、stage 重放、成功 validate+publish、重复 publish 幂等

## 3. 容量实测（500 标的 × 910 情景交易日）

- 报告：`/opt/cursor/artifacts/capacity-500x3y-report.json`
- JSONL：`/opt/cursor/artifacts/capacity-synthetic-bars.jsonl`（`jsonlBytesActual` **62844600**）
- SQLite：`/opt/cursor/artifacts/capacity-500x3y.sqlite`（**455000** bars、**500** instruments、`page_count` 见报告）
- **声明**：910 为脚本工作日计数（2021-01-04..2024-06-28），**非**港交所官方三年交易日

## 4. 财务筛选（本地合成 + 生产 fail-closed）

- 已映射且可筛（有 `announced_at`）：`operating_revenue`、`net_profit_attr_parent`、`basic_eps`、`roe`、`gross_margin`
- **未映射**（capabilities `notMapped`）：`pe_ttm`、`pb`、`market_cap` — 不伪造公告日/PE/TTM
- 本地 HTTP：`/opt/cursor/artifacts/financial-screener-http-report.json`（导入 financial 批次后 `supported: true`）
- 生产 staging 壳：`DATA_DISTRIBUTION_LICENSED=false` → HTTP `supported: false`（不阻塞壳部署）

## 5. UI 截图与买卖 EOD

来源：`/opt/cursor/artifacts/acceptance-walkthrough.log`

- 筛选：`screen-01` … `screen-05`（路径见 matrix）
- 买卖链：`accept-01` … `accept-09`（pending → EOD fill → sell）

## 6. 生产门禁

来源：`/opt/cursor/artifacts/production-gates-http.log`

- bootstrap / bootstrap-acceptance → **403**
- 开发默认凭据登录 → **403**
- 生产 + demo：`paper/confirm`、`admin/eod/run` → **403**

## 7. Staging 安全部署包（父端上传）

说明：[deploy-staging-package.md](./deploy-staging-package.md) · 构建 commit **`f562774a843e`**

| 产物 | 路径 |
|------|------|
| 展开目录 | `/opt/cursor/artifacts/staging-deploy-bundle/` |
| ZIP | `/opt/cursor/artifacts/etai-stock-watch-staging-f562774a843e.zip` |
| SHA256 | `2d41e8e555b68a31bb82373ff4a925699b8bcfda3d0abe762715a97144b037d0`（见 `staging-deploy-sha256.txt`） |
| 元数据 | `/opt/cursor/artifacts/staging-deploy-report.json` |

迁移顺序：`0001_initial.sql` → `0002_import_financial.sql`

## 8. workflow_dispatch（未跑远程 Actions）

`/opt/cursor/artifacts/workflow-dispatch-evidence.json` — `collector-ci.yml` 仅 `workflow_dispatch`，默认无 `schedule`

## 9. Staging DEMO（可登录测试）

- 交接：`docs/staging-demo-handoff.md`
- 配置：`wrangler.staging-demo.toml`
- HTTP 证据：`/opt/cursor/artifacts/staging-demo-http-report.json`（11/11，**不含**令牌）
- 移动端截图：`staging-demo-01-screener-mobile.png` … `03-account-demo-console.png`
- 父端 DEMO 部署 ZIP：`etai-stock-watch-staging-demo-f5141ff0b8c6.zip` · SHA256 `7186e5ab832cadb0c2e0744f65e016c0fcb2f5b375a1d84f8264c8b20081d44b`

**未声称**远程站主已完成激活；父端需按交接生成 0600 令牌文件 + D1 哈希。

## 10. 未覆盖

- 远程 D1 多副本并发
- 正式行情供应商与 `DATA_DISTRIBUTION_LICENSED=true`
- 远程 Cron / AKShare 实采
- 修改 etai 主站既有 Worker/D1
