---
rfc: 0006
title: Channel Runtime 2.0 - Approval Policy
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-17
targetVersion: vNext
---

# RFC 0006: Approval Policy

## Summary

ChildSession 的权限 envelope 只决定“这次执行最多能申请什么”。具体某个工具调用、外部发送、文件修改或配置变更是否能执行，必须由 ApprovalPolicyResolver 决定。审批逻辑应按 canonical user、channel account、entity、channel、工具、资源和风险等级分层解析。

## Motivation

不同人需要不同审批逻辑：

- 老板或管理员可以自动通过一部分操作。
- 外部体验用户只能触发低风险回复，高风险操作要问内部 owner。
- 普通成员可以操作自己负责的项目资源，但不能改全局配置。
- 系统任务如 off-hours digest 可以自动整理 backlog，但不能自动向外部群发送敏感内容。
- 某些工具对所有人都必须确认，例如删除、转账、发布、创建长期凭证。

因此审批不能只绑定 permission mode，也不能只按频道统一处理。

## Resolution Inputs

```text
triggering canonical user
triggering channel account
entity and entity channel
child session mode
requested capability
tool name and action kind
actor context for command tools
resource owner and scope
risk level and sensitivity
channel visibility
policy state
existing grants
```

Resolution result:

```text
allow
ask_trigger_user
ask_resource_owner
ask_channel_admin
ask_entity_admin
deny
degrade
```

`degrade` 表示改用更低风险能力，例如只生成草稿、不发送；只总结、不修改；只列计划、不执行。

Channel command tool 的 actor 必须来自触发消息的发送者：`actorUserId` 和 `actorAccountId` 由 inbound resolution 写入 ChildSession，agent 不能自行改写。即使 agent 通过自然语言理解后调用 `/policy mute` 对应的 typed tool，权限也按发送者而不是 bot、entity owner 或系统账号计算。

权限裁决和可执行凭证必须分开。`actorUserId` 表示“这次请求是谁发起的”，不表示系统已经拥有这个人的 OAuth token、平台账号登录态或外部系统凭证。工具在执行前必须同时满足：

```text
approval result allows requested capability
AND executable credential exists for the required subject
AND credential scope covers the requested resource/action
```

在当前单账号登录阶段，用户级 credential 大概率不存在。此时 resolver 只能返回 `ask_trigger_user`、`ask_resource_owner`、`ask_channel_admin`、`degrade` 或 `deny`，不能静默改用机器人账号执行需要本人权限的动作。机器人账号或 service principal 只能执行明确配置为 app-level/service-level 的能力，例如发送机器人回复、读入站事件、整理 backlog、写入 OneWorks 自己的 channel session 记忆。

当前落地状态：

