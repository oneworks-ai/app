---
rfc: 0006
title: Channel Runtime 2.0 - OneWorks Native Channel Plugin
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-17
targetVersion: vNext
---

# RFC 0006: OneWorks Native Channel Plugin

## Summary

OneWorks 需要一个正式的 first-party native channel 插件。它不是临时 debug adapter，而是 OneWorks 自己的频道类型：可以承载产品内群聊、演示空间、团队试用房间和本地 runtime 调试。

本地调试能力应作为这个插件的 simulation mode，而不是另起一套假 runtime。无论是真实用户在产品内发消息，还是开发者用假用户回放场景，事件都必须经过同一条 Channel Runtime 2.0 链路。

## Positioning

建议命名：

```text
package: @oneworks/channel-oneworks
channel type: oneworks
product name: OneWorks Channel
```

它提供：

- OneWorks 产品内可用的 room / direct / thread 频道。
- 正式 channel adapter，和 lark / wechat 一样注册到 `channels`。
- 插件 UI，用于查看房间、消息、trace、pending approval 和 command run。
- simulation mode，用于本地调试、scenario replay、自动化测试和演示。

调试是能力，不是身份。不要把正式 channel type 命名为 `debug`。

## Why A Plugin

放在插件里，而不是写死进 core runtime，有几个好处：

- core runtime 只定义 channel contract、trace contract 和插件扩展点。
- native channel 可以独立迭代 UI、scenario runner 和 room 管理。
- 私有化部署可以选择是否启用这个插件。
- 外部团队也可以参考它实现自己的 first-party channel。

但它是 first-party 插件，应随默认开发环境安装，作为 Channel Runtime 的标准测试和演示入口。

## Current Landing

当前已落地最小 first-party channel package：

- `packages/channels/oneworks`，包名 `@oneworks/channel-oneworks`，由 server 像 lark / wechat 一样通过 `type: "oneworks"` 加载。
- `apps/server` 已声明对 `@oneworks/channel-oneworks` 的 workspace 依赖，`pnpm install` 后会在 server workspace 下创建 symlink。
- `createChannelConnection` 支持标准 `sendMessage`、`updateMessage`、`startReceiving` 和 `handleWebhook`。
- `handleWebhook` 可用于 simulation mode：POST 到 `/channels/oneworks/<channelKey>/webhook`，payload 会被规范化为 `ChannelInboundEvent`，然后交给 server channel manager 的同一条入站管道。
- `oneworks channel <channelKey> simulate ...` 已提供 CLI 入口，用于本地向 native webhook 注入文本或结构化 payload。
- server manager 回归已覆盖 native webhook 进入真实 `oneworks` connection 后，继续携带对应 ChannelLink 调用 receiving handler。
- 出站消息先记录在 native connection 内存中并返回 `oneworks-out-*` message id；server 暴露 `GET /api/channels/<channelKey>/debug/outbound` 和 `DELETE /api/channels/<channelKey>/debug/outbound`，CLI 暴露 `oneworks channel <channelKey> debug outbound [--limit N|--clear]`，用于本地观察模拟场景的出站内容。后续 UI/room 持久化可以在这个边界上继续扩展。

这还不是完整 UI 插件：Rooms / Playground / Trace / Pending / Scenarios 等管理界面仍未落地。但服务端 channel type 已经可以作为本地调试和自动化测试入口，不需要飞书/微信外部平台也能验证 ChannelLink、identity、command、availability、ingress 和 child session 链路。

## Runtime Contract

OneWorks native channel 只 fake 平台，不 fake runtime。

必须经过：

```text
ChannelLink
  -> IngressRouter
  -> ConversationState / MemorySnapshot
  -> ChildSession
  -> ChannelCommandTool
  -> OutboundTurn
```

不允许插件 UI 直接调用 agent、直接写 memory、直接绕过 ApprovalPolicyResolver，或直接伪造 child run result。

## Relationship To Agent Room

现有 Agent Room 是产品内的协作投影：它围绕 host session、member、run 和 room message 展示子任务协作状态，并把用户消息投递给 host 或指定 member run。它默认使用 OneWorks 当前登录态和产品内权限语义。

OneWorks native channel 是 channel runtime 的平台实现。它可以复用 Agent Room 的房间、成员、消息和前端交互组件作为产品内承载，但进入 runtime 时必须重新归一化成标准频道事件：

```text
room/direct/thread message
  -> ChannelLink
  -> ChannelAccount
  -> CanonicalUser
  -> IngressRouter / PolicyEngine
  -> ChildSession
```

因此两者不应互相替代：

- Agent Room 负责展示和投递 OneWorks 内部协作。
- Native channel 负责模拟或承载一个真实频道类型，包括 identity、authorization、policy gate、command run 和 outbound delivery。
- 如果 native channel 使用 room UI，也只能把 room 当成外层 transport / surface，不能跳过 ChannelLink、ApprovalPolicyResolver、pending intent 或 child run 审计。

这个边界能避免“room 里已经登录了当前用户，所以 channel 就拥有所有人的权限”的误判。

## Single-Login Constraint

当前 OneWorks 尚不支持多账号同时登录。Native channel 在生产模式下能把 OneWorks 当前用户直接映射成 canonical user，但这只解决 actor identity；它不等于系统已经拥有其它平台账号、其它成员或模拟用户的 executable credential。

