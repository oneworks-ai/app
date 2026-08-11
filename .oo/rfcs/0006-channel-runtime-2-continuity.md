---
rfc: 0006
title: Channel Runtime 2.0 - Conversation Continuity
status: implemented
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Conversation Continuity

## Summary

ChildSession 是一次性执行容器，原则上即用即结束。持续对话不靠复用子会话、不靠无限增长的 prompt transcript，而靠 ChannelSession 下的 conversation state、recent turns、pending intents 和 MemorySnapshot 在每次新子会话开始时重新组装。

Conversation Continuity 不决定是否创建 ChildSession。每条消息先经过当前 channel link 绑定实体的 Ingress Router；只有 router 决策为 `create_child` 时，才把 ContinuitySnapshot 注入业务子会话。`observe` 消息只更新短期 turn / thread hint，不执行业务。

这保证两件事可以同时成立：

- 每条消息都是干净、可审计、可限权的一次执行。
- 用户体验上仍能理解“刚才那个”“继续”“按你上面说的改”等连续表达。

## Child Session Lifecycle

ChildSession 的生命周期：

```text
created
  -> hydrated with continuity snapshot
  -> running
  -> extracting writebacks
  -> committed
  -> terminal
```

Terminal 状态包括 `completed`、`ignored`、`blocked`、`failed`、`expired`。

进入 terminal 后：

- 释放运行态上下文、临时 tool handles、模型上下文和大 transcript。
- 保留 `child_session_runs` 审计记录、输入输出摘要、策略裁决、tool 调用记录、MemorySnapshot id 和 writeback 结果。
- 不把子会话对象当作下一条消息的执行上下文继续复用。

如果一次执行等待审批、外部工具或用户补充信息，优先把等待状态固化成 `pending_intent`。下一条相关消息仍创建新的 ChildSession，只是会加载这个 pending intent 来继续任务。

## Why Not Keep Child Session Alive

长期保活子会话会带来几个问题：

- 权限会漂移：后续消息可能来自不同用户，但仍继承旧触发人的能力。
- 上下文会污染：群聊里不同主题和不同人会混入同一个执行状态。
- 成本不可控：长期 transcript 会持续膨胀。
- 审计困难：很难解释某次回复到底基于哪次输入和哪组权限。

所以 ChildSession 只负责一次可解释的执行，连续性由长期状态层负责。

## Continuity State

ChannelSession 下新增 ConversationState，用来保存“下一次执行需要知道的对话连续性”。

核心字段：

```ts
interface ConversationState {
  id: string
  entityId: string
  entityChannelId: string
  channelSessionId: string
  threadKey: string
  topic?: string
  summary?: string
  activeParticipants: string[]
  recentTurnIds: string[]
  pendingIntentIds: string[]
  lastBotReply?: {
    messageId: string
    childRunId: string
    summary: string
    createdAt: string
  }
  expiresAt?: string
  updatedAt: string
}
```

ConversationState 不是完整聊天记录。它保存的是可继续对话所需的索引、摘要和挂起任务。

## Recent Turns

Recent turns 是短窗口原始上下文，保存最近相关的 inbound/outbound 轮次。

每条 turn 至少包含：

- platform message id、reply/thread id、timestamp。
- speaker channel account 和 canonical user。
- entity id、child run id。
- message kind、mentions、引用关系。
- 安全裁剪后的文本或摘要。

加载时只选当前 threadKey 相关的最近窗口，例如最近 8 到 20 条；超出窗口的内容依靠 summary 和 memory。

## Pending Intents

Pending intent 表示“上一次没完成，但可以被下一次消息继续的事情”。

示例：

- 等用户确认是否继续执行高风险操作。
- 等管理员审批某个工具调用。
- 等用户补充缺失参数。
- 下班期间积累了需要上班后统一处理的任务。

