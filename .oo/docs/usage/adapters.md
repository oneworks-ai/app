# 适配器配置与多账号

本文说明 Web 配置页里的适配器配置结构，以及适配器通用多账号能力的使用方式。

## 配置入口

- Web 配置页路径：`/ui/config?tab=adapters&source=project`
- 适配器详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>`
- 账号列表页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- 账号详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` 也可以切到 `global` 或 `user`，用于编辑跨项目默认值或本地适配器覆盖。

## 前端选择器

聊天输入框的适配器选择器默认展示当前应用内置支持的原生适配器：Claude Code（`claude-code`）、Codex（`codex`）、Copilot（`copilot`）、Gemini（`gemini`）、Grok（`grok`）、Kimi（`kimi`）、OpenCode（`opencode`）和 Pi（`pi`）。

以下 adapter 不需要先写入 `.oo.config.json` 才能出现在选择器里。用户选择某个 adapter 发起会话后，运行时会沿用 adapter 自己的 CLI 准备逻辑，把托管 CLI 安装到全局托管 bootstrap cache；首次启动某个 adapter 时可能会稍慢。

没有配置 `general.defaultAdapter` 时，选择器默认选中 `codex`；用户手动切换后的本地选择仍会被保留。

如果用户在 `adapters` 配置里添加自定义适配器 key，前端会把它展示在内置适配器的下方。内置适配器的隐藏/恢复是浏览器本地偏好，只影响前端选择器，不会写入项目或用户配置文件。

## Pi coding-agent

`pi` 适配器通过 Pi JSONL RPC 承载持续会话，默认托管 `@earendil-works/pi-coding-agent@0.84.1`，并支持复用原生/default provider 或使用会话私有 model service。
完整配置、原生凭据继承、安全与运行时边界、CLI 准备方式见 [Pi coding-agent 适配器](./pi-adapter.md)。

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
- 可以删除 One Works 保存的账号记录；只有 portable 且平台能够隔离该账号凭证时，适配器才会同时执行官方 logout
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
  - 调用适配器的删除流程；portable 且平台隔离的凭证可以同时走官方 logout
  - macOS Keychain 等 device-bound 凭证只删除 One Works 的账号记录和 binding，不会登出设备上的原生登录

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

- 登录和状态只调用官方 `claude auth login --claudeai` 与 `claude auth status --json`；只有 portable 且平台隔离的凭证删除才会调用官方 `claude auth logout`。
- 每个账号使用独立、稳定的 `CLAUDE_CONFIG_DIR`，会话通过所选账号目录隔离。
- macOS 的 Claude 凭证通常保存在 Keychain；Linux / Windows 可能使用 `.credentials.json`。前者按 device-bound 处理，新设备需要重新登录；后者可以保存 portable 快照。
- 删除 macOS 或其他 device-bound 账号时，One Works 只删除自己的账号记录和 binding，设备上的原生 Claude 登录仍然保留。用户若显式运行 `claude auth logout`，应将其理解为影响该机器原生登录的机器级操作。
- `.claude.json` 不是完整凭证。One Works 只保存账号身份和 `cachedUsageUtilization` 等 allowlist 状态，不复制 machine ID、项目列表或 workspace trust。
- 额度展示来自本地 cached usage，不是实时远端查询。

## Copilot 示例

`copilot` 使用官方 GitHub Copilot CLI。One Works 会把运行时配置写入 project home 的 `.mock/copilot/settings.json`，并把 CLI auth/keychain 交给官方 CLI 自己处理。

```yaml
adapters:
  copilot:
    cli:
      source: managed
      version: 1.0.36
    remote: false
    stream: true
    agent: reviewer
    agentDirs:
      - /absolute/path/to/copilot-agents
    pluginDirs:
      - /absolute/path/to/copilot-plugin
    mode: autopilot
    allowTools:
      - shell(git:*)
    denyTools:
      - shell(git push)
    allowUrls:
      - https://docs.github.com/copilot/*
    additionalDirs:
      - /absolute/path/to/shared-context
    configContent:
      askUser: false
```

行为说明：

- selected skills 会 stage 到 session 目录，并通过 `COPILOT_SKILLS_DIRS` 注入 Copilot CLI
- 任务 system prompt 会写成 session 级 custom instructions，并通过 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` 注入
- selected MCP servers 会翻译成 `--additional-mcp-config`
- `modelServices.extra.copilot` 可以配置 BYOK/provider 细节，适配器会映射为 `COPILOT_PROVIDER_*`
- hook plugins 会接入 Copilot native `PreToolUse` / `PostToolUse` / `Stop`，对应通用 bridge 事件会自动去重
- effective project / user 两层 Copilot 适配器配置会对 `cli` 与 `configContent` 做深合并，避免 user config 覆盖整块 native settings
- `mode` 会直接映射 `--mode`，并优先于 `autopilot` / plan permission；需要 autopilot 时推荐配置 `mode: autopilot` 或 `autopilot: true` 二选一

当前不实现 Copilot 多账号 API；需要登录、切换或排查账号时，使用官方 CLI 的 `/login`、`/logout`、`/user` 流程。

## Grok Build CLI

`grok` 使用 xAI 官方 Grok Build CLI，支持托管安装、模型路由、MCP、skills、hooks，以及按原生 UUID 迁移并续接已有会话。

完整配置、project-shared session home、外部会话导入和登录边界见 [Grok Build CLI 适配器](./grok-adapter.md)。
