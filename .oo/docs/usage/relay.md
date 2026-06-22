# Relay 托管、登录与身份模型

Relay 是 One Works 插件设备和云端会话之间的中继服务。普通用户默认使用 One Works 托管服务；只有需要私有化部署、公司内网隔离或自有域名 / 存储 / SSO 策略时，才需要自己部署 Relay Server 与 Admin。

## 私有化部署配置清单

私有化部署前，先把下面这些配置定下来，再创建平台项目、OAuth client、邮箱域名或 passkey：

| 配置项       | 建议                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 公开域名     | 先确定用户最终访问的 `https://relay.example.com` 这类域名，再配置 SSO / passkey。                             |
| 部署形态     | Vercel 单项目使用 Postgres；Cloudflare 使用 Pages + Worker / Durable Object；单机 Node 通常使用 SQLite。      |
| `PUBLIC_URL` | `ONEWORKS_RELAY_PUBLIC_URL` 指向浏览器实际打开的 Admin / login / API origin。                                 |
| CORS         | `ONEWORKS_RELAY_ALLOW_ORIGIN` 生产环境只放允许访问的前端 origin，不使用 `*`。                                 |
| 密钥         | Admin token、设备元数据密钥、数据库 URL、邮件 key、OAuth secret 都放平台 secret store。                       |
| 邮件         | 验证码、邀请、系统通知使用稳定发信域名和角色地址 Reply-To，不把发信 DNS 绑在 Relay Web host 上。              |
| SSO          | callback URL 必须和 Relay 实际发出的 URL 完全一致；内置 GitHub / Google 用专用环境变量，飞书用 Admin 预设。   |
| Passkey      | 在最终 HTTPS origin 上注册；必要时显式设置 `ONEWORKS_RELAY_PASSKEY_ORIGIN` / `ONEWORKS_RELAY_PASSKEY_RP_ID`。 |
| 插件服务     | Relay plugin 的 `servers[]` 只写最终公开 origin；dev、prod、公司内网服务可以并存。                            |

配置属于部署环境，不属于代码常量。不要把真实账号 ID、项目 ID、个人邮箱、数据库连接串、OAuth secret、Resend key、验证码或临时部署 URL 写进 README、`.oo/docs`、规则文件、截图或示例配置。

排查平台配置时，先确认自己查的是正确项目和环境：

- Vercel 用 `vercel env ls production` 查当前项目的 production 环境变量；如果部署命令使用 `--prod`，即使域名叫 dev，也要改 production env。`vercel env pull` 会把 secret 写到本地文件，只能写到 ignored scratch 文件并及时删除。
- Cloudflare Workers 用 `wrangler secret list --name <worker-name>` 查 Worker secrets；workflow 如果用 `--name` 覆盖 Worker 名，查 secret 时也必须带同一个名字。
- Cloudflare Pages 和 Workers 是两套 env store。Admin Pages 的 proxy env 与 Relay Worker 的 SSO / storage secret 互不共享，要分别检查。
- 删除旧变量后重新 list 确认不存在，再重新部署。Vercel 需要新 deployment 才会读取新 env；Cloudflare secret put/delete 可能立即产生新 Worker 版本，但仍应跑正式部署 workflow 保证代码和配置来自同一个 commit。

部署完成后至少检查：

```bash
curl -fsS https://<relay-origin>/health
curl -fsS https://<relay-origin>/api/auth/providers
curl -i https://<relay-origin>/api/admin/users
```

`/health.version` 应等于实际部署的 `@oneworks/relay-server` 包版本。只返回 `ok` 还不够，还要确认 public URL、登录方式、SSO provider、邮件验证码、passkey 和插件设备注册都在最终域名上工作。

## OpenAPI 与系统访问令牌

Relay Admin 提供两份隔离的机器可读 OpenAPI 文档：

```text
<relay-origin>/api/admin/openapi.json
<relay-origin>/api/profile/openapi.json
```

`/api/admin/openapi.json` 只描述平台管理员 API，包括用户、用户组、邀请码、SSO、团队策略、团队、团队成员组、消息、配置 profile / secret 和运维指标。`/api/profile/openapi.json` 只描述当前用户自己的个人 API，包括个人安全、当前用户团队自助流程、团队成员组和托管配置读取 / 管理。也可以在 Admin 的 `/admin/openapi` 页面直接查看、下载或打开这两份 JSON。受保护接口使用 `Authorization: Bearer <token>`；token 可以是部署级 Admin token、登录 session token，或用户在 `/admin/profile` 个人页面生成的 API 访问令牌。密码、Passkey 和访问令牌管理仍必须使用正常登录 session；删除当前账号接口也允许当前用户 API 访问令牌调用。

API 访问令牌属于当前登录用户，分为 `user`、`team`、`platform` 三种作用域：用户级令牌只操作当前账号数据；团队级令牌绑定一个团队，并按团队成员组授权；平台级令牌按平台用户组授权。`permissionGroupMode=all` 表示跟随账号当前拥有的全部用户组，`custom` 表示只授予指定用户组。服务端只保存令牌 hash 和 preview，完整令牌只在生成时显示一次；遗失后需要撤销并重新生成。API 访问令牌不能继续生成或撤销其他 API 访问令牌，这类安全操作必须使用正常登录 session。

平台管理员通过 `/admin/access-groups` 管理平台用户组及其能力、配额；团队负责人通过团队详情的“成员组”子页管理当前团队内的成员组。团队成员组只作用于当前团队，平台管理员不会因此获得跨团队查看或管理团队私有信息的权限。平台用户组和团队成员组都支持默认名称 / 说明，以及按系统支持语言填写的 `localizedNames` / `localizedDescriptions`；内置系统默认组会自动补齐所有支持语言的默认文案。界面会优先按用户语言展示多语言文案，未命中时回退到默认字段。

