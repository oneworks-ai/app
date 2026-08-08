---
rfc: 0006
title: Channel Runtime 2.0
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Channel Runtime 2.0

## Summary

Channel Runtime 2.0 把飞书、微信、Telegram、Discord 等频道从“一个频道绑定一个长期 session”升级为“实体驱动的多频道工作系统”。

核心变化：

- 每条频道消息或消息批先进入 entity-scoped IngressRouter；只有 create_child 决策才触发短生命周期 child session。
- 长期 channel session 只保存实体在该频道的记忆、策略、backlog 和路由状态。
- 跨平台账号通过 identity graph 绑定到 canonical user。
- 记忆加载由 Memory Resolver 负责 scope、权限、相关性和预算控制。
- 支持软屏蔽、上下班、回复节流、管理员/老板白名单、模型与 adapter 路由。
- 一个实体可以在多个频道工作，实体、用户、频道和账号维度的记忆各自可控。
- 提供正式的 OneWorks native channel，可作为产品内频道使用，也可通过 simulation webhook 做本地调试。

细节分册： [Ingress Router](./0006-channel-runtime-2-ingress-router.md)、[Channel Commands](./0006-channel-runtime-2-channel-commands.md)、[OneWorks Native Channel Plugin](./0006-channel-runtime-2-oneworks-channel-plugin.md)、[Identity And Routing](./0006-channel-runtime-2-identity-routing.md)、[Memory Resolver](./0006-channel-runtime-2-memory.md)、[Policy Engine](./0006-channel-runtime-2-policy.md)、[Approval Policy](./0006-channel-runtime-2-approval.md)、[Conversation Continuity](./0006-channel-runtime-2-continuity.md)。

## Motivation

当前 channel 模型适合简单的单群/单人持续对话，但真实团队协作里会出现：

- 群聊多人消息持续进入一个大上下文，容易污染 session。
- 同一个人在多个频道类型和多个 Lark app 下无法被识别为同一人。
- 频道记忆没有清晰的隐私、来源和可见范围。
- 机器人没有原生上下班、软屏蔽、节流、backlog 和用户级策略。
- 多角色机器人矩阵缺少统一实体模型，记忆、技能和经验难以复用。

目标产品语义是：**频道消息不是继续一个大聊天，而是触发某个实体在某个频道为某个已识别用户工作一次。**

## Goals

- 将 inbound channel message 先映射为 entity-scoped ingress event，再按决策升级为 child session execution。
- 保留 channel session 作为长期工作区，而不是长期执行上下文。
- 引入 Entity、EntityChannel、CanonicalUser 和 ChannelAccount。
- 将记忆读取改为受控 MemorySnapshot。
- 将记忆写回改为结构化、可审计、可回滚的 patch。
- 支持 warn、temporary mute、permanent mute 等软屏蔽等级。
- 支持下班固定话术、回复 throttle、backlog 和上班后统一处理。
- 支持按 entity/channel/user/account/mode 路由模型和 adapter。
- 将 channel command 统一为 agent 可调用的 typed command tools，并按发送者权限执行。
- 提供 first-party OneWorks native channel，用同一套 runtime 承载产品内频道、演示和本地调试。
- 兼容现有 `channels` 配置，并提供渐进迁移。

## Non-Goals

- 不调用飞书/微信/TG/Discord 的真实封禁 API。
- 不凭昵称或头像自动合并身份。
- 不默认把私聊记忆带入群聊。
- 不把完整原始聊天记录无脑写入长期记忆。
- 不要求所有频道类型一次性支持完全相同的能力。
- 不在单账号登录阶段假装可以代表每个群成员调用其个人平台权限。

## Concept Model

