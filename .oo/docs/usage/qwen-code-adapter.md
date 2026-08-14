# Qwen Code CLI 适配器

`qwen-code` 适配器运行 Qwen Code 原生 CLI。One Works 默认托管 `@qwen-code/qwen-code@0.21.11`，使用原生 headless `stream-json` / partial-message 协议，并保存 Qwen 原生 session ID，让同一个 One Works 会话后续通过 `--resume` 精确续接。

## 配置

```yaml
adapters:
  qwen-code:
    cli:
      source: managed
      version: 0.21.11
    disableAutoUpdate: true
    disableExtensions: true
    telemetry: off
```

`cli.source` 支持 `managed`、`system` 和 `path`。当前实现与验证版本精确限定为 `0.21.11`；系统或显式路径上的 binary 只要版本不同就会被保守拒绝，不会猜测 settings、routed provider 或 stream schema 兼容性。

## 运行时与会话

- stream 模式使用 `--output-format stream-json --include-partial-messages`，映射增量文本、工具调用、工具结果、usage、错误和退出事件。
- direct 模式保留原生交互体验，并从隔离 runtime 的 chat 记录读取 native session ID。
- system prompt 写入 session 私有 `ONEWORKS.md`；selected skills、MCP servers、rules/instructions 与 managed hooks 都只投影到该 session 的隔离目录。
- permission mode 映射到 Qwen Code 的 `default`、`plan`、`auto-edit`、`auto` 或 `yolo` approval mode。
- native resume 明确返回 session-not-found / invalid-session 时，本轮会失败并保留诊断与缓存 ID；不会静默新建会话造成分叉。
- 格式错误、截断 stream、result error、非零退出和进程启动失败都会 fail closed；不会改用另一个 provider 或成功开启新会话。

## 隔离与认证边界

每个 One Works session 都使用独立的 `HOME`、`QWEN_HOME` 和 `QWEN_RUNTIME_DIR`。适配器不会链接整棵真实 QWEN_HOME，也不会复制或软链 OAuth、MCP token 或其他凭据文件，隔离 runtime 因此也不能把新凭据写回真实 home。

当前已验证的凭据桥只有 `OPENAI_API_KEY`，包括 One Works model service 的 session 级注入。`PATH`、locale、proxy 等普通 project/runtime 环境仍会保留，但 GitHub、GitLab、AWS secret key、private key、cookie、password 以及通用 token/credential 等无关凭据命名变量不会传给 Qwen 子进程。仅在 Qwen 或隔离 MCP server 中有意可用的凭据值，会在 event、hook、log 与 task persistence 边界前加入 runtime redaction。One Works 不提供 Qwen Code 多账号或交互登录流程；需要原生 OAuth 的场景目前不应通过本 adapter 登录真实账号。

## Model Service 路由

Qwen Code routed model 当前只支持已验证的 OpenAI Chat Completions：

```yaml
modelServices:
  qwen-openai-compatible:
    apiBaseUrl: https://provider.example.com/v1
    apiKey: <store-in-private-config>
    apiProtocol: openai-chat-completions
    models:
      - example-model
```

在模型选择器选择 `qwen-openai-compatible,example-model` 后，session settings 会使用固定的 `openai` selected type / provider protocol、精确的 model item ID 和 canonical `OPENAI_API_KEY` env name。密钥值只进入子进程环境，不写入 `settings.json`。

Anthropic Messages、Gemini protocols 和 custom provider ID 均为 unsupported，并在 UI 筛选和 runtime 两层 fail closed。版本限定原因是：Qwen Code 0.21.11 的包内文档允许 custom protocol ID，但同版本 executable 的 `AUTH_ENV_MAPPINGS` 只能为 canonical provider 解析认证环境变量；custom selected type 会在认证映射阶段失败。因此，在新的上游版本经过独立 probe 前，本 adapter 只承诺 OpenAI Chat Completions routed path。

## 原生历史导入

“外部会话”可以只读预览和导入 Qwen Code 0.21.11 结构的 `projects/*/chats/*.jsonl` 与 `projects/*/subagents/*/*.jsonl`。扫描根目录优先使用 `QWEN_RUNTIME_DIR`，其次是 `QWEN_HOME`，最后才是默认 `~/.qwen`。

项目归属只使用每条记录的 `cwd`；main session、subagent meta、native session ID、parent session ID、agent ID 和 tool-use ID 必须相互一致。导入保留工具调用/结果与 parent-child 关系，并按 native identity 和 source 去重。malformed 或 truncated JSONL、超限文件、软链、根目录外路径以及身份不一致的记录均不会导入；源文件不会被修改。

Qwen Code 历史使用共享的服务端 50 MiB 硬上限，同时约束单个文件和一次预览/导入实际消费的累计字节。更小的自动导入设置仍会生效；`null` 使用 50 MiB 默认值，超过该值的配置会被拒绝。手动导入不能绕过服务端上限。文件打开后会核对身份，并在读取过程中计数，避免文件增长或替换绕过限制。

预览列表和手动导入通知会分别显示格式错误/读取期间变化/路径不安全、超过单文件上限，以及累计请求预算耗尽后未读取的文件。扫描不完整时不会误报“没有历史”，累计预算耗尽也不表示每个未读取文件都超过 50 MiB。Qwen 的排查提示使用上文相同的根目录解析顺序。

CLI 安装、预热与环境变量覆盖见 [适配器 CLI 安装与版本](./adapter-cli.md)。
