# Services 目录说明

- config/：配置子域服务目录，统一负责 workspace 变量、配置读取与合并
- automation/：automation 子域服务目录，负责规则执行与触发器调度
- session/：会话子域服务目录，统一负责生命周期、交互、通知与运行态管理
- agent-room/：Agent Room 领域服务目录，负责 room/member/run/message 聚合、用户消息投递、leader/child 公开消息投影
- runtime-store/：统一 CLI runtime protocol 持久化与投影目录，负责把 runtime events 投影到 session 和 Agent Room
- voice/：标准语音能力服务目录，负责 speech-to-text 服务解析、凭证模板展开、外部转写调用和响应归一化
- web-debug/：跨入口浏览器调试 runtime 目录，负责内置 Chii 等 Web/iframe/webview 调试能力，不归属单个 webpage metadata 功能
- mobile-debug/：跨入口移动设备调试 runtime，负责 Android ADB/scrcpy、iOS WDA、设备发现、截图 / 视频流、元素树和输入
- model-providers/：官方模型服务商能力目录，负责服务商模型、余额、状态和 secret 动作的服务端编排
- adapter-imports.ts：模型服务与 worktree environment 导入共用的 adapter runtime target 解析；不要在各导入域重复拼 package/export 位置
- worktree-environment-import.ts：枚举 adapter 的可选环境导入 capability，完整校验 discovery 结果、按目标 source 规范化 `.local` 展示后缀并整批去重，再按 Project / User additions-only 写入；响应与日志不得包含脚本正文
- worktree-environments.ts：adapter 导入走独占目录 claim 与 no-follow 文件写入，必须拒绝 `.oo`、环境根目录或 `.gitignore` 的符号链接；平台生命周期脚本存在时覆盖 base 脚本，不得双重执行
- skill-hub/：技能市场领域服务，负责内置/用户配置 registry 按 source 跨层合并、Registry 管理列表、远端 skills CLI 搜索，以及安装后的配置写回；`enabled: false` 必须同时阻止搜索和安装
- module-updates.ts：运行时模块版本检测与 bootstrap cache 安装编排，供普通 web、bootstrap web 和桌面 workspace 共同使用

分层约定：services 统一承载跨入口复用的业务编排、运行态状态和配置装载；routes/websocket/channels 不直接维护会话缓存，不直接拼装 loadConfig 的 jsonVariables。

理解路径建议：按任务读最近子目录的 `AGENTS.md`。普通会话任务先读 `session/AGENTS.md`；Agent Room 任务先读 `agent-room/AGENTS.md` 和 `runtime-store/AGENTS.md`；配置任务先读 `config/AGENTS.md`；语音转文字任务先读 `voice/AGENTS.md`；automation 任务先读 `automation/AGENTS.md`。
