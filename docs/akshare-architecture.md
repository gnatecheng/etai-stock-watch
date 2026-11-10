# AKShare 采集架构（观股记）

## 分层

```
┌─────────────────┐     Bearer IMPORT_MACHINE_API_KEY
│ Python 采集 CLI │ ──► POST /api/import/v1/batches → stage → validate → publish
└─────────────────┘
         │
         ▼
┌─────────────────┐     用户会话 + CSRF
│ Hono Worker API │ ──► 筛选 / 信号 / 模拟 / 自选
└─────────────────┘
         │
         ▼
      D1（bars_daily、fin_report_versions、import_batches…）
```

- **Python 不进 Worker**；AKShare 仅运行在采集机或 CI（合成测试）。
- **日历**：`calendar_hk` 由运维/引导导入；AKShare 数据**不能**替代交易日历授权。
- **EOD**：沿用已确认 pending 模拟单自动推进；`scope_complete=0` 或未 `publish` 的批次**不产生**信号。

## 导入批次状态机

`staging → validating → validated → publishing → published | failed | abandoned`

- 失败 **不** 部分写入 `bars_daily` / `fin_report_versions`。
- `idempotencyKey` 防重复建批；`publish` 乐观锁防并发双发。

## 财务版本与防前视

见 `fin_report_versions`：`announced_at` 未知保持 NULL，**不参与**历史筛选。

## 分发授权

- AKShare 免费抓取 **≠** 对外分发许可；`APP_ENV=production` + 未授权 `DATA_PROVIDER` 继续 fail-closed。
- 本轮 **不** 创建 Cloudflare 资源、不开 Cron、不部署。

## 不可做（记录）

| 项 | 状态 |
|----|------|
| 远程 D1 多副本并发证明 | 未测 |
| 正式 vendor 生产分发 | 未授权 |
| GitHub Actions 自动定时采集 | 默认关闭 |
| 实盘/券商 | 不在范围 |
