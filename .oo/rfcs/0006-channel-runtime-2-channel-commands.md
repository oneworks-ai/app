---
rfc: 0006
title: Channel Runtime 2.0 - Channel Commands
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Channel Commands

## Summary

Channel command 不应作为绕过 agent/runtime 的旁路命令系统。它们应统一注册为 agent 可调用的 typed command tools，例如 `channel.identity.whoami`、`channel.policy.mute`、`channel.availability.off`、`channel.memory.show`。

无论命令来自 slash command、自然语言还是 pending intent 续接，执行权限都按触发消息的发送者解析。Agent 可以决定调用哪个 command tool，但不能使用机器人自己的权限替发送者越权执行。

## Command Tool Model

命令工具是普通 tool 的一个受限子集：

```ts
interface ChannelCommandTool {
  name: string
  namespace: 'channel'
  action: string
  schema: JsonSchema
  capability: string
  visibility: 'public' | 'dm' | 'ephemeral' | 'none'
  risk: 'low' | 'medium' | 'high'
}
```

示例命名：

```text
channel.identity.whoami
channel.identity.link
channel.identity.accounts
channel.policy.status
channel.policy.warn
channel.policy.mute
channel.availability.off
channel.availability.on
channel.backlog.list
channel.backlog.process
channel.memory.show
channel.memory.pin
channel.memory.forget
```

旧的 `/identity whoami` 只是 `channel.identity.whoami` 的一种文本入口。自然语言“我是谁”“把这个人屏蔽十分钟”“今天先下班”也可以由 ChildSession 解析后调用同一工具。

## Actor Context

每次 command tool 调用必须携带 ActorContext：

```ts
interface ActorContext {
  actorUserId: string
  actorAccountId: string
  channelLinkId: string
  entityId: string
  entityChannelId: string
  childRunId: string
  sourceMessageId: string
  source: 'slash' | 'natural_language' | 'system_resume' | 'approval_resume'
  approvedByUserId?: string
}
```

默认规则：

- `actorUserId` 是触发消息的 canonical user。
- `actorAccountId` 是触发消息的平台账号。
- Agent 不能把 actor 改成 bot、entity owner 或管理员。
- `approvedByUserId` 只表示审批人，不替代 actor，除非工具定义明确要求审批人作为资源 owner 执行。
- system resume 只能执行系统 capability，例如 backlog digest；不能继承原发送者的全量权限。

这解决“agent 可以调用命令，但权限走发送者”的边界。

## Invocation Flow

Slash command 流程：

```text
platform slash command
  -> resolve channel link and sender
  -> IngressRouter create_child with mode=command
  -> ChildSession receives parsed command intent
  -> agent calls matching channel command tool
  -> ApprovalPolicyResolver checks actor permissions
  -> tool executes or creates pending approval
```

自然语言流程：

```text
user message
  -> IngressRouter create_child
  -> ChildSession interprets request
  -> agent calls channel command tool when appropriate
  -> same actor permission check
```

直接命令和自然语言最终走同一套 tool registry、权限和审计。

## Permission Semantics

Command tool 的权限不由 LLM 决定。Tool runtime 调用前必须询问 ApprovalPolicyResolver：

```text
actor user/account
entity channel
tool capability
target resource
requested action
risk level
visibility
```

结果：

- `allow`: 执行工具。
- `degrade`: 改成低风险版本，例如只生成草稿或只展示状态。
- `ask_trigger_user`: 让发送者确认。
- `ask_resource_owner`: 找资源 owner 审批。
- `ask_channel_admin`: 找频道管理员审批。
- `deny`: 拒绝并给出可展示原因。

高风险命令如 `channel.policy.mute`、`channel.memory.forget`、`channel.identity.merge` 必须写审计；必要时要求二次确认。

## Target Resolution

Agent 可以从自然语言里提取目标，但 tool runtime 必须重新校验：

- 目标用户是否属于当前 channel link 可见范围。
- 目标消息是否来自当前 entity channel。
- 目标记忆是否可被 actor 查看或修改。
- 目标策略是否允许 actor 修改。
- 参数是否满足命令 schema。

不能信任模型解析出的 user id、message id 或 memory id。

## Response Behavior

Command tool 返回结构化结果：

```ts
interface ChannelCommandResult {
  status: 'ok' | 'degraded' | 'pending_approval' | 'denied' | 'failed'
  publicSummary?: string
  privateSummary?: string
  auditId?: string
  pendingIntentId?: string
}
```

ChildSession 决定如何表达结果，但必须尊重 result visibility：

- 公开群里只发安全摘要。
- 私密信息用 dm 或 ephemeral。
- 审批中的操作只提示“已发起授权/等待谁处理”，不泄露 token 或敏感资源。

## Direct Execution Fast Path

