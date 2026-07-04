# Scripts 目录说明

`scripts/` 下的维护命令统一收口到一个 TS CLI：

- loader: `scripts/run-tools.mjs`
- commander 入口: `scripts/cli.ts`

不要再往 `package.json` 新增一串独立脚本名。新增维护命令时，优先给 `scripts/cli.ts` 增加子命令，再在文档里写 `pnpm tools ...` 的调用方式。

仓库开发服务也走同一个 CLI：当用户要求拉取最新代码并启动 web / Electron / PWA / homepage / docs 服务时，直接在仓库根目录运行 `pnpm tools dev-start <target>`。`scripts/run-tools.mjs` 会注册 TS，缺少 register 依赖时先执行 `pnpm install`；`dev-start` 会按需校验 workspace 安装并直接启动对应服务。

`dev-start` 的跨会话状态文件位于仓库根目录 `.logs/dev-start-<target>.json`，例如 `.logs/dev-start-web.json`。需要回答“当前 worktree 已启动哪个服务、URL / PID / 端口是多少、是否属于当前目录”时，读取该 JSON 的 `root`、`target`、`clientUrl` / `serverUrl`、`servicePid`、`clientPid`、`serverPid`、`startedAt` 和 `managerLog`。不要为了查询状态手动再启动 server/client；真正的启动请求仍交给 `pnpm tools dev-start <target>` 复用或重启。

## 当前命令

- `pnpm tools dev-start web`
  - 普通 Web UI：fetch / 安全拉取、按需 `pnpm install`、后台启动 server + Vite client、自动避开端口、探活后输出 URL
- `pnpm tools dev-start electron`
  - Electron 空 launcher 开发态：后台启动桌面开发进程并输出 PID / log
- `pnpm tools dev-start electron-workspace`
  - Electron 当前仓库 workspace 开发态：后台启动桌面开发进程并打开当前仓库
  - workspace 路径必须来自当前 `dev-start` 进程所在仓库根；不要用继承环境里的 `INIT_CWD`，嵌套 pnpm / 多 worktree 会话里它可能指向另一个 checkout。
  - 在 linked worktree 中验证时，检查输出的 workspace、Electron 窗口标题、会话 workspace title 和 runtime consumer cwd；如果任一项回到主 checkout，先排查 dev-start 环境变量和 desktop workspace-state 的 Git 路径归一化。
- `pnpm tools dev-start pwa`
  - PWA 独立前端预览：构建 standalone client，后台启动 server + 静态 client preview
- `pnpm tools dev-start homepage`
  - 官网首页预览：初始化 `assets/homepage` submodule，启动主仓 PWA iframe 预览，并启动 Astro homepage
- `pnpm tools dev-start docs`
  - 使用文档本地预览：通过 homepage docs shell staging 主仓 `.oo/docs` 内容并启动独立 VitePress 文档站
- `pnpm tools adapter-e2e run <selection>`
  - 真实离线 adapter E2E。`selection` 支持 `codex` / `claude-code` / `opencode` / case id / `all`
- `pnpm tools adapter-e2e test [selection]`
  - 跑 `scripts/__tests__/adapter-e2e/adapter-e2e.spec.ts`
- `pnpm tools adapter-e2e test [selection] --update`
  - 更新对应 case 的 file snapshot
- `pnpm tools desktop-control launch [--app <path>] [--workspace <path>]`
  - 面向 agent 的 Electron 控制入口，默认 JSON 输出；冷启动隔离 `userData` 的桌面实例，返回 CDP endpoint、targets、profile 路径和可直接继续执行的 command hints
  - 这个命令的用户是模型，不是人；新增桌面 UI 自动验证能力时优先复用返回的 `control` / `agentCommands`，不要让上层手写 `--remote-debugging-port`、app executable 路径或 profile 初始化逻辑
  - 默认会拒绝不含 `external-cdp` hook 的旧安装包，避免旧 Electron 包在验证中崩溃；只有明确排查 legacy Electron 行为时才使用 `--allow-unsupported-app`
