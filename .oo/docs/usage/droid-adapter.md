# Factory Droid CLI 适配器

`droid` 适配器通过 Factory 官方 `stream-jsonrpc` 协议运行 Droid CLI。One Works 负责顶层任务、权限交互和 workspace 编排；Droid 负责原生推理、工具调用与会话状态。

## 配置示例

```yaml
adapters:
  droid:
    cli:
      source: managed
      version: 0.195.0
    effort: high
    disableBuiltinSkills: false
    configContent:
      general:
        theme: dark
```

`cli.source` 支持 `managed`、`system` 和 `path`。托管模式默认安装 `@factory/cli@0.195.0`；system/path 模式可复用已有 `droid`，但所有被选中的二进制都必须满足 `>=0.195.0 <0.196.0`，并通过运行时协议版本协商。

## 运行时行为

- One Works 使用 `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc`，并严格要求 Factory API `1.0.0` 与 protocol `1.151.0`。缺失或不兼容的版本、畸形 initialize/load 响应都会显式终止会话。
- 首次会话调用原生 `droid.initialize_session` 并缓存 Factory session id；后续会话调用 `droid.load_session`。load 失败不会静默创建替代会话。
- 增量文本、完整消息、工具调用/结果、用量、hook、子会话提示和 turn terminal 事件会映射到 One Works 事件，并按原生 id 去重。
- child 退出时先记录结果，并继续排空 stdout 直至管道关闭；有界 fallback 会防止异常 child 永久挂起。致命 outbound RPC 失败会单次终结 session。
- adapter diagnostics、peer RPC error、畸形 frame 上下文、stderr 与 close 日志在进入 runtime event、cache 或日志前统一脱敏注入的 Factory API key/token。
- system prompt、所选 rules/instructions、skills、MCP servers 和 permission mode 会按 Factory 原生会话参数或隔离 settings 投影。`low`、`medium`、`high`、`xhigh`、`max` effort 会作为原生 reasoning effort 传递；共享层的 `ultra` 不受支持，会在 Droid 启动前显式拒绝。
- hook plugins 映射到 Factory 原生 hook 事件；通用 hook bridge 会抑制对应重复事件。

每个 One Works session 使用稳定的隔离 `HOME`、XDG config/cache/data、`.factory` 与进程工作目录。workspace 路径只作为原生 session `cwd` 传递；项目内 `.factory/mcp.json` 不会被隐式信任或加载。adapter 不读取或复制真实 Factory settings、credentials 或登录文件；只有显式提供的 `FACTORY_API_KEY` 和 `FACTORY_TOKEN` 可以跨入隔离环境。插件没有稳定的 session-scoped `stream-jsonrpc` 注入契约，因此会明确标记为 skipped，也不会安装到真实用户 HOME。

One Works 始终保留顶层 workspace/task 所有权。Droid Missions、原生 worktree 和额外 worker 编排不会由 adapter 启用。

Factory 协议本身提供 `droid.fork_session`，但当前 One Works adapter session 契约没有原生 fork 操作。One Works 的消息 fork/branch 会继续创建顶层 One Works session，并通过 history seed 续接；adapter 不伪造 native fork，也不会因此创建 Droid worktree。

## 外部会话导入

配置页“外部会话”可以只读扫描 `~/.factory/sessions/**/*.jsonl`。导入器仅接受 Factory SDK 会话结构，保留 native session id、cwd、消息父链、工具结果和 worker/subsession 分类，并支持当前项目、全部项目、`projectPaths` 与重复导入去重。

导入会拒绝畸形、超限、越界或 symlink 文件/来源根目录。它不会读取相邻 settings 文件或 Factory credentials，也不会修改原始 JSONL。

## 认证与限制

请在启动 One Works 前通过安全的环境注入提供 `FACTORY_API_KEY` 或 `FACTORY_TOKEN`。adapter 不代理交互式登录，也不会把真实 `~/.factory` 凭据复制进 session HOME。

当前模型列表只暴露 Factory 的原生 default 选择；指定原生 model id 时会直接交给 Droid。Factory native plugins 因协议缺少 session-scoped 注入而保持 unsupported/skipped。

更多 CLI 行为见 [Factory Droid Exec 文档](https://docs.factory.ai/cli/droid-exec/overview) 和 [适配器 CLI 安装与版本](./adapter-cli.md)。
