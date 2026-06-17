# 原生资产适配

返回入口：[ADAPTERS.md](../ADAPTERS.md)

## 统一语义

adapter 不是直接扫描 `.oo/skills`、`.oo/mcp`、插件目录然后各自随意处理；统一入口是：

- [`packages/workspace-assets/src/adapter-asset-plan.ts`](../../../packages/workspace-assets/src/adapter-asset-plan.ts)
- [`packages/task/src/run.ts`](../../../packages/task/src/run.ts)

`AdapterAssetPlan` 负责告诉 runtime：

- 哪些 MCP 最终生效
- 哪些 skill / overlay 需要投影到原生目录
- 每个资产是 `native`、`translated`、`prompt` 还是 `skipped`

Skill frontmatter 支持 `dependencies`。依赖先按本地 workspace / 插件 skill 解析；本地缺失且 `skills.autoDownloadDependencies` 未关闭时，由 `workspace-assets` 通过 `skills` CLI 安装到 `<project-home>/caches/skill-dependencies/`。adapter 只消费最终 `WorkspaceAssetBundle.skills`，不要在 adapter 内重新实现 dependency 下载。

## 各 adapter 的落点

| Adapter       | Hooks                                                                                | Skills                                                                                                                               | MCP                                                               | 其他原生资产                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code` | `<project-home>/.mock/.claude/settings.json`                                         | `<project-home>/.mock/.claude/skills -> .oo/skills`                                                                                  | 选中 MCP 写进 cache 文件，再用 `--mcp-config` 注入                | managed `.claude.json` 写 workspace trust state；managed Claude plugins stage 到 `<project-home>/caches/<ctx>/<session>/.claude-plugins`                                                                                                                                                                  |
| `codex`       | `<project-home>/.mock/.codex/hooks.json`                                             | `<project-home>/.mock/.agents/skills -> .oo/skills`，并把每个 workspace skill 目录软链到 `<project-home>/.mock/.codex/skills/<name>` | 翻译成 `-c mcp_servers.<name>.*`                                  | managed `config.toml` 写 workspace trust 与 update-check 默认值；账号 auth 快照落到 `<project-home>/.local/adapters/codex/accounts/<key>/auth.json`，账号元数据与 quota 快照落到 `meta.json`，session HOME 隔离到 `<project-home>/caches/<ctx>/<session>/adapter-codex-home`，并继承通用 mock home bridge |
| `copilot`     | `<project-home>/.mock/copilot/settings.json` 里的 `hooks`                            | session 级 `<project-home>/.mock/copilot/sessions/<session>/skills`，通过 `COPILOT_SKILLS_DIRS` 注入                                 | 翻译成 `--additional-mcp-config`                                  | `settings.json` 写 workspace trust / `configContent`；custom instructions 通过 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`；custom agents 通过 `COPILOT_AGENT_DIRS`；local plugins 通过 `--plugin-dir`                                                                                                             |
| `gemini`      | `<project-home>/.mock/.gemini/settings.json` 里的 `hooks` / `hooksConfig`            | `<project-home>/.mock/.agents/skills -> .oo/skills`                                                                                  | 写进 `<project-home>/.mock/.gemini/settings.json` 的 `mcpServers` | `<project-home>/.mock/.gemini/settings.json`、本地 Gemini compatibility proxy、`GEMINI_CLI_HOME`                                                                                                                                                                                                          |
| `kimi`        | session 级 generated `config.json` / copied TOML config 里的 `hooks`                 | session 级 `<project-home>/caches/<ctx>/<session>/adapter-kimi/skills`，通过 `--skills-dir` 注入                                     | 写进 session 级 `mcp.json`，再用 `--mcp-config-file` 注入         | session share dir `<project-home>/caches/<ctx>/<session>/adapter-kimi/share`；`KIMI_SHARE_DIR`；`--wire` JSON-RPC；`modelServices` 转 Kimi providers/models/services                                                                                                                                      |
| `opencode`    | `<project-home>/.mock/.config/opencode/opencode.json` 与 `plugins/oneworks-hooks.js` | session 级 `OPENCODE_CONFIG_DIR/skills`                                                                                              | 写进最终 `opencode.json`                                          | fallback `opencode.json` 默认写 `$schema` 与 `autoupdate: false`；`agents/commands/modes/plugins` 与 overlay 一起进入 session config dir                                                                                                                                                                  |

