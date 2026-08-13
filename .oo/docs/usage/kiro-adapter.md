# Kiro CLI 适配器

`kiro` 使用 Amazon 的 Kiro CLI。Kiro 是 Amazon Q Developer CLI 的正式后继；One Works 只提供一个 `kiro` adapter，不再创建独立的 Amazon Q adapter。系统来源会优先探测 `kiro-cli`；只有当 `q --version` 能识别为 Kiro 且 `q acp --help` 成功时，才会把 `q` 当作迁移期命令别名。

Kiro CLI 是闭源软件，作为 AWS Content 按 [AWS Intellectual Property License](https://kiro.dev/license/) 授权；One Works 的托管安装只读取 [Kiro 官方 stable manifest](https://prod.download.cli.kiro.dev/stable/latest/manifest.json)，选择当前平台发行物并校验 SHA-256。Kiro 的安装与使用还受其官方条款约束。

## 配置

```yaml
adapters:
  kiro:
    cli:
      source: managed
      version: latest
    additionalDirs:
      - /absolute/path/to/shared-context
    configContent:
      telemetry: false
    agentConfig:
      description: One Works managed Kiro agent
```

- `cli.source` 支持 `managed`、`system` 与 `path`；显式路径必须同时通过 `--version` 与 `acp --help` 探针。
- 托管来源使用 manifest 当前发布版。Kiro 不提供可直接验证旧版本 checksum 的 versioned stable manifest，因此配置其他精确版本时会安全拒绝，而不会下载未校验的历史包。复用与安装都在 managed cache lock 内执行；执行前会拒绝符号链接形式的 managed root / version 祖先、逃逸的 real path 与特殊 executable entry。
- `configContent` 写入 session 隔离的 `$KIRO_HOME/settings/cli.json`。
- `agentConfig` 合并到 session 隔离的 `oneworks` custom agent。不要在共享配置中写入 token 或其他凭据。
- `additionalDirs` 只在 initialize 响应广告 ACP additional-directories capability 时传入。

可以提前准备 CLI：

```bash
oneworks adapter prepare kiro
```

## 结构化运行与恢复

stream 会话只使用 Kiro 官方的 `kiro-cli acp --agent oneworks` JSON-RPC 通道。当前 Kiro 文档使用 `session/prompt.content`、`session/notification` 与 PascalCase update 名；当前 ACP v1 规范则使用 `prompt`、`session/update` 与 snake_case。One Works **只按 Kiro 官方格式发送**，不会对同一个 turn 猜测协议后重发；接收端兼容两种通知名称和字段大小写，以处理 Kiro/ACP 的演进。

initialize 响应会被收敛成显式 capability matrix：

- 只有 `loadSession: true` 才会用缓存的 Kiro native session id 调用 `session/load`。
- 静态模型选择器只展示 Kiro 原生 **Default**；OpenAI、Anthropic 等通用 `modelServices` 不会被路由进 Kiro。若 Kiro session state 广告了具体原生 model id，可通过原生 session setter 应用完全匹配的 ID；非默认 ID 未出现在 session 响应中时，启动会明确失败，不会静默保留另一模型。effort setter 只对精确广告的 option 生效，session metadata 也只报告 Kiro 响应中可验证的 active effort，不会回显未应用的 requested value；direct mode 没有可验证的 native state，因此不报告 effort。
- stdio MCP 直接映射到 ACP session；本 adapter 已验证的 Kiro CLI 2.18.0 initialize contract 未广告远程 HTTP / SSE MCP transport，因此选中的远程 server 会被跳过并显示 asset diagnostic，不会被报告为已启用。
- permission 选择严格保留 Kiro 广告的原生 option ID 与 scope。`dontAsk` / bypass，以及 `acceptEdits` 下的写请求，只有在 Kiro 提供 request-scoped `allow_once` 时才自动允许；如果只提供持久 allow，会明确失败。One Works 记住的 session / project 允许或拒绝规则同样只通过 Kiro 原生 `allow_once` / `reject_once` 满足当前请求；缺少对应安全选项时会失败关闭。只有用户在当前请求中明确选择原生持久选项，才允许修改 Kiro 的持久权限状态。default / plan 由 adapter 输出结构化 scope 语义，再由 client 或 channel 渲染完整的中文 / 英文 label、说明、色调、图标与可访问操作名称。channel 回复既可使用界面展示的本地化 label，也可使用原始 native label / value 或序号；有歧义时会拒绝而不是猜测。未知原生选项会在本地化的中性“范围未知”框架中保留其 native label。
- initial prompt 只会在 One Works 注册返回的 session response bridge 后启动，因此首轮 default / plan permission question 可以正常回答。`session/prompt` 表示完整 turn，不受 adapter 固定 30 秒超时限制；它会等待 Kiro 响应、调用方 cancel / task timeout 或进程退出。cancel 会先结清待处理 permission request，再发送 `session/cancel`；TurnEnd、错误、EOF 与退出都只终结一次，terminal state 后迟到的 request / notification 也不会再创建 UI interaction。

Kiro 的 `chat --no-interactive` 是官方 headless 能力，但它不是 One Works 的结构化 stream 协议，也不会被伪装成增量 JSON 输出。

由于 headless/direct mode 没有可验证的 model collection 或 setter 响应，该模式只接受 **Default**；需要选择 Kiro 广告的精确原生模型时应使用结构化 stream 路径。

## 资产与隔离

每个 Kiro 进程使用一次性原子创建、权限为 `0700` 的平台临时 `HOME`；会话持久的 `KIRO_HOME` 仍位于 One Works project home。Node 没有提供跨平台的 `openat` 类目录句柄相对 mkdir、删除与 symlink 原语，因此 adapter 不再复用或递归删除固定的 `adapter-kiro/home`，也不创建 macOS Keychain 文件系统链接。这一主动收窄的边界不存在“校验路径后再修改”的窗口：遗留 home / Keychain 路径保持不动，而 managed cache / session root 与持久 native home 仍会拒绝 symlink 祖先、特殊 entry 和逃逸 real path。

- system prompt / rules 写入 always-included steering，并由 managed custom agent 引用。
- selected skills stage 到 `$KIRO_HOME/skills`；显示名会转换为跨 POSIX/Windows 都安全的单级目录名，并在写入或创建链接前检查隔离根目录与祖先路径。
- selected stdio MCP servers 通过 ACP session 参数注入；在明确验证 Kiro wire capability 前，远程 transport 仍为 unsupported。已显式选择的 workspace MCP 名称始终优先，即使其远程 transport 被跳过，同名 session companion 也不会替代执行。managed agent 关闭隐式 `mcp.json` 读取，避免出现第二个配置所有者。
- hook plugins 映射到 Kiro 原生 `agentSpawn`、`userPromptSubmit`、`preToolUse`、`postToolUse` 与 `stop`；与通用 hook bridge 重叠的事件自动抑制。

One Works 不复制真实 `~/.kiro`、`~/.aws/amazonq`、Keychain 目录或凭据文件。包括 `KIRO_API_KEY`、`AWS_BEARER_TOKEN_BEDROCK`、`AWS_WEB_IDENTITY_TOKEN_FILE`、`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `FULL_URI`、`AWS_CONTAINER_AUTHORIZATION_TOKEN` / `TOKEN_FILE`、`AWS_SHARED_CREDENTIALS_FILE` 与 `AWS_CONFIG_FILE` 在内的 Kiro/AWS provider 环境变量只透传给当前进程。后两项是 credential-bearing locator：AWS 官方说明 shared credentials file 存储凭据，shared config file 也可以包含凭据或 `credential_process`。这些变量的键、原值、raw、混合大小写或全量 percent-encoded、多层 URL / form-encoded 与常见 base64 等价形式都会从普通对象属性名和值中清除，覆盖 task `base.json`、恢复 cache、native settings、runtime-protocol workspace-query-options cache 与 diagnostics / log snapshot。live Kiro runtime input 不会被修改；Kiro query-options cache 命中时会按当前进程重新生成，而不会把已脱敏的凭据回放给 runtime。malformed percent 片段会安全保留，很短的 secret 则整叶或属性移除，避免按字符全局替换。`AWS_REGION`、`AWS_PROFILE` 等明确非敏感恢复设置仍可缓存。恢复只从当前进程或 Kiro 自身可访问的系统凭据流程获取凭据及 provider file locator；One Works 不会物化 Keychain 文件系统视图。若某种 Kiro 登录只存在于未文档化的 home 文件中，需要在隔离 profile 内通过官方流程重新认证；当前不提供 Kiro 多账号 API。

Kiro 官方安装器可以迁移 Amazon Q 的 prompts、agents、MCP 与 rules，但该行为属于 Kiro 自身。adapter 不读取或复制 `~/.aws/amazonq`，也不把旧 `q chat` 当作结构化运行时。

## 历史边界

One Works 会缓存 Kiro ACP 返回的 native session id，并通过已验证的 `session/load` 恢复同一会话。Kiro 文档虽然公开了 `$KIRO_HOME/sessions/cli/*.json` / `*.jsonl` 的位置，但没有稳定公布磁盘 event-log schema；因此当前“外部会话”页面不预览或导入 Kiro 磁盘历史，也不声称支持项目发现、all-project 去重或 subagent 历史迁移。

参考：[Kiro ACP](https://kiro.dev/docs/cli/acp/)、[Kiro headless mode](https://kiro.dev/docs/cli/headless/)、[Kiro settings / `KIRO_HOME`](https://kiro.dev/docs/cli/reference/settings/)、[从 Amazon Q 迁移](https://kiro.dev/docs/upgrade-guides/migrating-from-q/)、[AWS shared config 与 credentials files](https://docs.aws.amazon.com/sdkref/latest/guide/file-format.html)、[ACP v1](https://agentclientprotocol.com/protocol/v1/)。
