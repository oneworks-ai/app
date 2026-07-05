# Relay Admin App Shell

`src/app` 只放管理端最外层 React Router shell、共享宿主壳接线和全局样式。

## 入口

- `AdminApp.tsx`：挂载 `features/dashboard/AdminDashboard` 的 route 页面，并通过 `@oneworks/route-layout` 的 `HostAppShell` 提供共享 content surface 与 route shell；只做 route、header actions 和 shell 接线。
- `AdminThemeProvider.tsx`：管理端主题入口，负责读取 / 保存主题偏好，同步 `html.dark`，并把同一套主题状态传给 AntD `ConfigProvider`。
- `AdminNavRail.tsx`：Relay Admin 的业务侧栏 adapter。这里把管理端路由、底部账号菜单、主题 / 语言偏好等业务输入喂给共享 `HostNavRail` 插槽；不要在共享包里引入 admin API 或插件注册逻辑，也不要在这里复制一套 sidebar DOM。
- `useAdminSidebarItems.tsx`：把 React Router location 映射为侧栏 item 和当前 route section，不监听 hash；设备入口应保持在认证管理入口之前，API 文档入口面向所有登录用户，平台管理区块继续按角色过滤。
- `AdminApp.css`：管理端 app shell、菜单 adapter、AntD 全局 surface 适配和页面级布局；不要在这里维护独立色板。
- `vite.config.ts` 在 dev server 里把 `/api/*` 和 `/login` 代理给 relay-server，登录 / API 语义不要在 app shell 里硬编码端口。

## 约定

- 新增业务区块时去 `src/features/<domain>/`，route 入口在 dashboard/app 层接线，不要把表格、表单或 API client 塞回 `AdminApp.tsx`。
- 新增页面入口时同时接入权限判断：侧边栏入口、React route 直达守卫、dashboard snapshot/API 调用范围都要按 `shared/model/adminPermissions.ts` 的权限模型处理。
- 新增带 tabs 的页面时，route 层要为稳定 tab 提供 path segment，例如 `/profile/:tab` 或 `/teams/:teamId/:tab`；header 高亮、面包屑和权限判断必须识别这些子路径。页面内搜索、状态、时间范围等可回放筛选状态走 query，不用 hash，也不要只存在组件 state。
- Relay Admin 必须复用 `@oneworks/route-layout/design-tokens.css` 的 `--bg-color`、`--text-color`、`--border-color`、`--primary-color` 等共享 token，不要新增 `--relay-*` 独立色板。
- 主题切换必须同时影响 `html.dark` 和 AntD `ConfigProvider`；不要把主题状态只放在菜单或某个局部组件里。
- 左下角账号菜单语义与 Relay 插件账号 popover 保持镜像：账号列表、个人资料、登录其他账号、退出登录这些用户入口变更时，必须检查 `packages/plugins/relay/src/client/index.ts` 是否需要同步；插件侧通过 scoped API 代理 session，不复制 Admin 的 localStorage token 持有方式。
- 只有真正全局的 admin adapter 样式放在这里；共享 token、Host shell / NavRail 的结构、padding、radius、折叠预览与 footer slot 样式归 `packages/route-layout`。
- 修改共享颜色、route header、nav rail 或 chrome 尺寸时，优先同步 `packages/route-layout/src/design-tokens.css`，再检查 `apps/client` 和 Relay Admin 的入口是否仍一致。
- 修改页面 shell 后跑 `pnpm -C apps/relay-admin typecheck` 和 `pnpm -C apps/relay-admin build`。