## 当前支持矩阵

| Adapter       | CLI prepare                                   | Accounts                                  | modelServices                                                                 | Hooks                                                                        | MCP                        | Plugins / skills                                                                |
| ------------- | --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `claude-code` | managed npm `@anthropic-ai/claude-code` + CCR | 依赖 Claude 原生登录态 / keychain bridge  | 通过 Claude Code Router 接 OpenAI-compatible `chat/completions` 服务          | 原生 Claude settings bridge；禁用重复 framework bridge                       | `--mcp-config`             | Claude native plugin 转 One Works plugin；skills 走 mock home                   |
| `codex`       | managed npm `@openai/codex`                   | One Works 管理账号快照、默认账号和 quota  | Codex provider / config override 路径；模型目录优先读 Codex catalog/cache     | 原生 Codex hooks；transcript 只补观测类工具事件                              | `-c mcp_servers.<name>.*`  | skills 同步到 `.agents/skills` 与 `.codex/skills/<name>`；OpenCode overlay 跳过 |
| `copilot`     | managed npm `@github/copilot`                 | 依赖 Copilot 原生登录态 / keychain bridge | `modelServices.extra.copilot` 通过本地 provider proxy 转 `COPILOT_PROVIDER_*` | Copilot 原生 `PreToolUse` / `PostToolUse` / `Stop`；只去重这三类 bridge 事件 | `--additional-mcp-config`  | session skills / instructions / agents / local plugin dirs                      |
| `gemini`      | managed npm `@google/gemini-cli`              | 依赖 Gemini 原生登录态                    | `service,model` 通过本地 Gemini compatibility proxy 接 OpenAI-compatible 服务 | Gemini settings native hooks                                                 | `settings.json.mcpServers` | `.agents/skills` native skills；OpenCode overlay 跳过                           |
| `kimi`        | managed uv `kimi-cli`                         | 依赖 Kimi 原生 credentials 软链           | `modelServices.extra.kimi` / `extra.codex` / `extra.opencode` 转 Kimi config  | Kimi Beta native hooks，经 `kimi-hook.js` 调 `oneworks-call-hook`            | `--mcp-config-file`        | session `--skills-dir` native skills；OpenCode overlay 跳过                     |
| `opencode`    | managed npm `opencode-ai`                     | 依赖 OpenCode 原生 provider 配置          | 合并到 session `opencode.json` 的 provider/model 配置                         | OpenCode plugin bridge；`PreCompact` 为不可阻断观测                          | session `opencode.json`    | session `OPENCODE_CONFIG_DIR` 同时承载 skills、commands、agents、modes、plugins |

## Claude Code

macOS `Library/Keychains` 与 `Library/Application Support` 由通用 mock home bridge 处理，不作为 Claude 专属资产维护。

- init 阶段把 `.oo/skills` 软链到 [`packages/adapters/claude-code/src/claude/init.ts`](../../../packages/adapters/claude-code/src/claude/init.ts) 里的 `<project-home>/.mock/.claude/skills`，并写 mock-home `.claude.json` 项目信任状态
- query 阶段在 [`packages/adapters/claude-code/src/claude/prepare.ts`](../../../packages/adapters/claude-code/src/claude/prepare.ts) 写 `--settings`、`--mcp-config`，并 stage `--plugin-dir`

设计考量：

- Claude 原生会发现 `~/.claude/skills`、`.claude/skills` 和 plugin skills，但没有稳定的 `--skills-dir`
- 所以最简单、最稳定的方式是让 mock home 模拟个人级 skills 目录
- Claude 的 workspace trust state 落在 `~/.claude.json.projects[<cwd>]`，也必须在 mock home 一起补齐
- plugin 属于 session 级能力，因为它要经过安装记录、session cache 和 `--plugin-dir` 启用链路

官方文档：

- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)

## Codex

