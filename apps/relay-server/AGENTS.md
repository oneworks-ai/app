# Relay Server App

`apps/relay-server` 是自部署公网 Relay 的 Node 服务入口。这里维护 HTTP 路由、OAuth / SSO、设备注册与心跳、用户 / 邀请码管理、会话转发元数据、存储驱动和链路日志。

## 入口

- `src/server.ts`：HTTP route 挂载与服务创建。
- `src/routes/`：传输层处理函数，只做认证、参数解析和响应。
- `src/routes/login.ts` / `src/routes/login-page.ts`：Relay 插件打开的 `/login` 与 `/login/complete` SSO 登录入口；负责 redirect 校验、provider start URL 计算、JSON config 注入和 Web/Electron 回跳，不承载完整用户端设备 / 会话页面。`/login` 的 React + AntD 控件在 `apps/relay-admin/src/login`，不要在 relay-server 字符串模板里手写 input/button/list。
- `src/auth/passkeys.ts` / `src/routes/passkeys.ts`：passkey 注册与登录核心逻辑和 HTTP route。这里处理 WebAuthn options/verify、邮箱验证码校验开关、邀请码策略、credential counter 更新和 session 发放；登录页 UI 仍在 `apps/relay-admin/src/login`。
- `src/routes/email-code-login.ts`：现有用户邮箱验证码登录 endpoint；发码继续走 `src/routes/email-verification.ts` 且使用 `purpose=login`。
- `src/routes/admin-sso-providers.ts`：B 端托管 SSO provider 管理 API。
- `src/devices/private-metadata.ts`：设备私有元数据加密、解密和 device token hash 工具。
- `src/auth/sso-provider-*`：SSO provider 元数据校验、redaction、OAuth client 解析与 env / store 合并。
- `src/email/`：验证码 / 邀请 / 登录邮件的 provider 抽象、Turnstile 校验、域名 evaluator 和发送风控；Admin UI 黑白名单管理留给 `apps/relay-admin` 后续任务，不要在这里写界面。
- `src/session-forwarding/`：会话快照、job、payload / result 转发仓库和访问控制；JSON / SQLite 本地模式使用内存 payload 仓库，云端模式必须由存储 driver 提供可跨请求恢复的 payload 仓库。
- `src/storage/`：store repository、SSO provider 归一化、JSON / SQLite / Postgres / Cloudflare Durable Object driver 与内容边界。
- `src/platform/fetch-handler.ts`：把 Fetch `Request` 适配到现有 Node-style route handler；Cloudflare Worker 入口使用它，不要在 Worker 中重复实现 route。
- `api/relay.ts`：Vercel Node Function 入口，使用 Postgres driver；Vercel 单项目部署时 `/admin` 由构建脚本复制出的静态 Admin 资源承载，不走这个函数。
- `cloudflare/worker.ts`：Cloudflare Worker + Durable Object 入口，使用 `cloudflare-do` driver，禁用内嵌 `/admin` 静态页。
- `scripts/prepare-vercel-build.mjs`：`build:vercel` 的最后一步，把 `apps/relay-admin/dist/admin` 复制到 `apps/relay-server/public/admin`，让同一个 Vercel project 同时提供 `/admin` 和 Relay API。
- `scripts/prepare-vercel-output.mjs`：本地 `vercel build --prebuilt` 后处理，把 pnpm workspace 下的 Postgres runtime package 拷进 `.vercel/output/functions/api/relay.func/node_modules/`；本地 CLI prebuilt 部署前必须跑。
- `src/telemetry/`：Relay trace 日志。
- `README.md`：面向自部署用户的命令、环境变量、Admin API、生产部署和日志说明。
- `.oo/rules/RELAY-DEPLOYMENT.md`：Relay 托管服务、私有化部署、Vercel / Cloudflare 域名、官方 OneWorks 域名 / 邮件拓扑和账号边界；处理部署请求时先读。SSO provider 对接经验拆在 `.oo/rules/relay-deployment/sso-*.md`，先读 common，再按 GitHub / Google / OIDC 读取对应文件。

## 约定

