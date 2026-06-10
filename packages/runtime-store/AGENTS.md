# Runtime Store Package

`@oneworks/runtime-store` 是 runtime protocol 的文件存储实现。它负责 session store 的路径、JSON/JSONL 读写、lock、command 排序和 file-store API；server 侧 watcher / projection 在 `apps/server/src/services/runtime-store/`。

## 快速入口

- `src/session-store.ts`：`FileRuntimeStore`、`FileRuntimeSessionStore`，读写 `meta.json`、`state.json`、`heartbeat.json`、`commands.jsonl`、`events.jsonl`。
- `src/paths.ts`：home project runtime root / user runtime root 解析。
- `src/json.ts`：JSON 与 JSONL 原子读写、tail helper。
- `src/lock.ts`：runtime owner lock 与 stale 判断。
- `src/scheduler.ts`：command priority 和下一条 command 选择。
- `src/schemas.ts`、`src/types.ts`：复用 `@oneworks/runtime-protocol` 的 schema/type 并补 store index / lock 类型。
- `src/index.ts`：公共导出入口。

## 边界

- 本包只关心文件存储与调度顺序，不消费事件语义。
- runtime event 到 session / Agent Room 的投影在 server `services/runtime-store/`。
- protocol 字段定义在 `packages/runtime-protocol/`，本包不单独扩展 event contract。
- adapter / engine 不应绕过这里直接手写 store 文件，除非是在测试里构造 fixtures。

## 回归

- `pnpm exec vitest run --workspace vitest.workspace.ts --project runtime-store packages/runtime-store/__tests__/runtime-store.spec.ts`