- init 阶段把 `.oo/skills` 软链到 [`packages/adapters/codex/src/runtime/init.ts`](../../../packages/adapters/codex/src/runtime/init.ts) 里的 `<project-home>/.mock/.agents/skills`，把每个 skill 目录镜像进 `<project-home>/.mock/.codex/skills/<name>`，并写 managed `<project-home>/.mock/.codex/config.toml`
- query 阶段在 [`packages/adapters/codex/src/runtime/session-common.ts`](../../../packages/adapters/codex/src/runtime/session-common.ts) 注入 `developer_instructions`、`mcp_servers.*`、feature flags 和 provider overrides，并为每个 session 组装独立 HOME
- 账号快照和额度探测在 [`packages/adapters/codex/src/runtime/accounts.ts`](../../../packages/adapters/codex/src/runtime/accounts.ts) 收口：`~/.codex/auth.json` 会导入到 `<project-home>/.local/adapters/codex/accounts/`，运行时按会话切换到对应 auth 快照
- 账号目录下的 `meta.json` 还会缓存账号来源与 quota / rate-limit 快照；当前 Codex 默认对这份快照使用 5 分钟 TTL，避免配置页每次打开都重新探测一次

设计考量：

- Codex 官方文档里的用户级 skills 入口仍是 `.agents/skills`
- 但当前真实运行时会在 `.codex/skills/.system` 下维护系统技能；只同步 `.agents/skills` 会和这条真实加载路径脱节
- 所以现在保持两处都同步：`.agents/skills` 继续承载用户级入口，`.codex/skills/<name>` 承载与当前 Codex 运行时兼容的镜像，hooks / managed config 留在共享 mock home，auth 改成 session 级切换

官方文档：

