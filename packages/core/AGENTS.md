# Core Package

`@oneworks/core` 是 app 层常用的公共 facade。它主要重新导出共享类型、config schema、channel contract、WebSocket 类型和少量环境 / tool 工具。

## 快速入口

- `src/index.ts`：公共导出入口。
- `src/types.ts`：从 `@oneworks/types` 重新导出的跨包类型；Agent Room 类型也从这里给 client/server 使用。
- `src/config-schema.ts`：配置 Zod schema、adapter config contribution、UI schema metadata。
- `src/channel.ts`：channel 接入公共 contract。
- `src/ws.ts`：server/client 共用的 WebSocket event 类型别名。
- `src/env.ts`、`src/schema.ts`、`src/tools.ts`：轻量工具导出。

## 边界

- 本包不实现 Agent Room、session、runtime store 或 adapter 执行逻辑。
- 新增跨包稳定类型优先落在 `packages/types/`，再通过 `src/types.ts` re-export。
- 新增 runtime protocol 字段不放这里，去 `packages/runtime-protocol/`。
- Config schema 字段变化需要同步 config package、server config service 和 client config UI。

## Agent Room 提醒

代码里常见 `@oneworks/core` 引入 Agent Room 类型，但真实定义在 `packages/types/src/agent-room.ts`。改 room contract 时优先读 `../types/AGENTS.md`，这里只负责 re-export。
