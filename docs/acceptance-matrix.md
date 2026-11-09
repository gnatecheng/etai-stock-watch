# 验收矩阵（逐项）

> 分支 `cursor/etai-stock-watch-mvp-7d54` · `npm test` **51 passed** · 未合并 · Agent 未远程部署  
> 证据根目录：`/opt/cursor/artifacts/`

| # | 场景 | 预期 | 实际 | 测试/断言 | 日志/截图 | 结果 |
|---|------|------|------|-----------|-----------|------|
| A1 | 用户条件筛选 AND | POST run | hits+理由 | screener-* + walkthrough | `screen-01`..`05` | ✅ |
| A2 | 成交额 DEMO 禁用 | 400 | TURNOVER_NOT_SUPPORTED | integration + walkthrough | acceptance-walkthrough.log | ✅ |
| A3 | 涨跌幅/非法输入 | toast+400 | UI | walkthrough | `screen-04-screener-invalid-input.png` | ✅ |
| A4 | 零命中/重置 | hits=0 | tighten | walkthrough | `screen-05-screener-zero-hits.png` | ✅ |
| A5 | 自选从筛选添加 | 1 条自选 | UI | walkthrough | `screen-03-screener-watchlist-add.png` | ✅ |
| B1 | EOD pending 推进 | filled | buy/sell 链 | walkthrough | `accept-06`..`09` | ✅ |
| B2 | 导入机 HTTP 全矩阵 | 11/11 pass | 分级报告 | `npm run test:import-machine` | `import-machine-http-report.json` | ✅ |
| B3 | 批次失败不发布 | bars 无写入 | validate fail | import-batch.sqlite.test.ts | — | ✅ |
| B4 | 发布幂等/并发 | 幂等 200 | sqlite race | import-batch tests | import 报告 publish 重复步 | ✅ |
| B5 | 财务防前视 | NULL 公告排除 | fin-point-in-time + fin-screener | tests + HTTP | `financial-screener-http-report.json` | ✅ |
| B6 | 财务 capabilities 本地 | supported=true（有 fin 行） | GET/POST | `test:financial-screen` | 同上 | ✅ |
| B7 | 财务 capabilities 生产 | supported=false | env gate | fin-screener.sqlite.test.ts | 报告 productionNote | ✅ |
| B8 | PE/TTM 不混算 | notMapped | capabilities | financial.ts + 报告 | notMapped 列表 | ✅ 声明 |
| C1 | 容量 500×910 情景 | 455k 行实测 | SQLite 落库 | `test:capacity` | `capacity-500x3y-report.json` | ✅ |
| C2 | JSONL 实测字节 | 非估算 | stat | capacity 报告 | jsonlBytesActual=62844600 | ✅ |
| C3 | import_batch_rows 大批量 | — | 未压测 | — | 报告 notFullyStressTested | 部分 ⚠️ |
| C4 | workflow_dispatch | 有、无 schedule | 静态 | workflow-dispatch-evidence.mjs | `workflow-dispatch-evidence.json` | ✅ |
| D1 | 生产门禁 HTTP | bootstrap/demo 403 | production-gates | `test:production-gates` | `production-gates-http.log` | ✅ |
| D2 | staging 部署包 | 无凭据 zip | 扫描 dist | `npm run package:staging` | `staging-deploy-report.json` | ✅ |
| D3 | 远程 D1 多副本 | — | 未测 | — | — | 未支持 🛑 |
| D4 | 正式 vendor 分发 | fail-closed | DATA_DISTRIBUTION_LICENSED | env-guards + staging vars | deploy-staging-package.md | 未支持 🛑 |

## 命令

```bash
npm run typecheck && npm test
npm run test:import-machine
npm run test:financial-screen
npm run test:capacity          # 全量约数分钟；JSONL 可复用跳过 synthetic
npm run test:integration
npm run test:production-gates
npm run acceptance
npm run package:staging
node scripts/workflow-dispatch-evidence.mjs
```

## 截图路径（精确）

| 文件 |
|------|
| `/opt/cursor/artifacts/screen-01-screener-form.png` |
| `/opt/cursor/artifacts/screen-02-screener-hits.png` |
| `/opt/cursor/artifacts/screen-03-screener-watchlist-add.png` |
| `/opt/cursor/artifacts/screen-04-screener-invalid-input.png` |
| `/opt/cursor/artifacts/screen-05-screener-zero-hits.png` |
| `/opt/cursor/artifacts/accept-01-watchlist-empty.png` … `accept-09-paper-after-sell.png` |

## 架构文档

- [akshare-architecture.md](./akshare-architecture.md)
- [deploy-staging-package.md](./deploy-staging-package.md)
- [api-screener.md](./api-screener.md)