```text
Entity
  一个可工作的机器人实体，例如 OWO、产品、测试、运维。

ChannelLink
  .oo/channels/<link>/channel.json 中的外部频道入口。一个 link 必须且只能绑定一个 Entity。

ChannelAccount
  某人在某平台、某租户、某 app 下的账号身份。

CanonicalUser
  OneWorks 认知里的同一个人，可绑定多个 ChannelAccount。

EntityChannel
  ChannelLink 物化后的实体频道绑定，存配置、策略和 runtime 状态。

IngressRouter
  EntityChannel 自己的入站 gate，只判断 ignore / observe / create_child / defer，以及模型、adapter 和可见性。

ChannelSession
  EntityChannel 的长期工作区，存记忆、策略、backlog 和成员状态。

ChildSession
  每条消息或消息批触发的一次短执行，结束后提炼写回。

ChannelCommandTool
  Agent 可调用的频道命令工具，例如 identity、policy、availability、memory；执行权限按触发消息的发送者解析。
```

ChildSession 的执行上下文是一次性 runtime context：包含原始 inbound message、当前 entity/channel/canonical user/channel account、策略裁决、受控记忆快照、模型/adapter 路由和外部回复目标。它即用即结束，释放运行态上下文；持续对话靠 ChannelSession 中的 ConversationState、recent turns、pending intents 和 MemorySnapshot 维持，审计记录与写回结果保留。

当前 runtime 的具体落地是：每条被路由处理的入站消息都创建一个新的 OneWorks session，上一条 ChildSession 只作为 `parentSessionId` 和 workspace 来源，不复用仍在运行的 adapter session。新子会话在启动前获得不可变的 actor/delivery snapshot；父会话的持久 session 权限会复制到子会话，一次性权限通过 SQLite 事务只移动给一个子会话。授权恢复同样创建新的 ChildSession，不向原 runtime 直接追加消息。

身份和凭证分两层处理：`ChannelAccount -> CanonicalUser` 只解决“这是谁”，`ChannelUserCredential / AuthorizationRequest` 只解决“这次能不能代表他执行某个能力”。多平台、多账号绑定不会自动带来可执行权限；没有用户凭证时只能走授权、降级或拒绝。

授权请求进一步拆成 `requester` 和 `credentialSubject`：requester 是触发频道消息的人，credential subject 是需要提供可执行凭证的人。默认两者相同；当工具明确要求资源 owner 或其他用户凭证时，resolver 返回 `ask_resource_owner`，pending intent 归属 credential subject，而不是把触发者和授权人混为一谈。

## Child Session Permissions

ChildSession 权限由触发用户身份、channel/entity 配置上限、当前 mode 和 policy decision 合成，默认最小权限，不直接继承 bot 或长期 ChannelSession 的全部能力。普通用户只能使用当前频道允许的工具和外显回复能力；管理员/老板白名单可提升到配置允许的高权限；系统触发任务使用 service principal，但仍受 entity/channel 上限约束。具体权限申请由 ApprovalPolicyResolver 按用户、账号、工具、风险和资源所有者决定自动通过、询问本人、询问管理员/老板、降级或拒绝；所有决策都写入 child run。

当前 OneWorks 尚不支持多账号登录时，`actor=发送者` 只用于权限裁决和审计，不代表系统已经拥有该用户的平台 token。需要用户级凭证的工具调用必须检查 `actorCredentialState`：已绑定且已授权才允许执行；未授权则生成 pending approval / authorization intent，并优先私信、ephemeral 消息或授权页请求本人授权；无法私信也无法发仅本人可见消息时，只能公开提示其加机器人好友或进入管理后台授权。app 级或 service principal 能力可以继续用于机器人发言、读取频道事件等低风险频道能力，但不能冒充发送者执行个人权限操作。

因此当前阶段不要求实现多账号登录闭环。系统先稳定区分 `actor identity` 和 `actor credential`：前者来自消息发送者，用于权限、审计、记忆和审批归属；后者只有用户显式授权后才可用于个人 API。没有 credential 时，ChildSession 和 channel command tool 必须进入 pending authorization / degrade / deny，而不是退回当前桌面登录态、CLI 登录态或机器人 app secret。

