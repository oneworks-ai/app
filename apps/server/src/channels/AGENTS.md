本目录用于服务端频道系统的模块化实现，采用中间件管道架构处理入站消息。

## 目录结构

```
channels/
  index.ts            初始化所有频道连接，对外暴露 ChannelManager
  handlers.ts         handleInboundEvent（ctx 组装 + ChannelLink 匹配 + 管道执行）、handleSessionEvent（出站回复）
  command-invocation.ts  typed channel command 的稳定入口；`command-invocation-*` 私有文件负责 actor snapshot、ctx 与 session 操作还原
  types.ts            频道层共享类型（re-export 自 middleware/@types）
  state.ts            内存绑定状态（dedup / binding / pendingUnack）
  loader.ts           动态加载频道连接模块
  middleware/         入站消息管道
    @types/             共享类型定义
      index.ts            ChannelContext / ChannelTextMessage / ChannelMiddleware
    @utils/             通用工具函数
      index.ts            stripSpeakerPrefix / stripLeadingAtTags / getInboundContentItems
    index.ts            管道组装（compose），导出 pipeline
    deduplicate.ts      按 messageId 做内存与 SQLite 持久去重
    i18n.ts             初始化 channel 提示语言与消息字典
    parse-content.ts    解析富文本内容 + 剥离 @-tag 和发言者前缀
    identity.ts         解析 sender 对应的平台账号与 canonical user
    emoji-registry.ts   自动记录入站平台自定义表情的可复用 id
    access-control.ts   检查 allowPrivateChat / allowGroupChat / 黑白名单
    resolve-session.ts  从 DB 查询当前 channel 绑定的 sessionId
    availability-gate.ts  ChannelLink availability gate，按 workHours / offHours / throttle / backlog 决定是否继续
    ingress-gate.ts     ChannelLink ingress 确定性 gate，按 ambientRouting / mention / command 决定是否继续
    group-message-debounce.ts  群聊普通消息防抖合并，slash command 不延迟
    ack.ts              向 channel 发送「处理中」确认
    admin-gate.ts       无 session 时限制非 admin 用户创建新会话
    commands/           指令定义、typed tool 转换与统一授权 / 审计；细节见 `commands/AGENTS.md`
    bind-session.ts     持久化 channel↔session 绑定 + 内存 binding
    dispatch/           创建新 session 或向已有 session 转发消息
      index.ts            dispatchMiddleware 编排入口
      context.ts          thread、conversation 与 message context
      runtime-content.ts  群聊提醒、emoji hint 与 multimodal model
      resume.ts           next-message resume intent 选择
      child-run.ts        child run 与 conversation turn 审计
      prompt/             会话启动时 systemPrompt 组装
        agent-rules.ts      读取 `.oo/rules/AGENTS.channel.<type>.md` 规则文件
        context.ts          生成频道上下文（平台名、bot 名称、admin 列表）
        index.ts            buildSessionSystemPrompt（汇总所有 prompt 片段）
```

## middleware/ 文件组织规则

`middleware/` 目录下只存在三类文件：

1. **`@` 开头的目录**（如 `@types/`、`@utils/`）— 放置通用工具与类型定义，不含业务逻辑；
   目录内以 `index.ts` 作为唯一出口。

2. **中间件实现文件**（如 `ack.ts`、`commands.ts`）— 每个文件只导出一个 `ChannelMiddleware`，
   命名统一为 `<camelCase>Middleware`。

3. **`index.ts`**（唯一入口）— 负责管道组装（`compose`）、`pipeline` 导出；
   不包含 `ChannelContext` 组装逻辑（ctx 在 `handlers.ts` 中创建）。

## 中间件管道执行顺序

入站事件进入中间件前，`handlers.ts` 会先根据 `ChannelRuntimeState.channelLinks` 匹配 `.oo/channels/<link>/channel.*`，并把匹配结果放入 `ctx.channelLink`。这个步骤只解析“当前外部频道绑定哪个实体”，不做策略、审批或会话创建。

```
deduplicateMiddleware      → 重复消息截断
i18nMiddleware             → 初始化提示语言
parseContentMiddleware     → 空消息截断，解析 contentItems，计算 commandText
identityMiddleware         → 记录 sender 平台账号并解析 canonical user
accessControlMiddleware    → 权限不符截断（admins 豁免所有控制）
emojiRegistryMiddleware    → 自动记录入站平台自定义表情引用
resolveSessionMiddleware   → 填充 ctx.sessionId
channelCommandMiddleware   → 识别到指令处理并截断，否则 next()
interactionResponseMiddleware → 处理待确认/权限问题的频道回复
availabilityGateMiddleware → ChannelLink 下班时段固定话术 / 节流 / 截断
ingressGateMiddleware      → ChannelLink 关闭 ambientRouting 时，拦截普通群聊消息
groupMessageDebounceMiddleware → 群聊普通消息按配置短暂合并
ackMiddleware              → 发送处理中状态
adminGateMiddleware        → 无 session 且非 admin 截断并提示
dispatchMiddleware         → 创建 session 或转发消息到已有 session
bindSessionMiddleware      → 持久化 channel↔session 绑定
```

