# 条件筛选 API（用户主动执行 · AND）

> **与 `signals` 无关**：本 API 不读取 20MA 策略输出；用户自定义条件组合。

## GET `/api/screener/capabilities`

需登录。返回单位说明、DEMO 标识、`turnoverSupported` 及不可用原因。

## POST `/api/screener/run`

需登录 + CSRF。Body：

```json
{
  "asOfDate": "2024-08-28",
  "conditions": [
    { "type": "price_close", "minHkd": 250, "maxHkd": 300 },
    { "type": "change_pct", "minPct": -5, "maxPct": 10 },
    { "type": "ma_relation", "period": 20, "relation": "above" }
  ]
}
```

### 条件类型

| type | 含义 | 单位 |
|------|------|------|
| `price_close` | 当日收盘价区间 | HKD |
| `change_pct` | 相对上一交易日收盘涨跌幅 | % |
| `ma_relation` | 收盘价 vs SMA(period) | `relation`: `above` \| `below` |
| `turnover` | 成交额区间 | HKD，**仅可信字段** |

**AND**：全部条件均 `pass` 才命中；任一项 `excluded`（缺数据/历史不足/成交额不可信）或 `fail` 则该标的不命中。

### 成交额可信规则

- `APP_ENV=production` + `DATA_PROVIDER=demo`：永远不支撑成交额条件。
- 演示供应商：`turnoverSupported=false`，请求体含 `turnover` → **400** `TURNOVER_NOT_SUPPORTED`（不静默丢弃）。
- 禁止使用 `收盘价×成交量` 推算成交额。

### 响应片段

```json
{
  "asOfDate": "2024-08-28",
  "dataLabel": "演示数据… · 合成 DEMO",
  "demo": true,
  "hits": [
    {
      "symbol": "DEMO:00700",
      "conditionResults": [
        { "type": "price_close", "status": "pass", "reason": "收盘价 285.00 HKD …" }
      ],
      "summaryReasons": ["…"]
    }
  ],
  "message": "当前条件下无命中标的…"
}
```

## 废弃

`GET /api/screener` → **410** `SCREENER_MIGRATED`（固定列表已移除）。