单账号兼容阶段的执行门禁是：channel-bound 子会话只把本地 session/project permission 当作运行器侧约束，不能把本地 allow 当作外部发送者授权。除一次性 interaction grant 和明确属于 channel runtime 的低风险内置 CLI 权限外，非内置工具调用要进入 ApprovalPolicyResolver，并生成可审计的 authorization request。执行前权限检查优先读取本轮消息写入的 `channelActorSnapshot`，而不是可被后续消息刷新覆盖的长期 channel binding。Agent 调用 typed channel command 时只能提交服务端签发的短期 child-run token；服务端根据 token 关联的 child run、session snapshot 和 immutable delivery binding 重建 actor，不接受 CLI 自报的 `senderId`、`sessionId` 或管理员身份。

推荐把这个阶段命名为 `single-login runner mode`：当前桌面登录、CLI profile、bot app secret 只是运行器或 service principal 的能力来源，用于启动 runtime、收发机器人消息和读写本地项目状态；它不是频道发送者的 delegated credential。所有用户级外部动作都必须先解析 `credentialSubject`，再查询该 subject 的 credential provider。没有 active credential 时，系统只能：

- 创建 pending authorization intent，并把授权请求送到 credential subject；
- 在能力允许范围内降级成只读、只回复说明或只生成草稿；
- 明确拒绝，并记录原因。

这允许 MVP 不实现多账号同时登录，但不会牺牲权限正确性；后续接入 OAuth、多账号切换或企业代管时，只需要补 credential provider，不需要重写 identity、router 或 child session 模型。

## Inbound Lifecycle

```text
receive platform event
  -> normalize channel/account/message/mentions
  -> resolve ChannelLink and its single Entity
  -> resolve ChannelAccount and CanonicalUser
  -> resolve EntityChannel
  -> hard access check
  -> PolicyEngine: soft-ban/off-hours/throttle/backlog
  -> IngressRouter: ignore/observe/create_child/defer
  -> stop if no child session is needed
  -> MemoryResolver builds MemorySnapshot
  -> route model and adapter
  -> create ChildSession
  -> execute and send external reply if needed
  -> extract memory and policy updates
  -> commit writebacks
```

PolicyEngine 和 IngressRouter 都在 child session 前执行。普通屏蔽期消息、下班普通消息、被 throttle 的重复 @、普通闲聊观察消息都不会创建 child session。

## Config Shape

平台连接和密钥继续放在 `.oo.config.json` 的 `channels`。实体定义继续放在 `.oo/entities/<entity>/`。外部频道入口不应内联写进 `.oo.config.json`，而应作为目录化定义放在 `.oo/channels/<link>/channel.json`；每个 channel link 只能绑定一个 entity，模型 gate、上下班、屏蔽、记忆 scope 都配置在这个 link 文件上。

`.oo.config.json` 只声明平台连接：

```json
{
  "channels": {
    "lark-main": {
      "type": "lark",
      "appId": "cli_xxx",
      "appSecret": "replace-with-secret"
    }
  }
}
```

实体仍按已有目录组织：

```text
.oo/entities/owo-demo/README.md
```

频道链接按目录组织：

```text
.oo/channels/wan-ke-chat/channel.json
```

```json
{
  "channel": "lark-main",
  "entity": "owo-demo",
  "external": {
    "type": "group",
    "chatId": "oc_xxx"
  },
  "memoryScope": "entity+channel+user",
  "ingress": {
    "ambientRouting": false,
    "routerPrompt": "普通寒暄只观察；明确请求 OWO 帮忙时才创建子会话。"
  },
  "authorization": {
    "deliveryThrottleMs": 1200000,
    "resume": {
      "mode": "immediate",
      "delayMs": 0
    }
  },
  "availability": {},
  "moderation": {},
  "routing": {}
}
```

