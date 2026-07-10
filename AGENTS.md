# Repo Agent Guide

## 最高优先级：开发服务 Fast Path

本节优先级高于本文所有后续阅读、规则加载和 worktree 初始化判断。

如果用户意图是“取最新代码并启动 web 服务”“拉取最新代码并启动一个 web 服务”“启动 web 服务”“start web dev server”，唯一动作是在仓库根目录直接执行：

```bash
pnpm tools dev-start web
```

此类请求不要做额外预检查或成功后二次验证；`dev-start` 已经负责 fetch、安全拉取 / 对齐、workspace install 校验、端口避让、后台进程和探活。相关经验和反例见 `.oo/rules/maintenance/common-issues.md` 的 “Subagent 启动 Web 服务超过 1 分钟”。

命令退出 0 且输出 `[dev-start] ready` 时，按 target 做最短交付并停止，不要再做 `ps`、`curl` 或读日志等二次验证：

- Web / PWA / homepage / docs 等前端页面服务：用 Browser / browser-use 自动打开输出里的 `CLIENT_URL`，然后只回复一个可点击前端入口链接，例如 `[前端界面](CLIENT_URL)`；不要在成功消息里展开 `SERVER_URL`、PID 或 `LOG_FILE`，除非用户明确需要排查信息。
- Electron / desktop / launcher：直接打开输出对应的开发态应用窗口；成功消息保持简短，不要让用户再手动打开应用。
- 只有命令失败时才读取输出中的 `LOG_FILE` 并继续排查。

其他开发服务启动意图同样直接走统一 Commander CLI：

用户要求拉取最新代码并启动开发服务时，不要手动推理端口、依赖安装、后台进程或多 worktree 进程；在仓库根目录直接执行统一 Commander CLI：

```bash
pnpm tools dev-start <target>
```

意图识别表：

- 普通 Web UI / “启动一个 web 服务” / “拉取最新代码，并启动一个 web 服务”：`pnpm tools dev-start web`
- Electron / 桌面端 / launcher：`pnpm tools dev-start electron`
- Electron 且要打开当前仓库作为 workspace：`pnpm tools dev-start electron-workspace`
- PWA / 独立前端 / standalone client：`pnpm tools dev-start pwa`
- 官网首页预览 / homepage preview：`pnpm tools dev-start homepage`
- 使用文档 / docs 本地预览：`pnpm tools dev-start docs`

`pnpm tools` 通过 `scripts/run-tools.mjs` 注册 TS；如果新 worktree 缺少 register 依赖，会先执行 `pnpm install`。`dev-start` 会安全执行 `git fetch --prune origin`，在工作区干净时按当前状态拉取 / 对齐最新代码，按需校验 workspace 安装，后台启动对应开发服务，自动避开已占用端口，并在探活成功后输出 URL / PID / `LOG_FILE`。如果当前 worktree 已有同 target 服务且探活成功，会直接复用并返回 URL。

`dev-start` 会把同一 worktree 的服务状态写到 `.logs/dev-start-<target>.json`，例如 web 对应 `.logs/dev-start-web.json`。当用户询问当前目录是否已有服务、URL / PID / 端口、这个服务属于哪个 worktree，或多会话如何复用时，优先读取这个 JSON；其中 `root`、`target`、`clientUrl`、`serverUrl`、`servicePid`、`clientPid`、`serverPid`、`startedAt` 和 `managerLog` 是跨会话共享识别信息。不要为查询这些信息而另起服务；如果用户的意图是启动或拉取后启动，仍直接运行 `pnpm tools dev-start <target>`，让脚本完成复用判断和端口处理。

只有脚本失败时才继续查看输出的 `LOG_FILE`、读取更细规则或手动排查端口；不要在这些启动需求上先做冗长仓库扫描。不要使用 `screen` 管理本仓开发服务。

## 模型选择与任务分工

