# AI 常见问题索引

本文收敛 AI agent 在本仓维护时反复遇到的问题、症状关键词和标准处理方式。遇到类似症状时，优先在本文件搜索关键词，再下钻到对应规则或日志。

## 索引

- [Subagent 启动 Web 服务超过 1 分钟](#subagent-启动-web-服务超过-1-分钟)
- [开发服务 ready 后仍继续验证](#开发服务-ready-后仍继续验证)
- [开发服务启动入口混用历史脚本](#开发服务启动入口混用历史脚本)

## Subagent 启动 Web 服务超过 1 分钟

症状关键词：`subagent 启动慢`、`取最新代码并启动 web 服务`、`拉取最新代码并启动一个 web 服务`、`dev-start web`、`读规则太多`、`worktree 初始化判断`。

标准处理：

- 命中“取最新代码并启动 web 服务”“拉取最新代码并启动一个 web 服务”“启动 web 服务”时，直接执行 `pnpm tools dev-start web`。
- 不要先读取 `.oo/rules/`。
- 不要先执行 `git rev-parse`、`git status`、`git log`、`git remote`、`git worktree list`。
- 不要手动检查 `node_modules`、`.oo.dev.config.json`、`.env`。
- 不要手动找端口、查进程或启动后台管理器。

原因：

`pnpm tools dev-start web` 已经封装了这些步骤：fetch、安全拉取 / 对齐、workspace install 校验、端口避让、后台进程和探活。agent 在命令前重复执行通用仓库初始化，会把 2-3 秒的热启动拖到 1 分钟以上。

完成条件：

- 命令退出码为 0。
- 输出包含 `[dev-start] ready`。
- 输出包含 `CLIENT_URL`、`SERVER_URL`、`SERVICE_PID`、`LOG_FILE`。

达到完成条件后立即回复这些值并停止。只有命令失败时，才读取输出里的 `LOG_FILE` 并继续排查。

## 开发服务 ready 后仍继续验证

症状关键词：`ready 后还 curl`、`ready 后 ps`、`读 dev-start-web.log`、`二次验证`。

标准处理：

- `dev-start` 已经在返回前完成探活；成功输出 `[dev-start] ready` 后，不要再跑 `ps`、`curl`、`git status`、`git log`、读 log 或列目录。
- 如果用户明确要求“再验证一下 URL”或命令输出不完整，才补充最小验证。

原因：

重复验证会让原本已经完成的启动任务变慢，并让 subagent 在简单启动请求里继续消耗上下文和工具调用。

## 开发服务启动入口混用历史脚本

症状关键词：`start.sh`、`screen`、`dev-start.mjs`、`手动找端口`、`历史入口`。

标准处理：

- 本仓开发服务统一入口是 `pnpm tools dev-start <target>`。
- Web：`pnpm tools dev-start web`。
- Electron launcher：`pnpm tools dev-start electron`。
- Electron 当前仓库 workspace：`pnpm tools dev-start electron-workspace`。
- PWA：`pnpm tools dev-start pwa`。
- Homepage preview：`pnpm tools dev-start homepage`。
- Docs：`pnpm tools dev-start docs`。

不要恢复根目录 `start.sh`，不要用 `screen` 管理本仓开发服务。需要查看启动器实现时，从 `scripts/cli.ts` 的 `dev-start` command 和 `scripts/dev-start.ts` 入口开始。
