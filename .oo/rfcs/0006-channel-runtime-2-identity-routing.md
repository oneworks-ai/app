---
rfc: 0006
title: Channel Runtime 2.0 - Identity And Routing
status: implemented
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Identity And Routing

## Summary

Channel Runtime 2.0 需要把“平台账号”与“OneWorks 用户”拆开。一个人可能同时有 Lark、WeChat、Telegram、Discord 账号，甚至在同一 Lark 租户下因不同 app 拥有不同 `open_id`。系统必须先解析 canonical user，再加载记忆、权限、策略和模型路由。

## Identity Graph

账号唯一键：

```text
channelType + tenantId + appId/botId + accountId
```

例子：

```text
user_123 = 示例用户
  - lark / tenant=A / app=OWO演示 / open_id=ou_xxx
  - lark / tenant=A / app=owo-cli / open_id=ou_yyy
  - wechat / openid=wx_xxx
  - telegram / user_id=tg_xxx
  - discord / user_id=dc_xxx
```

Lark 的 `open_id` 是 app-scoped，所以必须把 app/bot 维度写进 account key。

## Current Landing

当前服务端已经落了第一层持久化与入站解析骨架：

- `apps/server/src/db/channelIdentities/schema.ts`
  - `channel_accounts_v2`：保存平台账号元信息，主键是 `issuerKey(channelKey) + accountId`，`accountKey` 用来承载租户/app/bot 维度后的稳定账号引用。
  - `canonical_users`：保存 OneWorks 认知里的统一用户。
  - `channel_identity_links_v2`：在明确 issuer namespace 下把平台账号绑定到 canonical user，当前状态先支持 `pending / verified / revoked`。
  - `channel_identity_link_codes`：保存短期跨账号绑定码，用于证明两个 channel account 由同一人控制后绑定到同一个 canonical user。
  - `channel_user_credentials_v2`：按 `issuerKey + userId + credentialKey` 保存 credential 元信息和状态，不保存 token 本体。
  - `channel_authorization_requests`：保存用户级授权请求的 pending / granted / denied / expired 生命周期。
- `apps/server/src/channels/middleware/identity.ts`
  - 每条带 `senderId` 的 inbound message 会先 upsert 平台账号。
  - 如果账号已有 `verified` 绑定，会把 `ctx.actor.user` 解析成 canonical user。
  - 不会因陌生账号发消息而自动创建 canonical user，避免把未验证用户直接纳入跨平台记忆。
- `/whoami`
  - 已能展示当前 sender、channel account、account key、canonical user、identity link 状态和当前 channel type 下的 credential 数量。
  - 这个输出用于排查“系统认得这个人”和“系统能代表这个人执行 API”是否被混淆。
- `/identity link` / `/identity link <code>` / `/identity accounts`
  - `/identity link` 会为当前账号解析或创建 canonical user，并生成 10 分钟有效的短期绑定码。
  - `/identity link <code>` 会把当前频道账号绑定到 code 所属 canonical user；如果当前账号已绑定到另一个用户，会拒绝并要求管理员处理。
  - `/identity accounts` 会列出当前 canonical user 下已绑定的 channel accounts。
  - 这些命令同样通过 `channel.*` typed command registry 暴露，权限按发送者 actor 走，并写入 `channel_command_runs` 审计。

这一步解决“我知道这条消息来自哪个账号、这个账号是否已绑定某个用户、后续授权请求应挂到谁身上”，并提供了安全的自助跨账号绑定。它还没有实现管理员 merge/split audit log、真实 OAuth/token 存储和多账号可执行登录态。

## Link State

```text
candidate
verified
admin_verified
revoked
conflict
```

`candidate` 可以来自通讯录、邮箱、手机号、昵称或外部目录，但不能直接用于跨平台记忆共享。只有 `verified` 或 `admin_verified` 才能参与 canonical user 级记忆和权限。

## Binding Methods

自助绑定：

```text
用户在 A 平台发 /identity link
系统生成短期 code
用户在 B 平台发 /identity link <code>
系统确认两个账号由同一人控制后绑定
```

当前实现采用一次性短期 code：source account 生成 code，target account 消费 code。code 过期后会标记为 expired；target account 已绑定到其他 canonical user 时不会覆盖，避免误合并。消费成功只写 `channel_identity_links(source=link_code)`，不会创建或复制 `channel_user_credentials`。

管理员绑定：

```text
/identity bind <canonicalUserId> <accountRef>
/identity unbind <accountRef>
/identity merge <userA> <userB>
/identity split <accountRef>
/identity audit <user>
```

安全规则：

- 不凭昵称自动合并。
- 管理员绑定需要 audit log。
- merge 必须保留被合并用户的历史映射。
- split 后旧记忆不能继续自动套用到被拆出的账号。

## Login And Credential State

Identity binding 只证明“这些平台账号属于同一个 canonical user”，不等于 OneWorks 已经拥有这些账号的可执行登录态。每个 ChannelAccount 需要独立记录 credential state：

```text
unbound       只看到平台账号，未绑定 canonical user
linked        已绑定 canonical user，但没有可执行凭证
authorized    已授权，可按 scope 使用该账号凭证
expired       曾授权但凭证过期
revoked       用户或管理员撤销授权
service_only  只能使用 app/bot/service principal 能力
```

在不支持多账号登录的阶段，大部分账号只能处于 `linked` 或 `service_only`。它们仍然可以参与记忆归属、软屏蔽、上下班策略、router 规则和审计，但不能作为 executable actor 去调用用户级 API。需要用户级 API 时，ApprovalPolicyResolver 应创建授权 pending intent，而不是把动作落到当前登录用户或机器人账号上。

