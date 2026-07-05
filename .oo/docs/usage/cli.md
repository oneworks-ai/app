# CLI 与示例

## 常用命令

全局安装后可以直接使用 `oneworks`；不安装到项目依赖时，用 `npx -p <package> <bin>` 临时运行对应命令。

如果你更想先拿到一个统一入口，再按命令懒安装对应 runtime，也可以使用 bootstrap：

- `npx oneworks "读取 README 并总结"`
- `npx oneworks web`
- `npx oneworks server`
- `npx oneworks app`
- `npx oneworks app cache`
- `npx oneworks app --no-cache`

其中 `bootstrap app` 会把当前 shell 所在目录传给桌面应用：

- 同一个目录只会保留一个本机 service，重复执行时会聚焦已有项目窗口
- 切到另一个项目目录再执行时，已运行的桌面应用会为新目录启动独立 service，并打开新的项目窗口
- 如果你不是从项目目录启动桌面应用，而是直接双击安装包，桌面端会先要求选择最近项目或手动打开目录

- `oneworks --help`
- `npx -y -p @oneworks/cli oneworks --help`
- `npx -y -p @oneworks/mcp oneworks-mcp --help`
- `oneworks`：执行一次任务
- `oneworks --resume <sessionId>`：恢复已有 CLI 会话；已解析 adapter 和大部分启动参数仍从 `<project-home>/caches/` 对应会话读取，但可以额外覆盖 `--permission-mode` / `--yolo`、`--model`、`--effort`、`--include-tool`、`--exclude-tool`
- `oneworks-mcp`：启动独立 MCP stdio server
- `oneworks-call-hook`：从标准输入读取 hook payload 并执行 hooks runtime
- `oneworks list` / `oneworks ls`：以 compact 视图列出历史任务缓存
- `oneworks list --view default|full`：展示常用列或上下文、PID 与辅助命令列
- `oneworks list --running`：只看当前仍在运行的 CLI 会话
- `oneworks clear`：清理本地日志与缓存
- `oneworks stop <sessionId>`：优雅停止正在运行的 CLI 会话
- `oneworks kill <sessionId>`：强制终止正在运行的 CLI 会话
- `oneworks config list [path]`：查看配置 section 状态，或读取某个配置子树
- `oneworks config get [path]`：读取配置值
- `oneworks config set [path] [value]`：写入配置值
- `oneworks config unset [path]`：删除配置值
- `oneworks login [-s cf|vercel|<url>]`：登录 One Works Relay 账号，默认使用托管 Cloudflare 服务
- `oneworks users [-s cf|vercel|<url>]`：列出本机保存的 Relay 登录账号
- `oneworks users enable [user]` / `oneworks users disable [user]`：启用或停用某个 Relay 账号
- `oneworks logout [user]`：删除本机保存的 Relay 登录态
- `oneworks accounts add <adapter> [accountName]`：触发 adapter 原生登录流程，并把返回的凭据快照保存到 `<project-home>/.local/adapters/<adapter>/accounts/<key>/`
- `oneworks accounts show <adapter> <accountName>`：查看某个 adapter 账号的详情和最新额度摘要（CLI 当前会强制刷新）
- `oneworks accounts remove <adapter> <accountName>`：删除某个 adapter 账号在当前 workspace 下保存的凭据快照

这些命令默认以项目根目录作为 workspace。

- 如果显式设置了 `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__`，会直接使用该目录。
- 如果没有设置，`oneworks` / `oneworks-mcp` / `oneworks-call-hook` / `oneworks-web` / `oneworks-server` / `oneworks-client` 会从当前目录向上探测 `.oo`、`.oo.config.*`、`pnpm-workspace.yaml` 或 Git 根目录，因此可以在项目任意子目录下启动。
- 配置文件默认会跟随这个解析后的 workspace 根目录读取；如果需要把 `.oo.config.*` 放到别的目录，可以显式设置 `__ONEWORKS_PROJECT_CONFIG_DIR__`。

## 内建 Skills

`@oneworks/cli` 会默认注入 companion 插件 `@oneworks/plugin-cli-skills`，可直接通过 `--include-skill` 使用：

- `oneworks-cli-quickstart`：介绍 `oneworks`、`oneworks list`、`oneworks --resume`、`oneworks stop`、`oneworks kill`，以及 `oneworks config list|get|set|unset` 的基本用法和输出语义。
- `oneworks-cli-print-mode`：介绍 `--print`、`--input-format`、权限请求、继续会话和 `submit_input` 的写法。
- `oneworks-model-services`：说明模型服务商配置、内置 provider id、默认 API 地址、服务商后台入口、模型/余额/状态能力和安全写回规则。
- `create-entity`：按用户需求创建新的 One Works entity。
- `update-entity`：按用户需求更新已有 One Works entity。
- `create-plugin`：理解用户想要的 plugin 效果；需求不明确时先列出不确定点让用户确认，再转成 One Works plugin manifest、前端入口、server 入口和验证步骤。

```bash
oneworks --include-skill oneworks-cli-quickstart "介绍一下 oneworks CLI 怎么恢复一个会话"
oneworks --include-skill oneworks-cli-print-mode --print "告诉我 print 模式怎么处理权限请求"
oneworks --include-skill oneworks-model-services "帮我配置 DeepSeek 官方模型服务"
oneworks --include-skill create-plugin "做一个插件，给 chat header 加一个截图按钮"
```

