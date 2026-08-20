# 适配器配置与多账号

本文说明 Web 配置页里的适配器配置结构，以及适配器通用多账号能力的使用方式。

## 配置入口

- Web 配置页路径：`/ui/config?tab=adapters&source=project`
- 适配器详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>`
- 账号列表页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- 账号详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` 也可以切到 `global` 或 `user`，用于编辑跨项目默认值或本地适配器覆盖。

## 前端选择器

聊天输入框的适配器选择器默认展示当前应用内置支持的原生适配器：Claude Code（`claude-code`）、[Cline](./cline-adapter.md)（`cline`）、Codex（`codex`）、Copilot（`copilot`）、Cursor（`cursor`）、[Factory Droid](./droid-adapter.md)（`droid`）、[DSH](./dsh-adapter.md)（`dsh`）、Gemini（`gemini`）、[Goose](./goose-adapter.md)（`goose`）、Grok（`grok`）、[Junie](./junie-adapter.md)（`junie`）、[Kiro](./kiro-adapter.md)（`kiro`）、Kimi（`kimi`）、OpenCode（`opencode`）、Pi（`pi`）和 [Qwen Code](./qwen-code-adapter.md)（`qwen-code`）。

以下 adapter 不需要先写入 `.oo.config.json` 才能出现在选择器里。用户选择某个 adapter 发起会话后，运行时会沿用 adapter 自己的 CLI 准备逻辑，把托管 CLI 安装到全局托管 bootstrap cache；首次启动某个 adapter 时可能会稍慢。

没有配置 `general.defaultAdapter` 时，选择器默认选中 `codex`；用户手动切换后的本地选择仍会被保留。

如果用户在 `adapters` 配置里添加自定义适配器 key，前端会把它展示在内置适配器的下方。内置适配器的隐藏/恢复是浏览器本地偏好，只影响前端选择器，不会写入项目或用户配置文件。

## Cline CLI

`cline` adapter 使用 Cline 公开 ACP 入口，并以已验证的 `3.0.54` 作为 native resume 门禁；未通过门禁的 system/path binary 只使用结构化 fresh-only fallback。运行时、凭据隔离、资产与只读历史边界见 [Cline CLI 适配器](./cline-adapter.md)。

## Pi coding-agent

`pi` 适配器通过 Pi JSONL RPC 承载持续会话，默认托管 `@earendil-works/pi-coding-agent@0.84.1`，并支持复用原生/default provider 或使用会话私有 model service。完整配置、原生凭据继承、安全与运行时边界、CLI 准备方式见 [Pi coding-agent 适配器](./pi-adapter.md)。

`kiro` 使用 Kiro 官方 ACP 通道、隔离的 `KIRO_HOME`、原生 session id/load、selected skills、stdio MCP 与 native hooks；远程 MCP transport 在已验证的 Kiro CLI 2.18.0 contract 下会明确报告为 unsupported。静态模型选择器只展示原生 **Default**，不会把通用 `modelServices` 路由到 Kiro；只有 live Kiro session 明确广告的原生 model ID 才能作为精确选择。完整配置、Amazon Q 迁移边界、认证与降级说明见 [Kiro CLI 适配器](./kiro-adapter.md)。

## 适配器配置分组

适配器详情页默认按前端语义拆成几组，而不是把所有字段平铺在一层：

- `基础配置`
- `模型配置`
- `高阶配置`
- `账号`

其中：

- `defaultAccount` 会展示在 `基础配置` 中，并通过下拉框选择当前已发现或已配置的账号 key。
- `账号` 是独立入口，不和普通字段混在一起。
- 复杂字段会继续留在 `高阶配置` 或其子分组中，而不是堆在基础配置里。

## 通用多账号能力

适配器可以实现统一的账号目录、账号详情和账号管理动作。

账号生命周期是统一协议，但凭证持久化由适配器决定。当前内置适配器的主要行为是：

- Codex 和 Claude Code 的受管账号写入 global `~/.oneworks/.oo.config.json`，从而跨项目复用，并可由个人 Relay 配置同步账号快照。
- 其他返回 artifact 的适配器仍可使用 project home 私有目录：

```text
<project-home>/.local/adapters/<adapter>/accounts/<accountKey>/
```

所有本地账号文件和全局凭证快照都属于私有数据，不应该提交到 Git。base64 payload 是编码而不是加密；设备原生凭证会标记为 device-bound，新设备仍需通过官方客户端登录。

## Web 配置页里的账号管理

在 `Adapters -> <adapter> -> 账号` 中：

- 根页会展示账号列表、默认账号摘要和搜索框
- 可以直接触发适配器提供的 `接入账号` 动作
- 可以在列表里把某个账号设为默认账号
- 可以删除 One Works 保存的账号记录；只有官方 CLI 能把 logout 精确限定到所选账号时，适配器才会同时执行官方 logout
- 点进单个账号后，可以查看来源、额度摘要和账号配置字段

