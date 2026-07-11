# 启动服务

## 启动 Web UI

推荐直接在项目根目录执行：

```bash
npx oneworks web
```

默认会：

- 自动解析当前 workspace 根目录
- 启动一个内置 server
- 托管内置 Web UI
- 输出一个前端访问地址，默认是 `http://127.0.0.1:8787/ui/`

常用参数：

```bash
npx oneworks web --workspace /path/to/project --config-dir /path/to/project/infra
```

## 启动 headless server

如果你要让独立 PWA、静态站点或其他 app 连接当前项目，执行：

```bash
npx oneworks server
```

默认只暴露控制面服务，不挂载 Web UI。常用参数：

```bash
npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors
```

独立 PWA 或静态站点通常和后端不同源；如果 server 只给本机 tunnel 或反向代理使用，直接启动时加上 `--allow-cors` 即可：

```bash
npx oneworks server --allow-cors
```

## 从源码开发态启动 UI server / client

这一节只用于 One Works 仓库自身的前端开发，不推荐作为项目接入方式。项目侧优先使用：

```bash
npx oneworks web
```

如果你正在 One Works 源码仓根目录开发 UI，并且已经完成 `pnpm install`，可以执行：

```bash
pnpm --silent tools dev-service ensure web --json
```

统一入口会自动把 server DB、runtime store、mock home、cache 和启动日志放到当前开发实例的 project home（默认 `~/.oneworks/dev-instances/<worktree-key>/projects/<project-key>`），避免写回仓库工作区，也避免多个源码 worktree 并行开发时共享同一套本地状态。

如果目标是快速把当前源码 worktree 更新到最新并启动开发服务，执行：

```bash
pnpm --silent tools dev-service ensure <target> --json
```

target 包括 `web`、`daemon`、`electron`、`electron-workspace`、`pwa`、`homepage`、`docs`、`relay`、`desktop-control`、`android-emulator`。启动器会通过 `scripts/run-tools.mjs` 注册 TS，缺少 register 依赖时先执行 `pnpm install`，并负责安全拉取、按需校验 workspace 安装、后台启动、操作租约、端口避让和探活输出。

说明：

- Web 开发态默认使用 server `8787`、client `5173`；默认端口被其他 worktree 占用时，启动器会选择下一个可用端口。显式设置 `__ONEWORKS_PROJECT_SERVER_PORT__` 或 `__ONEWORKS_PROJECT_CLIENT_PORT__` 时，如果端口被占用则直接报错。
- `oneworks-client` 的 `dev` 模式依赖本地源码和 workspace 安装，不再作为 npm 发布包的通用运行方式。
- 非 `dev` 模式下，`@oneworks/client` 会直接托管已构建的 `dist`，不再依赖 `vite preview`。

## 说明

- `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` 指向你的项目根目录。
- 如果没有显式设置 `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__`，`@oneworks/web`、`@oneworks/server`、`oneworks-server` 和 `oneworks-client` 都会从当前目录向上探测 `.oo`、`.oo.config.*`、`pnpm-workspace.yaml` 或 Git 根目录，并自动把项目根目录作为 workspace。
- 项目配置默认也会跟随这个解析后的 workspace 根目录读取；如果需要单独改配置目录，可以显式设置 `__ONEWORKS_PROJECT_CONFIG_DIR__`。
- `__ONEWORKS_PROJECT_BASE_DIR__` 可选；默认是 `.oo`，也可以设成 `.oneworks` 或 `.oo` 之类的嵌套目录。
- `__ONEWORKS_PROJECT_CACHE_DIR__` 可选；用于覆盖项目级共享 cache 目录。没有显式设置时，One Works 会把 adapter CLI、skill dependency 等可复用资源放到 home 下的 project-scoped 目录：`~/.oneworks/projects/<project-key>/caches`。
- 未显式设置 `DB_PATH` 或 project path 覆盖时，Server 的 SQLite 会话数据库默认写入 `~/.oneworks/projects/<project-key>/.local/server/db.sqlite`；runtime store 默认写入 `~/.oneworks/projects/<project-key>/runtime`。同一 Git 项目的多个 worktree 默认共享同一个 project key；不同项目互不共享，也不会把运行产物写回用户本地仓库。
- worktree 场景下，项目级共享 cache、server 数据库、mock home、日志和 runtime store 会优先跟随 `__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__` 对应的 project home；没有这个环境变量时，会通过 Git worktree 的 common dir 反查主工作树。
- `__ONEWORKS_PROJECT_ENTITIES_DIR__` 可选；默认是 `entities`，会基于 AI 基目录继续解析。