- `pnpm tools desktop-control serve`
  - 面向 agent 的本地 JSON protocol bridge，启动后通过 `/protocol`、`/v1/electron/sessions`、`/v1/electron/sessions/:sessionId/recordings` 和 `/v1/evidence/wait-reply` 桥接 Electron、CDP、demo-video 录屏与 runtime evidence
  - `/recordings` 只用于已有 Electron session 的临时诊断录制；正式 Electron 验证 / 产品素材必须走 `desktop-control record-batch --use-deskpad-display`
  - Electron 验证视频不允许用 CDP 截帧作为画面 fallback；正式画面来源必须是通过可见性验证的 macOS 系统 display capture
  - 协议见 `scripts/desktop-control-protocol.md`；场景验证工具应调用这个 bridge，而不是重复实现端口选择、隔离 profile、CDP target discovery、demo-video URL 拼接或 runtime evidence discovery
- `pnpm tools desktop-control record-batch launcher-open-workspace-ui-tour --workspace <path> --app <app>`
  - 真实 Electron launcher/workspace 展示素材的批量入口；每个明暗 / 中英 variant 都冷启动隔离 Electron session，用专用 recording display 做系统连续录屏源，输出裁成 app 窗口区域后再结束 app
  - 这个入口的画面来源必须是系统录屏；CDP 只能用于自动化控制和等待条件，不作为录屏输出来源。不要交付整张 DeskPad 虚拟桌面
  - 正式验证 / 产品素材必须加 `--use-deskpad-display` 跑在专用虚拟桌面上；工具会查找系统显示器列表里的 `DeskPad Display`，把 launcher 和 workspace BrowserWindow bounds 注入到该 display，并验证 display capture 里确实包含 app window；找不到或验证失败时必须失败，不要占用用户当前桌面
  - display capture 可见性验证要比较解码后的像素相似度，不要用 `cmp` 比较 PNG 文件字节；透明 / vibrancy / 毛玻璃窗口必须同时支持结构边缘重合度，不能只用 RGB 相似度误杀真实 app window；失败时保留 probe 图和指标，先排查坐标、window level、空间归属和 provider 行为，再决定是否换 recording display provider
  - AppKit `NSScreen.frame` 的 y 是 bottom-origin，Electron window bounds 和 display crop 是 top-origin；写 bounds / crop 前必须转换 y，避免窗口被夹到虚拟屏顶部导致视频不居中
  - 录制前要让 recorder 校验 ffmpeg 真的可运行；不要把第三方 app bundle 里会崩溃的私有 ffmpeg 当默认候选，避免场景录完后才在编码阶段失败
  - `--use-deskpad-display` 会启动真实背景窗口展示固定批准壁纸，优先读取 `.logs/demo-videos/display-region-prototype/ventura-graphic-light-hq/ventura-background-full-3174x2232.png`，缺失时回退到系统 Ventura Graphic Light 候选；不要默认读取用户当前桌面 wallpaper，不要主动换背景。只有用户明确要求换背景时，才列候选让用户选择
  - 不要在正式 batch 入口使用 `system-window`、窗口级 ScreenCaptureKit、固定 region crop、CDP 截帧、假圆角合成或只有壁纸的 display capture；这些都会重新引入 traffic light、圆角、桌面占用或错误画面问题
  - 不要用 `demo-video batch url-tour --url .../ui/launcher --page-background ...` 代替这个入口；那只录 Web renderer，不能跟随真实 Electron workspace BrowserWindow，也无法保证窗口位置 / bounds 一致
  - 系统 display capture 的 `recordDuring(durationMs, action)` 里，`durationMs` 是最小录制窗口，不是 action 的硬截止；action 未结束时必须继续录，否则 cursor 事件会跑到 segment 外并在视频里表现为鼠标瞬跳。改动后用抽帧 / 坐标检测检查 launcher -> workspace 切换处的光标连续性
  - 交付 Electron / workspace 录屏时必须同步加载耗时分析：至少说明录制器启动、app spawn 到首窗、workspace server ready、renderer/chat ready、runtime package cache 命中状态，以及 stills / 抽帧是否证明已进入对话界面
- `pnpm tools chrome-debug targets [--port 9222]`
  - 查看本机 Chrome DevTools 目标页，确认当前 remote debugging 端口上有哪些页面
