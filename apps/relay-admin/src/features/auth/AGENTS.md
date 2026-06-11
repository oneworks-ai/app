# Relay Admin Auth Feature

`features/auth` 只处理管理端对 Relay 登录 session 的读取、保存和校验，不渲染顶部 token 输入，也不直接编排 `/api/admin/*`。

## 入口

- `adminSessionStorage.ts`：消费 `/login` 回跳的 `relay_token`，清理 URL，并保存 / 清除管理端 session token 与本地最近账号列表；需容忍 localStorage 不可用。
- `authApi.ts`：调用 `/api/auth/me` 校验当前 session 并读取当前用户角色。

## 约定

- 不在这里调用 `/api/admin/*`；API 调用由 dashboard 或具体 feature 编排。
- 不新增任何部署级 secret 的手动输入；页面权限由当前登录用户角色决定，`owner` / `admin` 才能加载管理数据。
- 不把 session token 写进日志、测试快照或持久配置文件；URL 中的 `relay_token` 必须在消费后清理。
- 修改 session 存储语义时补单测，并跑 `pnpm -C apps/relay-admin test`。
