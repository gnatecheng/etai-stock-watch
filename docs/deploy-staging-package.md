# Staging 安全部署包说明（父端上传用）

> **Agent 不执行远程部署**。本说明与 `/opt/cursor/artifacts/staging-deploy-bundle/`、`etai-stock-watch-staging-*.zip` 配套。

## 1. 设计原则

| 项 | staging 默认 |
|----|----------------|
| Worker 名称 | `etai-stock-watch-staging`（**独立**，勿覆盖 etai 主站 Worker） |
| D1 | `etai-stock-watch-staging-db`（**新建** `database_id`） |
| 路由 | 优先 `*.workers.dev` |
| `APP_ENV` | `production`（fail-closed） |
| `DATA_PROVIDER` | `none`（无演示行情；无用户时仅壳 + 拒绝受控 API） |
| Cron | **无**（`EOD_CRON_ENABLED=false`，配置无 `[triggers]`） |
| 采集/分发 | 不启用；`DATA_DISTRIBUTION_LICENSED=false` |
| 默认开发账号 | **禁止**（`admin@local.dev` 在生产返回 403） |
| bootstrap / bootstrap-acceptance | **403** |
| 未配置 Secret 的导入 API | **fail-closed**（`IMPORT_AUTH_NOT_CONFIGURED` / 401） |

财务筛选在 staging 保持 `supported: false`（无分发许可 + 无已发布数据），**不阻塞**安全网站壳部署。

## 2. 包内容

```
staging-deploy-bundle/
  dist/worker/index.js      # Hono Worker 编译产物
  dist/client/              # Vite 静态资源（Workers Assets 绑定）
  migrations/               # D1 SQL（按文件名序）
  wrangler.staging.toml     # 绑定模板（database_id 占位）
  docs/deploy-staging-package.md
  MANIFEST.json             # commit、迁移顺序、校验元数据
```

**部署包不含**：`.dev.vars`、随机测试 `IMPORT_MACHINE_API_KEY`、Playwright 截图、容量 SQLite 大文件。

## 3. Bindings / Vars / Secrets

### Bindings（wrangler.staging.toml）

| 名称 | 类型 | 说明 |
|------|------|------|
| `DB` | D1 | `etai-stock-watch-staging-db`，迁移目录 `migrations/` |
| `ASSETS` | Assets | 目录 `dist/client` |

### Vars（可写在 toml `[vars]`）

- `APP_ENV=production`
- `DATA_PROVIDER=none`
- `EOD_CRON_ENABLED=false`
- `DATA_DISTRIBUTION_LICENSED=false`
- `SESSION_COOKIE_NAME=esw_session`
- `HK_TIMEZONE=Asia/Hong_Kong`

### Secrets（控制台 / `wrangler secret put`，**勿写入 zip**）

| Secret | staging 是否必须 | 未配置行为 |
|--------|------------------|------------|
| `IMPORT_MACHINE_API_KEY` | 否 | `/api/import/v1/*` fail-closed |
| `MARKET_DATA_API_KEY` | 否 | 正式行情不可用 |
| `BOOTSTRAP_ADMIN_*` | **勿配** | 生产禁止 bootstrap 种子 |

首 deploy **可不配任何 Secret**：站点可加载静态壳；登录需运维事后邀请/种子用户（不走默认开发凭据）。

## 4. D1 迁移顺序

1. `migrations/0001_initial.sql`
2. `migrations/0002_import_financial.sql`

```bash
# 父端在替换 database_id 后
wrangler d1 migrations apply etai-stock-watch-staging-db --remote --config wrangler.staging.toml
```

## 5. 部署步骤（父端）

1. 解压 zip 到干净目录；核对 `MANIFEST.json` 中 `gitCommit` 与 `sha256`。
2. Cloudflare 控制台 **新建** D1 `etai-stock-watch-staging-db`，将 `database_id` 写入 `wrangler.staging.toml`。
3. 执行 D1 迁移（上一节）。
4. （可选）`wrangler secret put IMPORT_MACHINE_API_KEY` — 仅采集机就绪后。
5. `wrangler deploy --config wrangler.staging.toml` → 使用 workers.dev URL 验证：
   - `GET /api/health` → 200
   - `POST /api/admin/bootstrap` → 403
   - `POST /api/auth/login` 使用开发默认邮箱 → 403
   - 无会话时 `GET /api/screener/capabilities` → 401

## 6. 回滚

1. **Worker**：Cloudflare 控制台 → Workers → 版本历史 → 回滚上一稳定版本；或重新 deploy 上一已知 `gitCommit` 的包。
2. **D1**：本仓库 **无 down migration**。回滚 schema 需从 D1 备份恢复或新建 D1 实例并切换 `database_id`（短暂只读窗）。
3. **Secrets**：回滚 Worker 版本不删除 Secret；若误配 `BOOTSTRAP_*`，删除 Secret 并 redeploy。

## 7. 本地门禁（Agent 已跑）

```bash
npm run test:production-gates   # APP_ENV=production + demo 403 矩阵
node scripts/package-staging-deploy.mjs
```

产物：

- `/opt/cursor/artifacts/staging-deploy-report.json`
- `/opt/cursor/artifacts/staging-deploy-sha256.txt`
- `/opt/cursor/artifacts/etai-stock-watch-staging-<commit>.zip`

## 8. 不能仅凭本包“完成”的项

- 正式港股行情供应商与 `MARKET_DATA_API_KEY`
- `DATA_DISTRIBUTION_LICENSED=true` 及财务/行情对外分发合规
- AKShare 远程定时采集（无 Cron、无 Actions 远程执行）
- 多副本 D1 并发与生产级邀请邮件