- `pnpm tools chrome-debug messenger-conversations`
  - 列出当前 Feishu messenger 页里左侧可见的会话候选；如果用户没有明确指定目标会话，先跑这个命令再向用户确认
- `pnpm tools chrome-debug messenger-send <conversation> <message>`
  - 在当前 Feishu messenger 页里按会话名点开会话并发送一条消息
  - 如果是本轮第一次往该页面发消息，先确认目标会话；用户只说“我打开了一个会话”时，不要直接发送
- `pnpm tools chrome-debug messenger-click-reply <conversation> <messageSnippet>`
  - 在当前 Feishu messenger 页里悬停某条消息，并点击它的 reply 按钮
- `pnpm tools chrome-debug messenger-click-text <conversation> <text>`
  - 在当前 Feishu messenger 页里按可见文本点击一个右侧会话内的按钮或快捷气泡
- `pnpm tools message-actions verify [--quiet]`
  - 跑消息级 `编辑 / 撤回 / 分叉 / 复制原文` 的固定质量检查组合，并打印真实 Chrome 回归清单
- `pnpm tools demo-video list [--json]`
  - 列出能力展示录屏场景；录屏规则见 `.oo/rules/maintenance/demo-video.md`
- `pnpm tools demo-video record <scenario> --url <url> [--out-dir <path>] [--name <name>] [--keep-frames]`
  - 冷启动独立 Chrome profile 执行场景动作，按帧截图并用 `ffmpeg` 合成 MP4；默认输出到 `.logs/demo-videos/<scenario>`
  - 默认 headless；传 `--headed` 只用于调试可视浏览器。单条录制可用 `--language zh|en` 固定界面语言。
  - 录 launcher / 浮层类页面素材时可传 `--page-background macos-wallpaper`，让 headless/CDP 录制使用本机 macOS 系统壁纸背景；需要固定素材时传 `--page-background-image <path>`
  - 录真实 Electron 从 launcher 点击打开项目时，不要用这个底层入口交付正式素材；使用 `desktop-control record-batch launcher-open-workspace-ui-tour --use-deskpad-display`。`demo-video record` 的 `captureSource` 选项只保留给底层诊断。
- `pnpm tools demo-video batch <scenario> --url <url> [--out-dir <path>]`
  - 批量生成展示素材，默认输出 `light/dark x zh/en` 四个变体；用 `--color-schemes` / `--languages` 覆盖矩阵，产物仍包含 MP4、poster 和按秒 stills manifest
  - 仅用于纯 Web / headless CDP 页面；真实 Electron launcher 打开 workspace 的四变体素材用 `pnpm tools desktop-control record-batch ...`
- `pnpm tools agent-room-smoke resume [--json]`
  - 跑真实 `StartTasks -> agent room 消息 -> inactive task resume` smoke；启动临时 server / SQLite / MCP / Codex adapter，LLM 只用 mock，结束后清理临时进程
- `pnpm tools relay-config smoke [--allow-pending] [--json]`
  - 跑 Relay 配置下发 smoke：临时 workspace 使用真实 `@oneworks/plugin-relay`，准备 project home 本地 `config-snapshot.json`，调用 `@oneworks/config` 的 `loadConfigState` 验证 `mergedConfig.modelServices` 生效；最终验收不要带 `--allow-pending`
- `pnpm tools relay-config live-smoke [--json] [--keep-temp] [--skip-admin-build]`
  - 跑真实 Relay Server / Admin / 团队配置下发 smoke：临时 server 创建用户、团队、secret、profile、assignment，成员设备拉取加密 snapshot，再让真实 config hook 本地解密合并；CI 使用时不要带 `--skip-admin-build`
- `pnpm tools commitmsg-check [base] [head]`
  - 校验一个 git range 里的 commit title 是否符合 Conventional Commit；GitHub 默认 merge commit 例外
- `pnpm tools pr-change-check [base] [head] --body-file <path>`
  - 检查 PR body 是否包含已勾选的 `Experience Review` checklist；功能新增 / bug 修复类 PR 如果改动产品代码，还会要求对应 changelog；如果改动 UI 交互面，还会要求 PR 正文包含截图
