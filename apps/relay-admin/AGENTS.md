# Relay Admin App

`apps/relay-admin` 是 Relay B 端管理界面，使用 React + Vite 独立构建。它负责用户、角色、禁用状态、邀请码和 SSO provider 管理 UI；数据通过 `apps/relay-server` 的 `/api/admin/*` 接口读取和写入。

## 入口

- `src/main.tsx`：React 挂载入口，负责 AntD provider 与 React Router basename。
- `src/app/`：React Router 页面 shell、全局样式与顶层装配；通过 `@vibe@oneworks/route-layout` 的 `AppShellFrame` 复用主应用宿主壳能力，不要复制一套 sidebar / mobile drawer / route container 交互。
- `src/features/dashboard/`：管理台数据编排、route 页面切换、状态条、统计和 snapshot 聚合。
- `src/features/auth/`：Relay 登录回跳 token 消费、管理端 session token 本地保存和 `/api/auth/me` 客户端。
- `src/login/`：Relay `/login` 页面的 React + AntD 入口；通过 relay-server 注入的 JSON config 渲染最近账号、passkey 登录 / 注册、邀请码表单和 SSO provider 按钮。Passkey WebAuthn 调用只放在这里的登录 UI，邮箱验证码、邀请码策略、credential 存储和 session 发放由 `apps/relay-server/src/auth/passkeys.ts` 与 `src/routes/passkeys.ts` 处理。
- `src/platform/`、`api/`、`functions/`：独立 Vercel / Cloudflare Pages 静态部署的同源代理入口；只转发 `/api/*`、`/login` 和 `/login/complete` 到真实 Relay Server，不在 Admin 里重新实现 Relay API。Vercel 推荐部署形态优先看 `apps/relay-server` 的单项目 `/admin` 构建。
- `src/features/users/`：用户列表、用户表单、用户 API 和表单解析。
- `src/features/invites/`：邀请码列表、邀请码表单、邀请码 API 和表单解析。
- `src/features/sso/`：SSO provider 列表、创建、编辑、启用 / 禁用、secret 轮换和 API。
- `src/shared/`：跨 feature 复用的 API request、类型、角色常量、表单工具和基础 UI；基础 action button、data card、status badge 等先看 `src/shared/ui/AGENTS.md`。
- `__tests__/`：按 feature / 纯函数拆分的管理端单元测试。
- `README.md`：面向开发者的管理端结构、命令和 server 挂载说明。
- `.oo/rules/RELAY-DEPLOYMENT.md`：Relay 托管服务、私有化部署、Vercel / Cloudflare 域名、官方 OneWorks 域名 / 邮件拓扑和账号边界；处理 Admin 部署请求时先读。
- `HANDOFF.md`：当前共享 layout / Admin session 登录迁移的交接说明；接续这条 workstream 时先读这里，再按落点进入 `src/app`、`src/features/auth` 或 `packages/route-layout`。
- `vite.config.ts`：固定输出 `admin.js` 和 `admin.css`，供 relay-server 挂载；开发态接入登录页 live reload。
- `vite.relayLoginDev.ts`：Vite dev server 的 `/login` 与 `/login/complete` 本地渲染 helper，从 relay-server 登录页源码生成 shell/config；`/login` 加载 `src/login/main.tsx` 并由 Vite 提供 HMR。
- `scripts/prepare-platform-build.mjs`：把 Vite library 产物整理成 Vercel / Cloudflare Pages 可直接托管的 `dist/admin/index.html` 与 `dist/admin/assets/*`。

## 约定

- 构建必须走 Vite：`pnpm -C apps/relay-admin build`。
- 开发预览走 Vite dev server 和 HMR：`pnpm -C apps/relay-admin dev`，React Router 页面包括 `/admin/users`、`/admin/invites` 和 `/admin/sso`。开发态 `/api/*` 默认代理到 `http://127.0.0.1:48888`；`/login` 与 `/login/complete` 在 Vite 内本地生成 shell/config 并注入 Vite client，登录页 React 源码走 HMR，relay-server 登录 shell 源码变化会 full reload。需要指向其他 relay-server API / provider 来源时设置 `ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET`。
- 管理端单测：`pnpm -C apps/relay-admin test`。
- 组件与样式按模块职责拆分，不把页面重新堆成单体文件。
- 新增管理域时优先建 `src/features/<domain>/`，并补最近的 `AGENTS.md`；只有两个以上 feature 复用的代码才放进 `src/shared/`。
- 新增或改造 Admin 列表页时按统一列表标准走：必须提供搜索、过滤、展示列配置、批量操作和分页；表格 header 始终可见，分页器固定在列表底部，中间数据区滚动。行内操作默认图标化，不展示“详情 / 删除 / 禁用”这类文字；详情入口优先放在主识别字段链接上。UUID、内部 ID、secret 等低频排查字段不默认展示，只放详情页或展示列配置。
- 新增或改造 Admin 创建页 / 设置页时按统一创建表单标准走：不要直接堆 AntD `Form` 的裸 `layout="vertical"` 表单，也不要把提交按钮做成横跨整页的大色块。页面主体应使用紧凑工作台式行布局，短字段采用左侧固定宽度 label、右侧控件的两列表单行；长文本、Markdown 内容、介绍等特殊字段可独占一行并把 label 放在控件上方。Admin 创建 / 设置表单默认不设固定宽度上限，应撑满内容区并只保留页面 10px 级 padding；不要用 `min(760px, 100%)`、`max-width` 等窄表单上限复刻对象详情卡。主操作按钮放在表单底部右侧，移动端再自然折为单列。提交前必须用真实页面或截图检查：字段高度没有异常放大、控件宽度撑满但不溢出、底部操作不漂在内容中间。
- API 调用按 feature 拆在各自目录，例如 users 用 `features/users/usersApi.ts`，invites 用 `features/invites/invitesApi.ts`；通用 fetch 逻辑才放 `shared/api/`。
- 表单解析这类纯逻辑放到 feature 内的 `*Form.ts` 并配套 `__tests__/`，React 组件只负责交互和渲染。
- SSO provider list/detail 只会拿到 redacted `clientSecret`；编辑表单中 secret 留空表示保留原值，填写新 secret 才提交轮换。
- UI 保持工作台式、紧凑、可扫描；不要做营销页式 hero 或装饰布局。
- Admin 部署默认优先使用 OneWorks 托管服务或 relay-server 单项目 `/admin`；只有用户明确选择私有化部署时，才为 Vercel / Cloudflare Pages 配置独立代理。代理目标、项目名、域名、DNS 托管、收信策略、事务邮件发信域名、Reply-To、账号信息和 secrets 都来自用户或 OneWorks 服务账号，不写进可提交文档。
- 官方 OneWorks Admin/Relay 域名、`support@oneworks.cloud` / `hello@oneworks.cloud` 收信路由和 Resend 发信子域约定以 `.oo/rules/RELAY-DEPLOYMENT.md` 为准；不要在 Admin 文档或配置示例中记录私人邮箱、个人账号或平台 account slug。
