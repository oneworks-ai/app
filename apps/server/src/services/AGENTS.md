# Services 目录说明

- config/：配置子域服务目录，统一负责 workspace 变量、配置读取与合并
- automation/：automation 子域服务目录，负责规则执行与触发器调度
- session/：会话子域服务目录，统一负责生命周期、交互、通知与运行态管理
- channel-links/：频道链接定义解析，负责把 `.oo/channels/<link>/channel.*` 映射为入站 channel event 可用的实体绑定
- channel-ingress-router/：在 session 创建前执行四态 ingress 决策、model invoker fail-closed 校验和 route precedence；每个 linked inbound 都必须留下 router audit，只有 `create_child` 可以继续 dispatch。
- channel-continuity/：按已解析 thread 组装短期 continuity；ambient turns 使用独立 `channelKey + entity + channelId` buffer，只能注入未过期 turns，不能写入长期 memory。
- channel-memory/：按 issuer、entity、channel、identity、visibility 和 expiry 筛选长期 memory，持久化 snapshot/writeback 审计。
- oneworks-channel/：为第一方 OneWorks Channel 产品插件提供 workspace-only 的房间分享、模拟、链路与场景编排 facade；它不管理飞书、微信等 provider 的连接生命周期，插件也不得直接读取 DB 或 channel manager。
- channel-approval/：频道权限裁决服务，区分 actor identity 与 actor credential，并为缺失 credential 生成授权请求
- channel-authorizations/：频道授权请求服务，把 channel 权限交互镜像到可查询和可处理的授权状态
- channel-resume/：频道恢复服务，消费 resolved pending intent 的 `metadata.resume` 并把恢复提示投递回原 session，包含后台 scheduler
- agent-room/：Agent Room 领域服务目录，负责 room/member/run/message 聚合、用户消息投递、leader/child 公开消息投影
- runtime-store/：统一 CLI runtime protocol 持久化与投影目录，负责把 runtime events 投影到 session 和 Agent Room
- voice/：标准语音能力服务目录，负责 speech-to-text 服务解析、凭证模板展开、外部转写调用和响应归一化
- web-debug/：跨入口浏览器调试 runtime 目录，负责内置 Chii 等 Web/iframe/webview 调试能力，不归属单个 webpage metadata 功能
- mobile-debug/：跨入口移动设备调试 runtime，负责 Android ADB/scrcpy、iOS WDA、设备发现、截图 / 视频流、元素树和输入
- model-providers/：官方模型服务商能力目录，负责服务商模型、余额、状态和 secret 动作的服务端编排
- usage/：用量聚合服务，统一消费本地 ledger、插件 usage source 和 Launcher 在线 workspace，保留资源所属插件与同步插件两条 provenance；跨 runtime 去重、availability 继承和 scope 约定见 `../../../../.oo/rules/maintenance/token-usage-analytics.md`
- adapter-imports.ts：模型服务与 worktree environment 导入共用的 adapter runtime target 解析；不要在各导入域重复拼 package/export 位置
- worktree-environment-import.ts：枚举 adapter 的可选环境导入 capability，完整校验 discovery 结果、按目标 source 规范化 `.local` 展示后缀并整批去重，再按 Project / User additions-only 写入；响应与日志不得包含脚本正文
- worktree-environments.ts：adapter 导入走独占目录 claim 与 no-follow 文件写入，必须拒绝 `.oo`、环境根目录或 `.gitignore` 的符号链接；平台生命周期脚本存在时覆盖 base 脚本，不得双重执行
- skill-hub/：技能市场领域服务，负责内置/用户配置 registry 按 source 跨层合并、Registry 管理列表、远端 skills CLI 搜索，以及安装后的配置写回；`enabled: false` 必须同时阻止搜索和安装
- model-usage.ts：内容无关的 Model Service 用量计量桥；只在 session 边界观察 assistant usage 并通过标准 OTLP 输出，adapter 不重复计量；发送前读取 global `diagnostics.modelUsageReporting`，并从 Model Service 的 Relay 来源标记区分个人/具体团队。个人服务不得被团队策略限制，团队服务只应用来源团队策略；关闭时不得构造事件或初始化对应 scope exporter
- javascript-diagnostics.ts：把 Web / PWA 的无内容 JavaScript 异常事实写入本地有界日志，并按 global `diagnostics.reporting` 门控 OTLP 上报
- module-updates.ts：运行时模块版本检测与 bootstrap cache 安装编排，供普通 web、bootstrap web 和桌面 workspace 共同使用
  - Core 模块必须按当前宿主筛选：集成 Web 只管理 web shell，独立 server 只管理 server，桌面端只管理实际加载的 client/server。
  - 桌面 runtime cache 的目录 key 可能是 `dev-*`，当前版本必须读取被启动链路选中的 package `package.json`，不能把目录名或其他历史 semver cache 当成当前版本；安装入口必须拒绝降级。
- channel-runtime-key.ts：持久化到 SQLite 的频道复合键统一使用 JSON 编码，禁止使用 NUL 分隔符，避免驱动截断造成跨用户键碰撞。

分层约定：services 统一承载跨入口复用的业务编排、运行态状态和配置装载；routes/websocket/channels 不直接维护会话缓存，不直接拼装 loadConfig 的 jsonVariables。

理解路径建议：按任务读最近子目录的 `AGENTS.md`。普通会话任务先读 `session/AGENTS.md`；ChannelLink / 频道实体绑定任务先读 `channel-links/`；频道权限裁决任务先读 `channel-approval/`；频道授权请求镜像任务先读 `channel-authorizations/`；授权 resolved 后继续原任务读 `channel-resume/`；Agent Room 任务先读 `agent-room/AGENTS.md` 和 `runtime-store/AGENTS.md`；配置任务先读 `config/AGENTS.md`；语音转文字任务先读 `voice/AGENTS.md`；automation 任务先读 `automation/AGENTS.md`。
