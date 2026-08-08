# channel-resume 服务说明

- `index.ts`：对外 facade，只重导出恢复、查询和 scheduler 入口及公开类型。
- `payload.ts` / `types.ts`：解析 `metadata.resume` 并维护公开恢复类型。
- `intents.ts`：筛选 automatic、manual 和 next-message ready intents。
- `dispatch.ts`：原子 claim intent，维护 child run 和 resume 终态。
- `resume-session.ts` / `runtime-content.ts`：创建新的 `system_resume` ChildSession，并组装恢复上下文。
- `next-message.ts`：维护后续入站消息触发恢复时的 dispatching / dispatched / failed 状态。
- `batch.ts` / `scheduler.ts`：批量消费 ready intents，并提供后台 scheduler 的 start / stop / runOnce 入口。

这里不做授权裁决，也不负责平台消息送达。它只处理“授权/等待状态已经 resolved，怎样回到原 session 继续执行”的运行态桥接。

适合来这里的任务：

- 查找可恢复的 resolved pending intent；后台自动扫描只消费 `metadata.resume.mode=immediate` 且已过 `notBefore` 的 ready intent，`manual` 由 `/auth resume` / `channel.auth.resume` 显式触发，`next_message` 由同一 owner、同一 thread 的后续入站消息在 dispatch 中注入。
- 用带过期 lease 的原子 claim 获取 ready resume intent；worker 中断后只允许回收已过期 lease。
- 为恢复动作创建 `channel_child_session_runs(triggerType=system_resume)` 审计记录。
- 以原 session 作为 `parentSessionId` 和 workspace 来源创建新的 OneWorks session；不要向已经结束或仍运行的原 adapter session 追加恢复消息。
- 在新 session 启动前写入不可变 channel actor / delivery snapshot，并事务性继承父 session 的持久权限；一次性权限只能被一个新 session 取得。
- 将恢复结果写回 `metadata.resume.status=dispatched|failed|skipped`。
- 在 server 启动时初始化 lightweight scheduler，周期性消费 ready resume intent。
