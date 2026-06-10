# Services 目录说明

- config/：配置子域服务目录，统一负责 workspace 变量、配置读取与合并
- automation/：automation 子域服务目录，负责规则执行与触发器调度
- session/：会话子域服务目录，统一负责生命周期、交互、通知与运行态管理
- agent-room/：Agent Room 领域服务目录，负责 room/member/run/message 聚合、用户消息投递、leader/child 公开消息投影
- runtime-store/：统一 CLI runtime protocol 持久化与投影目录，负责把 runtime events 投影到 session 和 Agent Room
- module-updates.ts：运行时模块版本检测与 bootstrap cache 安装编排，供普通 web、bootstrap web 和桌面 workspace 共同使用

分层约定：services 统一承载跨入口复用的业务编排、运行态状态和配置装载；routes/websocket/channels 不直接维护会话缓存，不直接拼装 loadConfig 的 jsonVariables。

理解路径建议：按任务读最近子目录的 `AGENTS.md`。普通会话任务先读 `session/AGENTS.md`；Agent Room 任务先读 `agent-room/AGENTS.md` 和 `runtime-store/AGENTS.md`；配置任务先读 `config/AGENTS.md`；automation 任务先读 `automation/AGENTS.md`。
