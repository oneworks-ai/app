---
rfc: 0006
title: Channel Runtime 2.0 - Memory Resolver
status: implemented
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Memory Resolver

## Current Landing

当前 baseline 已落地 `channel_memories`、`channel_memory_snapshots` 和 `channel_memory_writebacks`：每条 create-child 决策在启动前按 issuer、org、entity、channel、verified canonical user / account、conversation、visibility、sensitivity 和 expiry 过滤候选，再排序并按 item/token budget 固化不可变 MemorySnapshot。snapshot id 会绑定 child run，并与 continuity 一起注入 system context。

频道 agent 通过受限的 `oneworks mem get|list|set|patch` 能力读取和显式固化可复用经验；system prompt 要求它在不熟悉上下文时先查记忆，并在本轮产生长期价值时于结束前真实写入，而不是口头承诺。每轮 dispatch 前，file-memory sync 会把当前 `entity`、`channel`、稳定 `conversation` 和 `user` 文件导入结构化 store；terminal lifecycle 会再次检测变更，按 child run 幂等提交 writeback 并记录 `terminal_check`。`session` scope 只属于一次性物理 ChildSession，不参与跨轮加载。

`user` 文件仍按当前平台 sender 保存，但同步到结构化 store 时优先归属已验证 canonical user；因此身份绑定后可跨平台加载。`entity` memory 不限制单个 channel id，可在同一实体的多个 ChannelLink 间复用；direct 来源的 user memory 仍不能进入 group prompt。基于独立模型的自动提炼器属于后续可选增强；它不能把原始 transcript 全量写入长期记忆，也不能绕过下面的 scope、visibility、sensitivity 和 provenance 规则。

## Summary

记忆加载不能是“查库后拼进 prompt”。Channel Runtime 2.0 需要一个 Memory Resolver：先解析身份和实体，再按 scope、权限、隐私、相关性和预算构造 MemorySnapshot，最后注入 child session。

## Memory Layers

```text
entity memory
  实体技能、人设、长期经验。

canonical user memory
  跨平台用户偏好和稳定事实。

channel account memory
  某个平台账号特有信息。

channel session memory
  当前群/私聊里的项目背景、约定、决策。

project/team memory
  项目目标、里程碑、风险和负责人。

policy memory
  屏蔽、上下班、节流、backlog 状态。
```

## Memory Metadata

每条记忆必须带元数据：

字段包括：`subjectType`、`subjectId`、`scope`、`sensitivity`、`confidence`、`source.channelType`、`source.channelId`、`source.sessionType`、`visibility.orgs`、`visibility.entities`、`visibility.channels`、`visibility.conversationTypes`、`expiresAt`。

## Resolver Flow

```text
resolve identity
  -> resolve entity
  -> resolve current mode
  -> resolve allowed scopes
  -> fetch candidate memories
  -> filter by privacy and access
  -> rank by task relevance
  -> compress within budget
  -> render MemorySnapshot
  -> attach to child session
```

MemorySnapshot 是结构化对象，不是原始记忆文本列表。它应被持久化并关联到 child run，方便复盘。

## Default Privacy Rules

- direct/private source memory 默认不能进入 group prompt。
- 跨 org 记忆默认不共享。
- 跨 entity 记忆默认不共享。
- sensitive memory 默认不注入 prompt。
- low-confidence memory 只能作为候选或不确定提示。
- revoked identity link 关联的 user memory 不再被 account 加载。

## Ranking

候选记忆打分建议：

```text
score =
  semantic_relevance * 0.40
+ importance * 0.25
+ recency * 0.15
+ confidence * 0.15
+ explicit_pin * 0.05
- sensitivity_penalty
- stale_penalty
```

不同模式使用不同权重：

- `normal_task`: 决策、项目背景、用户偏好。
- `moderation_review`: 行为摘要、违规证据、规则。
- `off_hours_buffer`: 少量策略状态，不加载大记忆。
- `off_hours_digest`: backlog、频道背景、项目状态。
- `identity_link`: 身份候选和验证状态。
- `admin_command`: 权限、审计和配置状态。

## Budget

示例：

示例预算：`maxItems=20`、`maxTokens=3000`，并按 `entity/user/channel/project/policy` 分配 section budget。

超预算时保留顺序：

```text
pinned facts
policy state
current-channel facts
high-relevance decisions
user preferences
historical summaries
```

## Snapshot Shape

Snapshot 至少包含：`entity`、`canonicalUser`、`channelAccount`、`channel`、`project`、`policy`、`selectedMemories`、`conflicts`。

Renderer 再把 snapshot 转成 system/runtime prompt。

## Conflict Handling

冲突不应静默覆盖。例子：

冲突记录应包含 `type`、`candidates`、`recommended` 和 `reason`。模型应看到当前采用版本和不确定性，而不是被迫相信互相矛盾的记忆。

## Writeback

当前实现由本轮 agent 自己做语义判断：产生长期价值时必须在结束前真实调用 `oneworks mem`。terminal lifecycle 随后读取允许自动加载的 scope，按内容 hash 去重，把完整文件状态更新到确定性的 memory id，并为每个变化记录 `file_memory_sync` writeback；最后总是记录一次 `terminal_check`，说明本轮是 `committed` 还是 `no_change`。重复 terminal event 不会产生重复 patch。

自动同步只处理默认 `README.md`。自定义 reference/topic 文件仍可由 agent 显式读取，用于避免把大段资料自动注入每个 prompt。未来若加入独立 extractor，其输出仍必须走同一结构化 upsert、privacy filter 和 writeback audit，不能直接改长期 memory。

## Cache Invalidation

Resolver cache key:

Cache key: `entityId + entityChannelId + canonicalUserId + channelAccountId + mode`。

失效事件：

- 新记忆写入；
- 身份绑定变更；
- 权限或策略变更；
- mute/off-hours 状态变化；
- 配置变更；
- 工作时间跨边界。