- 不要默认让所有任务使用当前可用的最强模型。先按歧义、风险与可逆性、上下文耦合、判断深度和验收强度选择满足要求的最低充分能力模型，不要只根据“前端”“PR”“修 bug”等任务名称机械路由。
- 默认能力分工：纯机械、强约束且可立即验收的工作先考虑 GPT-5.4 Mini；需要更可靠工具协作的明确重复任务用 Luna；需要工程判断或在既有模式内实现的日常工作用 Terra；需求含糊、未知根因、跨模块设计、高风险操作和关键最终审阅用 Sol。
- GPT-5.4 / GPT-5.5 必须参与比较，但主要作为可用性、兼容性和已验证工作流档位：当前公开费率下 GPT-5.4 与 Terra 同价，GPT-5.5 与 Sol 同价；新任务在代表性验收相同时优先 Terra / Sol，只有 5.6 不可用、需要 Codex cloud、需要复现旧模型行为，或仓库实测证明旧模型更适合时才选 GPT-5.4 / GPT-5.5。
- 一个任务应按“探索证据、做出决策、实现修改、验证结果、交付操作”拆阶段并分别选模型：例如核心问题分析由 Sol 负责，边界确定后的前端实现可交给 Terra，固定测试和 commit / PR 流程可交给 Luna。主线程保留最终责任。
- medium reasoning 只作为日常实现默认，不构成质量证明。凡非机械代码修改，写入前必须先给出全局影响地图和“复用 / 扩展 / 新建 / 保持内联”的抽象决策；实现者不得自审自批，交付前按风险完成独立的局部正确性、全局 / 抽象审阅和自动化门禁。完整标准见 `.oo/rules/maintenance/code-delivery-quality.md`。
- 新模型、新 reasoning 或费率 / 工具能力变化时，不凭版本号、单次成功或公开榜单直接调整分工；按 `.oo/rules/maintenance/model-routing-evaluation.md` 使用固定任务族、同场基线、重复运行、独立验收和真实分支路由验证后，再更新建议工作范围。
- Git 写操作必须已有用户授权且变更已审阅；PR 创建、commit、push 和满足条件的无冲突 merge 可由 Luna / Terra 执行，但代码审阅、冲突解决和是否可合入的判断按变更本身风险选择模型。
- 分配前先查当前工具 schema 和可用 model / reasoning，不硬编码不存在的值；优先使用能满足验收的最低 reasoning。模型分级不等于每个小任务都要新建子线程，没有独立验收面或委派成本更高时直接在当前线程完成。
- “计划使用低档模型”不等于实际降档。委派工具如果不能显式传入或核验 model / reasoning，继承父模型的 subagent 不得计为节省消耗；不要为了模型分级创建这种线程。用户已明确要求独立会话且工具支持模型参数时，才使用可指定 model / reasoning 的独立线程；否则由当前线程完成，或在模型隔离确实影响成本时回报限制。
- Prompt 中的“到时停止”只是软约束。成本敏感委派必须由主线程记录实际开始时间和 deadline，定期检查状态；到 deadline 时即使 subagent 仍在推理，也要主动中断或停止等待并收取已有结果。当前工具不能中断时，不要把长时间任务委派给它后声称有硬超时保证。
- 独立协调线程本身也必须按任务难度选择最低充分 model / reasoning，不能只给 worker 降档而让边界清晰的协调任务沿用默认 Sol / xhigh。总预算必须预留集成和最终输出时间；到 integration cutoff 后不再发起取证或归档类工具调用。协调器、worker 和整个任务的耗时均以外部平台记录为准，不使用模型自报时间替代。
- 模型档位、公开消耗 / 速度信息、抽象路由算法和示例见 `.oo/rules/maintenance/model-routing.md`；复杂任务的拆分、监控与集成流程见 `.oo/rules/maintenance/task-planning.md`。

## 常规仓库阅读

未命中上面的开发服务 Fast Path 时，开始处理仓库前先读 `.oo/rules/` 下 `alwaysApply: true` 的基础规则与维护文档；其他文档按任务结合 `description` / `globs` 按需继续阅读。

优先阅读：

- `.oo/rules/CODING-STYLE.md`
- `.oo/rules/ARCHITECTURE.md`
- `.oo/rules/MAINTENANCE.md`

## Worktree 初始化判断

本节不适用于“取最新代码并启动 web 服务”等已命中开发服务 Fast Path 的请求；这些请求直接执行 `pnpm tools dev-start <target>`。

