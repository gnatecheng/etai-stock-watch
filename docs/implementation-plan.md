# 观股记 · 实施计划

## 已定（产品）

| 事项 | 决定 |
| --- | --- |
| 市场 | 港股（HKD 普通股为首版范围，认股证等待定） |
| 受众 | 邀请制，无公开注册；按 `user_id` 隔离私有数据 |
| 能力 | 筛选、可解释信号、站内提醒、**模拟交易**；不接券商/实盘 |
| 节奏 | 收盘后 EOD；无盘中实时 |

## 待定（上线前须确认）

| 事项 | 状态 |
| --- | --- |
| 港股行情供应商与付费授权 | 未选；生产 `DATA_PROVIDER!=demo` 且无密钥时 fail-closed |
| Cloudflare Workers Free/Paid | 未知；Cron 批处理按 Paid 能力预留 |
| 独立子域名 `stocks.etais.dev` | 仅建议，未批准 |
| 港交所完整交易日历 | 需导入显式配置；缺省 weekday 推断会 fail-closed |
| 费用/印花税现行税率 | 演示费率仅用于工程；生产须配置 `fee_schedules` |

## 工程隔离（必须）

- 独立 Worker 名称 `etai-stock-watch` + 独立 D1 绑定（占位 `database_id`）
- **不得**修改现有 `etai` 主站、`etai-access-log` D1、`etai-apk` R2
- 本仓库**未执行**部署、绑域、Secrets 写入

## 本 MVP 已实现

- TypeScript：Hono API + Vite 静态中文 UI（移动适配）
- D1 迁移、演示 CSV 导入、演示行情 Provider（水印「演示数据，非真实行情」）
- 邀请注册/登录、会话（HttpOnly/SameSite）、CSRF、速率限制、审计日志
- 筛选/详情/自选/信号/通知去重
- 20 日均线交叉 **工程演示** 策略（非投资建议）
- EOD 管线：日历/供应商就绪/幂等 `job_runs`、管理员触发
- 模拟盘：整手、费用参数、下一交易日开盘成交（禁止同日收盘回填）
- 测试：策略、日历 fail-closed、成交纪律、密码哈希

## 已知缺口

- 正式行情 Provider 接口未接 vendor
- 完整港交所日历与半日市表需运维导入
- 大规模回测/Queue/KV/DO 未引入（见 README 扩展说明）
- 生产 Cron 默认 `EOD_CRON_ENABLED=false`

## 参考

- 规划 Canvas（追溯）：https://cursor.com/canvas/store-6a491b06-474b-4345-a7dc-54fbe05e7242/3c64208c-3abb-4f20-bd6d-4a4d94a296db
