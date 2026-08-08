---
rfc: 0006
title: Channel Runtime 2.0 - Policy Engine
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-17
targetVersion: vNext
---

# RFC 0006: Policy Engine

## Summary

Policy Engine 在 child session 创建前执行，负责决定消息是否进入 AI 主任务、是否写入 backlog、是否只回复固定话术、是否直接丢弃。它不调用平台 ban API，而是在 OneWorks 内部做接收和回复策略。

## Policy Order

```text
hard access
  -> admin/bypass check
  -> soft-ban check
  -> availability check
  -> reply throttle check
  -> backlog/write/drop/dispatch decision
```

Hard access 包括 `allowedGroups`、`blockedGroups`、`allowedSenders`、`blockedSenders`。Soft policy 包括警告、屏蔽、上下班、节流、backlog。

## Soft-Ban State

```text
normal
warned
muted_until(timestamp)
muted_permanent
```

默认先 account-level mute，只有明确恶意、管理员确认或高置信度证据时才提升到 canonical user-level mute。

配置示例：

```json
{
  "moderation": {
    "enabled": true,
    "reviewModel": "deepseek-chat",
    "replyThrottleMs": 600000,
    "levels": [
      { "hit": 1, "action": "warn" },
      { "hit": 2, "action": "mute", "durationMs": 600000 },
      { "hit": 4, "action": "mute", "durationMs": 3600000 },
      { "hit": 8, "action": "mute_permanent" }
    ],
    "bypassUsers": ["user_boss"]
  }
}
```

## Muted Behavior

- 普通消息：直接 drop，不创建 child session。
- @ 机器人：如果 reply throttle 已过期，回复一次固定解释。
- throttle 窗口内反复 @：不回复。
- 管理员/老板/白名单用户：可绕过。

固定话术应包含：

```text
原因
剩余时间
下一次可回复时间
申诉或联系管理员方式
```

## Moderation Review

屏蔽判断可以使用轻模型，例如 `deepseek-chat`。Moderation mode 只加载行为摘要、近期触发消息和规则，不加载项目机密或大段频道记忆。

输出结构：

```json
{
  "severity": "none|warn|mute|ban",
  "reason": "spam|abuse|off_topic|unsafe",
  "confidence": 0.91,
  "suggestedAction": {
    "type": "mute",
    "durationMs": 600000,
    "scope": "account"
  }
}
```

低置信度只警告或记录，不自动永久屏蔽。

## Availability

配置示例：

```json
{
  "availability": {
    "timezone": "Asia/Shanghai",
    "workHours": [
      { "days": [1, 2, 3, 4, 5], "start": "10:00", "end": "19:00" }
    ],
    "offHours": {
      "mode": "buffer",
      "replyText": "我现在下班啦，消息会先记下，上班后统一处理。",
      "replyThrottleMs": 1200000
    },
    "bypassUsers": ["user_admin", "user_boss"]
  }
}
```

下班期：

- 普通消息进入 `offhour_backlog`。
- @ 机器人最多每个 throttle 窗口回复一次固定话术。
- 重复 @ 不创建 child session。
- 白名单用户可直接触发执行。

当前实现先落了确定性 availability gate：当 ChannelLink 配置了 `availability.workHours`，且当前时间不在工作时间内，普通群聊消息会被截断；私聊或显式 mention 会回复 `offHours.replyText`，并按 `offHours.replyThrottleMs` 通过 `channel_reply_throttles` 做 DB 级节流；`availability.bypassSenders`、`availability.bypassUsers` 和频道管理员会绕过。`bypassUsers` 当前兼容平台 sender ID 和已解析的 canonical user ID；canonical user 来自 `identityMiddleware` 对 `channel_identity_links` 的 verified 绑定解析。被下班 gate 截断的消息会写入 `channel_offhour_backlog`，后续还缺上班后的 digest / backlog process。

## Backlog Processing

上班后不要逐条回放 backlog。应按 entity channel 聚合：

```text
entityChannelId + time window + sender/group
```

生成一个或几个 digest child session：

- 摘要下班期间发生了什么；
- 识别需要处理的待办；
- 回复群里可见的简短结论；
- 将长期价值写回 channel memory。

## Reply Throttle

Throttle key:

```text
entityChannelId + policyType + canonicalUserId/accountId
```

常见 policyType:

```text
muted_mention_notice
off_hours_notice
rate_limit_notice
```

Throttle 记录应可过期并可审计，避免机器人在群里反复刷固定话术。

当前落地表为 `channel_reply_throttles`，`availability-gate.ts` 使用 `policyType = off_hours_notice` 和 channel-level throttle key。后续 soft-ban / rate-limit 可复用同一表，换成 user/account/channel 级 key。

## Policy State

```json
{
  "scope": "account|user|channel",
  "state": "normal|warned|muted_until|muted_permanent",
  "reason": "spam",
  "hits": 2,
  "mutedUntil": 1781550000000,
  "updatedBy": "policy_engine|admin",
  "updatedAt": 1781549400000
}
```

所有变更写入 `policy_events`。

## Commands

```text
/policy status
/policy warn <user>
/policy mute <user> 10m
/policy mute <account> 10m
/policy unmute <user>
/policy bypass add <user>
/policy audit <user>

/availability status
/availability off
/availability on
/backlog list
/backlog process
```

## Safety Defaults

- 永久屏蔽默认需要管理员确认，除非配置明确允许自动永久屏蔽。
- account-level 优先，user-level 谨慎。
- 下班模式默认 buffer，不丢消息。
- 任何代表用户对外发送的消息仍需遵守现有通信确认策略。