进入仓库后先用最小命令判断当前副本状态，再决定是否需要初始化；不要仅凭路径猜测：

- `git rev-parse --show-toplevel`：确认当前仓库根目录。
- `git status --short --branch`：确认是否 detached HEAD、是否有本地改动。
- `git log -1 --oneline --decorate` 与 `git remote -v`：确认当前提交与远端来源。
- `git worktree list`：确认当前目录是否是额外 worktree，以及主 worktree / 其他会话是否正在使用同一仓库。
- `test -d node_modules`、`test -f .oo.dev.config.json`、`test -f .env`：判断依赖与本地私有配置是否已就位。

如果当前目录是新的或刚切换来的 worktree，通常会出现这些信号：路径位于 `.codex/worktrees/` 或 `.oo/worktrees/sessions/`、`node_modules` 缺失、私有配置缺失、HEAD 处于 detached 状态，或当前提交落后于 `origin/main`。这些信号只用于决定下一步检查，不代表可以清理或覆盖文件。

## 按用户需求快速初始化

本节不适用于已命中开发服务 Fast Path 的启动请求；不要把下面的手工初始化步骤叠加到 `pnpm tools dev-start <target>` 之前。

- 只做阅读、解释、轻量检索：不安装依赖，不启动服务；读基础规则后按文件路径直接查看相关 `AGENTS.md` / 规则文档。
- 用户要求拉取最新代码：先确认工作区干净；`git fetch --prune origin` 后，如果当前是 detached HEAD 且用户没有指定分支，可对齐到 `origin/main`；如果在本地分支上，优先 `git pull --ff-only`。遇到本地改动先停下来说明，不要重置。
- 用户要求运行测试、构建、CLI、server、client 或 Electron：如果 `node_modules` 缺失，先在当前 worktree 根目录执行 `pnpm install`；如果任务依赖私有配置而 `.oo.dev.config.json` / `.env` 缺失，优先从已有本地副本确认可复用来源，不能确认时向用户说明缺口。
- 用户要求启动桌面端 / Electron：继续阅读 `apps/desktop/AGENTS.md` 与 `.oo/docs/usage/desktop.md`；如果已有正式版或其他 worktree 的 Electron 在运行，先列出 PID、启动时间、命令路径和 worktree 来源。需要并行启动开发态时，使用独立 `--user-data-dir`，避免被单实例锁转发到已有应用。
- 用户要求启动 Android 模拟器 / AVD / 虚拟机用于调试：继续阅读 `.oo/rules/maintenance/common-issues.md` 的 “Android 模拟器启动排查耗时” 与 `.oo/rules/maintenance/mobile-workspace-webview.md`；先查 `adb devices -l`、`sdkmanager --list_installed`、`avdmanager list avd`，优先复用已有 AVD 并 detached 启动，不要全盘搜索 SDK 或让前台命令长期挂住模拟器。
- 用户要求启动前端或调试页面：继续阅读 `.oo/rules/FRONTEND-STANDARD.md`、`.oo/rules/frontend-standard/debugging.md` 和 `apps/client/AGENTS.md`；涉及聊天页 / sender / 消息级交互时，再读 `apps/client/src/components/chat/AGENTS.md`。
- 用户要求启动后端、改 API、数据库、adapter 或 MCP：继续阅读 `.oo/rules/BACKEND-STANDARD.md`；按影响范围进入 `apps/server/src/routes/AGENTS.md`、`apps/server/src/services/*/AGENTS.md` 或相关 package 的 `AGENTS.md`。
- 用户要求改配置语义、配置页、加载 / 写回 / 分层合并：继续阅读 `.oo/rules/CONFIG.md`，再按前端或后端落点补读对应规则。
- 用户要求更新 README、接入方式、命令行为或使用说明：继续阅读 `.oo/rules/USAGE.md`，并按实际用户可见变化更新 `.oo/docs/` 公开文档内容源或对应模块 README。
- 用户要求 hooks、benchmark、发布或 changelog：分别继续阅读 `.oo/rules/HOOKS.md` / `.oo/rules/HOOKS-REFERENCE.md`、`.oo/rules/BENCHMARK.md` / `.oo/rules/BENCHMARK-PLAN.md`、`.oo/rules/RELEASE.md` 与 `changelog/`。

