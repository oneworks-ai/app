# Relay Admin Dashboard Feature

`features/dashboard` 负责管理页的 route 页面编排和 snapshot orchestration，不拥有具体 devices / users / invites / sso endpoint 细节。

## 入口

- `AdminDashboard.tsx`：根据 React Router section 渲染当前页面，默认只显示当前管理域，不把所有表格和表单堆在一个页面。
- `useRelayAdminDashboard.ts`：管理登录 session 校验、角色权限状态、loading/error、snapshot 刷新和 feature 操作编排。
- `adminSnapshot.ts`：聚合 devices / users / invites / sso 四个 feature 的查询结果。
- `AdminStatusBar.tsx`：展示加载、错误和非 admin 用户状态；登录缺失由 dashboard hook 直接重定向到 `/login`。

## 约定

- 具体领域 API 留在对应 feature，例如 `features/devices/devicesApi.ts`、`features/users/usersApi.ts` 和 `features/invites/invitesApi.ts`。
- snapshot 聚合必须按当前用户权限选择 endpoint；普通 member/viewer 只能拉取设备相关接口，不要请求 users / invites / sso 这类 admin API。
- 修改 dashboard 编排后跑 `pnpm -C apps/relay-admin test` 和 `pnpm -C apps/relay-admin typecheck`。
