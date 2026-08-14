# JetBrains Junie CLI 适配器

`junie` 使用 JetBrains 官方 `@jetbrains/junie` CLI 的非交互 headless 模式。One Works 默认管理 `2651.4.0` 包，并保守限定在其报告的 `26.8.x (2651.4)` 协议系列；检测到不兼容版本或 wire event shape 时会显式失败，而不是把 TUI 文本当成稳定协议。

## 配置

```yaml
adapters:
  junie:
    cli:
      source: managed
      version: 2651.4.0
      prepareOnInstall: true
    provider: openai
    effort: high
    review: false
    agentMode: classic
    disableAutoUpdate: true
    shareAnonymousStatistics: false
```

`provider` 只选择 Junie 的 BYOK provider；凭据必须通过官方支持的 `JUNIE_API_KEY` / `JUNIE_*_API_KEY` 环境变量或系统凭据存储提供。普通 One Works model service 不会被转换或路由成 Junie provider，也不会出现在 Junie selector 中；请使用 Junie 原生 model/provider 配置。`configContent` 只用于非敏感 Junie 配置；在共享任务 `base.json` cache 或 Junie session config 落盘前，One Works 会从每个 Junie 配置视图的纯克隆中移除凭据特征字段、`byok` 下直接承载秘密的标量、token-shaped 值，以及 URI/form/base64/嵌入 JSON/raw 文本中的凭据表示，同时保留合法非敏感内容。即使当前任务选择其他 adapter，这条规则也会覆盖所有有效 package/runtime identity 解析为 Junie 的配置实例，包括通过 `packageId` 或 Junie package root 声明的自定义键，并清洗其所有共享 config、asset config、layer 及 raw/resolved source 视图；有效覆盖或 tombstone 已将其改为其他 runtime 的键，以及该 adapter 自身的 `configContent`，不会被 Junie policy 改写。混合凭据 URL 的 userinfo、query、path 与 fragment 中的所有已知 secret 都会被清除，同时保留无关路由内容。这个清洗不会改写内存中的 runtime 配置对象，但 `configContent` 不是受支持的认证入口。适配器也拒绝在 `extraOptions` 里传入认证参数，避免凭据进入进程参数记录。

官方 26.8.10（2651.4）`--help` 对 `--effort` 公布的完整取值是 `low`、`medium`、`high`。这三个值同时驱动 Default model 元数据、配置 schema、前端 selector 和 runtime；`max` 等未公布值不会出现在 selector 中，已有配置或请求中的不支持值会在启动子进程前显式失败，不会静默映射。advanced args 不能覆盖 adapter-owned 的 model/provider/review/agent-mode、更新/隐私、session/prompt/project、路径/资产、认证与输入输出设置；这些参数的 split/equal/大小写/重复形式、官方 `-a` / `-c` / `-p` alias、保守预留的 effort alias，以及 `--` 参数终止符都会在 prepare/spawn 前被拒绝。`--verbose` 等安全 Junie 选项仍可使用，受控参数只会从共享验证入口精确生成一次。

## 会话与输出

- 默认路径是 `json-stream`。`session` 事件中的原生 id 先保持 tentative；只有同一 turn 收到已确认的 `result`、没有后续 failure/terminal 协议错误且子进程正常结束后，才写入 One Works session cache。后续消息使用精确的 `--session-id=<id> --resume`，返回 id 不一致会失败且不改写 cache。
- 未显式设置 `mode` 时仍使用 stream，因此默认新会话存在可验证的“新建 → 缓存原生 id → 续聊”路径。
- `mode: direct` 是显式终端/headless text 路径。Junie text 输出没有可验证的 session-id 事件，因此 direct 新会话会报告非致命降级，不能承诺后续恢复；direct resume 只在同一 One Works session 已通过 stream 缓存原生 id 时可用。
- pinned 发行物的稳定 wire schema 是 `CliStreamEvent`，包含 `session`、`step`、`system`、`error` 和 `result`。它提供结构化的 step 级增量，而不是 token delta；有 `name` 的 step 映射为工具开始/结果，无名称 step 和 system/result 映射为助手消息。成功终态必须包含 descriptor 要求的 string `result` 与序列化 `errorCode` array；尽管 wire 名称如此，这个字段实际承载 `LlmUsageOutput`，其中 `model` 与 `calls` 必填，并不是进程错误码。进程退出 0 但终态缺失、畸形、不兼容或截断，仍视为不完整流且不能提交原生 id。有效 `result` 后的普通非终态事件按诊断忽略；后续 failure/terminal-shaped 或畸形 result 会撤销成功。未知普通 EAP-shaped type 保留诊断后继续；未知 failure/terminal-shaped type、缺少 session id、截断 JSON、空事件流和不兼容 CLI 版本会显式失败。
- 取消会向当前子进程发送 `SIGINT`，等待进程关闭后只发出一次 terminal/exit 结果。