Pending intent 必须按用户绑定，而不是只挂在频道上。比如某次子会话需要触发用户开权限，就把 intent 绑定到该 canonical user 和对应 channel account；后续只有这个用户的授权事件、私聊回复、ephemeral 交互或群内明确回复能推进它，其他人的普通群消息不能误触发继续。

字段建议：

```ts
interface PendingIntent {
  id: string
  entityId: string
  entityChannelId: string
  threadKey: string
  ownerUserId: string
  ownerAccountId?: string
  approverUserIds?: string[]
  createdByChildRunId: string
  kind: 'need_user_input' | 'need_approval' | 'deferred_work' | 'tool_wait'
  status: 'open' | 'resolved' | 'cancelled' | 'expired'
  requiredAction?: string
  delivery?: 'dm' | 'ephemeral' | 'public_hint' | 'external_link'
  deliveryMessageId?: string
  payloadRef?: string
  expiresAt: string
}
```

Pending intent 必须有过期时间。过期后不再注入 prompt，只保留审计。

## Thread Resolution

Router 或 ChildSession 需要上下文时解析 threadKey：

1. 如果平台有 thread/reply id，优先使用平台线程。
2. 如果是回复机器人上一条消息，绑定到上一条 bot reply 的 threadKey。
3. 如果明确 @ 某个实体，绑定到该实体在当前频道的活跃 threadKey。
4. 如果发送人是某个 open pending intent 的 owner 或 approver，且消息能匹配 requiredAction，绑定到该 pending intent 的 threadKey。
5. 如果短时间内同一用户连续追问，绑定到最近相关 threadKey。
6. 否则创建新 threadKey。

群聊里不能只有一个全局“最后话题”。至少要按平台线程、引用关系、被 @ 的实体、发送人和时间窗口拆分，避免产品脑爆、测试验收、监控告警混成一个连续对话。

## Hydration

创建 ChildSession 前，Runtime 组装 ContinuitySnapshot：

```ts
interface ContinuitySnapshot {
  conversationStateId: string
  threadKey: string
  topic?: string
  summary?: string
  recentTurns: RecentTurn[]
  pendingIntents: PendingIntent[]
  lastBotReply?: LastBotReply
  participants: ParticipantView[]
}
```

ChildSession 最终收到的是：

- 当前 inbound message。
- PolicyDecision 和权限 envelope。
- ContinuitySnapshot。
- MemorySnapshot。
- RoutingDecision。

它不会收到所有历史 child transcript，也不会收到与当前 threadKey 无关的群聊噪声。

## Writeback

ChildSession 结束时生成三类写回：

- conversation patch：更新 topic、summary、recent turn、last bot reply。
- pending intent patch：创建、解决、取消或延长 pending intent。
- memory patch：把稳定事实、偏好、经验写入 Memory Resolver 管辖的 memory store。

写回顺序建议：

```text
persist child run result
  -> commit outbound message refs
  -> update recent turns
  -> update pending intents
  -> update conversation summary
  -> submit memory writebacks
```

Memory writeback 可以异步，但 conversation patch 应该跟 child run 一起提交，避免下一条消息看不到刚才的上下文。

## Off-Hours Continuity

下班期间的普通消息不创建 ChildSession，但可以进入 backlog。

如果有人 @ 实体：

- 在 throttle 窗口内只回复一次固定下班话术。
- 后续 @ 不重复回复，只追加 backlog 或 recent turn marker。
- 上班后创建一个系统触发 ChildSession，加载 backlog summary 和必要 recent turns，统一处理。

这不是保活旧子会话，而是用 backlog 生成新的连续性输入。

## Permission Continuity

权限审批不能藏在子会话内存里。

当某次执行需要审批：

- ChildSession 写入 `pending_intent(kind=need_approval)`。
- ApprovalPolicyResolver 记录触发用户、审批目标用户、风险、资源和可用送达方式。
- Runtime 优先私信目标用户发起授权；如果平台支持只对目标用户可见的 ephemeral/only-visible 消息，可以在原频道发这种消息。
- 如果平台既不能私信，也不能发只对目标用户可见的消息，只在原频道发送不含敏感细节的公开提示，例如让目标用户加机器人好友或打开授权入口。
- 审批结果回来后创建新的系统 ChildSession 继续，或等待对应 owner/approver 的下一次有效消息继续。

