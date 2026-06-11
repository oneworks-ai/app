# Agent Rooms DB Module

本目录是 Agent Room 的 SQLite schema 和 repo。它只负责持久化，不承载 runtime 投影、消息投递或 UI 聚合逻辑。

## 文件职责

- `schema.ts`
  - 创建并迁移：
    - `agent_rooms`
    - `agent_room_members`
    - `agent_room_runs`
    - `agent_room_messages`
  - 维护索引和新增列的兼容迁移。
- `repo.ts`
  - row <-> domain object 映射。
  - room/member/run/message CRUD。
  - `payloadJson`、run `optionsJson` 等 JSON 字段的 parse/stringify。

## 表模型

- `agent_rooms`
  - room 基础信息、`hostSessionId`、status、lastMessage、archive/favorite 时间。
- `agent_room_members`
  - room 内成员，包含 kind/label/avatar/subtitle、status、latestSummary、activeRunCount、pendingCount。
- `agent_room_runs`
  - child run，包含 memberKey、sessionId、title、status、interactionId、requestKind、options。
- `agent_room_messages`
  - room timeline 原始消息，包含 role、memberKey、runKey、content、eventType、payloadJson、createdAt。

## 约束

- 新字段优先放在现有 JSON payload 还是结构化列，需要看查询需求：需要索引或高频过滤才加列。
- schema 迁移写在 `schema.ts` 的 `ensureColumn` 段，不要在 repo 里做隐式建表。
- repo 返回共享类型定义在 `packages/types/src/agent-room.ts`，不要在 DB 层扩展私有字段给上层。
- `appendMessage` 当前按 id 去重，事件投影依赖这个幂等性。

## 回归

- DB schema/repo 改动至少跑 server 侧 Agent Room service 测试：
  `pnpm exec vitest run --workspace vitest.workspace.ts --project server apps/server/__tests__/services/agent-room.spec.ts`
