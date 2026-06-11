---
alwaysApply: false
description: 当任务涉及 Kimi adapter runtime、Kimi CLI 安装、modelServices 转换、native hooks、client 图标或真实 Kimi CLI 验证时加载。
---

# Kimi Adapter

本文件是 Kimi adapter 维护入口页；运行时、模型服务、hooks/assets 和验证细节拆到同目录下的细分文件。

## 先读这些

- [运行时与安装](./runtime.md)
- [modelServices 转换](./model-services.md)
- [hooks 与 assets](./hooks-and-assets.md)
- [验证与官方资料](./verification.md)

## 关联规则

- 根规则：[.oo/rules/ADAPTERS.md](../../../../../.oo/rules/ADAPTERS.md)
- 根规则：[.oo/rules/HOOKS.md](../../../../../.oo/rules/HOOKS.md)
- 根规则：[.oo/rules/HOOKS-REFERENCE.md](../../../../../.oo/rules/HOOKS-REFERENCE.md)
- [packages/workspace-assets/AGENTS.md](../../../../../packages/workspace-assets/AGENTS.md)
- [packages/task/AGENTS.md](../../../../../packages/task/AGENTS.md)
- [apps/cli/src/AGENTS.md](../../../../../apps/cli/src/AGENTS.md)

## 核心边界

1. Kimi 默认 stream runtime 走 `--wire`，用 JSON-RPC 长连接驱动 `initialize` / `prompt` / `steer` / `cancel`，不要再回退到每轮一个 `--print --prompt` 进程。
2. adapter 自动安装只用 `uv tool install` 写入全局 bootstrap uv cache，旧 `<project-home>/caches/adapter-kimi/cli` 会迁移到全局 cache；不在 init 中执行官方 `install.sh`。
3. 权限优先走 Wire `ApprovalRequest`；`dontAsk` / `bypassPermissions` 自动 approve，`acceptEdits` 只自动接受编辑类工具；默认模式下还要读取 merged `permissions` 做本地 allow/deny 短路，并记住当前会话里的 session/project 决策。
4. `ToolCall.function.arguments` 可能为空，`ApprovalRequest.display` 要参与反填 `tool_use.input`；display 反解结果要和原始 arguments 合并，不能丢掉已有参数。
5. Kimi resume 会用 `.oneworks-session.json` provenance 限制跨 ctx 迁移，避免同 sessionId 但配置/模型不同的旧 `sessions` 被误恢复。
6. `showThinkingStream` 已在配置类型中声明，但 runtime 尚未映射到 Kimi config 的 `show_thinking_stream`。
7. client 展示图标必须来自官方 KIMI Brand Guidelines。

## 相关记录

- [PR #102](https://github.com/oneworks-ai/app/pull/102) 是 Kimi adapter 的实现与评审记录。
