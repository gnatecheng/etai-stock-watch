# 部署准备（未执行部署）

## Cloudflare Worker

- `wrangler.toml`：`database_id` 占位；`EOD_CRON_ENABLED=false`
- Secrets（控制台配置，**不入库**）：
  - `IMPORT_MACHINE_API_KEY` — 采集机专用
  - `MARKET_DATA_API_KEY` — 正式行情（未来）
  - `BOOTSTRAP_ADMIN_*` — 仅开发

## 采集机

- 安装 `collector/requirements.txt`
- 环境变量：`ESW_IMPORT_BASE_URL`、`ESW_IMPORT_MACHINE_KEY`
- 日志勿含 Bearer 全文

## GitHub Actions

- `.github/workflows/collector-ci.yml`：**仅** `workflow_dispatch`
- 不配置 `CLOUDFLARE_API_TOKEN` 等部署密钥
- Actions 分钟数/并发队列受 GitHub 套餐限制 — 非承诺实时

## 迁移

```bash
npm run db:migrate:local   # 含 0002_import_financial.sql
```

## 容量参考

```bash
node scripts/capacity-synthetic.mjs
CAP_BENCH_SYMBOLS=50 CAP_BENCH_DAYS=60 node scripts/capacity-benchmark.mjs
```

产物：`/opt/cursor/artifacts/capacity-synthetic-meta.json`、`capacity-benchmark.json`