- 管理页前端不放在这里；React 管理端在 `apps/relay-admin`，通过 Vite 构建后由 `/admin/assets/*` 提供。
- `src/routes/admin-ui.ts` 只负责 HTML shell 和静态资源读取；不要把 React 代码、样式或业务状态内联回 relay-server。
- Relay store 不保存会话正文或结果正文，只保存 trace/status/size/timestamp/errorCode 等元数据；新增存储 driver 必须复用 `content-boundary.ts` 的过滤。
- Relay device 的 name / capabilities / workspaceFolder / pluginScope 是用户私有元数据。新写入必须加密存储，device token 只存 hash；admin 用户管理只返回 `deviceCount` / `maxDevices` 这类聚合字段，不返回其他用户设备详情。
- `/api/relay/devices` 是当前 session 用户自己的设备列表。不要因为 owner/admin 有管理权限就把其他用户设备详情从这个接口返回。
- SSO provider 的 `clientSecret` 可以由 admin API 写入 / 更新，但 list/detail 响应必须只返回 redacted 值，不能把明文 secret 返回给管理端。
- `users.email` 是联系邮箱，不是全局唯一登录键。登录来源归属以 `store.authIdentities` 为准：SSO 用 `(provider, providerUserId)` 绑定用户，Google / GitHub 等同邮箱登录也创建独立用户；`loginId` 必须全局唯一并可由用户后续改名；邮箱验证码只允许命中 `email_code` 身份，不能借同邮箱登录 SSO-only 账号。
- 发信入口必须先经过 `src/email/` 的 Turnstile、域名策略、同邮箱 / 同 IP / 同域名和全局预算检查，再调用 Resend 或后续 provider。域名 allowlist 只能解除域名封禁，不能绕过 Turnstile、频率或预算。
- `/login` 的默认登录方式由 `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD` 决定，支持 `password`、`passkey`、`verification_code`；前端可记住浏览器最近一次选择，但 server config 仍是默认来源。
- Passkey 注册默认必须先校验邮箱验证码；新用户是否还需要邀请码由 `ONEWORKS_RELAY_REGISTRATION_MODE` 决定。`invite_required` 是默认值，`email_verified` 允许邮箱验证后自注册，`admin_created_only` 禁止新账号自注册但允许已有用户绑定 passkey。`ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED=off` 只允许新 passkey 自注册跳过邮箱确认，已有用户新增 passkey 仍必须验证邮箱。不要把这些策略硬编码到前端。
- `ONEWORKS_RELAY_STORAGE_DRIVER=sqlite` 是单机 Node 生产推荐路径，`ONEWORKS_RELAY_DATA_PATH` 指向 SQLite 文件；不要把 SQLite 实现扩散到 routes 或 session-forwarding。
- `ONEWORKS_RELAY_STORAGE_DRIVER=postgres` 是 Vercel / serverless Node 路径，连接串来自 `ONEWORKS_RELAY_POSTGRES_URL`、`DATABASE_URL` 或 `--data`；日志和 repository location 必须脱敏连接串密码。
- `cloudflare-do` 只允许由 `cloudflare/worker.ts` 通过 Durable Object repository 创建，不要从 Node CLI 直接实例化。
- Vercel serverless 入口是单项目形态：`apps/relay-server` 的 `build:vercel` 会内置 Admin 静态页到 `/admin`；Cloudflare 仍使用 `apps/relay-admin` Pages + `apps/relay-server` Worker 两个部署面。
- 用户只想使用 Relay 时，默认引导到 OneWorks 托管服务；只有用户明确选择私有化部署时，才按其提供的平台账号和域名部署。不要把个人账号、真实 account id、测试凭据、token、数据库 URL 或临时部署 URL 写入可提交文档。
- OneWorks 官方服务域名、`support@oneworks.cloud` / `hello@oneworks.cloud` 收信路由和 Resend 发信子域约定只维护在 `.oo/rules/RELAY-DEPLOYMENT.md`；不要把私人收信目标或个人邮箱写入 README、AGENTS、handoff 或示例配置。
- 私有化部署的域名和邮件策略是配置，不是代码常量。Vercel 默认是 `<project>.vercel.app` 或自定义域；Cloudflare Worker 默认是 `<worker>.<account-subdomain>.workers.dev`，其中 account subdomain 是账号级设置，变更会影响该账号下所有 Workers。部署前确认用户自己的 DNS 托管、收信策略、事务邮件发信域名和 Reply-To。
- 修改 API 或存储边界后，优先跑 `pnpm -C apps/relay-server test` 和 `pnpm -C apps/relay-server typecheck`。
- 修改 Vercel / Cloudflare 入口后，额外跑 esbuild bundle smoke：Vercel 使用 `apps/relay-server/api/relay.ts` + `--platform=node`，Cloudflare 使用 `apps/relay-server/cloudflare/worker.ts` + `--platform=browser` 并 external `node:*`。
- 修改 `/admin` 静态挂载时，先跑 `pnpm -C apps/relay-admin build`，再用 relay-server smoke 请求 `/admin/assets/admin.js` 与 `/admin/assets/admin.css`。
