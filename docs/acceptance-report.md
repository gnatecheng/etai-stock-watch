# 观股记 MVP 验收报告（逐项证据）

> **待产品复验 · 未合并 · 未部署** · 分支 `cursor/etai-stock-watch-mvp-7d54` · [PR #1](https://github.com/gnatecheng/etai-stock-watch/pull/1)

## 1. 执行命令

```bash
npm run typecheck
npm run build
npm test                    # 29 passed
npm run test:integration
npm run test:production-gates
npm run acceptance
```

场景矩阵：[acceptance-matrix.md](./acceptance-matrix.md)

## 2. EOD 推进已确认单（非 API 二次 confirm）

来源：`/opt/cursor/artifacts/acceptance-walkthrough.log`

```
paper confirm idempotent: … "status":"pending"
import buy fill session: 200
EOD buy fill day: … "pending":{"scanned":1,"filled":1,…}
paper confirm after EOD (no fill via API): … "status":"filled"
…
EOD sell fill: … "pending":{"filled":1}
after sell EOD: … pos=[] trades=2
```

证明：买入 **信号 2024-08-28** → **EOD 2024-08-29 填单**；卖出 **信号 2024-09-06** → **EOD 2024-09-09 填单**；`POST /api/paper/confirm` 重复调用不触发成交。

## 3. 生产门禁 HTTP

来源：`/opt/cursor/artifacts/production-gates-http.log`

- `POST /api/admin/bootstrap` → **403**
- `POST /api/admin/bootstrap-acceptance` → **403**
- 开发默认凭据登录 → **403**
- `APP_ENV=production` + `DATA_PROVIDER=demo`：`/api/paper/confirm` → **403**；`/api/admin/eod/run` → **403**

配置：`wrangler.production-test.toml` + `wrangler dev --persist-to .wrangler/prod-gate-test`

## 4. 截图

| 文件 | 场景 |
|------|------|
| `accept-01` … `accept-07` | 自选、buy 信号、pending、filled、提醒 |
| `accept-08-signals-sell-confirm.png` | 合成行情 sell + UI 确认 |
| `accept-09-paper-after-sell.png` | 卖出 EOD 后空仓 |

路径：`/opt/cursor/artifacts/accept-*.png`

## 5. 未覆盖 / 限制

- 未对接正式行情供应商；生产 EOD/纸交易对 demo 保持 **HTTP 403**（非“冒充授权完成”）。
- 并发仅在 SQLite 模拟 D1 + 单进程 `wrangler dev` 下验证；**未**在远程多副本 D1 压测。
- 本轮不合并、不部署、不修改 etai 主站资源。
