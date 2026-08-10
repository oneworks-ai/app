# Pi coding-agent 适配器

`pi` 适配器使用 Pi 的 JSONL RPC 模式承载持续会话。默认托管
`@earendil-works/pi-coding-agent@0.84.1`，运行环境需要 Node.js 22.19.0 或更高版本：

```yaml
adapters:
  pi:
    cli:
      source: managed
      version: 0.84.1
    telemetry: off
    disableVersionCheck: true

modelServices:
  team:
    apiBaseUrl: https://gateway.example.com/v1/responses
    apiKey: ${TEAM_API_KEY}
    models:
      - gpt-5.6-terra
    extra:
      pi:
        api: openai-responses
        input:
          - text
          - image
```

如果本机 Pi 已经完成登录或配置了 provider，可在发送区选择 `Pi`，并把模型保留为
`default`；One Works 会复用 Pi 的默认 provider/model，并把凭据播种到项目私有 profile。
可以先用 `pi --version` 确认本机版本，或运行 `oneworks adapter prepare pi` 提前准备托管版本。
两种方式都不会回写真实 profile 数据或 session 文件；仅当真实 `auth.json` 存在时，会短暂使用上游兼容的 `auth.json.lock` 读取一致快照。

使用 `model: team,gpt-5.6-terra` 选择上述服务时，One Works 会生成 session 私有的
Pi provider 配置。API key 和自定义 header 只通过环境变量注入，不会以明文写入
`models.json`。

运行时边界：

- One Works model service 使用会话隔离的 `PI_CODING_AGENT_DIR`；原生/default 模型使用项目私有的持久 Pi profile。用户已有的 `auth.json` 只会播种到该 profile，OAuth 刷新和并发锁都保留在项目私有目录；真实 Pi 登录变更或登出会同步，但 One Works 不会回写真实 profile 数据或 session 文件。只有读取现有真实 `auth.json` 时会短暂创建上游兼容的 `auth.json.lock`。同一项目的原生 Pi 会话有意共享该 profile，因此其中一次登录或刷新会对同项目的其他原生会话可见
- `inheritNativeSettings` 默认为 `true`，只复制模型默认值、compaction/retry 等经过嵌套字段校验的无执行能力设置，以及净化后的 auth/model 凭据；`packages`、`extensions`、`skills`、`prompts`、`themes`、`npmCommand`、shell 前缀、未知字段和 `auth.json`/`models.json` 中以 `!command` 表示的凭据/header 都不会继承。设为 `false` 可完全关闭原生 settings/models 继承
- Pi 的自动 skill、prompt template、theme、context file 和 extension 发现默认关闭；One Works 选中的 skill 会通过显式 `--skill` 路径加载
- Pi 当前没有稳定的内建 MCP 接口；选中的 MCP 会显示为 `skipped` 诊断，不会隐式安装第三方 extension
- `plan`、`acceptEdits`、普通询问、`dontAsk` 和 bypass 权限模式会映射到托管 permission extension；direct/serverless 启动时会从私有 permission mirror 原子领取 `allow_once` 并仅烘焙到该 Pi 进程，启动前崩溃最多丢失一次授权；`deny_once` 保持持久化并在恢复后继续保守拒绝。流式会话通过 One Works 的六档权限交互记录新的 scoped 决策；若已配置的 permission-check server 不可达，所有 Pi 工具都会安全阻断且不会读取 mirror。direct 终端会话则使用 Pi 原生的本次 Allow/Deny 提示
- `telemetry: off`、`disableVersionCheck: true` 和 `offline: true` 分别控制 Pi telemetry、版本检查和启动期网络访问
- 只有显式设置 `enableNativeExtensions: true` 时才会通过明确路径加载用户的全局 Pi extensions；项目 `.pi/extensions` 还要求同时设置 `projectTrust: always`，默认的 `projectTrust: never` 会保持项目自动发现关闭。extension 与本机代码拥有相同权限，启用前应先审阅。extension 自定义工具还必须显式列入 `tools.include`，未知工具统一经过写操作权限门禁

可以运行 `oneworks adapter prepare pi` 下载并校验托管 CLI。详细版本和覆盖方式见
[Adapter CLI 安装与版本](./adapter-cli.md)。
