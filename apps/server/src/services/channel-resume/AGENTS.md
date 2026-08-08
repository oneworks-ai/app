# channel-resume 服务说明

- `index.ts`：对外 facade，只重导出恢复、查询和 scheduler 入口及公开类型。
- `payload.ts` / `types.ts`：解析 `metadata.resume` 并维护公开恢复类型。
- `intents.ts`：筛选 automatic、manual 和 next-message ready intents。
- `dispatch.ts` / `runtime-content.ts`：创建 `system_resume` child run，并把恢复上下文投递回原 runtime session。
- `next-message.ts`：维护后续入站消息触发恢复时的 dispatching / dispatched / failed 状态。
- `batch.ts` / `scheduler.ts`：批量消费 ready intents，并提供后台 scheduler 的 start / stop / runOnce 入口。

这里不做授权裁决，也不负责平台消息送达。它只处理“授权/等待状态已经 resolved，怎样回到原 session 继续执行”的运行态桥接。

适合来这里的任务：

- 查找可恢复的 resolved pending intent；后台自动扫描只消费 `metadata.resume.mode=immediate` 且已过 `notBefore` 的 ready intent，`manual` 由 `/auth resume` / `channel.auth.resume` 显式触发，`next_message` 由同一 owner、同一 thread 的后续入站消息在 dispatch 中注入。
- claim ready resume intent，避免重复投递。
- 为恢复动作创建 `channel_child_session_runs(triggerType=system_resume)` 审计记录。
- 调用 session `processUserMessage` 将内部恢复上下文投递回原 session。
- 将恢复结果写回 `metadata.resume.status=dispatched|failed|skipped`。
- 在 server 启动时初始化 lightweight scheduler，周期性消费 ready resume intent。