## Channel 配置字段

`channelBaseSchema`（`@oneworks/core/channel`）支持以下字段：

| 字段                      | 类型        | 说明                                                                                    |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `type`                    | `string`    | 频道类型（必填）                                                                        |
| `title`                   | `string?`   | 频道标题，也作为 bot 在该频道的显示名称                                                 |
| `description`             | `string?`   | 频道说明                                                                                |
| `enabled`                 | `boolean?`  | 是否启用，默认 true                                                                     |
| `enableWebhook`           | `boolean?`  | 是否启用该 channel 的 HTTP webhook，默认 true                                           |
| `systemPrompt`            | `string?`   | 启动会话时注入的系统提示词                                                              |
| `commandPrefix`           | `string?`   | 频道指令前缀，默认 `/`                                                                  |
| `groupMessageDebounceMs`  | `number?`   | 群聊普通消息防抖合并时间，单位毫秒，默认 1200；设为 0 可关闭                            |
| `silentSessions`          | `string[]?` | 被静默的 OneWorks session ID 列表；这些会话不能通过 `oneworks channel` 主动发送频道消息 |
| `language`                | `zh\|en?`   | 频道提示语言，默认 `zh`                                                                 |
| `enableSessionMcp`        | `boolean?`  | 是否自动挂载该频道提供的 session companion MCP，默认 true                               |
| `serverBaseUrl`           | `string?`   | 频道动作页与工具详情页对外可访问的 server 基础地址；未配置时继承顶层 `server.public`    |
| `sessionDetailBaseUrl`    | `string?`   | 会话详情 UI 的对外可访问基础地址；未配置时基于 `serverBaseUrl` 和 client base 推导      |
| `access.admins`           | `string[]?` | 管理员 sender ID 列表，豁免所有访问控制，可执行管理指令                                 |
| `access.allowPrivateChat` | `boolean?`  | 是否接受私聊，默认 true                                                                 |
| `access.allowGroupChat`   | `boolean?`  | 是否接受群聊，默认 true                                                                 |
| `access.allowedGroups`    | `string[]?` | 群组白名单（channel ID）                                                                |
| `access.blockedGroups`    | `string[]?` | 群组黑名单（channel ID）                                                                |
| `access.allowedSenders`   | `string[]?` | 发送者白名单（sender ID）                                                               |
| `access.blockedSenders`   | `string[]?` | 发送者黑名单（sender ID），优先于白名单                                                 |

## WeChat Channel

WeChat / WechatApi 的 package 级配置、TokenId 获取入口、平台文档链接和公网暴露说明维护在 `packages/channels/wechat/README.md`；代码维护边界见 `packages/channels/wechat/AGENTS.md`。

服务端侧只保持通用约定：webhook route 固定为 `/channels/:channelType/:channelKey/webhook`，公网 host 默认放行 `/channels/*/*/webhook`，不要求用户把该路径写进 `server.publicPaths`。是否暴露某个具体 channel 由对应 channel 配置控制，例如 `enableWebhook: false`。

## OneWorks Native Channel

OneWorks 内置 channel type 是 `oneworks`，实现位于 `packages/channels/oneworks/`。它提供本地 / 产品内 native channel 的最小平台实现：webhook simulation payload 会被规范化为 `ChannelInboundEvent`，再进入当前 server 的完整中间件管道。维护该包前先读 `packages/channels/oneworks/AGENTS.md`。

服务端侧仍只通过 `loadChannelModule('oneworks')` 加载包，不在 `channels/` 目录写死 native channel 业务逻辑。

## Companion MCP 约定

Channel 包可以可选导出 `@oneworks/channel-<type>/mcp` 子入口，用于声明该频道的 session-scoped companion MCP。

