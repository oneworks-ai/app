# Codex 账号、共享模型与客户端接入

`codex` 已接入通用多账号能力。配置示例：

```yaml
adapters:
  codex:
    defaultAccount: work
    shareBuiltinModels: true
    accountPool:
      enabled: true
      strategy: sticky-priority
      cooldownMs: 300000
    accounts:
      work:
        title: Work
        priority: 100
      personal:
        title: Personal
        authFile: /absolute/path/to/personal-auth.json
        priority: 50
      paused:
        title: Paused
        disabled: true
```

## 账号池与共享模型

- 这里的账号来自官方 Codex 登录，是 ChatGPT/Codex 套餐账号，不是 `modelServices` 的 API key profile。启用账号池后，Codex 聊天账号选择器会出现 `Auto`。
- `shareBuiltinModels` 在 Codex 适配器配置页显示为“共享 Codex 内置模型”。启用后，Claude Code、Gemini、Grok、OpenCode、Kimi、Pi 与 Copilot 的模型选择器会出现一组 `codex 内置模型`。PM 仅在任务运行时注入内部 Chat Completions 路由与凭据，用户无需配置 Host、端口、协议或 Token，持久 `modelServices` 也不会改写。
- 共享模型的 Codex 来源账号由 Codex Auto 池选择；未启用账号池时使用默认账号。模型不会按账号重复展示。
- 聊天页右下角、Adapter 左侧的账号选择器始终控制当前 Adapter 自己的账号。比如 Claude Code 选择共享 Codex 模型时，这里仍显示和选择 Claude Code 账号；它不是 Codex 来源账号选择器。
- `Auto` 仅在创建新会话时按 `priority` 从高到低选择健康账号。会话产生首个 assistant、tool 或交互结果后就固定账号；resume 也继续使用原账号。
- 只有首个结果提交前遇到可识别的登录、套餐、限流或暂时性服务错误，stream 会话才会尝试下一个账号。失败账号按模型进入 cooldown；凭据更新后旧 cooldown 自动失效。显式选择账号和 direct mode 不自动 failover。
- 其他 Adapter 的内部模型路由采用 Responses 星型结构：Chat 入站先规范化为 Responses，官方 `codex app-server` 使用调用方注册的 dynamic tools 运行，输出再还原为 Chat；工具仍由调用方 Adapter 执行。实现借鉴 CLIProxyAPI 的请求级状态、call-id 和首个可见结果前账号切换，但不复制其私有 ChatGPT endpoint、OAuth client identity 或客户端伪装。
- 内部路由不会导出 `auth.json`、access token，也不会把账号复制成持久 `modelServices`。路由只绑定当前 PM 的 loopback capability，不能作为公网 API 网关。

## 官方 Codex 客户端接入

- `shareBuiltinModels` 同时启用官方客户端桥接：manager 在现有 PM 服务端口的 `/api/adapters/codex/app-server` 提供 app-server WebSocket。受管理的 Codex CLI / app-server 兼容客户端会自动发现地址。
- 本机官方 CLI 连接没有浏览器 Origin，可复用 PM 的 loopback 边界而无需独立 Token；任何带 Origin 的浏览器连接和非本机连接都必须通过 PM 登录认证。
- 本机可以运行 `oneworks adapter connect codex`；需要固定账号时加 `--account <账号 key>`，省略时使用默认账号。manager 环境直接使用当前 PM；workspace 内置终端会忽略 workspace 服务地址并发现 manager；外部 shell 从运行实例文件发现桌面端动态端口。找不到存活 manager 时会明确报错，不会猜测固定端口。
- 远程 PM 的 bearer token 通过 `ONEWORKS_CODEX_REMOTE_AUTH_TOKEN` 传给官方 CLI 的 `--remote-auth-token-env`，不会写入 URL 或命令参数。
- 原始 RPC 连接不会中途换账号：未指定账号时固定默认账号，显式指定时固定该物理账号。
- 官方目前仍将 app-server WebSocket transport 标记为实验能力。建议仅用于本机或受管理网络；非本机部署必须同时使用 TLS 和 PM 登录认证。详见 [Codex app-server 文档](https://learn.chatgpt.com/docs/app-server)。

## 模型、运行时与导入

- 空项目没有 `adapters` 配置时，运行时默认使用 `codex`，不会为了启动会话主动写入 `.oo.config.json`。
- 如果本机存在 `~/.codex/auth.json`，Codex 适配器会将其作为只读 fallback 账号展示和使用，不自动复制或删除。
- Web 模型选择器依次使用 `CODEX_HOME` / `~/.codex/config.toml` 的 `model_catalog_json`、`models_cache.json` 和内置回退列表。
- Launcher / daemon manager 会按账号、启动参数和进程 / 网络 profile 跨 workspace 复用 Codex app-server；model provider、MCP、cwd、权限、workspace / session 元数据和 selected skills 按 thread 下发。manager ready 后后台预热最多 3 个默认或已配置账号；空闲进程默认保留 5 分钟，可用 `appServer.idleTimeoutMs` 调整。
- One Works managed hook 通过 manager 返回 owning workspace lease；callback capability 只进入 thread config，不进入共享 app-server 进程环境。thread 归属按 lease、thread ID 与 cwd 校验。
- direct mode 使用 session 隔离 HOME；没有 manager 的 standalone stream 保留 project-local fallback pool。manager-owned stream 使用机器共享的 profile HOME，但不会把 workspace skills / hooks 软链进去。
- `network.httpProxy`、`httpsProxy`、`allProxy`、`noProxy` 与 `caCertificate` 仅作用于 Codex adapter，同时覆盖原生 Codex 进程和 One Works provider 转发。本地转发地址始终加入 `NO_PROXY`；内联 CA 会写入权限为 `0600` 的 profile 私有文件。
- “设置 → 模型服务”底部的 Adapter 导入行可以读取用户级或可信 workspace 的 Codex `config.toml` provider。导入仅在点击按钮后执行，只新增目标 One Works source 中缺失的服务，不修改原 Codex 配置。
- “设置 → 环境”底部的 Adapter 导入行可以读取 workspace `.codex/environments` 下有界的普通 `*.toml` 文件。`setup` 映射为 `create`，`cleanup` 映射为 `destroy`；Codex `actions` 不等价于 One Works `start`，因此只报告为跳过。
- Web 配置页默认展示缓存的额度快照；`oneworks accounts show codex <account>` 会主动刷新账号详情和额度。

账号新增和重新登录会复用用户真实登录 shell、pnpm/Volta/local-bin，以及 Codex 或 ChatGPT 应用内置的官方 CLI，并显示准备、浏览器授权、凭据验证和保存阶段。完成后会刷新并打开账号详情，桌面端会在可用时恢复当前窗口。
