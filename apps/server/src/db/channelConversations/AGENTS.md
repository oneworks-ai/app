# Channel Conversations DB Module

本目录维护 channel runtime 的连续对话状态。

## 文件职责

- `schema.ts`：创建 `channel_conversation_states`、`channel_conversation_turns` 和 `channel_pending_intents`。
- `repo.ts`：保持 `createChannelConversationsRepo` 与公开类型出口，只负责装配子 repo。
- `state-record.ts` / `state-repo.ts`：conversation state 映射与 ensure/get。
- `turn-record.ts` / `turn-repo.ts`：recent turn 映射与 append/list。
- `pending-intent-record.ts`：pending intent 类型、字段选择与行映射。
- `pending-intent-read-repo.ts` / `pending-intent-write-repo.ts`：pending intent 查询与 upsert/update。
- `json.ts`：本模块共享的 JSON 安全转换与字符串列表去重。

## 边界

- 这里保存短期 continuity 索引和安全裁剪后的 turn，不保存完整 runtime transcript。
- conversation state 的唯一性必须包含 `channelKey`；相同 channel type、chat id、thread key 在不同 app / tenant 连接下不能共享 state 或 pending intent。
- pending intent 独立保存在 `channel_pending_intents`，不要混进 conversation turn；memory snapshot 和 tool-call audit 后续各自独立建模。
- resolved authorization intent 可以携带 `metadata.resume`，表示授权结果已经准备好被后续 system-child resume 或调度器消费。
- `threadKey` 当前由确定性 resolver 生成；模型 router 接入后可继续写入同一 state。
