# Client Diagnostics

此目录负责浏览器运行时的全局异常捕获与安全传输。异常必须先通过 `@oneworks/diagnostics` 归一化，只发送稳定错误码、类型和不可逆指纹；不得发送 message、stack、URL、路径或组件内容。

- Electron 渲染层优先走 `window.oneworksDesktop.reportJavaScriptError`，写入桌面诊断日志。
- Web / PWA 走本地 `/api/diagnostics/javascript-errors`，由本地 Server 记录并按用户的系统诊断开关决定是否转发 OTLP。
- React Error Boundary、`window.error`、`unhandledrejection` 和客户端 bootstrap 共用同一个去重、限流 reporter。
- `desktop-first-action-submit.ts` 是真实 session send / annotation send / queued send 的统一提交边界：匿名 `client-action-*` 必须在 transport 前生成并在成功响应后标记 accepted；新 session 的 optimistic retry 继续复用同一个 action ID。
- `desktop-first-action.ts` 只观察服务端为该次提交投影的匿名 action user message、可展示 assistant response 和真实 terminal 状态；它锁定 renderer 内首个 submitted session/action，只向 Desktop IPC 发送闭合的无内容 milestone，不发送 session id、action id、消息或错误文本。删除尚未 dispatch 的首个 queued item 必须收口为 terminated。
- Direct workspace 的 app-level client event stream 与 active session WebSocket 可并行补齐观测，但每条 live transport 必须先独立看到精确 action user message，才能用该 transport 的后续 response/terminal 闭环；每次真实重连和最后 subscriber 离开后的再次观察都要重置该 transport 的 causal generation，连续观察期间复用同一已打开 socket 的新增 subscriber 不得重置，其他 interaction-panel session 的连接变化也不得重置被跟踪 session。任一可信流或 history 看到下一条 user message 后，首动作即全局 superseded，后续 completed 不得接管。history 快照也必须自身包含精确 action。不得用跨机器时间戳、`running` 状态或另一条 transport 的进度拼接因果关系。Relay workspace 离开 active session route 后仍可能缺失样本，不能把缺失解释为成功。

修改后至少运行 `apps/client/__tests__/javascript-error-reporting.spec.ts`、客户端 typecheck 与 build。