当前实现用 `channel_user_credentials_v2.status` 表达 credential 层状态：

```text
needs_auth
active
expired
revoked
```

这和 identity link 状态刻意分离：账号已绑定用户不代表系统已经能代表该用户调用平台 API。

当前没有多账号登录闭环时，所有 channel actor 都按“可识别但未必可执行”处理。`/whoami` 中出现 canonical user 只能说明身份绑定成功；credential 数量为 0 或只有 `needs_auth / expired / revoked` 时，用户级 API 仍必须进入 authorization request、degrade 或 deny。agent、CLI 和 native channel UI 都不能把本地当前登录态当成这个 actor 的 credential。

授权请求也保持同样的拆分：

- `requesterUserId/requesterAccountId`：谁触发了这次频道消息或 command。
- `credentialSubjectUserId`：哪个 canonical user 的可执行凭证缺失或 scope 不足。
- `credentialKey`：需要哪类凭证，不包含 token 本体。

当 requester 和 credential subject 不一致时，pending intent 应交给 credential subject 处理，resolver 状态为 `ask_resource_owner`。这避免当前单账号登录态、CLI token 或 bot app secret 被误认为“触发者本人已经授权”。

实现上把当前 OneWorks 登录态视为 `runner principal`，把机器人应用密钥视为 `service principal`，把频道消息发送者视为 `actor identity`，把真正能执行用户级 API 的授权记录视为 `credential principal`。这四者不能隐式互相替代：

- runner principal 可以管理本地 session、项目文件和 runtime 生命周期。
- service principal 可以收发机器人消息、读取频道事件和执行明确配置允许的 app 级能力。
- actor identity 用于权限裁决、审计、记忆归属、router 规则和授权请求归属。
- credential principal 才能代表用户执行个人 API 或访问用户私有资源。

因此多账号登录不是 identity graph 的前置条件。MVP 只要保证所有工具调用在执行前显式声明需要哪种 principal，并在缺少 credential principal 时返回 `needs_authorization / ask_resource_owner / deny`，就能先安全落地。

## Inbound Resolution

每条 inbound message 先解析 channel link，再解析发送人身份：

```text
PlatformEvent
  -> ChannelLink
  -> exactly one Entity
  -> EntityChannel
  -> ChannelAccountRef
  -> ChannelAccount
  -> CanonicalUser or platform-local user
```

`ChannelLink` 来自 `.oo/channels/<link>/channel.json`，一个 link 必须且只能绑定一个 entity。入站解析阶段不允许根据消息内容切换 entity；后续 Ingress Router 也只能在这个 entity 范围内决定是否创建 ChildSession，以及使用什么 mode/model/adapter。

如果需要另一个实体参与，应由已创建的 ChildSession 通过显式 handoff / delegation 请求，而不是由入站 router 静默改派。

如果没有绑定，创建 platform-local canonical user：

```text
status = unverified
scope = account
```

未验证用户仍可工作，但只能使用 account/channel 范围记忆，不读取跨平台 canonical user 记忆。

如果账号已绑定 canonical user 但没有可执行 credential，Memory Resolver 仍可在权限允许时加载该 canonical user 的可见记忆；执行外部动作时必须再检查 credential state。也就是说，身份认知和执行授权是两条链路：前者服务于“我知道你是谁”，后者服务于“我能不能代表你做事”。

## Access Model

现有 senderId 级配置应扩展为 user/account 双粒度：

```json
{
  "access": {
    "admins": {
      "users": ["user_123"],
      "accounts": ["lark:tenant:app:ou_xxx"]
    },
    "bypassUsers": ["user_boss"],
    "blockedUsers": ["user_spam"],
    "blockedAccounts": ["telegram:tenant:bot:tg_xxx"]
  }
}
```

推荐语义：

- `admins.users` 跨平台生效。
- `admins.accounts` 只对某个账号生效。
- `blockedAccounts` 优先于 `blockedUsers`，用于局部封禁。
- user-level block/mute 要比 account-level 更谨慎。

## Routing Model

模型和 adapter 路由在单个 entity channel 内解析，优先级：

```text
account rule
> canonical user rule
> mode rule
> entity channel rule
> entity rule
> global default
```

示例：

```json
{
  "routing": {
    "default": { "model": "gpt-5.4", "adapter": "codex" },
    "moderation": { "model": "deepseek-chat" },
    "offHoursDigest": { "model": "deepseek-chat" },
    "users": {
      "user_boss": { "model": "gpt-5.5", "adapter": "codex" }
    },
    "accounts": {
      "lark:tenant:app:ou_xxx": { "model": "gpt-5.4-mini" }
    }
  }
}
```

Routing decision 应写入 `child_session_runs`，用于解释为什么某次执行用了某个模型或 adapter。

Ingress Router 的决策应写入 `ingress_router_runs`。当 decision 不是 `create_child` 时，不会产生 `child_session_runs`，但仍要能解释为什么 ignore、observe 或 defer。

## Commands

这些文本命令应映射到 `channel.identity.*` typed command tools。直接 slash command 和自然语言触发都走同一套 sender-scoped 权限与审计。

```text
/identity whoami
/identity link
/identity link <code>
/identity accounts
/identity unlink <account>
/identity audit <user>
```

管理员命令：

```text
/identity search <query>
/identity bind <user> <account>
/identity unbind <account>
/identity merge <userA> <userB>
/identity split <account>
/identity trust <account>
```

## Privacy Boundary

绑定身份不等于所有记忆都能跨平台共享。Canonical user 只是主语统一；Memory Resolver 仍必须检查 memory scope、source channel、conversation type、sensitivity 和 visibility。