- [Codex Skills](https://developers.openai.com/codex/skills)
- [Codex AGENTS.md](https://developers.openai.com/codex/agents-md)
- [Codex Hooks](https://developers.openai.com/codex/hooks)

## Copilot

- init 阶段在 [`packages/adapters/copilot/src/runtime/init.ts`](../../../packages/adapters/copilot/src/runtime/init.ts) 准备 managed CLI、mock-home keychain bridge 和 native hook runtime
- query 阶段在 [`packages/adapters/copilot/src/runtime/shared.ts`](../../../packages/adapters/copilot/src/runtime/shared.ts) 生成 mock `settings.json`、session skills / instructions 目录、MCP JSON 和官方 CLI 参数
- native hooks 在 [`packages/adapters/copilot/src/runtime/native-hooks.ts`](../../../packages/adapters/copilot/src/runtime/native-hooks.ts) 写入 `PreToolUse`、`PostToolUse`、`Stop`，由 [`packages/adapters/copilot/src/hook-bridge.ts`](../../../packages/adapters/copilot/src/hook-bridge.ts) 转换成统一 hook 输入输出

设计考量：

- Copilot CLI 以 `~/.copilot/settings.json`、`skills/`、`agents/`、`hooks/` 为用户级原生边界；One Works 使用 `<project-home>/.mock/copilot` 作为隔离 config dir
- skills 和 custom instructions 是 session 级能力，分别通过 `COPILOT_SKILLS_DIRS` 与 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` 注入，避免全量污染用户级目录
- hook plugins 现在标记为 native；只有 Copilot 原生已经接管的 `PreToolUse` / `PostToolUse` / `Stop` 会从通用 hook bridge 去重

官方文档：

- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Copilot CLI configuration directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Copilot hooks configuration](https://docs.github.com/en/copilot/reference/hooks-configuration)

## Kimi

- init 阶段在 [`packages/adapters/kimi/src/runtime/init.ts`](../../../packages/adapters/kimi/src/runtime/init.ts) 定位或安装 Kimi CLI，并预备 native hook runtime
- query 阶段在 [`packages/adapters/kimi/src/runtime/config.ts`](../../../packages/adapters/kimi/src/runtime/config.ts) 生成 session share dir、Kimi config、MCP config、skills overlay 和 spawn env
- stream runtime 在 [`packages/adapters/kimi/src/runtime/session.ts`](../../../packages/adapters/kimi/src/runtime/session.ts) 走 `kimi --wire` JSON-RPC 长连接；direct runtime 在 [`packages/adapters/kimi/src/runtime/direct.ts`](../../../packages/adapters/kimi/src/runtime/direct.ts) 只做交互式透传
- native hooks 由 [`packages/adapters/kimi/src/runtime/native-hooks.ts`](../../../packages/adapters/kimi/src/runtime/native-hooks.ts) 写入 generated JSON / copied TOML config，最终通过 [`packages/adapters/kimi/kimi-hook.js`](../../../packages/adapters/kimi/kimi-hook.js) 调用统一 hook runtime

设计考量：

- Kimi 有稳定的 `--skills-dir` 和 `--mcp-config-file`，所以 skills / MCP 都保持 session 级，不写真实 `~/.kimi`
- `modelServices` 会翻译成 Kimi `providers` / `models` / `services`；`providerType: "kimi"` 时还会生成 search/fetch 服务
- credentials 只从真实 Kimi home 软链到 session share dir；One Works 当前不提供 Kimi 多账号管理 UI
- Kimi native hooks 仍是 Beta，新增事件前必须同步 adapter、hook runtime 去重和 permission service

官方文档：

- [Kimi Code CLI Docs](https://moonshotai.github.io/kimi-cli/en/)
- [Kimi Hooks Beta](https://moonshotai.github.io/kimi-cli/zh/customization/hooks.html)

## OpenCode

- init 阶段在 [`packages/adapters/opencode/src/runtime/native-hooks.ts`](../../../packages/adapters/opencode/src/runtime/native-hooks.ts) 托管 mock config dir
- query 阶段在 [`packages/adapters/opencode/src/runtime/session/skill-config.ts`](../../../packages/adapters/opencode/src/runtime/session/skill-config.ts) 和 [`packages/adapters/opencode/src/runtime/session/child-env.ts`](../../../packages/adapters/opencode/src/runtime/session/child-env.ts) 生成 session 级 `OPENCODE_CONFIG_DIR`

设计考量：

- OpenCode 已经有成熟的 session config dir 方案，且 One Works 暴露了 `include-skill` / `exclude-skill`
- 官方 config/permissions 文档没有单独的 trust-state；当前 workspace 直接按 permission 规则运行，额外目录才走 `permission.external_directory`
- 如果在 init 时把整棵 `.oo/skills` 全量挂进 mock home，会绕过 session 级 skills 选择和 overlay 规划
- 所以 OpenCode 保持“hooks 在 mock home，skills/agents/commands/modes 在 session config dir”的双层结构

官方文档：

- [OpenCode Agent Skills](https://opencode.oo/docs/skills)
- [OpenCode Config](https://opencode.oo/docs/config/)

## Gemini

- init 阶段把 `.oo/skills` 软链到 [`packages/adapters/gemini/src/runtime/init.ts`](../../../packages/adapters/gemini/src/runtime/init.ts) 里的 `<project-home>/.mock/.agents/skills`
- init 阶段在 [`packages/adapters/gemini/src/runtime/native-hooks.ts`](../../../packages/adapters/gemini/src/runtime/native-hooks.ts) 预备 managed hook runtime，并标记 `__ONEWORKS_PROJECT_GEMINI_NATIVE_HOOKS_AVAILABLE__`
- query 阶段在 [`packages/adapters/gemini/src/runtime/shared.ts`](../../../packages/adapters/gemini/src/runtime/shared.ts) 生成 `<project-home>/.mock/.gemini/settings.json`，把 selected MCP 写入 `mcpServers`，把 managed hook groups 写进 `hooks`
- 如果模型选择是 `service,model`，则在 [`packages/adapters/gemini/src/runtime/proxy.ts`](../../../packages/adapters/gemini/src/runtime/proxy.ts) 启动本地兼容代理，把 Gemini `generateContent` 流量转成上游 `chat/completions`

设计考量：

- Gemini CLI 已经有稳定的 `settings.json` native hooks 落点，One Works 通过 generic `oneworks-call-hook` + [`packages/adapters/gemini/src/hook-bridge.ts`](../../../packages/adapters/gemini/src/hook-bridge.ts) 做事件映射
- 外部服务支持依赖共享层 `modelServices`，但 Gemini adapter 只接受 OpenAI-compatible `chat/completions`
- OpenCode overlay 之类没有稳定 Gemini 原生映射的资产继续标记为 `skipped`
