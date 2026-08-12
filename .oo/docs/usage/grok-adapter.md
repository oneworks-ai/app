# Grok Build CLI 适配器

`grok` 使用 xAI 官方 Grok Build CLI。One Works 为同一项目使用稳定的 `$GROK_HOME`，让原生会话可以跨 worktree 和 runtime context 续接，并在 session 配置中按受管策略继承真实 Grok home 的登录凭据与基础 `config.toml`。

## 配置示例

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

## 运行时行为

- 默认托管 `@xai-official/grok`，也可用 `cli.source: system` 或 `cli.source: path` 指向已有 `grok`。
- 原生模型名直接传给 `--model`；共享模型选择器里的 `service,model` 会写成 session 级 Grok custom model，支持 `chat_completions`、`responses` 和 `messages` backend。
- selected MCP servers 会写入 session `config.toml` 的 `mcp_servers`，selected skills 会投影到 `$GROK_HOME/skills`。
- system prompt、permission mode、effort 和 tool include/exclude 会映射到 Grok 原生 CLI 参数。
- hook plugins 会接入 Grok native `PreToolUse`、`PostToolUse` 和 `Stop`；其中 `PreToolUse` 保留阻断能力，对应通用 bridge 事件自动去重。
- 自动更新检查默认关闭；memory、subagents 和 web search 默认保留，只有对应 `disable*` 配置为 `true` 时才关闭。

## 会话迁移与导入

session home 使用 project-shared 稳定路径。续接时，One Works 会按同一个原生 UUID 从旧版 context 目录或真实 `$GROK_HOME` 迁移会话，因此切换 worktree 或 runtime context 后仍可继续。

“外部会话”会扫描 `$GROK_HOME/sessions`（默认 `~/.grok/sessions`），支持按项目预览并导入 Grok 原生历史；导入副本保持只读语义。

## 登录

One Works 当前不提供 Grok 多账号 API。首次登录或切换登录态时，使用官方 `grok login` 和 `grok logout`。

托管 CLI 的版本固定、预热和环境变量覆盖见 [适配器 CLI 安装与版本](./adapter-cli.md)。
