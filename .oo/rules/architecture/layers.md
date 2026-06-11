# 架构分层

返回入口：[ARCHITECTURE.md](../ARCHITECTURE.md)

## 应用层

- `apps/cli`：主 CLI，负责编排 `ow run`、`ow list`、`ow clear`、`ow stop`、`ow kill`、`ow benchmark`、`ow agent`。
- `apps/server`：UI server / session runtime，负责 HTTP / WebSocket 接口、会话启动、通知与配置写回。
- `apps/client`：Web UI，复用共享契约，不直接触达 benchmark runtime 或文件系统。

## 入口与运行时层

- `packages/cli-helper`：CLI loader，负责 `NODE_OPTIONS`、`@oneworks/register/preload` 和退出码透传。
- `packages/app-runtime`：对 `apps/*` 暴露 task / benchmark 入口，并携带默认非 task `OneWorks` MCP 锚点。
- `packages/task`：任务执行层，负责 `prepare()`、`run()` 与 adapter query options。
- `packages/runtime-protocol`：agent runtime 的命令、事件、状态、metadata schema 与协议版本兼容判断。
- `packages/runtime-store`：agent runtime 的本地 JSONL store、锁、索引、tail/replay 与快照读写。
- `packages/task-runtime`：消费 runtime command、驱动 adapter run/resume/stop、写 runtime event 的 task runtime engine。
- `packages/managed-plugins`：adapter-native 插件的 source 获取、安装、更新与启动前同步。
- `packages/mcp`：独立 MCP stdio server，暴露 `oneworks-mcp` / `oneworks-mcp`，不承担 task runtime 入口。
- `packages/hooks`：独立 hooks runtime，暴露 `oneworks-call-hook`。
- `packages/benchmark`：benchmark 发现、workspace 准备、执行和结果读写。

## 共享与支撑层

- `packages/types`：`Config`、adapter contract / loader、task <-> mcp binding、session / ws 类型。
- `packages/core`：schema、channel DSL、env、ws 类型和统一导出。
- `packages/config`：全局 `~/.oneworks/.oo.config.json`、workspace `.oo.config.*` / `.oo.dev.config.*` 查找、变量替换、缓存重置、配置写回；分层语义见 [配置分层设计](../CONFIG.md)。
- `packages/utils`：logger、log level、字符串 key 转换、uuid、cache、message text 提取，以及托管插件安装记录的低层读写。
- `packages/definition-core`：definition 名称 / 标识 / 摘要语义、rule `always` 兼容、remote rule reference 投影。
- `packages/definition-loader`：rules / skills / specs / entities 发现、读取与解析。
- `packages/workspace-assets`：workspace assets 发现、hook 插件资产投影、prompt asset 选择与 prompt 文本拼装。
- `packages/register`：运行前预加载辅助层。

## 扩展实现层

- `packages/channels/lark`：channel definition / connection。
- `packages/adapters/*`：`codex`、`claude-code`、`opencode` 等 adapter 实现。
- `packages/plugins/*`：`logger`、`chrome-devtools` 等 hook plugin 实现。

## 相关约束

- 新增跨包能力时，先下沉共享 contract，再迁移实现。
- 跨 package 只走公开导出，不扩散私有深路径。
- `apps/client` 不直接依赖运行逻辑包。
