---
rfc: 0006
title: Channel Runtime 2.0 - Ingress Router
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-08-09
targetVersion: vNext
---

# RFC 0006: Ingress Router

## Summary

Ingress Router 是每个 entity channel 的入站 gate。它可以使用确定性规则和轻量模型判断一条消息是否需要升级为 ChildSession，并为这次执行选择 mode、model、adapter、visibility 和 threadKey。

Ingress Router 不选择 entity。entity 在进入 router 前已经由 `.oo/channels/<link>/channel.json` 唯一确定。

## Channel Link Invariant

`.oo/channels/<link>/channel.json` 中的 channel link 是外部频道到实体的绑定：

```text
platform connection + external channel/chat/conversation + entity
```

硬约束：

- 一个 channel link 文件必须且只能绑定一个 `entity`。
- Ingress Router 只能在该 entity 的范围内工作，不能把消息改派给另一个 entity。
- 如果同一个物理群里有多个机器人实体，应配置多个独立 channel link，或者由某个实体在 ChildSession 内显式请求另一个实体协作。
- 跨实体 handoff 是业务执行行为，不是入站路由行为。

这个约束让权限和记忆边界更清晰：消息从哪个 channel link 进来，就天然属于哪个 entity channel。

## Non-Goals

- 不直接回复用户。
- 不调用业务工具。
- 不写长期记忆。
- 不审批权限。
- 不跨 entity 派发。
- 不把普通群聊都升级成业务会话。

Router 只输出 routing decision。真正的回复、工具调用、权限申请和记忆写回都属于 ChildSession。

## Pipeline

```text
platform event
  -> normalize message
  -> resolve channel link
  -> get exactly one entity
  -> resolve sender account and canonical user
  -> hard access and policy preflight
  -> deterministic ingress rules
  -> optional lightweight router model
  -> decision: ignore / observe / create_child / defer
```

确定性规则先跑，避免所有消息都调用模型：

- 明确 @ 当前 entity：进入 router。
- 回复当前 entity 的消息：进入 router。
- 命中 pending intent 的 owner/approver：进入 router。
- 命令、slash、webhook：进入 router；明确 channel command 通常输出 `create_child` + `mode=admin` 或 `mode=clarify`。
- 被软屏蔽、下班普通消息、throttle 命中：直接按 PolicyEngine 处理。
- 普通群聊消息：默认 observe 或 ignore，只有 `ambientRouting=true` 时才进入模型 router。

当前实现先落了确定性 fast gate：当入站消息匹配到 ChannelLink，且 `ingress.ambientRouting === false`，普通群聊消息会在进入 debounce / ack / adminGate / dispatch 前停止；私聊、slash command、消息开头的结构化 `<at ...>` mention，以及 `ingress.mentionPatterns` 命中的平台文本 mention 会继续进入后续会话流。这个阶段还不会写 observe buffer，也不会调用模型 router；pending intent / reply-to-bot 需要后续表结构和事件关联能力再接入。

## Router Decision

Router 输出结构化结果：

```ts
interface IngressRouterDecision {
  decision: 'ignore' | 'observe' | 'create_child' | 'defer'
  reason: string
  confidence: number
  threadKey?: string
  mode?: 'reply' | 'clarify' | 'digest' | 'admin' | 'background'
  model?: string
  adapter?: string
  visibility?: 'public' | 'dm' | 'ephemeral' | 'none'
  contextPolicy?: {
    includeRecentTurns?: boolean
    includePendingIntents?: boolean
    includeMemory?: boolean
  }
}
```

语义：

- `ignore`: 不创建 turn，不创建 ChildSession，只保留最小事件审计。
- `observe`: 记录 recent turn / thread hint，不创建 ChildSession。
- `create_child`: 创建业务 ChildSession。
- `defer`: 进入 backlog 或 pending queue，不立即创建 ChildSession。

`ask_clarify` 不作为 router 的直接回复能力。如果需要澄清，Router 输出 `create_child` + `mode=clarify`，由 ChildSession 负责发送澄清问题。

## Model Router

模型 router 只在 deterministic rules 无法判断、且 channel link 允许时启用。

输入：

- 当前消息和平台 metadata。
- 少量 recent turns。
- 当前 entity 和 channel link 配置。
- pending intents 的摘要。
- 用户配置的 `routerPrompt`。
- 当前 link 允许的 model/adapter 列表。

输出必须符合 schema。系统会强制校验：

- 不允许输出其他 entity id。
- 不允许请求业务工具。
- 不允许直接回复正文。
- 不允许突破 channel link 的 allowed models / adapters。
- 不允许授予权限。

Router 可以识别“这像是 channel command”，但不直接执行命令。命令执行必须进入 ChildSession 或低风险 command fast path，并由 ChannelCommandTool 按发送者权限检查。

## Config

示例：

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
  "ingress": {
    "ambientRouting": false,
    "routerModel": "gpt-5.4-mini",
    "routerPrompt": "普通寒暄只观察；用户明确让 OWO 帮忙、总结、分析、创建或继续任务时才创建子会话。",
    "createOnMention": true,
    "mentionPatterns": ["@OWO"],
    "createOnReplyToBot": true,
    "createOnPendingIntent": true,
    "observeWindow": {
      "maxTurns": 20,
      "ttlSeconds": 1800
    }
  },
  "routing": {
    "default": { "model": "gpt-5.4", "adapter": "codex" },
    "clarify": { "model": "gpt-5.4-mini", "adapter": "lark-im" }
  }
}
```

`routerPrompt` 是软规则。它能约束“什么时候创建子会话”，不能改变系统硬约束。

## Example: Ordinary Group Chatter

群里出现：

```text
A：你好
B：我知道了
C：知道啥
B：不知道啥
```

默认 `ambientRouting=false` 时：

```text
A -> observe or ignore
B -> observe
C -> observe
B -> observe
```

不会创建 ChildSession，也不会主动回复。系统最多把它们作为短期 recent turns，以便后续有人明确 @ 当前 entity 时参考。

如果 C 发：

```text
C：@OWO 知道啥
```

则 deterministic rule 命中 mention，Router 可输出 `create_child`。ChildSession 会加载这段 recent turns，但应带低置信度解释：

```text
从上下文看，B 可能是在接 A 的“你好”，但这几句没有明确对象，我不能确定他说“知道了”具体指什么。
```

## Batching

对于高频群聊，不应逐条调用模型 router。建议：

- 对普通未 @ 消息先写入短期 observe buffer。
- 在 `ambientRouting=true` 时按小时间窗批处理，例如 3 到 10 秒。
- 如果批内出现明确 @、reply-to-bot、pending intent 命中，立即 flush 并路由。
- observe buffer 只保留短窗口，不进入长期记忆。

## Observability

每次 router run 记录：

- channel link 和 entity。
- deterministic rule 命中情况。
- 是否调用模型 router。
- router prompt 版本。
- decision、confidence、reason。
- 如果没有创建 ChildSession，说明是 ignore、observe、defer 还是 policy short-circuit。

这用来解释“为什么没回”“为什么这条消息创建了会话”“为什么用了这个模型和 adapter”。

## Design Principle

Ingress Router 是门卫，不是业务 agent。它负责少量、可解释、可配置的升级判断；ChildSession 才负责真正工作。
