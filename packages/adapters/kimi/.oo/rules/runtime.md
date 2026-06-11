# Kimi Runtime

## Session 布局

Kimi adapter 不直接写真实 `~/.kimi`。每个 session 使用独立 share dir：

```text
<project-home>/caches/<ctxId>/<sessionId>/adapter-kimi/share
```

运行时会设置：

- `KIMI_SHARE_DIR` 指向 session share dir
- `KIMI_CLI_NO_AUTO_UPDATE=1`
- `__ONEWORKS_KIMI_TASK_SESSION_ID__`
- `__ONEWORKS_KIMI_HOOK_RUNTIME__`
- `__ONEWORKS_KIMI_HOOK_MODEL__`

如果真实 Kimi home 有 `credentials`，会软链到 session share dir；如果存在 `config.toml` 或 `config.json`，且本次没有生成新的 model config，会复制一份到 session share dir 再合并托管 hooks。

## Wire 模式

默认 stream runtime 使用 Wire JSON-RPC over stdio。稳定命令形态：

```bash
kimi \
  --work-dir "$PWD" \
  --config-file "<project-home>/caches/.../adapter-kimi/share/config.json" \
  --mcp-config-file "<project-home>/caches/.../adapter-kimi/share/mcp.json" \
  --skills-dir "<project-home>/caches/.../adapter-kimi/skills" \
  --wire
```

维护要点：

- Wire 是长连接；adapter 启动后先发 `initialize`，再用 `prompt` 开启轮次、运行中用 `steer` 注入用户补充、用 `cancel` 中止当前轮次。
- stdout 是 JSON-RPC JSONL，由 [src/runtime/wire-rpc.ts](../../src/runtime/wire-rpc.ts) 分发到 [src/runtime/wire-messages.ts](../../src/runtime/wire-messages.ts) 转成 One Works `ChatMessage` / `interaction_request`。
- Kimi 的 `ToolCall.function.arguments` 可能为空，Shell 等工具的可展示参数通常在后续 `ApprovalRequest.display`；adapter 需要先暂存 `ToolCall`，再用 approval display 反填 `tool_use.input`，没有 approval 时在 `ToolResult` 前补发原始 tool use。
- approval display 反填不能覆盖 Wire arguments；两边都是对象时要合并。已知 `DisplayBlock` 要结构化处理：`shell` -> `command/language`，`diff` -> `path/diffs`，`todo` -> `items`，`background_task` -> `task_id/kind/status/description`，未知 block 保留在 `display`。
- resume 只在 session share dir 下存在 `sessions` 时给 Wire 进程加 `--continue`。
- session share dir 根目录会写 `.oneworks-session.json` provenance，只保存 hash 和非敏感摘要。跨 ctx 恢复旧 `sessions` 时优先要求 provenance fingerprint 匹配；没有 provenance 的历史目录只在唯一候选时兼容迁移，多个候选不要按 mtime 猜。
- `--continue` 与 `--session`/`--resume` 互斥，当前 adapter 没有主动指定 Kimi session id。
- `permissionMode: plan` 通过 `--plan` 启动，并在 `initialize.capabilities.supports_plan_mode` 声明客户端支持 plan mode。
- `permissionMode: bypassPermissions` 才加 `--yolo`；`dontAsk` 不加 yolo，而是在 Wire approval request 层自动 approve。
- 默认 permission mode 下，adapter 还会读取 merged config 里的 `permissions.allow/deny/ask` 做本地短路；用户在当前会话里选择 `allow_session` / `allow_project` / `deny_session` / `deny_project` 后，也会在 Kimi session 内记住相同 subject 的后续决策。
- 未识别的 Wire request 不能只记日志，必须回 JSON-RPC error，避免 Kimi CLI 卡在等待响应的状态。
- stream/direct session 都接入 `createStartupProfiler`；维护启动慢问题时打开 `ONEWORKS_STARTUP_PROFILE=1` 看 `kimi.session.*` / `kimi.direct.*` mark。

## Direct 模式

[src/runtime/direct.ts](../../src/runtime/direct.ts) 只负责把交互式 Kimi 交给终端：

- `stdio: inherit`
- 支持 `--yolo`、`--plan`、`--continue`
- 不解析 stdout 事件

## 安装策略

Kimi CLI 定位优先级：

1. `adapters.kimi.cli.path` 或 `__ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_PATH__`
2. 全局 bootstrap uv cache：`~/.oneworks/bootstrap/uv/<package-version>/python-<version>/bin/kimi`
3. 旧 primary workspace 共享托管 binary：`<project-home>/caches/adapter-kimi/cli/bin/kimi`，全局缺失时先移动到全局；无法移动时才兼容 fallback
4. `source=system` 时只检查系统 `PATH` 里的 `kimi`
5. `autoInstall !== false` 且 `uv` 可用时，执行 `uv tool install --python 3.13 kimi-cli`
6. 系统 `PATH` 里的 `kimi`（默认兜底；`source=managed` 时不启用）

用户可通过 `adapters.kimi.cli` 固定版本和安装器：

```yaml
adapters:
  kimi:
    cli:
      source: managed
      package: kimi-cli
      version: 1.36.0
      python: "3.13"
      uvPath: uv
```

旧字段 `autoInstall`、`installPackage`、`installPython`、`uvPath` 继续兼容；新配置优先用 `cli.*`。环境变量覆盖包括：

- `__ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_SOURCE__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_PATH__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_AUTO_INSTALL__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PACKAGE__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_VERSION__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PYTHON__`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_UV_PATH__`

官方安装脚本适合提示用户手动执行：

```bash
curl -LsSf https://code.kimi.com/install.sh | bash
```

adapter 内部不直接执行官方脚本，因为它会修改用户级环境和 PATH。自动安装必须保持在全局 bootstrap uv cache 下，避免污染真实 home 或项目 `.oo/caches`。

worktree 场景下，新 CLI 安装统一进入全局 bootstrap uv cache；旧 primary workspace cache 若存在会先移动到全局。session share dir 留在当前 workspace project home 的 `<project-home>/caches/<ctxId>/<sessionId>/adapter-kimi/share`，不要和 CLI cache 混用。

没有 `kimi` 或 `uv` 时，错误信息要继续包含：

- 官方 Kimi installer，macOS/Linux 与 Windows PowerShell 两种命令
- uv installer、Homebrew `brew install uv`
- 手动 `uv tool install --python <version> kimi-cli`
- `__ONEWORKS_PROJECT_ADAPTER_KIMI_CLI_PATH=/absolute/path/to/kimi`