这样即使原子会话已经终止，也能清楚知道等待什么、谁能批准、批准后继续哪个 threadKey。

审批续接的关键是“谁欠系统一个动作”，不是“哪个频道下一条消息”。同一个群里其他人继续聊天，只会形成自己的 ChildSession；不会消耗这个 pending approval。

当前 OneWorks 不支持多账号同时登录，所以 permission continuity 不能假设 runtime 已经拥有 owner/approver 的平台 token。`ownerUserId`、`ownerAccountId` 只标识审批归属；真正执行时还要检查该用户是否存在可用 credential 或一次性 grant。没有 credential 时，pending intent 的下一步是发起授权送达，而不是切换到当前桌面用户、CLI 用户或 bot app secret 继续执行。

当前已落地最小链路：channel dispatch 会把 `conversationStateId`、`threadKey` 和 `childRunId` 写入 `channelActorSnapshot`；session permission resolver 在 channel 子会话中遇到非内置工具审批时，会创建 `channel_authorization_requests`，并同步 upsert 一个 `channel_pending_intents(kind=need_approval, requiredAction=grant_authorization)`。mirrored `interaction_request(kind=permission)` 也会从 session runtime snapshot 继承这些字段并创建同类 pending intent。这个 intent 已经绑定 owner user/account、authorization request、conversation state 和 child run。

`/auth grant|deny` 已统一通过 channel-authorizations 服务处理授权请求结果：更新 `channel_authorization_requests`，关闭关联 open pending intents，并在请求由 interaction mirror 生成时把 `allow_once` / `deny_once` 回填给原 session interaction。关闭 intent 时会写入 `metadata.resume`，包含 authorization request id、授权状态、capability、原 child run、session id、threadKey 和 resolvedBy；如果原 interaction 已经续接成功，resume 状态为 `skipped`，否则为 `ready`。

`services/channel-resume` 已提供最小恢复消费器：可以列出 resolved intent 中 `metadata.resume.status=ready` 的项，claim 后以原 session 为 parent 创建新的 `channel_child_session_runs(triggerType=system_resume)` 和 fresh ChildSession，再将 resume 状态更新为 `dispatched`、`failed` 或 `skipped`。恢复产物使用 intent 派生的稳定 ID，过期 lease 被重新领取时会复用同一 run、session 和 conversation turn，避免重复创建。

interaction 请求送达到频道后，channel handler 会按当前 channel session 类型把 pending intent 标记为 `delivery=dm` 或 `delivery=public_hint`，并记录平台返回的 `deliveryMessageId`。送达成功还会写入 `channel_reply_throttles(policyType=authorization_request_delivery)`，按 channel link 的 `authorization.deliveryThrottleMs` 节流；未配置时默认 20 分钟内同一个 authorization request 不重复发送。这为后续“只提醒一次”“撤回/更新提示”“点击后恢复原 thread”提供锚点。

`/auth grant|deny` 命令层已经 best-effort 调用 `channel-resume`，会尝试消费同一 authorizationRequestId 的 ready resume intent；typed command invocation 走同一执行链路，因此 agent 调用 `channel.auth.grant` / `channel.auth.deny` 也会触发同样的恢复尝试。server 启动时也会在非 manager 角色初始化 lightweight channel resume scheduler，周期性扫描 ready resume intent，避免只依赖当前授权命令调用栈。

`authorization.resume.mode=next_message` 已接入 dispatch：同一 owner、同一 thread 的下一条入站消息会原子 claim 对应 ready resume intent，把 `<channel-authorization-resume>` 作为本轮 fresh ChildSession 的 runtime context，并将 intent 标记为 `dispatched`；其他人的普通消息不会消耗该 pending intent。pending intent 的原 `sessionId` 只作为 parent、workspace 和权限状态来源，不会重新作为本轮执行会话。

