---
rfc: 0006
title: Channel Runtime 2.0 - Memory Resolver
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-16
targetVersion: vNext
---

# RFC 0006: Memory Resolver

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

child session 结束后 extractor 输出 patch：

Extractor 输出结构化 patch，例如 `channelMemory`、`userMemory`、`entityMemory`、`policyUpdates`。Patch 要带 confidence、source child run 和审计信息。

写回分两层：

- hot memory: 立即可见，短期有效；
- stable memory: 经合并、去重、审计后长期固化。

低置信度 patch 进入 candidate，不直接稳定化。

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
