# Staging DEMO 站主激活与父端交接

> 适用于已独立部署的 `etai-stock-watch-staging`（**勿**改 etai 主站资源）。  
> **不**在聊天、PR、日志或 ZIP 中放置真实激活令牌。

## 产品决策（最少用户操作）

1. 父端离线生成令牌 → 写入 **mode 0600** 本地文件。  
2. 父端仅将 **哈希** 插入 D1（`site-owner-prepare-activation.mjs` 产出的 SQL）。  
3. 站主在本机浏览器打开 staging URL → **站主首次激活** 表单 → 自行粘贴令牌并设密（令牌不经聊天）。  
4. 登录后 → **账户 → 幂等初始化合成数据** → 按引导测试筛选/信号/模拟盘。

## 1. 迁移顺序（在既有 D1 上执行）

1. `migrations/0001_initial.sql`  
2. `migrations/0002_import_financial.sql`  
3. `migrations/0003_site_owner_demo_sim.sql`  

```bash
wrangler d1 migrations apply etai-stock-watch-staging-db --remote --config wrangler.staging-demo.toml
```

## 2. Worker vars（staging-demo）

| 变量 | 示例 |
|------|------|
| `APP_ENV` | `production` |
| `STAGING_DEMO_ENABLED` | `true` |
| `DATA_PROVIDER` | `demo` |
| `SITE_OWNER_ACTIVATION_ENABLED` | `true` |
| `SITE_OWNER_LOGIN` | 站主标识（如 `chengyi` 或完整邮箱） |
| `SITE_OWNER_LOGIN_DOMAIN` | `staging.local`（用户名无 @ 时使用） |
| `DEMO_WATERMARK` | 醒目合成水印文案 |
| `EOD_CRON_ENABLED` | `false` |
| `DATA_DISTRIBUTION_LICENSED` | `false` |

仍 **禁止**：`BOOTSTRAP_*`、`/api/admin/bootstrap`、默认 `admin@local.dev` 登录、Cron、真实采集密钥。

## 3. 站主激活生成（父端，无真实秘密入仓库）

```bash
node scripts/site-owner-prepare-activation.mjs \
  --login "<SITE_OWNER_LOGIN>" \
  --out /secure/staging-owner-activation.token \
  --sql-out /secure/staging-owner-activation.sql \
  --ttl-minutes 120

wrangler d1 execute etai-stock-watch-staging-db --remote \
  --config wrangler.staging-demo.toml \
  --file /secure/staging-owner-activation.sql
```

- 明文令牌 **仅** 在 `--out` 文件中。  
- 过期轮换：先执行 `site-owner-rotate-activation.mjs` 产出的 `supersede` SQL，再插入新哈希。

## 4. 部署后验收（站主本人）

1. 打开 `https://etai-stock-watch-staging.*` → 激活页（若尚无管理员）。  
2. 设密登录 → 账户 → **幂等初始化合成数据**。  
3. 筛选（价/涨跌幅/MA）· 财务 tab · 信号 · 自选 · 模拟单。  
4. **推进下一交易日** + **对模拟日运行 EOD**（非真实日更）。

## 5. 与安全壳差异

| 模式 | `DATA_PROVIDER` | 登录 | 数据 |
|------|-----------------|------|------|
| 安全壳 | `none` | 需自有用户种子 | 无行情 |
| staging-demo | `demo` + `STAGING_DEMO_ENABLED` | 站主激活 | 合成 fixture |

生产非 demo staging（`production`+`none` 或未开 `STAGING_DEMO_ENABLED`）保持原 fail-closed。

## 6. 本地证据（Agent）

```bash
npm test
npm run test:staging-demo
npm run package:staging-demo
```

报告：`/opt/cursor/artifacts/staging-demo-http-report.json`（**不含**令牌）
