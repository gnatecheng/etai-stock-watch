# API 隔离抽检（本地 wrangler dev）

由代理于本地执行：

1. `POST /api/admin/bootstrap` → `ok`
2. 用户 B 邀请注册并添加自选 `inst_demo_00700`
3. `GET /api/watchlists` 管理员 → `items: []`
4. `GET /api/watchlists` 用户 B → 含 DEMO:00700

结论：跨用户自选隔离通过。