按任务继续阅读：

- adapter runtime / mock home / 原生资产自动适配：`.oo/rules/ADAPTERS.md`
- 配置加载、写回、分层合并或配置页 source 语义：`.oo/rules/CONFIG.md`
- 前端 / 后端约束：`.oo/rules/FRONTEND-STANDARD.md`、`.oo/rules/BACKEND-STANDARD.md`
- 桌面端 / Electron 打包、发布与本地调试：`apps/desktop/AGENTS.md`、`.oo/docs/usage/desktop.md`
- Electron agent 控制、UI 自动验证、外部 CDP bridge 或 runtime evidence 验证：先读 `scripts/AGENTS.md` 和 `scripts/desktop-control-protocol.md`，再读 `apps/desktop/AGENTS.md`；优先复用 `pnpm tools desktop-control serve`，不要在场景工具里重复实现端口选择、隔离 profile、CDP target discovery 或 `events.jsonl` discovery。
- 仓库开发与贡献：`.oo/rules/DEVELOPMENT.md`
- 复杂任务拆分、子线程协作、交叉审阅或经验沉淀：`.oo/rules/maintenance/task-planning.md`
- medium 编码的全局影响、抽象和交付质量门禁：`.oo/rules/maintenance/code-delivery-quality.md`
- 新模型与 reasoning 的持续评测、分析和工作范围更新：`.oo/rules/maintenance/model-routing-evaluation.md`
- 项目接入方式：`.oo/docs/` 公开文档内容源或对应模块 README
- Relay 托管服务 / 私有化部署 / Vercel / Cloudflare / 域名与账号边界：`.oo/rules/RELAY-DEPLOYMENT.md`，再读 `apps/relay-server/AGENTS.md`、`apps/relay-admin/AGENTS.md` 和 `packages/plugins/relay/AGENTS.md`
- 使用文档边界约定：`.oo/rules/USAGE.md`
- hooks 方案与维护：`.oo/rules/HOOKS.md`、`.oo/rules/HOOKS-REFERENCE.md`
- benchmark 方案与规划：`.oo/rules/BENCHMARK.md`、`.oo/rules/BENCHMARK-PLAN.md`
- 当前重构待办：`.oo/rules/REFACTOR-TODO.md`
- 发布与更新日志：`changelog/`

前端任务补充：

- 只要任务涉及 `apps/client` 的页面交互、样式、浮层、focus、主题、热更新、真实 Chrome 回归或 CDP 调试，除了 `.oo/rules/FRONTEND-STANDARD.md`，还必须继续阅读 `.oo/rules/frontend-standard/debugging.md`。
- 如果改动范围落在 `apps/client/`，还应继续阅读 `apps/client/AGENTS.md`；如果涉及聊天页 / sender / 消息级交互，再继续阅读 `apps/client/src/components/chat/AGENTS.md`。
- 如果任务落在某个已有子模块，优先继续读最近的 `AGENTS.md`，用它建立模块地图；不要一开始就广泛读取源码或规则文件。

模块引导文档维护：

- 每次收到新的用户需求后，先完成必要的轻量判断；等到需求边界和主要落点已经清楚，例如能判断要改 `apps/client` 的某个组件、`apps/server` 的某个 service、`packages/*` 的某个共享包，或 `apps/desktop` 的某条启动链路时，再考虑补充模块引导文档。
- 如果发现“某类事情应该去哪个模块 / 子目录处理”的规则已经稳定，但最近的 `AGENTS.md` 没有记录，应在本次改动中同步补上。优先更新离代码最近的 `AGENTS.md`；只有跨多个模块的入口映射才写到根目录 `AGENTS.md`。
- 模块引导只写现状和入口：这个模块负责什么、什么任务应该来这里、继续读哪些文件或规则、常见验证入口是什么。不要写迁移历史、临时过程、个人判断记录或一次性排查日志。
- 不要为了补文档而提前扩大阅读范围；只有在实际需求已经触达某个模块，或者改动暴露出稳定的模块归属规则时才补。

