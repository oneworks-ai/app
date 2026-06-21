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
