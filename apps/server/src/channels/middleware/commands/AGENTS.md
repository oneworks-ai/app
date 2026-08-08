# Commands Middleware

Channel 指令系统的核心中间件，负责解析用户输入的文本指令并执行对应的操作。

## 架构概览

```
commands/
  index.ts            ← 中间件入口，组装所有指令并分发（含权限拦截）
  command-system.ts   ← 指令类型系统、chain builder、解析器
  cmd.general.ts      ← 通用指令：help / whoami / lang（含 help 格式化）
  cmd.identity.ts     ← 身份指令：identity whoami / link / accounts
  cmd.session.ts      ← 会话指令：session / search / bind / unbind / reset / stop / get / set / permissionMode
  cmd.authorization.ts ← 授权请求指令：auth request / list / grant / deny
  cmd.channel-control.ts ← 频道过程控制指令：silent / unsilent / stop / start / ban
  cmd.access.ts       ← 权限指令：access / admins / admin / allow / block
  access.ts           ← 权限检查 & 频道配置写入工具
  tools.ts            ← CommandSpec 到 `channel.*` typed tool definition 的转换
  i18n.ts             ← 国际化注册 API（defineMessages / t / createT）、LanguageCode 类型、系统级共享翻译
  utils.ts            ← splitCommand / dedupe / choiceParser
```

## 核心机制

### Chain-style 指令定义

所有指令使用 `command()` builder 链式定义，而非对象字面量。支持 `.alias()` / `.description()` / `.adminOnly()` / `.argument()` / `.subcommand()` / `.action()` / `.build()`。需要 action 的指令以 `.action()` 结尾返回 `CommandSpec`；纯分组指令（只有 subcommands 没有 action）以 `.build()` 结尾。

### 权限自动拦截

每个 `CommandSpec` 有 `permission: 'everyone' | 'admin'`（通过 `.adminOnly()` 设置）。中间件在 dispatch 时会把解析后的 command、当前 sender、channel admin 配置和 source 交给 `services/channel-approval` 做最小裁决：若指令标记为 admin-only 且当前发送者不是管理员，直接回复权限错误，不会进入 action。cmd 文件中的 action 无需手动检查权限。

### Command Run 审计

解析成功的 fast path 指令会写入 `channel_command_runs`：

- action 成功：`success`
- admin-only 被拦截：`denied`
- action 抛错：`failed`

未知指令会继续透传给后续 middleware，不写 command run。解析到已知指令但参数错误时当前仍只回复用法，不写 run；后续若需要完整审计再扩展 parse-error run。

`channel_command_runs.metadata.approval` 会记录最小 resolver 的裁决摘要，包括 status、reasonCode、capability、actor id 和 authorizationRequestId（如有）。这只是审计摘要，不是 credential secret，也不代表已经获得用户个人登录态。

### Typed Tool Registry

`tools.ts` 将现有 `CommandSpec` 树转换成 `channel.*` typed tool definition，并提供 tool input 到 `CommandParseSuccess` 的解析。registry 描述工具名、command path、slash usage、参数 JSON schema、权限等级和 `actorAuthority: 'sender'`；执行仍回到 `index.ts` 的统一 command runner，所以 typed invocation 和 slash fast path 共享权限拦截、action 和 `channel_command_runs` 审计。

新增命令时只要继续使用 `command()` / `requiredArg()` / `optionalArg()` / `restArg()` / `variadicArg()` 定义，`listChannelCommandTools()` 会自动生成对应 tool definition，`invokeChannelCommandTool()` 会按 tool name + JSON input 调用同一条执行链路。agent / ChildSession 接入时必须传入真实发送者的 `ChannelContext`；不要手动构造管理员 ctx 或绕过 `isAdmin(ctx)`。offline command invocation 带 `sessionId` 时，`command-invocation.ts` 会优先使用该 session 的 `channelActorSnapshot`，并拒绝和 snapshot 冲突的 sender/channel context；新增调用入口不要重新信任 CLI 传入的 sender。

agent / CLI 对 typed tools 的远程入口在 `apps/server/src/channels/command-invocation.ts` 和 `/api/channels/:channelKey/commands/invoke`。那里会从 `ChannelRuntimeState`、当前消息 context 和 DB identity tables 还原 `ChannelContext`；commands 模块本身只负责定义、解析、权限拦截和执行。不要在 commands 模块里读取 CLI profile、桌面登录态或外部平台 token 来决定 actor。

