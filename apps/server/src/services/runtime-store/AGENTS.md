# Runtime Store Service Module

本模块消费统一 CLI runtime protocol 的 store/events/meta/state，并把它们投影到 server session 与 Agent Room。

## 快速入口

- `watcher.ts`：runtime store watcher，发现 session store、读取增量事件并触发投影。
- `projection.ts`：总投影入口，协调 metadata、session event、room event。
- `metadata-projection.ts`：meta/state 到 session 与 room 初始状态的投影。
- `session-projection.ts`：runtime status 到 server session status 的映射。
- `session-event-projection.ts`：runtime events 到 session message / interaction / status 的投影。
- `room-projection.ts`：runtime events 到 Agent Room room/member/run/message 的投影。
- `engine-consumer.ts`：把 runtime protocol command 交给具体 adapter / engine 执行。
- `jsonl.ts`、`types.ts`、`content.ts`：store 读取、局部类型和 content 文本提取工具。

## Agent Room 投影规则

- `roomId` 或 `hostSessionId` 来自 runtime event 或 metadata。
- `session_started` 会映射成 room assignment / run running。
- `approval_requested` / `input_requested` 会映射成 attention，并可转发给 leader host session。
- `session_completed` / `operation_completed` / completed status 映射成 run completed。
- `session_failed` / `command_failed` 映射成 run failed。
- `session_stopped` 或 stopped/cancelled/killed 状态映射成 run stopped。
- `message` 只有在 `visibility: "room"` 或 `publicSummary` 存在时才可能成为 room summary；普通子会话 transcript 不直接投影到 room。

## Agent Room 投影注意事项

- `status_changed` / `session_completed` 可以更新 run 状态，但不一定应该生成用户可见 room message；等待审批的 run 尤其不能被重复 terminal state 覆盖成 completed。
- 给 child session 的 `send_message` / `resume` command 要保留 `roomId`、`runId`、`memberKey`、`source` 等上下文，否则前端无法区分消息来自用户、leader 还是其他实体。
- runtime consumer 启动或恢复时，避免把 start command、follow-up command 和 adapter 自己产出的 user message 重复投影；去重依据应优先使用 command ack / submitted marker。

## Leader Child Request 转发

`room-projection.ts` 会把 child run 的 permission/input request 转成 host session 中的用户消息，内容以 `[Agent room child request]` 开头，并携带：

- `memberKey`
- `runKey`
- `childSessionId`
- `interactionId`
- request kind / options

Agent Room service 再通过这些 metadata 判断 leader prompt 是否应该公开投影回 room。

## 边界

- runtime protocol 字段定义在 `packages/runtime-protocol/`。
- Agent Room 领域状态更新走 `../agent-room/` service，不在这里直接维护 room 聚合规则。
- session messages 的持久化走 session projection；room messages 的持久化走 room projection + agent-room service。

## 回归

- 改 room 投影时同时看 `apps/server/__tests__/services/agent-room.spec.ts` 中 host projection / child request 用例。
- 改 protocol 字段时同步跑 `packages/runtime-protocol` 测试，并检查 adapter 事件输出。
