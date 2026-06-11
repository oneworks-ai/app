# 启动链路

返回入口：[ARCHITECTURE.md](../ARCHITECTURE.md)

## `ow run`

1. `apps/cli/cli.js`
2. `@oneworks/cli-helper/loader`
3. `apps/cli/src/cli.ts`
4. `apps/cli/src/commands/run.ts`
5. `@oneworks/app-runtime.generateAdapterQueryOptions()`
6. `@oneworks/app-runtime.run()`
7. `packages/task/src/prepare.ts`
8. `@oneworks/config`、`@oneworks/utils`、`@oneworks/definition-loader`、`@oneworks/definition-core`、`@oneworks/workspace-assets` 完成 config、logger、definition 文档、definition 语义、workspace assets 与非 task 默认 MCP 装配
9. adapter query

## `ow agent`

1. `apps/cli/cli.js`
2. `@oneworks/cli-helper/loader`
3. `apps/cli/src/cli.ts`
4. `apps/cli/src/commands/agent.ts`
5. `@oneworks/runtime-store`
6. `@oneworks/runtime-protocol`
7. home project 目录 `runtime/sessions/<sessionId>/commands.jsonl`、`events.jsonl`、`state.json`

`ow agent` 是 task runtime 的标准调用面，用于 start / send / stop / kill / submit / resume / status / events。Agent guidance、server projection 和后续 runtime consumer 都围绕 runtime protocol/store 对接。

## `oneworks-mcp`

1. `packages/mcp/cli.js`
2. `@oneworks/cli-helper/loader`
3. `packages/mcp/src/cli.ts`
4. `packages/mcp/src/command.ts`
5. `packages/mcp/src/tools/*`
6. `@modelcontextprotocol/sdk` stdio server

`oneworks-mcp` 只承担非 task MCP 工具入口；task runtime 不通过 MCP 暴露工具，也不提供 MCP 到 runtime protocol 的转换层。

## `oneworks-call-hook`

1. `packages/hooks/call-hook.js`
2. `packages/hooks/src/entry.ts`
3. 优先加载当前 active adapter 的 `./hook-bridge`
4. 未命中时回退 `packages/hooks/src/runtime.ts`
5. runtime 通过 `@oneworks/config` 读取配置，通过 `@oneworks/utils` 处理 logger、log level 与输入转换
6. plugin middleware 链

## 默认内建 MCP

- `task prepare` 会把内建 `OneWorks` MCP server 作为 fallback MCP asset 注入到 workspace bundle，但该 MCP 不承担 task runtime 入口。
- 关键实现位置：
  - `packages/config/src/default-oneworks-mcp.ts`
  - `packages/task/src/prepare.ts`
- 它本质上是 `process.execPath + <resolved @oneworks/mcp>/cli.js` 的本地 stdio server。
- 子 agent 调度、状态查看与消息发送统一走 `ow agent ...` 和 runtime protocol/store。

## 关闭方式

优先级从高到低：

1. 运行参数 `useDefaultOneWorksMcpServer`
2. 配置 `noDefaultOneWorksMcpServer`
3. 默认值 `true`

CLI 开关：`ow run --no-default-oneworks-mcp-server`
