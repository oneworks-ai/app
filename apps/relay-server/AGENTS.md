# Relay Server App

`apps/relay-server` 是自部署公网 Relay 的 Node 服务入口。这里维护 HTTP 路由、OAuth / SSO、设备注册与心跳、用户 / 邀请码管理、会话转发元数据、存储驱动和链路日志。

## 入口

- `src/server.ts`：HTTP route 挂载与服务创建。
- `src/routes/`：传输层处理函数，只做认证、参数解析和响应。
- `src/routes/login.ts` / `src/routes/login-page.ts`：Relay 插件打开的 `/login` 与 `/login/complete` SSO 登录入口；负责 redirect 校验、provider start URL 计算、JSON config 注入和 Web/Electron 回跳，不承载完整用户端设备 / 会话页面。`/login` 的 React + AntD 控件在 `apps/relay-admin/src/login`，不要在 relay-server 字符串模板里手写 input/button/list。
- `src/routes/admin-sso-providers.ts`：B 端托管 SSO provider 管理 API。
- `src/devices/private-metadata.ts`：设备私有元数据加密、解密和 device token hash 工具。
- `src/auth/sso-provider-*`：SSO provider 元数据校验、redaction、OAuth client 解析与 env / store 合并。
- `src/session-forwarding/`：会话快照、job、volatile payload / result 转发和访问控制。
- `src/storage/`：store repository、SSO provider 归一化、JSON / SQLite driver 与内容边界；Postgres 目前只保留明确未实现的接缝。
- `src/telemetry/`：Relay trace 日志。
- `README.md`：面向自部署用户的命令、环境变量、Admin API、生产部署和日志说明。

## 约定

- 管理页前端不放在这里；React 管理端在 `apps/relay-admin`，通过 Vite 构建后由 `/admin/assets/*` 提供。
- `src/routes/admin-ui.ts` 只负责 HTML shell 和静态资源读取；不要把 React 代码、样式或业务状态内联回 relay-server。
- Relay store 不保存会话正文或结果正文，只保存 trace/status/size/timestamp/errorCode 等元数据；新增存储 driver 必须复用 `content-boundary.ts` 的过滤。
- Relay device 的 name / capabilities / workspaceFolder / pluginScope 是用户私有元数据。新写入必须加密存储，device token 只存 hash；admin 用户管理只返回 `deviceCount` / `maxDevices` 这类聚合字段，不返回其他用户设备详情。
- `/api/relay/devices` 是当前 session 用户自己的设备列表。不要因为 owner/admin 有管理权限就把其他用户设备详情从这个接口返回。
- SSO provider 的 `clientSecret` 可以由 admin API 写入 / 更新，但 list/detail 响应必须只返回 redacted 值，不能把明文 secret 返回给管理端。
- `ONEWORKS_RELAY_STORAGE_DRIVER=sqlite` 是单机生产推荐路径，`ONEWORKS_RELAY_DATA_PATH` 指向 SQLite 文件；不要把 SQLite 实现扩散到 routes 或 session-forwarding。
- 修改 API 或存储边界后，优先跑 `pnpm -C apps/relay-server test` 和 `pnpm -C apps/relay-server typecheck`。
- 修改 `/admin` 静态挂载时，先跑 `pnpm -C apps/relay-admin build`，再用 relay-server smoke 请求 `/admin/assets/admin.js` 与 `/admin/assets/admin.css`。