部分低风险 slash command 可以走 fast path，例如 `/identity whoami` 或 `/policy status`。但 fast path 仍必须：

- 创建 `channel_command_runs` 审计。
- 携带 ActorContext。
- 走同一套权限检查。
- 产生与 ChildSession tool call 相同的结果格式。

Fast path 只是省掉模型理解，不是绕过 runtime。

当前落地状态：

- 现有 channel command middleware 仍保留 slash fast path；同时 `CommandSpec` 树已能生成 `channel.*` sender-scoped typed tool registry。
- 解析成功的 slash fast path 会写入 `channel_command_runs`，记录 actor、channel、channel link、command path、raw args、permission、status 和错误；成功、管理员拒绝和执行失败都会完成 run 状态。
- `invokeChannelCommandTool()` 已可按 tool name + JSON input 调用同一条 command runner，typed invocation 和 slash fast path 共享权限拦截、action 和 `channel_command_runs` 审计；typed invocation 的 run source 默认为 `natural_language`。
- 服务端新增 `/api/channels/:channelKey/commands` 和 `/api/channels/:channelKey/commands/invoke`。typed invoke 只接受服务端签发给当前 child run 的短期 HMAC token、tool name 和 input，不接受调用方自报 actor、session 或 reply target。
- CLI 新增 `oneworks channel command list` 和 `oneworks channel command invoke <toolName> [jsonInput]`，供 ChildSession / agent 使用。CLI 从当前消息上下文文件读取 invocation token；服务端再用 token 关联 child run、session actor snapshot 和不可变 delivery binding，重建 sender-scoped authority。
- `buildChannelRuntimeSystemPrompt()` 和 `oneworks-channel` skill 已提示 agent：管理频道内部状态使用 `oneworks channel command`，command output 只进入 shell / Chat History；需要群里可见时再用 `oneworks channel send` 发摘要。
- 新增 `/auth request <capability> [message]`：按发送者 `ctx.actor.user` / `ctx.actor.account` 创建 `channel_authorization_requests`。
- 新增 `/auth list`：普通用户查看自己的 pending 授权请求；未绑定 canonical user 时按平台账号查询。
- 新增 `/auth grant <id>`、`/auth deny <id> [reason]`：管理员可把 pending 授权请求标记为 granted / denied；当请求由 session permission interaction 自动镜像而来时，会 best-effort 调用 `handleInteractionResponse` 续接原会话。

这一步已经把授权状态同时暴露为 slash fast path 和 agent CLI typed invocation，并补上了 run 审计、typed registry 元数据、server route 和 ChildSession prompt 注入。command runner 已接入 `services/channel-approval` 的最小 resolver：权限主体优先使用当前 inbound sender，管理员命令不再直接读 `isAdmin(ctx)` 作为唯一裁决点，approval 摘要会写入 `channel_command_runs.metadata.approval`。它还没有接入 MCP/native tool surface，也还没有接入完整 policy layer 与授权送达策略；后续要把更多 child session tool call、actor credential 检查、审批送达和审计记录统一起来。

## Single-Login Constraint

当前 OneWorks 不支持多账号登录，因此 command tool 的 sender authority 不能等同于“已经拿到了发送者的可执行凭证”。设计上分成两层：

- `actor identity`：来自 inbound 消息，可用于权限判断、审计、记忆归属和审批请求归属。
- `actor credential`：用户单独授权后的可执行凭证，只在需要代表该用户调用个人 API 时使用。

如果 typed command 只修改当前 entity/channel 的配置，例如 `/auth list`、`/whoami`、`/access`，可以按 actor identity 和频道管理员规则执行。如果它需要用户个人账号能力，例如读取某人的私有云文档、代某人审批、代某人加人进群，则必须先检查 credential state；没有凭证时生成 authorization intent，并优先私信、ephemeral 或授权页请求本人授权。不能退化成使用当前登录用户、bot app 或企业管理员账号代替发送者执行。

因此当前 CLI 注入方案的边界是：CLI 是携带一次 child-run capability token 的 transport，不是登录态本身。服务端只相信签名 token 指向的持久化 actor snapshot、child run 和 delivery binding，并按 channel 配置、identity link 和 authorization request 判定；如果将来支持多账号 OAuth，也应只是补齐 `actor credential`，不能改变 `actor identity` 的来源。

## Observability

每次 command run 记录：

- command tool name 和 action。
- source: slash / natural language / system resume / approval resume。
- ActorContext。
- target resources。
- ApprovalPolicyResolver 决策。
- result status 和 audit id。

这样可以解释“为什么 agent 能调用这个命令”“为什么权限按谁算”“为什么这次被拒绝或进入审批”。

## Design Principle

Channel command 是 agent 的 typed capability，不是 bot 的超级管理员后门。Agent 可以帮助用户选择和填写命令；最终能不能执行，永远由发送者身份、频道配置和审批策略决定。
