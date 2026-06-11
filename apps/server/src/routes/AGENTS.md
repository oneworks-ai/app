# Server Routes Module

本目录是 HTTP 传输层。Route 负责 URL、参数校验、状态码、错误码和响应形状；业务状态和跨入口复用逻辑放到 `../services/`。

## 常见入口

- `index.ts`：统一挂载各 route module 和 prefix。
- `sessions.ts`：session detail、message queue、branch、message 操作等 session API。
- `agent-rooms.ts`：Agent Room HTTP API。
- `config.ts`：配置读取与写回 API。
- `automation.ts`：automation API。
- `module-updates.ts`：运行时模块版本检测与缓存安装 API；业务逻辑放在 `../services/module-updates.ts`。

## Agent Room Route

`agent-rooms.ts` 只做这些事：

- list / get room detail。
- patch archive/favorite metadata。
- post room user message，并规范化 `target`。
- post room event / member / run，用于 runtime 和工具入口写入 room 状态。
- 把 service 抛出的 not found / invalid input 转成 HTTP error。

不要在 route 里实现 room 状态计算、消息投递、runtime 投影或 SQLite 查询；这些分别属于：

- `../services/agent-room/`
- `../services/runtime-store/`
- `../db/agentRooms/`

## 回归

- Route 改响应 shape 时，同时检查 client API 封装和 `packages/types/src/agent-room.ts`。
- Agent Room 行为优先跑 service 测试；route 层只在请求校验或 HTTP 状态码变化时补 route 测试。