- 子入口导出 `resolveChannelSessionMcpServers(config, context)`。
- 返回值是具体 MCP server 配置数组；server 会在会话启动时解析，而不是在 workspace 资产阶段预注入。
- companion MCP 只会注入到“从该频道绑定会话启动出来的 adapter session”里，不会影响其他会话。
- `enableSessionMcp !== false` 时默认启用；频道配置可按 channel key 单独关闭。
- companion MCP 应优先暴露该频道上下文相关、需要当前会话绑定信息才能安全执行的动作，例如发送消息、查询当前群、处理频道目录对象等。
- 命名推荐使用 `channel-<type>-<channelKey>` 前缀，避免和用户 workspace 自带的 MCP 重名。
- 如果 companion MCP 需要给用户返回 server 动作链接或详情页链接，统一基于 `serverBaseUrl` / `sessionDetailBaseUrl` 生成，默认继承顶层 `server.public`，再回落到 `http://localhost:<serverPort>`；涉及局域网、反向代理或公网部署时，优先通过顶层 server 配置提供外部可访问地址。
- 这类对外动作链接依赖 `__ONEWORKS_PROJECT_SERVER_ACTION_SECRET__` 做签名；未配置时不应继续生成可点击链接。
- 对外暴露到聊天卡片里的 server 动作链接必须使用短时签名 token，不直接暴露原始 `sessionId` / `toolUseId`；带副作用的动作应进一步做一次性消费，避免刷新或预取重复执行。

实现约定：

```typescript
export const resolveChannelSessionMcpServers =
  defineResolveChannelSessionMcpServers<MyChannelConfig>((config, context) => [
    {
      name: `channel-mytype-${context.channelKey}`,
      config: {
        command: process.execPath,
        args: [resolveMcpCliPath()],
        env: {
          ONEWORKS_CHANNEL_SESSION_ID: context.sessionId,
          ONEWORKS_CHANNEL_KEY: context.channelKey
        }
      }
    }
  ])
```

## systemPrompt 组装顺序

新建 session 时，以下片段按顺序 `\n\n` 拼接：

1. `config.systemPrompt` — 配置文件中直接写的提示词
2. `buildChannelContextPrompt()` — 自动生成（平台名 / bot 名 / admin 列表）
3. `loadChannelAgentRules()` — 优先读取 `.oo/rules/AGENTS.channel.<channelType>.md`，兼容回退到项目根目录同名文件
4. `connection.generateSystemPrompt()` — 频道连接实现动态生成（如调平台 API）

最终再与 `startAdapterSession` 内部的 spec/entity prompt 和语言提示合并。

## ChannelConnection 接口扩展

`@oneworks/core/channel` 的 `ChannelConnection<TMessage>` 支持 `handleWebhook`、`updateMessage`、`generateSystemPrompt` 可选方法；签名以该 package 的公开类型为准。

频道实现可在此方法中调用平台 API（如获取 bot profile），结果自动注入 systemPrompt。

`handleWebhook` 用于 HTTP callback 型平台；server route 统一挂在 `/channels/:channelType/:channelKey/webhook`，route 只分发，平台 payload 解析和 secret 校验放在对应 channel package。
通用 route 同时支持 `GET` webhook verification / challenge 和 `POST` 事件回调；`ChannelWebhookRequest` 会带上 method、headers、query、解析后的 body，以及 body parser 可用时的 `rawBody?: string | Uint8Array`，需要 HMAC / token challenge / 解密的平台应优先使用 `rawBody`。

`updateMessage` 主要用于频道内的增量状态展示，例如把连续的 tool_use / tool_result 事件更新到同一条卡片或消息里，而不是每次发送一条新的文本回复。

## 工作约定

- `channels/index.ts` 仅负责初始化与对外导出，不新增业务逻辑
- `handlers.ts` 只保留出站事件处理（`handleSessionEvent`），入站逻辑全部在管道中
- `command-invocation.ts` 只用于 agent / CLI / HTTP 侧的 typed channel command 调用；它必须从真实 channel runtime state 和当前消息上下文还原发送者身份，不要手动提升为管理员或复用当前 CLI 登录态
- `identity.ts` 只解析入站 sender 的平台账号与已绑定 canonical user，不自动创建 canonical user
- `availability-gate.ts` 只处理确定性上下班窗口、固定话术、DB 节流与 off-hours backlog 写入；`bypassUsers` 可填 sender ID 或已绑定 canonical user ID；digest 和更复杂策略状态后续放到独立服务
- `ingress-gate.ts` 只做确定性 gate；模型 router、pending intent、审批和策略状态不要塞进这里
- HTTP webhook 入口只做 route 参数整理与 channel manager 分发；平台 payload 解析和 secret 校验放在对应 channel package 的 `handleWebhook`
- `state.ts` 只管理内存状态，不写 DB
- `loader.ts` 只负责动态加载频道连接模块
- 新增中间件在 `middleware/` 下单独建文件，导出格式为 `export const <name>Middleware: ChannelMiddleware`，在 `middleware/index.ts` 中按顺序组装
- 新增 prompt 片段在 `middleware/dispatch/prompt/` 下单独建文件，在 `middleware/dispatch/prompt/index.ts` 中汇总
- `middleware/` 下的公共类型统一放在 `middleware/@types/`，不直接写在实现文件中
- 任何对 `channel_sessions` 的写入必须同时更新内存绑定（`bindSessionMiddleware` 统一处理）
- 删除会话时要同步清理 `channel_sessions` 和内存 binding
