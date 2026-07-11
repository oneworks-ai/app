# Relay Server App

`apps/relay-server` 是自部署公网 Relay 的 Node 服务入口。这里维护 HTTP 路由、OAuth / SSO、设备注册与心跳、用户 / 邀请码管理、会话转发元数据、存储驱动和链路日志。

## 入口

- `src/server.ts`：HTTP route 挂载与服务创建。
- `src/routes/`：传输层处理函数，只做认证、参数解析和响应。
- `src/routes/login.ts` / `src/routes/login-page.ts` / `src/routes/login-redirect.ts`：Relay 插件打开的 `/login` 与 `/login/complete` SSO 登录入口；负责受限 Client redirect 校验、provider start URL 计算、JSON config 注入和 Web/Electron 回跳，不承载完整用户端设备 / 会话页面。同一配置生成器也供 `/api/auth/login-options` 返回 Client 原生登录页所需的登录方式、endpoint 和 provider；原生能力列表必须过滤需要 Turnstile、因而不能由 Client 直接完成的验证码方式。`/login` 的 React + AntD 控件在 `apps/relay-admin/src/login`，不要在 relay-server 字符串模板里手写 input/button/list。
- `src/auth/passkeys.ts` / `src/routes/passkeys.ts`：passkey 注册与登录核心逻辑和 HTTP route。这里处理 WebAuthn options/verify、邮箱验证码校验开关、邀请码策略、credential counter 更新和 session 发放；登录页 UI 仍在 `apps/relay-admin/src/login`。
- `src/routes/email-code-login.ts`：现有用户邮箱验证码登录 endpoint；发码继续走 `src/routes/email-verification.ts` 且使用 `purpose=login`。
- `src/routes/admin-sso-providers.ts`：B 端托管 SSO provider 管理 API。
- `src/routes/teams.ts`、`src/routes/team-*.ts`、`src/routes/config-secrets.ts`、`src/teams.ts`、`src/config-secrets.ts`：团队、成员、租户团队策略、配置 secret 加密存储 / 轮换 / 撤销 API 与团队配置消费权限 helper；`/api/relay/teams` 面向用户自助团队流程，`/api/admin/teams` 和 `/api/admin/team-policy` 只给站点管理员。
- `src/routes/project-rule-documents.ts` / `src/project-rule-documents.ts`：项目规则 assignment 自有文档快照的当前用户与管理员 API、权限边界和持久化归一化；它不是账号 / 团队文档索引，也不负责读取正文或判断本地 Git 项目是否命中规则。
- `src/routes/admin-openapi.ts`：Relay 机器可读 OpenAPI 3.1 文档；平台管理员 API 挂载在 `/api/admin/openapi.json`，个人用户 API 挂载在 `/api/profile/openapi.json`，不要写入真实 token 或部署 secret。Admin 前端只读取这两份文档，不在 `apps/relay-admin` 复制 paths / schema。
- `src/routes/profile.ts`：当前登录用户自己的 profile 安全 API，包括系统访问令牌、OpenAPI 调用审计查询、密码修改和 passkey 绑定；不要在这里实现他人用户管理动作。
- `src/devices/private-metadata.ts`：设备私有元数据加密、解密和 device token hash 工具。
- `src/auth/sso-provider-*`：SSO provider 元数据校验、redaction、OAuth client 解析与 env / store 合并。
- `src/email/`：验证码 / 邀请 / 登录邮件的 provider 抽象、Turnstile 校验、域名 evaluator 和发送风控；Admin UI 黑白名单管理留给 `apps/relay-admin` 后续任务，不要在这里写界面。
- `src/session-forwarding/`：会话快照、job、payload / result 转发仓库和访问控制；JSON / SQLite 本地模式使用内存 payload 仓库，云端模式必须由存储 driver 提供可跨请求恢复的 payload 仓库。
- `src/storage/`：store repository、SSO provider 归一化、JSON / SQLite / Postgres / Cloudflare Durable Object driver 与内容边界。
- `src/platform/fetch-handler.ts`：把 Fetch `Request` 适配到现有 Node-style route handler；Cloudflare Worker 入口使用它，不要在 Worker 中重复实现 route。
- `api/relay.ts`：Vercel Node Function 入口，使用 Postgres driver；Vercel 单项目部署时 `/admin` 由构建脚本复制出的静态 Admin 资源承载，不走这个函数。
- `cloudflare/worker.ts`：Cloudflare Worker + Durable Object 入口，使用 `cloudflare-do` driver，禁用内嵌 `/admin` 静态页。
- `scripts/prepare-vercel-build.mjs`：`build:vercel` 的最后一步，把 `apps/relay-admin/dist/admin` 复制到 `apps/relay-server/public/admin`，让同一个 Vercel project 同时提供 `/admin` 和 Relay API。
- `scripts/prepare-vercel-output.mjs`：本地 `vercel build --prebuilt` 后处理，把 pnpm workspace 下的 Postgres 与 WebAuthn runtime package 依赖闭包拷进 `.vercel/output/functions/api/relay.func/node_modules/`；本地 CLI prebuilt 部署前必须跑。
- `src/telemetry/`：Relay trace 日志。
- `README.md`：面向自部署用户的命令、环境变量、Admin API、生产部署和日志说明。
- `.oo/rules/RELAY-DEPLOYMENT.md`：Relay 托管服务、私有化部署、Vercel / Cloudflare 域名、官方 OneWorks 域名 / 邮件拓扑和账号边界；处理部署请求时先读。正式版 Admin / Relay 发布继续读 `.oo/rules/relay-deployment/admin-release-sop.md`。SSO provider 对接经验拆在 `.oo/rules/relay-deployment/sso-*.md`，先读 common，再按 GitHub / Google / OIDC 读取对应文件。