## 参考示例

### 启动 UI

```bash
npx oneworks web
```

如果你在 One Works 源码仓里开发前端，再分别启动本地 server / client：

```bash
npx -y -p @oneworks/server oneworks-server --allow-cors
npx oneworks-client
```

### 从项目目录打开桌面应用

```bash
cd ~/work/project-a && npx oneworks app
cd ~/work/project-b && npx oneworks app
```

### 启动独立 MCP

```bash
npx -y -p @oneworks/mcp oneworks-mcp --include-category general,task
```

### 调试 hooks runtime

```bash
printf '%s\n' '{"hookEventName":"Notification","cwd":"'"$PWD"'","sessionId":"debug-hook"}' | npx -y -p @oneworks/hooks oneworks-call-hook
```

### 执行一次任务

```bash
oneworks -A codex --print "读取 README 并给出一个三步改进建议"
oneworks -A claude "读取 README 并给出一个三步改进建议"
oneworks --workspace billing "修复订单状态回滚问题"
```

`adapter` 参数支持 `-A` 短写，也接受常见简化值，例如 `claude`、`adapter-codex`。

脚本消费 `--print` 输出时，可以加 `--print-idle-timeout <seconds>` 作为兜底；如果超过指定秒数没有任何 adapter 事件，CLI 会以非 0 退出。

### 指定 workspace

大型仓库可在 `.oo.config.json` 声明 `workspaces`。指定 `--workspace <id>` 后，任务会在对应 workspace 目录下启动，并使用该目录自己的配置与数据资产。

```bash
oneworks --workspace billing "修复订单状态回滚问题"
```

更多配置见 [Workspace 调度](./workspaces.md)。

### 权限模式默认值

`--permission-mode <mode>` 会覆盖本次启动的权限模式。未传该参数，或 Web UI 仍处于“默认”模式时，会读取配置里的 `permissions.defaultMode`，例如 `"bypassPermissions"`。

`--yolo` 是 `--permission-mode bypassPermissions` 的短写，可用于新会话和恢复会话。

### 恢复会话

```bash
oneworks list
oneworks list --view default
oneworks list --view full
oneworks --resume <sessionId>
oneworks --resume <sessionId> --permission-mode bypassPermissions
oneworks --resume <sessionId> --yolo
oneworks --resume <sessionId> --effort high --include-tool read_file
```

- `--resume` 会继续使用缓存里的 adapter、model、workspace 等启动参数。
- 如果只想调整下一次恢复时的权限模式，可以单独传 `--permission-mode <mode>`，或用 `--yolo` 切到 `bypassPermissions`；新的模式会用于本次恢复，并写回该会话的 CLI cache，后续继续 `resume` 时沿用。

### 读取配置

```bash
oneworks config list
oneworks config get general.defaultModel
oneworks config get models
oneworks config get modelServices.gpt-responses.models
```

- `oneworks config list` / `oneworks config get` 默认读取 merged config；显式传 `--source global|project|user|merged|all` 可以切换读取来源，其中 `global` / `project` / `user` 展示对应文件里的原始配置，`merged` 展示最终生效配置，`all` 只用于 `list`。
- `oneworks config set` / `oneworks config unset` 默认写入项目配置；显式传 `--source global|project|user` 可以选择写入全局、项目或本地配置。
- 文本模式默认输出 YAML，适合直接阅读；`--json` 保留结构化原始结果，适合脚本消费。
- `oneworks config get models` 和 `oneworks config list models` 在文本模式下会按 `modelServices` 展开成 `service -> models` 视图，并把 `models` 里的 metadata 合进去，避免把稀疏 metadata map 误看成完整模型列表。
- 如果需要看原始 `models` metadata 结构，使用 `--json`。

### 调试启动耗时

平时不需要打开。排查启动慢时，可以在项目 `.oo.dev.config.json` 里临时加：

```json
{
  "diagnostics": {
    "startupProfile": {
      "enabled": true,
      "log": true,
      "thresholdMs": 10
    }
  }
}
```

也可以用环境变量临时开启：

```bash
ONEWORKS_STARTUP_PROFILE=1 ONEWORKS_STARTUP_PROFILE_CONSOLE=1 oneworks "hi"
```

日志会写入当前 workspace 的 project home：`<project-home>/logs/<ctx>/startup/`。`__ONEWORKS_PROJECT_BASE_DIR__` 只影响 rules / skills / plugins 等项目资产目录，不影响 logs / caches / mock home 这类运行态目录。

### 管理 Relay 登录账号

```bash
oneworks login
oneworks login -s vercel
oneworks users
oneworks users enable alice
oneworks users disable --account oneworks-cloudflare:user-1
oneworks logout -s cf alice
```

`login`、`logout`、`users` 是官方 Relay 能力提供的顶层命令。`-s, --server` 默认是 `cf`，也支持 `cloudflare`、`vercel` / `vc`、服务 id，或 `https://relay.example.com` 这样的完整 URL。登录凭据保存在本机 `~/.oneworks/auth.json`。

如果某个 server 下只有一个账号，`users enable`、`users disable`、`logout` 可以不传用户；如果有多个匹配账号，交互终端会让你选择。脚本或 AI 工具应使用 `--json` 获取结构化输出，并用 `--account serverId:userId` 精确指定账号，避免不同 server 上同名用户被误操作。`--input <json>` 和 `--stdin` 可以把 JSON payload 合并到命令请求里。