- `identityMiddleware` 已把入站 sender 解析成 `ctx.actor.account`，如果已有 verified 绑定则同时提供 `ctx.actor.user`。
- `channel_user_credentials_v2` 已能按 issuer 记录用户在某 channel app 下的 credential 元信息和 `needs_auth / active / expired / revoked` 状态。
- `channel_authorization_requests` 已能记录 pending 授权请求及 resolved 状态，用于后续把“需要某人授权”从 child session 中持久化出来。表内刻意区分 `requesterUserId/requesterAccountId` 和 `credentialSubjectUserId`：前者表示谁触发了这次请求，后者表示谁的可执行凭证需要补齐；两者相同时是本人授权，两者不同时 resolver 返回 `ask_resource_owner`，pending intent owner 也指向 credential subject。
- `/auth request|list|grant|deny` 已能通过 channel command fast path 创建、查询、批准和拒绝 `channel_authorization_requests`；普通查询按发送者 actor 限定，grant / deny 目前只允许频道管理员。
- channel session 中发出的 `interaction_request(kind=permission)` 已会镜像为稳定 id 的 `channel_authorization_requests`，并写入 `metadata.approval`，把当前 sender/canonical user、capability、resolver status 和 reasonCode 固化下来。如果请求 metadata 中带有 `sessionId + interactionId`，`/auth grant` 会 best-effort 回复原 interaction 为 `allow_once`，`/auth deny` 会 best-effort 回复为 `deny_once`，让运行中的任务可以继续或失败。
- 解析成功的 channel command fast path 已写入 `channel_command_runs`，记录 actor、command path、权限等级和执行结果；现有 `CommandSpec` 树也已能生成 `channel.*` typed registry 元数据。
- `services/channel-approval` 已落地最小 ApprovalPolicyResolver：支持 `everyone/admin` command permission、sender 优先的 actor 解析、`active/expired/revoked/needs_auth` credential state 检查、scope 缺失判断，以及缺少 credential 时生成稳定 `channel_authorization_requests`。
- 当 required credential 的 `subjectUserId` 和触发 actor 不一致时，resolver 不再把 subject 写回 requester，而是把 authorization request 记录为 `requester=触发者`、`credentialSubjectUserId=资源/凭证 owner`。这让没有多账号登录的阶段也能清楚表达“谁发起任务”和“谁需要授权”。
- slash command fast path 和 typed channel command invocation 已接入该 resolver。管理员命令仍保持原有外显行为，但权限判断现在走统一 resolver，并把 approval 裁决摘要写入 `channel_command_runs.metadata.approval`。
- channel-bound session 的 `/api/interact/permission-check` 已有单账号兼容 guardrail：除一次性 allow 和内置低风险 channel CLI 权限外，非内置工具不会因为本地 session/project `permissions.allow` 自动放行，而是返回 `channelApprovalAsk` 并创建稳定 `channel_authorization_requests`。这能防止当前 CLI / 桌面登录态被误当成外部发送者的可执行权限。
- 每次 channel 消息投递都会把本轮 `actorAccountId`、`actorUserId`、channel link、message id 和 sender 写入 `sessions.channelActorSnapshot`。permission-check 优先使用这个 snapshot，旧会话才 fallback 到 `channel_sessions.senderId`，避免群聊后续消息覆盖 binding 后影响正在运行的权限审批。
- 每次 channel inbound dispatch 都会写入 `channel_child_session_runs`，把 actor snapshot、messageId、entity、dispatch mode 和目标 sessionId 关联起来。权限请求和 authorization request 后续可以通过 sessionId / messageId / actor 追溯到触发 run。

尚未落地的部分是完整 policy layer 解析、授权请求送达策略、授权页面/私信/ephemeral 的平台能力适配、credential secret 的真实存储，以及多账号 OAuth 登录后的真实 credential 激活链路。当前 resolver 是最小可执行内核，permission-check guardrail 只解决“不偷用本地登录态”的安全边界；没有 credential 时仍只能 ask / degrade / deny，不能代表发送者直接执行个人平台权限。

## Single-Account Compatibility

当前 OneWorks 只有一个本地登录态，channel child session 运行时会共享同一套本地 CLI / adapter 进程。因此权限必须按下面三层处理：

1. `runtime permission`：本地运行器是否允许某个工具被调用。它可以用 once/session/project allow/deny 表达，但对 channel child 不能直接等价为发送者授权。
2. `actor approval`：这条频道消息的发送者、频道管理员、资源 owner 或 entity admin 是否允许这件事发生。这个由 ApprovalPolicyResolver 裁决，并写入 authorization request / audit。
3. `executable credential`：系统是否真的拥有目标用户的 OAuth token 或外部系统凭证。只有 credential active 且 scope 覆盖时，用户级外部动作才可执行。

在单账号阶段，channel-bound permission-check 的默认策略是：

- `onceAllow` 可以通过，用于 `/auth grant` 等已明确批准的当前 interaction 续接。
- `deny` 和 `ask` 仍保持更严格结果。
- `bash-oneworks-channel-send`、`bash-oneworks-mem` 等内置 channel runtime 能力可以 `channelDefaultAllow`，因为它们作用于当前 channel runtime 自己的回复和记忆。
- 其它工具即使命中了本地 session/project allow，也要转成 `channelApprovalAsk`，由发送者/管理员/owner 的审批和 credential 状态决定后续是否继续。
- actor 解析优先使用 session runtime state 中的 `channelActorSnapshot`，因为它代表本轮触发消息；`channel_sessions` 只是当前频道绑定状态，可能被后续消息刷新，不能作为正在执行任务的权威 actor。