账号详情页里的可编辑字段来自适配器自己的 `accounts.<key>` schema。\
当前 `codex` 已经支持：

- `title`
- `description`
- `authFile`
- `priority`
- `disabled`

其中 `description` 会用多行输入框编辑；`authFile` 用于显式引用现有 Codex `auth.json`。通过账号管理入口新增的 Codex 凭证会直接保存到 global config，不依赖 project home artifact。

## CLI 管理账号

当前通用入口是：

```bash
npx oneworks accounts add <adapter> [accountName]
npx oneworks accounts show <adapter> <accountName>
npx oneworks accounts remove <adapter> <accountName>
```

说明：

- `add`
  - 调用适配器暴露的接入能力
  - Codex / Claude Code 会运行各自官方 CLI 登录并写入 global 账号快照；其他 adapter 返回的 artifact 仍由上层落到 workspace 私有目录
- `show`
  - 读取适配器账号详情
  - 当前 CLI 会强制刷新一次账号详情和额度摘要
- `remove`
  - 调用适配器的删除流程；平台隔离的凭证可以同时走官方 logout
  - 默认 Claude home / Desktop 等机器级引用只删除 One Works 的账号记录和 binding，不会登出设备上的原生登录

## Codex 示例

Codex 已接入通用多账号、Auto 账号池、内置模型共享、官方客户端桥接和原生配置导入。完整配置与行为说明见 [Codex 账号、共享模型与客户端接入](./codex.md)。

## Claude Code 示例

Claude Code 使用同一套账号入口：

```bash
npx oneworks accounts add claude-code work
npx oneworks accounts show claude-code work
npx oneworks accounts remove claude-code work
```

行为说明：

- 登录和状态只调用官方 `claude auth login --claudeai` 与 `claude auth status --json`；只有 logout 能精确限定到所选账号时才调用官方 `claude auth logout`。
- macOS 首次新增 Claude 账号时，如果 Desktop 或默认 CLI 已有有效的机器级 Claude.ai 登录，One Works 会直接保存 device-bound 账号卡片和 binding，不重复打开登录流程。该账号明确引用默认 Claude home，不伪装成隔离登录；已有受管账号的重新认证仍走官方登录。
- 通过官方登录建立的受管账号使用独立、稳定的 `CLAUDE_CONFIG_DIR`。引用现有 Desktop / 默认 CLI 登录的账号沿用默认 Claude home；One Works 仍会清理可能覆盖所选账号的 API Key、Router 和 settings 认证配置。
- macOS 的 Claude 凭证通常保存在 Keychain；Linux / Windows 可能使用 `.credentials.json`。前者按 device-bound 处理，新设备需要重新登录；后者可以保存 portable 快照。
- 默认 Claude home / Desktop 引用与其他账号使用不同边界：默认引用是机器级资源，删除时只清 One Works 记录；其他账号通过稳定的独立 `CLAUDE_CONFIG_DIR` 登录，可与默认账号及彼此并行使用，删除时只 logout 对应 profile。同一 email + organization 身份不会重复显示为 Desktop 和隔离账号。由于部分旧版 macOS CLI 会让 Keychain 登录跨配置目录继承，One Works 会在登录前和 logout 前用官方 status 验证隔离；无法证明独立时会拒绝操作，不会把机器级凭证误当成可并行账号。
- `.claude.json` 不是完整凭证。One Works 只保存账号身份和 `cachedUsageUtilization` 等 allowlist 状态，不复制 machine ID、项目列表或 workspace trust。
- 额度展示优先使用身份匹配且仍新鲜的本地缓存，包括 Claude CLI 的 `cachedUsageUtilization`、Claude Desktop 的计划用量历史，以及 Desktop 已缓存的同 organization usage 响应；后者可补充“首次发消息后开始”和精确重置时间。用户主动刷新时，One Works 可以用当前官方 OAuth 凭证在内存中查询 Anthropic usage；token 不会写入 One Works 配置或日志。远端 profile、Desktop 数据与所选账号的 email / organization 不匹配时一律拒绝，远端失败或限流时按 `Retry-After` 退避并继续使用安全的本地值。
- Desktop 与 CLI 可以共享默认机器登录和部分配置，但会话历史不会因此合并；One Works 也不会把 Desktop 会话冒充为 CLI / One Works 会话。

## Copilot 示例

`copilot` 使用官方 GitHub Copilot CLI。One Works 会把运行时配置写入 project home 的 `.mock/copilot/settings.json`，并把 CLI auth/keychain 交给官方 CLI 自己处理。

项目配置可固定 `cli.source` / `cli.version`，并按需设置 `remote`、`stream`、`agent`、`agentDirs`、`pluginDirs`、`mode`、工具与 URL allow/deny 规则、`additionalDirs` 和 `configContent`。

行为说明：