多账号登录不是 native channel 的前置条件。runtime 收到消息时以 `ChannelAccount` 作为 actor identity，并通过 identity link 解析 canonical user；工具真正执行前再单独检查 credential subject 是否有 active credential。管理面可以先只展示当前登录用户可见的信息和授权入口，后续再补多账号切换/代管视图，但底层权限记录必须已经能容纳同一个 canonical user 下的多个 channel account 和多个 credential subject。

执行规则：

- channel command tool 和 child session 的权限按消息发送者 actor 裁决。
- 用户级 API 必须在当前 `channelKey` issuer 下检查 `channel_user_credentials_v2` 是否 active 且 scope 覆盖。
- 没有 credential 时只能发起 authorization request、降级或拒绝，不能借用桌面登录态、CLI profile、bot app secret 或当前房间 owner 的权限。
- `/whoami` 应展示 channel account、canonical user、identity link 和 credential 数量，用于排查“认得这个人”和“能代表他执行”是否混淆。

## Config

示例：

`.oo.config.json` 只声明 native channel 平台连接：

```json
{
  "channels": {
    "oneworks-main": {
      "type": "oneworks",
      "title": "OneWorks Native Channel",
      "webhookSecret": "replace-with-dev-secret"
    }
  }
}
```

频道入口放在目录化 channel link 文件：

```text
.oo/channels/wan-ke-chat/channel.json
```

```json
{
  "channel": "oneworks-main",
  "entity": "owo-demo",
  "external": {
    "type": "room",
    "roomId": "wan-ke-chat"
  },
  "ingress": {
    "ambientRouting": false,
    "routerPrompt": "普通寒暄只观察；明确请求 OWO 帮忙时才创建子会话。"
  },
  "routing": {
    "default": { "model": "gpt-5.4", "adapter": "codex" }
  }
}
```

一个 channel link 文件仍然只能绑定一个 entity。native channel 不因为在 OneWorks 内部就绕过这个约束。

最小 simulation payload：

```json
{
  "roomId": "wan-ke-chat",
  "senderId": "user-yijie",
  "messageId": "sim-1",
  "text": "@OWO hi"
}
```

如果未配置 `webhookSecret`，webhook 默认拒绝请求。只有显式设置 `allowInsecureWebhooks: true` 且请求 Host 为 loopback 时才允许无 secret 的本地 simulation；共享或公网环境必须配置 secret。

## Channel Features

正式能力：

- group room、direct room、thread/reply。
- mention 当前 entity 和成员。
- slash command 和自然语言 command。
- bot outbound message、ephemeral message、DM fallback。
- pending approval 入口。
- message delivery state 和 outbound echo suppression。
- room membership、role 和 visibility。

Simulation mode 额外能力：

- 创建 synthetic users。
- send-as-user 注入 inbound event。
- scenario replay。
- 人工触发 webhook-like event。
- 开关 bot echo，用来验证 suppression。
- 时间旅行，用于测试 off-hours / throttle / mute expiry。

这些调试能力必须受本地开发或管理员权限保护，不能在普通生产房间暴露。

## Plugin Contributions

插件应贡献：

```json
{
  "plugin": {
    "contributions": {
      "channels": [
        {
          "type": "oneworks",
          "entry": "./server/channel"
        }
      ],
      "navItems": [
        {
          "id": "oneworks-channel",
          "title": "OneWorks Channel",
          "icon": "forum"
        }
      ]
    }
  }
}
```

如果当前 plugin system 还没有 `channels` extension point，需要补这个扩展点，而不是把 native channel 写死到 server。

## UI Surfaces

建议提供这些视图：

- Rooms: 查看和创建 native rooms。
- Playground: 选择 room、用户、消息类型并发送。
- Trace: 展示 IngressRouterRun、ChildSessionRun、ChannelCommandRun、OutboundTurn。
- Pending: 查看 pending intents 和 approval delivery。
- Scenarios: 运行 YAML/JSON 场景文件。

UI 的目标不是“调试页”，而是 native channel 的管理与体验页。Playground / Scenarios 是其中的高级能力。

## Scenario Files

场景文件应表达真实频道事件：

```yaml
room: wan-ke-chat
entity: owo-demo
steps:
  - user: A
    text: 你好
  - user: B
    text: 我知道了
  - user: C
    text: "@OWO 知道啥"
    expect:
      childSession: true
      replyContains: 不确定
```

scenario runner 只负责注入 inbound events 和断言 trace，不直接调用内部函数制造结果。

## Identity

生产模式下，native channel 的发送者来自 OneWorks 当前登录用户。它可以直接映射 canonical user。

Simulation mode 下，synthetic user 必须标记来源：

```text
account provider = oneworks-sim
trust = simulated
```

simulated account 默认不能参与跨平台身份合并，除非管理员显式允许。

## Security

- 普通用户不能 send-as-other-user。
- 生产 room 默认关闭 simulation mode。
- simulation mode 的所有 event 都要写 audit。
- command tool 权限仍按 ActorContext 走，不因为是 native channel 就使用管理员权限。
- trace 里敏感信息要按 viewer 权限过滤。

## Design Principle

OneWorks native channel 是正式产品能力，也是 Channel Runtime 的标准实验场。它的价值在于用同一条真实 runtime 链路同时服务产品体验、演示和本地调试。
