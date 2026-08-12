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

`codex` 已经接入这套通用多账号能力。配置示例：

```yaml
adapters:
  codex:
    defaultAccount: work
    accounts:
      work:
        title: Work
        description: 公司账号
      personal:
        title: Personal
        authFile: /absolute/path/to/personal-auth.json
```

行为说明：

- “设置 → 模型服务”列表底部有独立导入行：左侧可搜索选择声明了模型服务导入能力的 adapter package，右侧点击“导入”；每个 adapter 自己声明支持 Global、Project 或 User 中的哪些来源
- 空项目没有 `adapters` 配置时，运行时默认使用 `codex`，不会为了启动会话主动写入 `.oo.config.json`
- 如果本机存在 `~/.codex/auth.json`，Codex 适配器会把它作为只读 fallback 账号展示和使用，不会自动复制或删除
- 由 Launcher / daemon manager 启动的 workspace 会在账号、启动参数和有效进程 / 网络 profile 一致时跨 workspace 复用同一个 manager-owned Codex app-server；model provider、MCP、cwd、权限、One Works workspace / session 运行时元数据和 selected skills 按 thread 下发，不会仅因切换 workspace 或 provider 重启进程。其他进程级环境差异会形成不同 profile。manager ready 后会纯后台预热最多 3 个默认 / 已配置账号，不阻塞 Launcher 启动；空闲进程默认保留 5 分钟，可通过 `appServer.idleTimeoutMs` 调整
- One Works managed hook 会由共享 app-server 回调 manager，再只转发到 owning workspace lease 执行；回调能力按 lease 下发到 thread config，不进入共享 app-server 的进程环境。workspace 自带的 `.codex/hooks.json` 仍由 Codex 按 thread cwd 发现。thread 注册后以 lease + thread ID + cwd 校验归属；创建 thread 的短暂窗口只允许同一 lease 内的 pending setup 以 cwd 绑定，不会跨 workspace 猜测 owner
- direct mode 仍使用 session 隔离 HOME；没有 manager 的 standalone stream 保留 project-local fallback pool。manager-owned stream 使用机器共享的 app-server profile HOME 并挂载所选账号 `auth.json`，但不会把 workspace skills / hooks 软链进共享 HOME
- `network.httpProxy` / `httpsProxy` / `allProxy` / `noProxy` 与 `caCertificate` 只作用于 Codex adapter；配置同时覆盖原生 Codex 进程和 One Works 的 provider 转发请求。本地转发地址始终加入 `NO_PROXY`；`caCertificate` 可传 PEM 文件路径或内联 PEM，内联内容会先落到权限为 `0600` 的 profile 私有文件
- 在该导入行选择 `Codex config.toml`：当前来源为 Global 时，会把用户级 `CODEX_HOME/config.toml` 或 `~/.codex/config.toml` 中缺失的 provider 导入 global `modelServices`；只有点击“导入”时才执行
- 当前来源为 Project 时，同一选项会把可信 workspace `.codex/config.toml` 中的 provider 导入 project `.oo.config.*`；Codex 原生会忽略 project 层的 provider/auth 字段，但 One Works 会按 `global < project < user` 使用导入结果。未信任的 project 层不导入，也不会把 global/user provider 展开复制进 project 文件
- 两类导入都不会修改原 Codex 配置，也不会覆盖目标 One Works source 中已有的服务
- “设置 → 环境”同样在列表底部提供通用 adapter 导入行，来源只支持 Project 与 User。选择 Codex 后会安全读取当前 workspace `.codex/environments` 下有界的普通 `*.toml` 文件（包括默认、编号和命名环境）；`setup` 映射为 `create`，`cleanup` 映射为 `destroy`，当前平台脚本会覆盖默认脚本。空的基础脚本视为未配置，因此只声明平台脚本也能导入；环境 ID 末尾的 `.local`（不区分大小写）会被规范化，因为该后缀保留给 One Works 的 User 来源展示语义
- Codex environment 的 `actions` 不等价于 One Works 生命周期 `start`，因此只会报告为跳过，不会被错误迁移；导入只新增缺失环境，不合并或覆盖已有目录，也不会修改原生 TOML
- Web 模型选择器优先复用 Codex 本地模型目录：`CODEX_HOME` / `~/.codex/config.toml` 里的 `model_catalog_json`，其次是 `models_cache.json`；没有可读目录时才回退内置模型列表
- Web 配置页默认展示缓存后的额度快照；当前 Codex quota 快照默认缓存 5 分钟
- CLI `oneworks accounts show codex <account>` 会主动刷新一次最新额度信息

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

## Grok 示例

`grok` 使用 xAI 官方 Grok Build CLI。One Works 为每个 session 生成独立的 `$GROK_HOME`，保留原生 session 续接，同时只引用真实 Grok home 里的登录凭据和受管策略文件。

```yaml
adapters:
  grok:
    cli:
      source: managed
      version: 1.0.3
    effort: high
    disableAutoUpdate: true
    disableMemory: false
    disableSubagents: false
    disableWebSearch: false
    configContent:
      ui:
        screen_mode: minimal
```

行为说明：

- 默认托管 `@xai-official/grok`，也可用 `cli.source: system` 或 `cli.source: path` 指向已有 `grok`
- 原生模型名直接传给 `--model`；共享模型选择器里的 `service,model` 会写成 session 级 Grok custom model，支持 `chat_completions`、`responses` 和 `messages` backend
- selected MCP servers 会写入 session `config.toml` 的 `mcp_servers`，selected skills 会投影到 `$GROK_HOME/skills`
- system prompt、permission mode、effort 和 tool include/exclude 会映射到 Grok 原生 CLI 参数
- hook plugins 会接入 Grok native `PreToolUse` / `PostToolUse` / `Stop`；其中 `PreToolUse` 保留阻断能力，对应通用 bridge 事件自动去重
- 自动更新检查默认关闭；memory、subagents 和 web search 默认保留，只有对应 `disable*` 配置为 `true` 时才关闭
- session home 使用 project-shared 稳定路径；续接时会按同一个 UUID 从旧版 context 目录或真实 `$GROK_HOME` 迁移原生会话，因此切换 worktree / runtime context 后仍可继续
- “外部会话”会扫描 `$GROK_HOME/sessions`（默认 `~/.grok/sessions`），支持按项目预览并导入 Grok 原生历史；导入副本保持只读语义

One Works 当前不提供 Grok 多账号 API；首次登录或切换登录态时使用官方 `grok login` / `grok logout`。
