# WebSocket 目录说明

- index.ts：WebSocket 入口导出，避免上层直接耦合实现文件
- server.ts：轻量 HTTP upgrade / WebSocketServer 挂载；启动阶段不得静态加载会话、DB、插件或终端运行时
- lazy-connection.ts：并发安全、失败可重试的首次连接加载边界
- connection.ts：连接鉴权与按 channel / subscribe 类型分发；插件、终端、移动调试和 session runtime 必须保持分支级动态加载，避免轻量插件连接拉起完整会话栈
- session-connection.ts：普通会话 socket 的创建、消息协议与生命周期回调；只在真实会话连接时加载

边界约定：websocket 目录只负责连接和协议；会话缓存、交互等待队列、事件广播、配置读取都放在 services 下。

理解路径建议：先从 server.ts 看 upgrade 入口，再从 connection.ts 跳到 services/session/runtime.ts、services/session/interaction.ts 和 services/session/index.ts 理解真正的运行态与业务逻辑。