## 约定

- 管理页前端不放在这里；React 管理端在 `apps/relay-admin`，通过 Vite 构建后由 `/admin/assets/*` 提供。
- `src/routes/admin-ui.ts` 只负责 HTML shell 和静态资源读取；不要把 React 代码、样式或业务状态内联回 relay-server。
- Relay store 不保存会话正文或结果正文，只保存 trace/status/size/timestamp/errorCode 等元数据；新增存储 driver 必须复用 `content-boundary.ts` 的过滤。
- 项目规则文档绑定 config assignment，使用 `/api/relay/config-assignments/:assignmentId/documents` 或管理员同构路径同步。Relay Server 业务路由保存并透传客户端生成的密文格式 payload 以及同步、范围和审计元数据，不解析或索引文档正文；部署运营方能够复现当前命名空间派生密钥，因此文档不得承诺运营方无法解密。本地目录、Git 命中判断、路径安全和提示词注入由 Relay 插件负责，不能下沉到 server 或宿主应用。
- Relay device 的 alias / name / capabilities / workspaceFolder / pluginScope 是用户私有元数据。新写入必须加密存储，device token 只存 hash；admin 用户管理只返回 `deviceCount` / `maxDevices` 这类聚合字段，不返回其他用户设备详情。`alias` 是 OneWorks / Relay 内的展示名，不参与设备身份判断；真实机器名继续放在 `name`，用于兜底显示和排查。
- `/api/relay/devices` 是当前 session 用户自己的设备列表。不要因为 owner/admin 有管理权限就把其他用户设备详情从这个接口返回。
- 系统访问令牌属于当前登录用户，落库只存 hash 和 preview；生成接口只返回一次明文。权限按令牌所属用户的 role/capability 解析，不要给系统访问令牌绕过当前用户保护，例如禁止修改自己的 role。
- 通过系统访问令牌调用 `/api/*` 时，`src/security/audit.ts` 需要记录 OpenAPI audit event，查询入口是 `/api/profile/openapi-audit` 且只能由登录 session 查看。
- 新增、删除或改名 `/api/admin/*` 平台管理员 API、`/api/profile/*` 当前用户 API，或面向用户自助团队 / 配置管理的 `/api/relay/teams*`、`/api/relay/team-policy`、`/api/relay/config-*` API 时，必须同步更新 `src/routes/admin-openapi.ts` 的对应 OpenAPI 文档、`apps/relay-server/__tests__/profile.spec.ts` 的路径 / schema 隔离清单 / visibility matrix / `$ref` contract 检查，以及面向用户的 `README.md` / `.oo/docs/usage/relay.md` / `.oo/docs/en/usage/relay.md`。插件设备转发、登录提交和 OAuth callback 等运行时内部接口不要塞进这两份用户可导入的 OpenAPI，除非它们明确变成公开产品 API。
- SSO provider 的 `clientSecret` 可以由 admin API 写入 / 更新，但 list/detail 响应必须只返回 redacted 值，不能把明文 secret 返回给管理端。
- `users.email` 是联系邮箱，不是全局唯一登录键。登录来源归属以 `store.authIdentities` 为准：SSO 用 `(provider, providerUserId)` 绑定用户，Google / GitHub 等同邮箱登录也创建独立用户；`loginId` 必须全局唯一并可由用户后续改名；邮箱验证码只允许命中 `email_code` 身份，不能借同邮箱登录 SSO-only 账号。
- 发信入口必须先经过 `src/email/` 的 Turnstile、域名策略、同邮箱 / 同 IP / 同域名和全局预算检查，再调用 Resend 或后续 provider。域名 allowlist 只能解除域名封禁，不能绕过 Turnstile、频率或预算。
- `/login` 的默认登录方式由 `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD` 决定，支持 `password`、`passkey`、`verification_code`；前端可记住浏览器最近一次选择，但 server config 仍是默认来源。
- `/login` 与 `/login/complete` 的 HTML 包含当前请求时计算的登录方式和 SSO provider 配置，响应必须保持 `Cache-Control: no-store`，避免 provider 启停后浏览器继续复用旧能力列表。CSP `frame-ancestors` 只允许与受限 `ONEWORKS_RELAY_ALLOW_ORIGIN` 一致的 Web `redirect_uri` 来源；`*` 仅对 loopback redirect 保留本地开发嵌入，其他来源以及自定义协议 / 无效 redirect 均禁止 iframe，防止未知顶层站点调用已委派的 WebAuthn。
- 登录 token 的最终 redirect 只允许与 `ONEWORKS_RELAY_ALLOW_ORIGIN` 同源的 Web URL、本地开发时的 loopback URL，或精确的 `oneworks://relay/auth` / `one-works://relay/auth` 回调形状；OAuth 中间回跳只额外允许当前 Relay origin 的 `/login/complete`，不得按“任意 HTTPS / 任意自定义协议”放行。
- Passkey 注册默认必须先校验邮箱验证码；新用户是否还需要邀请码由 `ONEWORKS_RELAY_REGISTRATION_MODE` 决定。`invite_required` 是默认值，`email_verified` 允许邮箱验证后自注册，`admin_created_only` 禁止新账号自注册但允许已有用户绑定 passkey。`ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED=off` 只允许新 passkey 自注册跳过邮箱确认，已有用户新增 passkey 仍必须验证邮箱。不要把这些策略硬编码到前端。
- `ONEWORKS_RELAY_STORAGE_DRIVER=sqlite` 是单机 Node 生产推荐路径，`ONEWORKS_RELAY_DATA_PATH` 指向 SQLite 文件；不要把 SQLite 实现扩散到 routes 或 session-forwarding。
- `ONEWORKS_RELAY_STORAGE_DRIVER=postgres` 是 Vercel / serverless Node 路径，连接串来自 `ONEWORKS_RELAY_POSTGRES_URL`、`DATABASE_URL` 或 `--data`；日志和 repository location 必须脱敏连接串密码。
- `cloudflare-do` 只允许由 `cloudflare/worker.ts` 通过 Durable Object repository 创建，不要从 Node CLI 直接实例化。
- Vercel serverless 入口是单项目形态：`apps/relay-server` 的 `build:vercel` 会内置 Admin 静态页到 `/admin`；Cloudflare 仍使用 `apps/relay-admin` Pages + `apps/relay-server` Worker 两个部署面。
- Relay Server 的公开版本号必须从 `apps/relay-server/package.json` 元数据读取；不要在 `src/types.ts`、`src/config.ts`、`src/server.ts`、平台入口或 Admin/login config 中硬编码 release 字符串。修改版本输出时同步覆盖 `/health` / public config 测试，并在 Vercel / Cloudflare 部署后确认 `/health.version` 等于本包版本。
- 用户只想使用 Relay 时，默认引导到 OneWorks 托管服务；只有用户明确选择私有化部署时，才按其提供的平台账号和域名部署。不要把个人账号、真实 account id、测试凭据、token、数据库 URL 或临时部署 URL 写入可提交文档。
- OneWorks 官方服务域名、`support@oneworks.cloud` / `hello@oneworks.cloud` 收信路由和 Resend 发信子域约定只维护在 `.oo/rules/RELAY-DEPLOYMENT.md`；不要把私人收信目标或个人邮箱写入 README、AGENTS、handoff 或示例配置。
- 私有化部署的域名和邮件策略是配置，不是代码常量。Vercel 默认是 `<project>.vercel.app` 或自定义域；Cloudflare Worker 默认是 `<worker>.<account-subdomain>.workers.dev`，其中 account subdomain 是账号级设置，变更会影响该账号下所有 Workers。部署前确认用户自己的 DNS 托管、收信策略、事务邮件发信域名和 Reply-To。
- 修改 API 或存储边界后，优先跑 `pnpm -C apps/relay-server test` 和 `pnpm -C apps/relay-server typecheck`。
- 修改 Vercel / Cloudflare 入口后，额外跑 esbuild bundle smoke：Vercel 使用 `apps/relay-server/api/relay.ts` + `--platform=node`，Cloudflare 使用 `apps/relay-server/cloudflare/worker.ts` + `--platform=browser` 并 external `node:*`。
- 修改 `/admin` 静态挂载时，先跑 `pnpm -C apps/relay-admin build`，再用 relay-server smoke 请求 `/admin/assets/admin.js` 与 `/admin/assets/admin.css`。