多账号登录上线后，只是在第三层补齐 `executable credential`；不能把 actor identity 改回“当前桌面用户”，也不能让 bot app secret 冒充某个发送者。

## Policy Layers

解析优先级：

```text
hard deny
> explicit grant
> account policy
> canonical user policy
> role policy
> entity channel policy
> entity policy
> channel default
> global default
```

`hard deny` 永远优先，例如用户被 muted、账号未验证、资源超出组织边界、工具被全局禁用。

## User Approval Profile

每个 canonical user 可以有审批 profile：

```json
{
  "userId": "user_123",
  "trustTier": "external|member|admin|owner",
  "selfApproval": ["draft", "read", "reply"],
  "requiresOwnerApproval": ["file.write", "config.write"],
  "alwaysAsk": ["delete", "publish", "credential.create"],
  "delegatedApprovers": ["user_admin"]
}
```

Channel account 可以覆盖 user profile，用于只限制某个平台账号。

## Capability Grants

Grant 是有作用域和有效期的：

```json
{
  "subject": "user_123",
  "capability": "channel.reply",
  "scope": {
    "entityChannelId": "ec_xxx",
    "resource": "chat:oc_xxx"
  },
  "expiresAt": 1781550000000,
  "createdBy": "user_admin"
}
```

Grant 不应无限期默认扩大。临时授权优先，长期授权必须可审计、可撤销。

## Approver Selection

审批人选择规则：

- 用户请求操作自己的资源：优先 ask_trigger_user。
- 用户请求操作他人或团队资源：ask_resource_owner。
- 用户通过 channel command tool 触发管理动作：按 sender actor 权限裁决，不自动继承 bot 权限。
- 资源 owner 不明确：ask_channel_admin 或 ask_entity_admin。
- 外部用户触发内部动作：默认 ask_channel_admin。
- 系统任务要外发消息：根据 channel visibility 决定 ask_channel_admin 或 allow draft-only。
- 高风险动作：即使触发人是管理员，也可要求二次确认。

## Interaction Behavior

审批请求要绑定到具体 canonical user / channel account，而不是只绑定到当前频道。谁需要授权、谁能批准、谁需要补充信息，都应写入 pending intent；后续只有该用户的授权事件或有效回复能推进审批。

送达策略按能力降级：

1. 如果机器人能私信目标用户，优先私信发送完整授权说明和确认入口。
2. 如果平台支持只对目标用户可见的 ephemeral / only-visible 消息，可以在原频道发送这种消息。
3. 如果既不能私信，也不能发送只对目标用户可见消息，则在原频道发送不含敏感细节的公开提示，要求目标用户加机器人好友、打开授权链接或到管理后台处理。

群聊中不能把敏感资源、权限细节和审批 token 暴露给全群。公开提示只说明“需要某人授权才能继续”，完整上下文进入私信、ephemeral 消息或授权页面。

如果平台不支持私信或 ephemeral 消息，且机器人还不能主动联系目标用户，审批 pending intent 必须保留在 channel session 中，并在原频道只发一次最小提示：需要目标用户加机器人好友、打开授权入口或联系管理员。后续同一用户重复触发相同 pending intent 时走 throttle，避免刷屏。

审批结果要写入 child run：

```text
requested capability
resolved approver
delivery channel
decision
decision source
grant id if any
timestamp
```

超时默认拒绝或降级，不能默认通过。

## Examples

外部用户在飞书群让机器人改项目配置：

```text
trigger = external user
capability = config.write
result = ask_channel_admin or degrade to draft
```

老板让机器人发群公告：

```text
trigger = boss
capability = channel.reply.broadcast
result = allow or ask_trigger_user, depending on channel policy
```

下班 digest 要处理 backlog：

```text
trigger = service principal
capability = backlog.digest
result = allow
capability = channel.reply
result = allow summary or ask_channel_admin when sensitive
```

## Defaults

- 普通用户：读、回复、草稿类低风险能力可自动通过。
- 外部用户：默认不能触发写配置、删文件、发布、创建凭证。
- 管理员：可自动通过更多操作，但高风险动作仍可配置为 alwaysAsk。
- Service principal：只能执行 mode 允许的系统任务，不能继承任何人的全量权限。
- 未验证账号：只能使用 account/channel 级低风险能力。