### 可配置前缀

指令前缀从 `ctx.config.commandPrefix` 读取，默认 `/`。解析和格式化时均通过参数传入 prefix，不硬编码。

### i18n（分布式注册 + ctx 注入）

所有面向用户的文本通过 `ctx.t(key, args?)` 获取。`ctx.t` 是一个已绑定语言的翻译函数，由 `handlers.ts` 在组装 `ChannelContext` 时通过 `createT(lang)` 创建，语言从 `ctx.config.language` 读取。

翻译采用**分布式注册**：每个 `cmd.*.ts` 在模块顶部通过 `defineMessages(lang, entries)` 注册自己的翻译条目，而非集中定义在一个文件中。`i18n.ts` 仅提供 `defineMessages` / `t` / `createT` 三个 API 以及系统级共享翻译（`system.*`、`label.*`）。消息模板支持 `string` 和 `(args) => string` 两种形式。

`LanguageCode` 类型定义在 `i18n.ts` 中（非 `@oneworks/core`，因为该类型仅 server 使用）。

cmd action handlers 中**不再直接 import `t`**，全部通过 `ctx.t(key, args?)` 调用。`command-system.ts` 的 `parseCommandString` 同样接收 `opts.t` 函数而非 `lang` 参数。

### Identity / Credential 可观测性

`/whoami` 是当前排查 actor identity 与 executable credential 分离的入口。它需要展示 sender、channel account、account key、canonical user、identity link 状态和当前 channel type 下的 credential 数量；不要把它简化回只有 sender/session 的展示。credential 查询只读 `channel_user_credentials` 元信息，不读取 token secret，也不代表已经获得用户个人登录态。

### 授权恢复

`/auth grant|deny` 先通过 `services/channel-authorizations` 收敛 authorization request 和 pending intent，再 best-effort 调用 `services/channel-resume` 消费同一 authorizationRequestId 下的 ready resume intent。typed tool invocation 走同一 command runner，所以自然语言触发 `channel.auth.grant` / `channel.auth.deny` 时也会尝试恢复原 session。

### ctx 组装

`ChannelContext`（含 `t`、session 操作、`reply` 等）在 `handlers.ts` 的 `handleInboundEvent` 中完成组装，而非 `middleware/index.ts`。`middleware/index.ts` 仅负责管道组合（`compose`），导出 `pipeline`。

### 会话操作在 ctx 上

`getBoundSession` / `resetSession` / `stopSession` / `restartSession` / `updateSession` 均挂载在 `ChannelContext` 上（由 `handlers.ts` 负责注入实现），指令内直接调用 `ctx.xxxSession()` 即可，不需要在 commands 内 import DB 或 websocket 模块。

## 添加新指令

1. 在合适的 `cmd.*.ts` 中用 `command()` 链式定义，或新建 `cmd.xxx.ts` 文件
2. 在同一文件顶部通过 `defineMessages('zh', { ... })` 和 `defineMessages('en', { ... })` 注册翻译
3. 在 `index.ts` 的 `getAllCommands()` 中注册新文件导出的数组
4. 若是 admin-only 操作，加上 `.adminOnly()` 即可，中间件自动拦截非管理员
5. 参数解析用 `requiredArg` / `optionalArg` / `restArg` / `variadicArg`，自定义解析用 `choiceParser`
6. action 中使用 `ctx.t(key, args?)` 获取翻译文本，不要直接 import `t`

## 添加新语言

在每个 `cmd.*.ts` 文件中新增对应语言的 `defineMessages(newLang, { ... })` 调用，并在 `i18n.ts` 中为系统级翻译追加同语言条目。同时在 `i18n.ts` 的 `LanguageCode` 类型和 `@oneworks/core` 的 `channelBaseSchema` 的 `language` 枚举中添加新值。

## 测试

测试在 `__tests__/channels/middleware/commands.spec.ts`。`makeCtx()` 已内建所有 session 操作的 mock 和 `t`（通过 `createT(undefined)` 创建），mock 实现直接委托给注入的 DB/websocket mock，与真实 `handlers.ts` 中的实现逻辑对齐。