Agent Room / runtime 快速入口：

- 前端 room 页面与气泡渲染：`apps/client/src/components/agent-room/AGENTS.md`
- 前端 room 路由、发送消息、详情 view model：`apps/client/src/routes/AGENTS.md`
- 服务端 HTTP route：`apps/server/src/routes/AGENTS.md`
- 服务端 room 领域服务：`apps/server/src/services/agent-room/AGENTS.md`
- runtime store 到 session / room 的投影：`apps/server/src/services/runtime-store/AGENTS.md`
- agent room SQLite 表与 repo：`apps/server/src/db/agentRooms/AGENTS.md`
- runtime protocol 共享契约：`packages/runtime-protocol/AGENTS.md`
- runtime store 文件存储包：`packages/runtime-store/AGENTS.md`
- 跨包 room 类型契约：`packages/types/AGENTS.md`

维护约定：

- `.oo/rules/` 是 `AGENTS.md` 的模块化组织目录：当 `AGENTS.md` 单文件过大，或模块内部组织、稳定入口、agent 记忆需要拆分时，把细节拆到最近的 `.oo/rules/` 下，并在最近的 `AGENTS.md` 保留入口链接。
- `.oo/rules/*.md` 一级规则会进入默认规则目录，`alwaysApply: true` 正文还会直接进入默认会话上下文；一级规则只写短入口、硬约束和阅读路由，详细经验放到同名子目录，避免规则文件造成上下文膨胀。
- `.oo/docs/` 是主仓公开文档内容源，只放 Markdown 与文档图片 / 素材；中文 root locale 放在 `.oo/docs/index.md`、`.oo/docs/usage/`，英文 locale 放在 `.oo/docs/en/index.md`、`.oo/docs/en/usage/`。不要在 `.oo/docs/` 放 `package.json`、`.vitepress/`、Vue 组件、theme、构建脚本或 README 占位说明。VitePress 壳层、部署、构建和导航装配信息沉淀在 homepage / docs app 侧的 `AGENTS.md` 或规则文档中。
- 强制边界：`AGENTS.md` / `.oo/rules/` 只描述模块内部组织结构、内部入口信息和 agent 对这个模块的稳定记忆；`README.md` / `.oo/docs/` 只描述模块外部如何使用。修改任意 `README.md`、`AGENTS.md` 或 `.oo/docs/` 内容时，必须先按这个边界判断内容归属，发现不符合边界的内容应同步迁移到正确位置。
- README 必须保持多语言支持：根 README 使用 `README.md` 作为英文入口、`README.zh-Hans.md` 作为中文入口，并在顶部互链；模块 README 如果面向外部用户，也应优先保留或补齐同等多语言入口。`.oo/docs/` 作为 homepage docs 文档站内容源时，也必须保留 i18n 设计。`AGENTS.md` 不强制多语言，按模块内部协作效率选择中文、英文或混合表达。
- 仓库 README 的编写与展示约定统一收敛在 `.oo/rules/USAGE.md`；调整 README 时先按那里的信息取舍、双语组织和截图规则执行。
- 公开 README 只保留品牌、图标和必要路由入口。不要在根 README 放内部排障、实现细节、迁移记录或产品截图；用户使用说明放 `.oo/docs/` 公开文档内容源或对应模块 README，维护规则放 `.oo/rules/`，agent 工作入口放最近的 `AGENTS.md`。
- 顶层文件只做总览与导航；超过一屏的细节继续拆到同名子目录，保持渐进式披露。
- 如果改动涉及面向用户的使用方式、配置入口、命令行为或接入路径变化，应及时更新 `.oo/docs/` 或对应模块 README 下的使用文档。
- 更新日志统一维护在仓库根目录 `changelog/`，按版本目录组织。
- 如果通过 worktree 切换到新副本，先确认本地私有配置与依赖已经就位，例如 `.oo.dev.config.json`、`.env`，并在当前 worktree 根目录执行一次 `pnpm install`。
- AGENTS 与文档只描述现状，不记录迁移历史。
