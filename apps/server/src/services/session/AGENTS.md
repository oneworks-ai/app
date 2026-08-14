# Session 服务目录说明

- index.ts：会话生命周期主入口，负责 Adapter 会话启动、用户消息注入、状态更新、中断与终止；`getWorkspaceActivitySnapshot` 汇总 workspace 是否仍有运行中 / 等待输入的会话
- create.ts：会话创建编排，负责初始消息注入、标签初始化与按需启动会话
- creation-lifecycle.ts：协调 HTTP 创建与提前到达的 WebSocket；HTTP 是唯一持久化写入方，WebSocket 只等待完整创建结果
- events.ts：会话事件落库与状态派生，负责从消息中提取摘要并更新会话元信息
- interaction.ts：交互请求/响应服务，负责等待用户输入、超时处理与 external session 交互闭环
- notification.ts：会话状态通知，基于 config 子域装载的统一配置决定是否发送系统通知
- chat-markdown-prompt.ts：OneWorks 聊天消息的稳定 Markdown 展示协议，向 agent 注入显式内部网页、外部浏览器和 workspace 文件链接约定
- runtime.ts：会话运行态仓库，统一维护 socket、消息缓存、交互等待队列与广播

首动作等客户端 turn correlation 使用 route 校验后的匿名 `client-action-*` ID：`create.ts` 将它作为初始 runtime command ID，`index.ts` 将它作为 follow-up user message / runtime command ID，`queue.ts` 将它作为 queued item ID 并在真正 dispatch 时恢复为 user message ID。follow-up 必须先把 session 标成 `running`，再持久化对应 user message；这样任何包含该 action message 的 history snapshot 都不会携带上一轮 `completed` 状态。用户终止必须先写入 `terminated` 再 kill adapter；后续同步或异步到达的 runtime event 必须通过 `terminal-status.ts` 保留已有 `failed` / `terminated`，`stop` / `exit` 只有在解析为真实 `completed` 时才能 dispatch queued turn。不要改回用客户端/服务端时间戳或裸 `running` 推断 turn 因果。

边界约定：session 子域统一承载所有会话生命周期与运行态逻辑；routes、websocket、channels 只能调用对外服务，不直接操作内部 store。

理解路径建议：先读 runtime.ts 建立运行态模型，再读 index.ts 看主流程，随后阅读 interaction.ts、create.ts 与 events.ts，最后补 notification.ts 理解状态通知分支。