- `pnpm tools release-tags plan <base> <head> [--json]`
  - 比较两个提交之间 workspace package manifest 的版本变化，生成需要创建的 `pkg/<normalized-package-name>/v<version>` tag 候选
  - release PR 合入 `main` 后由 `.github/workflows/release-tags.yml` 调用；不会把根目录开发用 `package.json` 纳入候选
- `pnpm tools runtime-evidence list [--project-home <path>] [--limit <count>] [--json]`
  - 通用 runtime session 证据入口：有界列出最近的 `runtime/sessions/*/events.jsonl`，用于 UI smoke、Electron 验证、adapter 调试和 release 验证，不要为 nonce/session discovery 在各脚本里重复写 parser
- `pnpm tools runtime-evidence wait-reply --expected-reply <text> [--session-id <id>]`
  - 等待已完成 runtime session 的 assistant 回复；不传 `--session-id` 时按期望回复在有界 runtime store 中自动发现 session
- `pnpm tools release-verify agent --channel beta --version auto`
  - AI-native 发布验证主入口：默认 `desktop-chat`，自动生成期望回复 nonce，打印 Electron UI action，随后在有界 runtime store 中自动发现匹配会话，不要求手动传 `--session-id`
  - 上层 agent 应先按输出的 UI action 操作 Electron，再让命令继续等待证据；如果已经知道 session id，可直接带 `--session-id` 缩短等待
- `pnpm tools release-verify run --channel beta --version auto [--scenario desktop-installed|desktop-chat]`
  - 面向脚本 / agent 的可控 runner：自动从 `oneworks@<channel>` 解析版本，运行确定性 probe，并输出 verdict / evidence / recommendations
- `pnpm tools release-verify beta --version <version> [--session-id <id>] [--expected-reply <text>]`
  - 底层 deterministic probe：发布后把 npm beta dist-tag、桌面 GitHub Release asset、已安装 `/Applications/One Works.app`、内置 runtime package、`~/.oneworks/bootstrap` cache 和可选 UI 会话回复收敛成一条验证命令
  - UI 仍负责真实发消息；命令直接轮询对应 `runtime/sessions/<id>/events.jsonl` 判断是否完成和是否出现期望回复，避免人工等界面或递归翻 cache
  - runtime 子包默认按各自 `@beta` dist-tag 校验，不要求都等于桌面版本；需要强制同版本时才加 `--runtime-exact-version`
- `pnpm tools homebrew-tap sync-oneworks --version <version>`
  - 根据已发布的 `oneworks@<version>` npm tarball 更新 `infra/homebrew-tap/Formula/oneworks.rb` 的 `url` 和 `sha256`
  - One Works CLI 发版后执行；随后在 `infra/homebrew-tap` 内提交并 push，再回到主仓库提交 submodule 指针
- `pnpm tools windows-install sync-oneworks --version <version>`
  - 根据已发布的 `oneworks@<version>` npm tarball 更新 `infra/windows/scoop-bucket/bucket/oneworks.json` 的 `version`、`url` 和 `hash`
  - 同步 `infra/windows/winget/` 下的 manifest 版本号；如果本次已经发布 Windows portable zip，需要同时传 `--winget-installer-url` 和 `--winget-installer-sha256`
  - One Works CLI 发版后执行；随后在 `infra/windows/scoop-bucket` 内提交并 push，再回到主仓库提交 submodule 指针和 winget 模板改动
- `pnpm tools publish-plan -- [args]`
  - 透传到 `scripts/publish-plan-core.mjs`
  - 发布规则、检查清单和 tag 约定统一见 `.oo/rules/RELEASE.md`

## publish-plan 使用备注

- `publish-plan` 只负责基于显式包选择和内部依赖生成发布顺序。
- 所有“是否该发布、怎么发布、发布后怎么收尾”的规则统一见 `.oo/rules/RELEASE.md`。

## adapter-e2e 结构

- `scripts/adapter-e2e/harness.ts`
  - suite 生命周期
- `scripts/chrome-debug.ts`
  - Chrome DevTools 本地调试 helper，负责枚举目标页、连接 CDP 和执行 messenger 发送动作