- selected skills 会 stage 到 session 目录，并通过 `COPILOT_SKILLS_DIRS` 注入 Copilot CLI
- 任务 system prompt 会写成 session 级 custom instructions，并通过 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` 注入
- selected MCP servers 会翻译成 `--additional-mcp-config`
- `modelServices.extra.copilot` 可以配置 BYOK/provider 细节，适配器会映射为 `COPILOT_PROVIDER_*`
- hook plugins 会接入 Copilot native `PreToolUse` / `PostToolUse` / `Stop`，对应通用 bridge 事件会自动去重
- effective project / user 两层 Copilot 适配器配置会对 `cli` 与 `configContent` 做深合并，避免 user config 覆盖整块 native settings
- `mode` 会直接映射 `--mode`，并优先于 `autopilot` / plan permission；需要 autopilot 时推荐配置 `mode: autopilot` 或 `autopilot: true` 二选一

当前不实现 Copilot 多账号 API；需要登录、切换或排查账号时，使用官方 CLI 的 `/login`、`/logout`、`/user` 流程。

## Cursor 示例

`cursor` 使用 Cursor Agent CLI。One Works 默认从官方发行包安装托管 CLI，也可以复用系统 `agent` / `cursor-agent`，或指定现有 binary：

```yaml
adapters:
  cursor:
    cli:
      source: managed
      version: latest
    mode: agent
    approveMcps: true
```

- stream 会话使用 Cursor 的 JSON 输出并保存原生 chat id，后续消息通过 `--resume` 继续同一会话；system prompt、所选 skills、MCP servers 和 hooks 写入 session 隔离的 config/data 目录，不覆盖真实 `~/.cursor`
- 本机 Cursor CLI 登录配置会复制到隔离目录，macOS keychain 通过路径桥接；`force`、`autoReview`、`approveMcps`、`sandbox`、`endpoint`、`additionalDirs`、`pluginDirs` 和 `headers` 映射为原生参数，登录状态仍由 CLI 管理，One Works 不提供多账号 API

## 迁移原生历史会话

配置页“外部会话”可以预览和导入当前项目或已发现项目的 Codex、Claude Code、Cline、Cursor、Factory Droid、Goose、Grok 与 Qwen Code 历史。Cursor 读取 `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`；Droid 读取 `~/.factory/sessions/**/*.jsonl`；Qwen Code 读取 0.21.11 兼容的 chats/subagents JSONL；Goose 只调用公开 `session list` / `session export` JSON 命令，绝不读取 SQLite。

所有自动导入、预览和手动导入读取都受服务端 50 MiB 单文件与累计硬上限约束。自动导入可以设置更小的单文件阈值；留空或设为 `null` 时使用 50 MiB。adapter 未设置时继承全局值，显式 `null` 则使用 50 MiB；超过 50 MiB 的配置无效。手动导入可以读取被更小自动阈值跳过的文件，但不能绕过服务端硬上限。

预览和手动导入通知会区分被拒绝的文件、超过单文件上限的文件，以及累计预算耗尽后未读取的文件；混合结果仍保留成功候选。若所有候选均被拒绝或受限，界面会报告扫描不完整，而不是宣称不存在历史记录。

全局原生历史自动导入会按 best-effort 扫描已启用 adapter：某个可选原生 CLI 缺失时会报告，但不会丢弃其他可用 adapter 的导入结果。显式 adapter 选择仍保持严格且可操作；显式 mixed selection 会保留成功结果并报告不可用项。
导入只读取源 JSONL，不修改 Cursor 数据。导入结果会成为 One Works 中可查看的已完成外部会话，并保留用户消息、助手文本和工具调用；重复导入会按原生 session id 与源文件去重。由于 Cursor 的项目目录名是工作区路径的压缩形式，Cursor 候选只在能匹配当前项目、显式选择的项目路径或 Cursor 工作区元数据时导入。

## Grok Build CLI 与 Goose CLI

`goose` 通过 Goose ACP 提供持续结构化会话、隔离配置、原生工具、权限请求、MCP 与 selected skills。托管 release 校验、凭据边界、model-service 支持、明确 fallback 和 public CLI 历史导入见 [Goose CLI 适配器](./goose-adapter.md)。
`grok` 使用 xAI 官方 Grok Build CLI，支持托管安装、模型路由、MCP、skills、hooks，以及按原生 UUID 迁移并续接已有会话。完整配置、project-shared session home、外部会话导入和登录边界见 [Grok Build CLI 适配器](./grok-adapter.md)。
Junie 的 headless stream、原生续聊、隔离、hooks、Plan 降级与暂不支持历史导入的边界见 [JetBrains Junie CLI 适配器](./junie-adapter.md)。

## Qwen Code CLI

`qwen-code` 使用 Qwen Code 0.21.11 原生 headless 协议、session ID / resume、隔离 HOME、skills、MCP 和 native hooks；routed model 仅支持已验证的 OpenAI Chat Completions，且不会复制或软链真实 QWEN_HOME 凭据。完整边界见 [Qwen Code CLI 适配器](./qwen-code-adapter.md)。
