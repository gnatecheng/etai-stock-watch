# AKShare 港股字段映射（已核对函数签名）

## `stock_hk_hist`

- 参数：`symbol`（港股代码如 `00700`）、`period`=`daily`|`weekly`|`monthly`、`start_date`/`end_date`（`YYYYMMDD`）、`adjust`=`''`|`qfq`|`hfq`
- 返回列（中文，随版本可能变化）：`日期`、`开盘`、`收盘`、`最高`、`最低`、`成交量`、`成交额`（若有）
- **成交额**：仅当源列存在且运维标注 `turnover_trustworthy` 时入库；禁止用 `收盘×成交量` 冒充

## `stock_financial_hk_analysis_indicator_em`

- 参数：`symbol`、`indicator`=`年度`|`报告期`
- 行项目为中文名称；入库仅映射白名单：
  - `OPERATING_REVENUE` → `operating_revenue`
  - `HOLDER_PROFIT` / 归母净利润相关列 → `net_profit_attr_parent`（缺失 NULL）
  - `BASIC_EPS` → `basic_eps`
  - `ROE` → `roe`
  - `GROSS_PROFIT_MARGIN` → `gross_margin`
- **不映射**：PE、PB、TTM 推算 — 不同算法/币种禁止混搭

## 版本模型入库字段

| 字段 | 说明 |
|------|------|
| `period_end` | 报告期末日 `YYYY-MM-DD` |
| `period_type` | `annual` / `interim` / `quarter` |
| `announced_at` | 公告日；未知 **NULL** |
| `currency` / `unit_label` | 源披露口径 |
| `metrics_json` | 仅白名单指标，缺失 null |