`authorization.resume.mode=manual` 已接入 channel command：管理员或具备对应权限的 agent 可以调用 `/auth resume <authorizationRequestId>`，或通过 typed command `channel.auth.resume` 显式消费该授权请求下的 deferred ready resume intent。这个入口会使用发送者权限审计，不会自动提升为 bot、CLI 或桌面登录用户。

可恢复任务的发现走同一套 sender-scoped 命令：`/auth list resumable` 或 typed command `channel.auth.list` with `{ "scope": "resumable" }` 会列出 `metadata.resume.status=ready` 的 resolved pending intent。普通用户只看到自己 owner user/account 下的任务；管理员可以看到当前 channel type 下所有可恢复任务。

平台送达当前按可用能力选择 direct message 或脱敏 public hint，并通过持久 throttle 避免重复提醒；具体平台的 ephemeral/only-visible provider 和外部 OAuth 授权页仍是扩展点。授权结果回来后，恢复器可以按 immediate、manual 或 next_message 消费 `metadata.resume`，通过 lease 和稳定派生 ID 创建 fresh ChildSession；其他用户的消息不会误消费 owner 的 pending intent。

## Memory Loading

ContinuitySnapshot 解决“刚才聊到哪”，MemorySnapshot 解决“这个人/实体/频道长期知道什么”。

加载顺序建议：

1. Resolve identity and policy。
2. Resolve threadKey and ConversationState。
3. Build ContinuitySnapshot。
4. Use current message + continuity metadata query MemoryResolver。
5. Budget combine continuity and memory into child prompt。

当预算紧张时，优先级是：当前消息 > policy/permission > pending intents > recent turns > conversation summary > scoped memory。

## Observability

每次 child run 需要记录：

- resolved threadKey 和 conversationStateId。
- 加载了哪些 recent turn、pending intent、summary。
- 为什么判断为继续旧话题或新话题。
- 写回了哪些 conversation patch。
- 哪些内容被 scope、权限、预算或过期策略过滤掉。

这样才能解释“为什么它记得刚才”“为什么它没接上”“为什么没有继续旧任务”。

当前已落地 deterministic `threadKey` 和 `channel_conversation_states` / `channel_conversation_turns` 的最小连续性索引：每次 channel inbound 被投递到 runtime session 前，会按平台 reply、私聊 channel 或群聊 entity+actor 解析 threadKey，确保 ConversationState，并在投递成功后追加 inbound recent turn。`channel_child_session_runs` 已关联 `conversationStateId` 和 `threadKey`，可解释一条消息进入了哪个连续性线程。

`channel_pending_intents` 也已落地最小存储、授权写入、delivery 标记、默认 delivery throttle 和 grant/deny 收敛链路。ConversationState 会维护 `pendingIntentIds` 索引；DB repo 已提供 open / resolved intent 查询，resolved authorization intent 会带 `metadata.resume.status=ready`，`services/channel-resume` 可以按 authorization request、conversation、owner user/account 或 threadKey 加载并投递待续接事项。

当前 child lifecycle 已关联 router decision、continuity snapshot、MemorySnapshot、pending intent、terminal status 和 writeback audit；外发成功后会幂等追加 outbound turn 并刷新 `lastBotReply`。当前 topic resolver 保持确定性：平台 reply 优先，其次 direct channel，再次 group entity+actor；更智能的 topic split/merge 和平台专属 ephemeral delivery 属于后续兼容扩展，不改变 fresh ChildSession 不变量。

## Open Questions

- threadKey 是否需要在 UI 暴露为可手动切换的话题。
- 群聊里多实体同时被 @ 时，是创建一个共享 threadKey，还是每个实体各自维护子 thread。
- long-running tool wait 是否允许保留 suspended child run，还是一律落 pending intent 后终止。