- `scripts/adapter-e2e/runners.ts`
  - Codex / Claude / OpenCode 的真实运行路径
- `scripts/adapter-e2e/log.ts`
  - hook 日志解析与事件计数
- `scripts/adapter-e2e/snapshot.ts`
  - 真实 CLI 结果 -> 稳定 snapshot projection
- `scripts/adapter-e2e/mock-llm/request.ts`
  - 请求体解析与 input 摘要提取
- `scripts/adapter-e2e/mock-llm/tooling.ts`
  - mock tool 选择与入参生成
- `scripts/adapter-e2e/mock-llm/rules.ts`
  - `when...` / `messageTurn` / `selectedToolTurn` 这套规则 DSL
- `scripts/adapter-e2e/mock-llm/registry.ts`
  - scenario registry 与 turn 解析
- `scripts/adapter-e2e/mock-llm/responses.ts`
  - OpenAI Responses mock 输出
- `scripts/adapter-e2e/mock-llm/chat-completions.ts`
  - Chat Completions mock 输出
- `scripts/adapter-e2e/mock-llm/server.ts`
  - mock server 装配
- `scripts/__tests__/adapter-e2e/cases.ts`
  - case DSL、case 选择、标准场景族、显式 expectations
- `scripts/__tests__/adapter-e2e/assertions.ts`
  - 结构化 expectations 校验 + Vitest file snapshot 入口
- `scripts/__tests__/adapter-e2e/adapter-e2e.spec.ts`
  - 真实 CLI E2E spec
- `scripts/__tests__/adapter-e2e/log.spec.ts`
  - hook 日志 parser 和 snapshot projection 单测
- `scripts/__tests__/adapter-e2e/mock-llm.spec.ts`
  - mock LLM 规则 DSL 单测

## desktop-control / runtime evidence 结构

- `scripts/desktop-control-server.ts`
  - agent-facing 本地 JSON protocol bridge，负责 `/protocol`、Electron control session、CDP target refresh 和 runtime evidence endpoint
- `scripts/desktop-control-protocol.md`
  - bridge protocol 文档；新增场景验证能力时先扩展这里的 endpoint / phase 约定，再让 scenario runner 组合调用
- `scripts/desktop-cdp.ts`
  - 冷启动隔离 Electron 实例、分配 CDP endpoint、返回 `control` 和 `agentCommands`
- `scripts/runtime-evidence.ts`
  - 通用 runtime session evidence discovery / wait-reply；release、Electron smoke、adapter 调试不要重复解析 `events.jsonl`
- `apps/desktop/src/main/external-cdp.ts`
  - Electron app 侧 bootstrap 前 opt-in CDP hook；默认关闭，协议和编排仍归 `scripts/` 层维护

## Lark 调试约定

- 用户没有明确给出会话名时，第一次发消息前先把当前会话标题或可见候选回给用户确认。
- 用户确认过本轮调试目标后，后续默认继续复用同一会话，除非用户明确要求切换。

## 维护约定

- 入口层只做命令解析和调度，不写业务逻辑。
- adapter E2E 的 case 定义、Vitest spec、mock-llm 单测、snapshot 必须放在 `scripts/__tests__/adapter-e2e/` 一处维护。
- adapter E2E 新增场景时，先在 `scripts/__tests__/adapter-e2e/cases.ts` 定义 case 的 `prompt/model/mockScenarios/expectations`，再用 `mock-llm/rules.ts` 组合 mock 行为。
- 先写结构化 expectations，再看 snapshot。最低限度要覆盖输出文本、mock trace、hook 事件计数；file snapshot 负责保留完整回归上下文。
- 当前标准场景至少保持两类：`*-read-once` 验证工具链路，`*-direct-answer` 验证无工具直答链路。
- mock server 要记录“请求摘要 -> mock 响应摘要”，让 snapshot 能直接表达 mock LLM 输入输出链路。
- hook 日志解析不要再堆复杂正则，优先维护在 `scripts/adapter-e2e/log.ts` 的 line-based parser。
- mock server 的协议输出和请求解析必须分文件维护，不要再回到单个大脚本。
- 优先让测试直接 import TS 模块，不要绕兼容 wrapper。
