# 观股记 · AKShare 港股采集器（独立 Python）

与 Cloudflare Worker **分离部署**：本 CLI 仅负责采集 → 调用 Worker `POST /api/import/v1/*`（机器凭据），不进入 Worker 运行时。

## 环境与依赖

```bash
cd collector
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

- **Python ≥ 3.10**
- 主测试使用 **合成 fixture**（`etai_collect/providers/synthetic.py`），不依赖外网。
- 可选最小真实取样（遵守源站限制、不对外发布）：

```bash
export ESW_AKSHARE_LIVE_SAMPLE=1   # 显式开启
python -m etai_collect.cli sample-hk --symbol 00700 --days 3
```

## 已核对 AKShare 接口（勿编造）

| 用途 | 函数 | 说明 |
|------|------|------|
| 港股日线 | `ak.stock_hk_hist(symbol, period='daily', start_date, end_date, adjust='')` | 东财来源；列：日期/开高低收/成交量等 |
| 港股日线（新浪） | `ak.stock_hk_daily(symbol, adjust='')` | 备选；字段不同 |
| 财务主要指标 | `ak.stock_financial_hk_analysis_indicator_em(symbol, indicator='年度'\|'报告期')` | 字段随东财变化，映射见 `docs/AKSHARE_FIELDS.md` |
| 三大报表 | `ak.stock_financial_hk_report_em(stock, symbol='利润表', indicator='年度')` | 报表行项目，非全部已映射入库 |

**不存在/受限**：实时分钟内盘、付费 Level2、未文档化字段 — 保持缺失，不补齐。

## 导入流水线

1. `create` 批次（`idempotencyKey`）
2. `stage` 行（可分批重试）
3. `validate`（日历/标的/字段）
4. `publish`（幂等；失败整批不发布）

```bash
export ESW_IMPORT_BASE_URL=http://127.0.0.1:8787
export ESW_IMPORT_MACHINE_KEY=   # 与 Worker IMPORT_MACHINE_API_KEY 一致，勿写入仓库

python -m etai_collect.cli push-bars --fixture acceptance --trade-date 2024-08-29
python -m etai_collect.cli push-financial --fixture sample
```

## 限制与合规

- 不绕过反爬；限速 `ESW_AKSHARE_DELAY_MS`（默认 800ms）。
- AKShare **免费获取 ≠ 对外分发授权**；生产 `DATA_PROVIDER` 未授权时 Worker fail-closed。
- 日志自动脱敏 Bearer token（不打印完整密钥）。
