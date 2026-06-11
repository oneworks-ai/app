# MCP 包说明

`@oneworks/mcp` 提供独立的 MCP stdio server，以及 `oneworks-mcp` / `oneworks-mcp` 二进制入口。

## 什么时候先看这里

- `oneworks-mcp` 启动失败
- MCP tool 注册、过滤、分类行为异常
- 非 task MCP tool 行为异常，例如 `AskUserQuestion`
- 想确认独立 MCP CLI 与 core / server 的依赖边界

## 入口

- `cli.js`
  - 独立 CLI 壳，补齐工作区环境并转交给共享 loader
- `src/cli.ts`
  - standalone `oneworks-mcp` commander 入口
- `src/command.ts`
  - MCP options / stdio server 启动逻辑
- `src/tools/*`
  - MCP tool 注册与实现

## 边界约定

- CLI loader 统一走 `@oneworks/cli-helper/loader`
- `@oneworks/mcp` 直接引用本包内需要的 hook / prompt 模块，不再通过额外 bindings 装配层传递上下文
- `task` domain 不在 MCP 暴露；子 agent 调度、消息、输入提交、停止与状态查看统一走 `ow agent ...` 和 runtime protocol/store
- MCP tool 实现集中在本包，且不保留 MCP 到 task runtime command 的转换层

## 相关文档

- [架构说明](../../.oo/rules/ARCHITECTURE.md)
- [文档边界约定](../../.oo/rules/USAGE.md)
- [CLI 维护说明](../../apps/cli/src/AGENTS.md)
