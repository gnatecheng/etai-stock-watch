# Staging 激活 HTTP 400 — 本地调查（非远程结论）

> **未声称**远程 `https://etai-stock-watch-staging.chengyitang.workers.dev` 本次 400 的 `code`（kcots 未拿到响应体）。  
> **父端只读 DB（北京时间）**：`users=0`，`site_owner_activation` 一行 `owner@staging.local`，`consumed_at`/`superseded_at` 为空 → 失败发生在消费令牌之前。

## 已排除（依据 kcots 报告）

| 假设 | 状态 |
|------|------|
| 预填**整文件**（含 `#` 注释头） | **不符合** kcots（仅单行令牌进浏览器）；整文件导致 `TOKEN_INVALID` 仍作**防错**保留 |

## 部署 commit `f5141ff` 上合法的 HTTP 400 `code`

（见 `git show f5141ff:src/auth/site-owner.ts`）

| code | 条件 |
|------|------|
| `INVALID_INPUT` | 令牌空 **或** 密码 `length < 10`（**合并一条文案**，无法区分） |
| `TOKEN_INVALID` | 哈希无匹配行 |
| `TOKEN_USED` / `TOKEN_EXPIRED` / `TOKEN_LOGIN_MISMATCH` | 状态/配置 |

`LOGIN_MISMATCH` 为 **403**，不是 400。

## 本地 UI/API 复现（与本 PR 修补后）

命令：

```bash
npm run test:activation-matrix
npm run test:activation-ui
```

产物：

- `/opt/cursor/artifacts/activation-failure-matrix.json`
- `/opt/cursor/artifacts/activation-ui-regression.json`

### 与 kcots 场景相关的可验证点

1. **单行令牌 + 密码空字符串** → API `400` `PASSWORD_TOO_SHORT`（修补后拆分；`f5141ff` 为 `INVALID_INPUT`）  
2. **错误令牌** → `400` `TOKEN_INVALID` + 表单 `#activateError` **持久**（修补前仅绿 toast 2.5s）  
3. **单行令牌 + 密码 ≥10** → `200` 激活成功  

**Secure Form 未写入 `password` 字段**时：若仍发出 POST（如脚本 `requestSubmit` 绕过校验），与 (1) 一致 → 400。  
HTML `required`/`minlength` 在部分自动化/预填组合下**不保证**拦截；故前端在 submit 前显式校验 + 持久 `#activateError`。

## 本会话修补（不涉及生产 DB/真实令牌）

- 生成器 `--out` **仅单行令牌**；`.meta.json` 存 login/过期说明  
- 后端 `sanitizeActivationToken`（历史带头文件可提取末行，防错）  
- 拆分 `TOKEN_MISSING` / `PASSWORD_TOO_SHORT`；响应 `error`+`message`+`code`  
- 激活失败**不**用短时 toast；仅持久 `#activateError`（红色样式）

### 配置一致性（只读 DB：`login_id=owner@staging.local`）

Worker `SITE_OWNER_LOGIN` 规范化后须与 D1 一致。若 Worker 为 `staging-owner` 而表单为 `owner@staging.local` → **403** `LOGIN_MISMATCH`（非 400）。  
远程为 **400** 时，更可能为 `INVALID_INPUT` / `TOKEN_*`（仍无响应 code，不作实根因）。

父端 redeploy 本 PR 后，失败应出现持久 `#activateError` 与 `[CODE]`。