仓库中的协议 fixture 是根据官方 `2651.4.0` JAR 的 `CliStreamEvent` / `OutputWriter` 与底层 A2UX class/field descriptors 构造的脱敏合成序列，不是真实 CLI transcript，也不把原始 A2UX 对象冒充 wire output。自动化还使用 fake CLI 验证任意分片、多事件同块、多轮 resume、取消、spawn error、非零退出、无 `result` 的 EOF、create/resume 中畸形或截断的 `result` / `errorCode`、late terminal、resume id 不一致、重复 terminal、cache 提交边界、持久化配置清洗和子进程环境隔离。

## 隔离、资产与 hooks

每个 One Works session 使用 project home 下的独立 HOME、JUNIE_DATA、XDG config/data/cache、Junie cache、显式 config 和资产目录。managed 安装也使用 One Works bootstrap 下的独立安装 HOME；system source 只读解析官方 launcher 背后的实际 executable，运行时不把真实 Junie data/config 目录挂入 session。默认的用户/项目 config、MCP、skills、commands、agents 和 models discovery 都关闭；只有本次选择的内容会通过显式路径传给 Junie。

- system prompt 和 rules/instructions 写入显式 `--ide-guidelines` 文件。
- selected MCP servers 写入隔离的 `mcp.json`，selected skills 和 agents 只通过 session 内的 symlink 与 `--skill-location` / `--agent-location` 暴露。
- native headless hooks 接入 `SessionStart`、`PreToolUse`、`Stop`、`StopFailure` 和 `SessionEnd`。`PreToolUse` 保留 deny/ask；`StopFailure` 按上游语义只做观测，不能阻断；`SessionEnd` 用于清理。headless 不触发 `UserPromptSubmit`，Junie 也没有已验证的 `PostToolUse`，这些能力不会被伪造。
- 上游 batch host 也提供 `PermissionRequest`，但 One Works 当前没有独立的同名 normalized hook。适配器不把它重复映射为第二次 `PreToolUse`，避免同一工具调用重复执行策略；当前权限 deny/ask 由已接入的原生 `PreToolUse` 承担。
- Junie 的 `--plan` 仅属于 interactive mode。One Works 的 plan permission 在 headless 中降级为强制只读 planning instruction，不宣称原生 Plan Mode，也不能把它当作进程级沙箱。
- `review: true` 映射原生 `--review`。subagent 仍由 Junie 自己调度；pinned `CliStreamEvent` 会把内部 A2UX block 渲染为通用 step，没有稳定的 subagent id/parent/task wire 字段，因此适配器不伪造 operation/子任务关系。

## 认证与 BYOK 边界

One Works 不登录真实 JetBrains 账号，不保存 Junie token，也不复制或链接整个 `~/.junie`。子进程环境从空对象构建，只加入 PATH/locale/platform 基础项、必要的非敏感 One Works project/hook 项、隔离 HOME/JUNIE_HOME/JUNIE_DATA/XDG，以及 `JUNIE_API_KEY`。只有配置选中的 provider 才会桥接该 provider 在官方 JAR 中确认的 `JUNIE_*_API_KEY` 与对应标准变量（LiteLLM 还包括 URL）；其他 OPENAI/AWS/AZURE/Git/internal secret 不会继承。认证环境在每个 turn 启动前重新读取。Junie 任务的共享 `base.json` 落盘前，纯克隆会移除所有受支持的 Junie/account/provider 认证键，并清洗编码或配置表示中已知的长凭据回显；live runtime ctx 与 create/resume 所选 child env 不会被修改，cache 克隆中的非敏感 PATH、locale、proxy 与 One Works routing metadata 会保留。在 Linux 上，仅保留通过 shape 校验的本地 `DBUS_SESSION_BUS_ADDRESS` 与绝对路径 `XDG_RUNTIME_DIR`，使原生用户 session credential service 仍可寻址；畸形值和非 Linux 值会被移除，这两个 locator 不会扩大 ambient env 继承。任何 keychain/credential-store 文件都不会被复制。任何 key 都不会写入参数、持久化 session config、cache、hook 或 session 文件，session 目录也不会写回真实用户目录。需要首次登录时，请在 One Works 外使用官方 Junie 流程，或在启动 One Works 的环境中提供官方支持的 token/BYOK 环境变量。

## 历史导入与当前验证范围

当前不在“外部会话”中展示或导入 Junie 历史。官方发行物存在 events/transcript/subagent 文件，但没有稳定、已验证的公开历史 schema；在 schema 稳定前，One Works 不猜测项目归属、去重或子任务关系。

已完成官方 `--help` / `--version` 探针、`CliStreamEvent` / `OutputWriter` 描述符复核和隔离 fake lifecycle。没有执行真实账号登录，也没有完成“已认证的真实 Junie CLI lifecycle smoke”；因此版本、参数、隔离、解析失败和进程生命周期的信心来自官方发行物描述符与自动化，真实 provider 返回的完整 step 组合与文本渲染仍是待独立验证风险。

托管 CLI 的准备命令和环境覆盖见[适配器 CLI 安装与版本](./adapter-cli.md)。
