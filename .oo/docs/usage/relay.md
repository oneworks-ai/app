# Relay 托管、登录与身份模型

Relay 是 One Works 插件设备和云端会话之间的中继服务。普通用户默认使用 One Works 托管服务；只有需要私有化部署、公司内网隔离或自有域名 / 存储 / SSO 策略时，才需要自己部署 Relay Server 与 Admin。

## 登录方式

`/login` 是 Relay 插件、Admin 和 Web 回跳共用的登录页。部署方可以通过 `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD` 设置默认方式，浏览器也会记住用户上次选择的方式。

- 密码登录：用于已有密码的非 SSO 账号。
- 验证码登录：只用于已有的非 SSO / `email_code` 账号。它会向该账号绑定的邮箱发送登录验证码，不会创建新账号，也不会用同邮箱登录 SSO-only 账号。
- Passkey：同一个入口同时支持登录和注册。用户先输入邮箱或账号名并点击“使用 PASS KEY”；如果已有 passkey，就直接唤起系统认证；如果没有 passkey 且允许注册，才进入注册流程。
- SSO：通过管理员配置的 Google、GitHub 或自定义 OAuth/OIDC provider 登录。

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
- SSO 账号用 `(provider, providerUserId)` 绑定，同一个邮箱通过 Google 和 GitHub 登录会创建两个独立账号。
- Google 和通用 OIDC 必须返回 verified email；GitHub 使用 verified primary email。
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

私有化部署时，先确定用户最终访问的公开域名，再配置 SSO 和 passkey。Vercel 单项目通常把 Admin、API 和登录页放在同一个域名；Cloudflare Pages + Worker 这类分离部署也应把 OAuth callback 注册到用户打开的 Pages / 自定义域名，而不是隐藏的 Worker 地址。开发、测试、生产是否共用同一个 OAuth client 由部署方决定；需要隔离 secret、callback 或受众时，应使用独立 client。

## 验证码与风控

验证码、邀请和登录邮件都应经过同一条发送链路：Turnstile、域名 allowlist / blocklist、一次性邮箱拦截、同邮箱 / 同 IP / 同域名频率限制、全局日 / 月预算，再调用事务邮件 provider。短时间重复请求应复用 TTL 内的有效验证码，避免被刷出账单。

文档、截图和示例配置不要写入真实个人邮箱、OAuth secret、Resend key、数据库 URL 或测试验证码。