## Adapter CLI 安装与版本

各 adapter 原生 CLI 的托管安装、版本固定、预热与环境变量覆盖见 [Adapter CLI 安装与版本](./adapter-cli.md)。

## Web 登录保护与运行时映射

- Web UI 在 server 绑定到 `localhost`、`127.*`、`::1` 时默认不启用登录保护；绑定到 `0.0.0.0`、局域网 IP 或域名时默认启用。可以在项目配置中设置多个账号：

```yaml
webAuth:
  enabled: true
  rememberDeviceTtlDays: 30
  accounts:
    - username: alice
      password: change-me
    - username: bob
      password: change-me-too
```

- 如果没有配置 `webAuth.accounts` 或 `webAuth.password`，server 会在数据目录生成 `web-auth-password`，默认账号是 `admin`。默认数据目录是 `<project-home>/server/data/`，不会写入工作区。
- 临时关闭登录保护：

```yaml
webAuth:
  enabled: false
```

- `HOME` 可用于隔离运行环境，默认落到 project home 的 `.mock` 子目录。启动入口会把真实 home 里的常见 dot 目录和 macOS `Library/Keychains`、`Library/Application Support` 桥接进 mock home；直接软链路径如果已有旧文件或目录，会先移动到同级 `.backup-*` 再创建正确软链。
- `modelServices` 是共享层配置；各 adapter 会按自己的原生运行时做映射，具体以对应 adapter 文档为准。
  - `claude-code` 对 Anthropic、Kimi、DeepSeek、百炼/Qwen、智谱 GLM、MiniMax、OpenRouter、Requesty、Vercel AI Gateway、Portkey 等已知 Anthropic-compatible 官方入口优先直连；其它 OpenAI-compatible `service,model` 继续回退 Claude Code Router
  - `codex` 与 `gemini` 走 adapter 自己的本地代理
  - 部分 adapter 会把 provider 配置写进 session 级或原生配置文件
- Coding Plan / Token Plan 指服务商的计费套餐，不是 agent Plan Mode。选择这类服务时优先使用专属 provider id，例如 `qwen-coding-plan`、`zhipu-coding-plan`、`minimax-token-plan`、`kimi-code`、`tencent-tokenhub-coding-plan`、`volcengine-ark-coding-plan`、`baidu-qianfan-coding-plan`；不要把套餐 key 和普通 API key、套餐 base URL 和普通 API base URL 混用。
- 套餐模型列表默认来自内置目录，不假设 `/v1/models` 可用。只有想固定 allowlist 时才写 `models`：

```yaml
modelServices:
  qwen-coding:
    provider: qwen-coding-plan
    apiKey: ${ALIYUN_CODING_PLAN_KEY}

  minimax-token:
    provider: minimax-token-plan
    apiKey: ${MINIMAX_SUBSCRIPTION_KEY}
```

- 未选择 routed `service,model` 时，adapter 继续使用自己的原生模型/二进制路径。

## 默认内建 MCP

- `oneworks` 与 server session 默认都会加载内建 `OneWorks` MCP server。
- 单次关闭：`oneworks --no-default-oneworks-mcp-server "..."`
- 全局关闭：

```yaml
noDefaultOneWorksMcpServer: true
```