现有 `channels.<key>.access` 仍可继续工作。迁移后它属于 hard access；channel link 文件里的 `availability`、`moderation`、`ingress`、`routing` 属于 entity channel 的 soft policy / execution policy。

## Data Model Draft

核心表：`entities`、`channel_links`、`entity_channels`、`channel_accounts`、`canonical_users`、`identity_links`、`channel_sessions`、`ingress_router_runs`、`child_session_runs`、`channel_command_runs`、`memories`、`memory_snapshots`、`memory_writebacks`、`policy_states`、`policy_events`、`reply_throttles`、`offhour_backlog`、`conversation_states`、`conversation_turns`、`pending_intents`、`routing_rules`。

当前已落地的 server SQLite 表：

- `channel_sessions_v2`、`channel_preferences_v2`：按 `channelKey + sessionType + channelId` 隔离的当前 ChildSession 绑定和频道级 adapter / permission / effort 偏好；`channel_session_deliveries` 为每个 ChildSession 保存不可变发送目标。
- `channel_seen_messages`：已有入站消息去重。
- `channel_action_tokens`：已有频道动作短期 nonce。
- `channel_accounts_v2`、`canonical_users`、`channel_identity_links_v2`、`channel_identity_link_codes`：identity graph 基础表和短期跨账号绑定码。账号与绑定以 `channelKey` 作为 issuer namespace，避免同一平台不同 app/tenant 的外部账号 ID 相互碰撞。
- `channel_user_credentials_v2`：新增 issuer-scoped 用户 channel credential 元信息表，以 `channelKey + userId + credentialKey` 隔离不同 app/tenant，只存状态和引用，不存 token。旧表仅作为单 issuer 安全迁移来源。
- `channel_authorization_requests`：新增授权请求状态表，用于后续 pending authorization intent。
- `channel_child_session_runs`：新增 channel inbound 到 runtime session 的最小 child run 审计表，记录 actor、message、entity、dispatch mode、sessionId 和投递状态。当前 `dispatched` 表示已交给 runtime，不代表业务任务完成。
- `channel_conversation_states`、`channel_conversation_turns`：新增 deterministic `threadKey` 下的连续性状态和 recent turns，记录当前 thread 的参与者、最近 turn、最后消息和 child run 关联；当前只承载最小连续性索引，不做完整 transcript 或 memory writeback。
- `channel_pending_intents`：新增最小 pending intent 表。当前 `resolveChannelApproval(createAuthorizationRequest: true)` 和 mirrored `interaction_request(kind=permission)` 在上下文包含 `threadKey` 时，会把 pending authorization 同步写为 `need_approval` intent，并关联 authorization request、conversation state、child run、owner user/account 和 required action。interaction 请求送达频道后会写入 `delivery` / `deliveryMessageId`，并通过 `channel_reply_throttles(policyType=authorization_request_delivery)` 按 `authorization.deliveryThrottleMs` 抑制同一 authorization request 的重复送达，默认 20 分钟；`authorization.resume.mode` 会随 mirrored request 写入 metadata，并在 grant / deny 后进入 resolved intent 的 `metadata.resume`。`immediate` 且已过 `notBefore` 的 ready intent 可被 `/auth grant|deny` 或后台 scheduler 自动消费；`manual` 和 `next_message` 只保留 ready intent，等待显式恢复或下一条相关消息触发。`services/channel-resume` 使用带 lease 的原子 claim 消费 ready intent，创建新的 `system_resume` ChildSession；worker 中断后，过期 lease 可被重新领取。
- `channel_command_runs`：新增 channel command fast path 审计表，记录 actor、command path、权限级别、状态和错误。
- `channel_reply_throttles`：新增策略固定话术节流状态表。
- `channel_offhour_backlog`：新增下班期被 gate 截断消息的 backlog 表。
- `@oneworks/channel-oneworks`：新增 first-party `oneworks` channel type，支持本地 simulation webhook 注入 inbound event，并复用 server channel manager 的完整入站管道。配置 secret 时 webhook 使用 timestamp + nonce + raw body 的 HMAC-SHA256 签名并拒绝超时或重放；无 secret 的调试入口仅允许显式开启且实际 socket 来源为 loopback。