## 登录方式

`/login` 是 Relay 插件、Admin 和 Web 回跳共用的登录页。部署方可以通过 `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD` 设置默认方式，浏览器也会记住用户上次选择的方式。

- 密码登录：用于已有密码的非 SSO 账号。
- 验证码登录：只用于已有的非 SSO / `email_code` 账号。它会向该账号绑定的邮箱发送登录验证码，不会创建新账号，也不会用同邮箱登录 SSO-only 账号。
- Passkey：同一个入口同时支持登录和注册。用户先输入邮箱或账号名并点击“使用 PASS KEY”；如果已有 passkey，就直接唤起系统认证；如果没有 passkey 且允许注册，才进入注册流程。
- SSO：通过管理员配置的 Google、GitHub、飞书或自定义 OAuth/OIDC provider 登录。

## Passkey 注册体验

Passkey 登录页应该保持两阶段：

1. 第一屏只要求邮箱或账号名、记住账号选项和“使用 PASS KEY”按钮。
2. 只有当服务端判断当前账号没有可用 passkey，且部署策略需要额外信息时，才进入第二步。

第二步展示哪些字段由服务端配置决定：

- `ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED=on` 时显示邮箱验证码。
- `ONEWORKS_RELAY_REGISTRATION_MODE=invite_required` 时显示邀请码。
- 如果新账号注册不需要验证码也不需要邀请码，就不显示第二步，直接进入浏览器 passkey 创建流程。

已有账号新增 passkey 仍然必须验证邮箱，不能因为关闭新账号邮箱确认而跳过已有账号的绑定确认。生产环境要在最终用户访问的 HTTPS 域名上注册 passkey，并设置 `ONEWORKS_RELAY_PUBLIC_URL`；如需固定 WebAuthn 期望值，再设置 `ONEWORKS_RELAY_PASSKEY_ORIGIN` 与 `ONEWORKS_RELAY_PASSKEY_RP_ID`。Passkey 绑定 origin，迁移域名后旧凭据可能无法继续使用。

## 账号身份模型

Relay 不把邮箱当作全局唯一账号键。`users.email` 是联系邮箱；真正的登录来源保存在服务端的 auth identity 里。

- `loginId` 是用户可见、全局唯一的账号名，用户登录后可以修改。
- SSO 账号用 `(provider, providerUserId)` 绑定，同一个邮箱通过 Google、GitHub 和飞书登录会创建独立账号。
- Google 和通用 OIDC 必须返回 verified email；GitHub 使用 verified primary email；飞书联系邮箱只作为展示 / 联系信息，不作为 Relay 已验证邮箱，缺失时使用 `.invalid` 占位联系邮箱。
- 邮箱验证码只匹配 `email_code` 身份，不会因为邮箱相同而登录 SSO-only 账号。
- 新建非 SSO 用户、密码用户、邀请码用户和 passkey 用户会拥有 `email_code` 身份，因此可以使用验证码登录。

这个模型避免了企业场景里同一个人用公司 SSO、个人 GitHub、Google 账号时互相覆盖，也避免了未验证邮箱导致的误绑定。

## SSO 配置经验

创建 OAuth / OIDC provider 前先确认要支持的 public origin：本地开发、dev 环境、production 环境和自定义域名。Provider 的 callback URL 必须和 Relay 实际发出的地址完全一致。

常见 callback 路径：

```text
<relay-origin>/api/auth/oauth/github/callback
<relay-origin>/api/auth/oauth/google/callback
<relay-origin>/api/auth/oauth/<provider-id>/callback
```

Admin 中维护的 provider secret 只保存在服务端，列表和详情接口只返回脱敏值。面向用户的 SSO 按钮应使用 provider 品牌图标，不要退回通用登录图标。

内置 GitHub / Google 登录使用专用环境变量，不要把 `github` 或 `google` 写进 `ONEWORKS_RELAY_SSO_PROVIDERS`。这两个 provider id 是保留的；如果旧部署里已经写错，要从 Vercel、Cloudflare 或对应平台的所有环境变量 / secret store 中清掉旧值，重新部署后分别验证 `/health`、`/api/auth/providers` 和 OAuth start `302`。飞书自建应用使用 Admin 里的飞书预设，Client ID 填 App ID，Client Secret 填 App Secret，并在飞书开发者后台添加 `<relay-origin>/api/auth/oauth/feishu/callback`；本地调试可以用 `http://127.0.0.1:<port>/api/auth/oauth/feishu/callback`，但必须和 Relay 实际发送的地址完全一致。飞书自建应用通常面向当前企业租户内的用户，管理员发布并审批应用权限后，用户需要属于该飞书企业并能访问这个应用才能完成登录；不要把它当作面向任意外部用户的公开 OAuth 入口。

私有化部署时，先确定用户最终访问的公开域名，再配置 SSO 和 passkey。Vercel 单项目通常把 Admin、API 和登录页放在同一个域名；Cloudflare Pages + Worker 这类分离部署也应把 OAuth callback 注册到用户打开的 Pages / 自定义域名，而不是隐藏的 Worker 地址。开发、测试、生产是否共用同一个 OAuth client 由部署方决定；需要隔离 secret、callback 或受众时，应使用独立 client。

## 验证码与风控

验证码、邀请和登录邮件都应经过同一条发送链路：Turnstile、域名 allowlist / blocklist、一次性邮箱拦截、同邮箱 / 同 IP / 同域名频率限制、全局日 / 月预算，再调用事务邮件 provider。短时间重复请求应复用 TTL 内的有效验证码，避免被刷出账单。

文档、截图和示例配置不要写入真实个人邮箱、OAuth secret、Resend key、数据库 URL 或测试验证码。
