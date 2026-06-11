# Runtime Protocol Package

`@oneworks/runtime-protocol` 定义统一 CLI runtime protocol 的 JSONL record、command、event、meta/state 与版本兼容规则。它是 contract 包，不承载 adapter 执行、server 投影或 UI 行为。

## 快速入口

- `src/types.ts`：TypeScript contract。
- `src/schemas.ts`：Zod schema，与 types 字段保持同步。
- `src/jsonl.ts`：JSONL parse / serialize helper。
- `src/version.ts`：protocol version 与 supported range 检查。
- `src/index.ts`：公共导出入口。

## Agent Room 相关字段

runtime event / meta 上这些字段会被 server runtime-store 投影读取：

- `roomId`
- `roomTitle`
- `hostSessionId`
- `memberKey`
- `memberKind`
- `memberLabel`
- `memberAvatar`
- `memberSubtitle`
- `runId`
- `runTitle`
- `visibility`
- `publicSummary`
- `requestKind`
- `kind`
- `options`
- `multiselect`

改这些字段时，需要同步检查：

- `apps/server/src/services/runtime-store/AGENTS.md`
- `apps/server/src/services/runtime-store/room-projection.ts`
- `apps/server/src/services/runtime-store/session-event-projection.ts`
- adapter 输出 runtime events 的地方

## 边界

- 这里只定义协议和验证；不要在本包里实现 Agent Room 投影、session 状态更新或 adapter 调用。
- 新增字段必须同时改 `types.ts`、`schemas.ts`、导出和相关测试。
- 兼容性变化需要评估 `version.ts` 的 supported range，而不是只改类型。