仍处于 draft 的表包括：`entities`、`channel_links`、`entity_channels` 的持久化物化层，`ingress_router_runs`、完整 child run 生命周期 / tool-call / memory writeback 记录、memory / policy event / routing 相关表，以及 pending intent 平台私信 / ephemeral 送达策略、backlog digest/process 运行记录。

## Commands

命令组：`/identity whoami|link|accounts|unlink|audit`、`/auth request|list|grant|deny`、`/policy status|warn|mute|unmute`、`/availability status|off|on`、`/backlog list|process`、`/memory show|pin|forget|audit`。

当前已落地 `/identity whoami|link|accounts` 的最小自助链路：`/identity link` 在当前账号生成短期绑定码，`/identity link <code>` 从另一个账号消费并绑定到同一 canonical user，`/identity accounts` 列出已绑定账号。该流程只绑定身份和记忆归属，不授予或复制 executable credential。

这些命令不作为绕过 agent 的旁路执行器。它们应注册为 `channel.*` typed tools：slash command、自然语言请求和系统续接都可以触发同一套工具，但工具调用必须携带 `actor=发送者 canonical user/channel account`，并由 ApprovalPolicyResolver 按发送者权限裁决。

## Migration Plan

Phase 1:

- 为现有 channel 创建默认 `.oo/entities/<entity>/` 和 `.oo/channels/<link>/channel.json`，迁移现有 `channel_sessions` 为长期 channel session，并为已知 senderId 生成 platform-local canonical user。

Phase 2:

- 每条 inbound message 先经过 IngressRouter，只有 create_child 决策才注入 MemorySnapshot、创建 child session，并增加 writeback extractor、channel command tools 和 channel summary 写回。

Phase 3:

- 启用 warn、mute、off-hours、throttle、backlog。

Phase 4:

- 增加 identity linking、canonical user memory、user/account 级访问控制。

Phase 5:

- 增加模型/adapter 路由、ingress router prompt 和 entity 多频道管理 UI。

## Security And Privacy

- 不按显示名自动合并身份。
- 私聊来源记忆默认不能进入群聊 prompt。
- 跨平台记忆必须有明确 scope。
- 敏感记忆默认不注入 prompt。
- 身份合并、永久屏蔽、记忆删除都要有 audit log。
- 模型路由必须尊重 provider 和数据敏感性策略。
- 单账号登录阶段必须显式区分 actor identity 与 executable credential；没有用户凭证时只能降级、询问或拒绝。

## Observability

每次 ingress router run 和 child run 应记录 resolved channel link/entity/account/user、policy decision、router decision、memory candidate/filter counts、snapshot id、model/adapter route、reply throttle decision 和 writeback result，用来解释“为什么没回”“为什么创建了会话”“为什么记住了”“为什么用了这个模型”。

## MVP

第一版建议只做：

- entity 和 entity channel 基础模型；
- channel link 唯一绑定 entity；
- 每条频道消息先过 IngressRouter，必要时再创建 child session；
- channel session memory snapshot 和 conversation state；
- child session 结束后写回 channel summary；
- `/identity whoami` 和管理员手工绑定；
- channel command typed tools 和 sender-scoped 权限裁决；
- warn 和 temporary account-level mute；
- off-hours 固定话术、throttle 和 backlog；
- default / moderation / user override 模型路由。
- OneWorks native channel plugin 的基础 room、trace 和 simulation mode。

## Design Principle

频道里的长期状态属于 entity/channel/user memory，短期执行属于 child session。策略和记忆必须有作用域、可审计、可撤销；模型不应该被迫从一个无限增长的大聊天上下文里猜当前任务。
