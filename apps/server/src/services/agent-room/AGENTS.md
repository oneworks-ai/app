# Agent Room Service Module

本模块是服务端 Agent Room 领域服务。它维护 room/member/run/message 的聚合状态，负责用户 room 消息投递到 host 或 child session，并把 host session 中需要公开的 assistant 回复投影回 room。

## 入口文件

- `index.ts`：当前完整领域服务入口。

## 核心职责

- `createRoom` / `ensureRoomForHostSession`：创建或绑定 host session 的 room。
- `upsertMember`：保存成员并根据成员 runs 重新计算成员状态。
- `upsertRun`：保存子 run，维护 run 状态、latest summary、interaction/options。
- `applyEvent`：写入 runtime 投影过来的 room event，并更新 member/run/room summary。
- `appendUserMessage`：把用户在 room 里发的消息投递到目标 child run 或 host session，同时写入 room message、delivery 和 reaction payload。
- `getDetail`：读取持久化 detail，并叠加 host session 中可公开的 initial user message 和 final leader assistant message。

## 数据边界

- 持久化表和 SQL 在 `../../db/agentRooms/`，service 不直接拼 schema。
- HTTP 入参校验在 `../../routes/agent-rooms.ts`，service 抛业务错误即可。
- runtime event 到 room event 的映射在 `../runtime-store/room-projection.ts`，service 只消费已经规范化的 `AgentRoomEvent`。
- 共享类型在 `packages/types/src/agent-room.ts`，不要在 service 内私造跨层 contract。

## 消息投递规则

- 有 `target.runKey` 时优先投递到对应 run 的 session。
- run 正在 `waiting` 且有 `interactionId` 时，room 消息作为 interaction response。
- 有 host target 或无 target 时，投递到 room 的 `hostSessionId`。
- 成功投递后，room user message payload 写入：
  - `delivery`
  - `reactions: [{ kind: 'working', ...target }]`
  - 原始 `target`，供前端生成 target label 和 reaction。

## Host Session 公开投影

`getHostSessionRoomMessages` 只把这些 host session 内容投影到 room：

- 初始用户消息。
- 与 room activity 同一 turn 相关的最终 leader assistant 消息。
- 由 child permission/input request 触发的 leader prompt。

普通 leader 内部推理或不相关 casual reply 不应出现在 room timeline。

## Agent Room 消息语义注意事项

- room 里的用户消息必须在发送时写入 room timeline，同时投递到目标 session；不要等 child session 完成后再补显示。
- 续发到已有 member run 时优先复用该 run 的 session，不要为同一个 member 新建平行 session。
- 修 room / member session 双向投递时，回归要确认两边都能看到用户原消息和实体回复，且不会出现重复 assistant message。

## 回归

- 服务行为：`pnpm exec vitest run --workspace vitest.workspace.ts --project server apps/server/__tests__/services/agent-room.spec.ts`
- 改动涉及 runtime 投影时，同时跑 runtime-store 相关测试或至少搜索 `room-projection` 覆盖项。
