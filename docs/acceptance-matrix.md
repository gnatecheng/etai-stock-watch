# 验收矩阵（逐项）

> 本轮：`npm test` **46 passed** · `npm run test:collector` 2 passed · `npm run test:capacity` · `acceptance` DONE  
> 远程 D1 多副本 / 正式分发授权：**未声称通过**

| # | 场景 | 预期 | 实际 | 测试/断言 | 日志/截图 | 结果 |
|---|------|------|------|-----------|-----------|------|
| A1 | 用户条件筛选 AND | POST run | hits+理由 | screener-* + walkthrough | screen-01..05 | ✅ 已验证 |
| A2 | 成交额 DEMO 禁用 | 400 不静默 | TURNOVER_NOT_SUPPORTED | integration + walkthrough | log | ✅ |
| A3 | 涨跌幅/非法输入 | API 400 | toast | walkthrough | screen-04 | ✅ |
| A4 | 零命中/重置 | hits=0 | UI+reset | walkthrough | screen-05 | ✅ |
| B1 | EOD pending 推进 | filled | pending-eod | walkthrough | accept-06..09 | ✅ |
| B2 | 导入机鉴权 | 无 Bearer 401 | import-machine | `import-machine-http.mjs` | import-machine-http.log | 部分 ⚠️ |
| B3 | 批次失败不发布 | bars 无写入 | validate fail | import-batch.sqlite.test.ts | — | ✅ |
| B4 | 发布幂等/并发 | ≥1 published | race test | import-batch | — | ✅ |
| B5 | 财务防前视 | NULL 公告不可筛 | fin-point-in-time.test.ts | — | ✅ |
| B6 | 财务 capabilities fail-closed | supported=false | GET financial-capabilities | 单测/手工 | — | ✅ |
| C1 | AKShare 采集器 CLI | synthetic 测试绿 | pytest collector/tests | collector README | — | ✅ |
| C2 | 容量 500×3y 合成 | 455k 行 meta | capacity-synthetic.mjs | capacity-synthetic-meta.json | ✅ 已验证 |
| C3 | 容量基准样本 | 3000 行 insert | capacity-benchmark.mjs | capacity-benchmark.json | ✅ |
| C4 | GitHub Actions | workflow_dispatch only | collector-ci.yml | — | 待用户决定 ⏸ |
| D1 | 生产门禁 | bootstrap/demo 403 | production-gates | production-gates-http.log | ✅ |
| D2 | 远程 D1 并发 | — | 未测 | — | — | 未支持 🛑 |
| D3 | 正式 vendor 分发 | fail-closed | env-guards | — | 未支持 🛑 |

## 命令

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:production-gates
npm run test:capacity
npm run test:collector
npm run acceptance
```

## 架构文档

- [akshare-architecture.md](./akshare-architecture.md)
- [deploy-prep.md](./deploy-prep.md)
- [api-screener.md](./api-screener.md)
- `collector/docs/AKSHARE_FIELDS.md`
