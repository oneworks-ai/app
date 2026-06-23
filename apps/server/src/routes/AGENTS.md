# Server Routes Module

本目录是 HTTP 传输层。Route 负责 URL、参数校验、状态码、错误码和响应形状；业务状态和跨入口复用逻辑放到 `../services/`。

## 常见入口

- `index.ts`：统一挂载各 route module 和 prefix。
- `sessions.ts`：session detail、message queue、branch、message 操作等 session API。
- `agent-rooms.ts`：Agent Room HTTP API。
- `config.ts`：配置读取与写回 API。
- `automation.ts`：automation API。
- `module-updates.ts`：运行时模块版本检测与缓存安装 API；业务逻辑放在 `../services/module-updates.ts`。
- `web-debug.ts`：跨入口浏览器调试 API；只返回 server 管理的调试 runtime 信息，业务逻辑放在 `../services/web-debug/`。
- `mobile-debug.ts`：Android 设备调试 API；ADB、scrcpy、元素树和输入状态放在 `../services/mobile-debug/`。
- `launcher.ts`：manager role 的 launcher 控制面 API；只挂项目选择、目录浏览、创建目录、启动 workspace server 等 daemon 能力。
- `static-client.ts`：Web client 静态挂载与 runtime env 注入；manager role 下不要注入 workspace folder，默认入口由 client 导向 `/launcher`。

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
