# Task 包说明

`@oneworks/task` 承载任务执行 runtime。

## 什么时候先看这里

- `ow run` 或 server session 的主流程异常
- adapter query options、workspace assets、skills / rules / entities / specs prompt 生成不对
- 被 MCP task 工具复用的任务执行行为异常
- 想确认任务运行时和 `types` / `workspace-assets` / `hooks` / `mcp` 的职责边界

## 入口

- `src/run.ts`
  - 任务主运行入口
  - 负责 session 生命周期编排、adapter 执行与 native/bridge 去重
  - `base.json` 写入前的 adapter-specific clone policy 也在这里编排；Junie policy 使用 `@oneworks/adapter-junie/auth-env` 的权威认证键分类，并以有效 `resolveAdapterRuntimeTarget` identity 派生所有 Junie 自定义实例键，不依赖当前选中 adapter 清洗它们的全部共享配置视图
- `src/prepare.ts`
  - 运行前装配
  - 负责 config、logger、workspace assets、默认内建 MCP 与 runtime 输入归并
- `src/generate-adapter-query-options.ts`
  - 负责把 CLI / server 输入转换成 adapter query options
- `__tests__/run.spec.ts`
- `__tests__/generate-adapter-query-options.spec.ts`

## 边界约定

- `@oneworks/task` 负责任务执行，不负责 CLI 命令注册
- `@oneworks/task` 直接依赖 `@oneworks/types`、`@oneworks/workspace-assets`、`@oneworks/hooks`、`@oneworks/config`、`@oneworks/utils`；内建 Junie 的持久化边界只通过 `@oneworks/adapter-junie/auth-env` 子路径共享分类契约，不加载 adapter runtime
- app-facing task 入口通过 `@oneworks/app-runtime` 暴露
- 默认 system prompt 的开关解析与合并策略、默认内建 MCP 解析位于 `@oneworks/config`
- definition loader 位于 `@oneworks/definition-loader`
- cache 位于 `@oneworks/utils`
- hooks runtime 仍在 `@oneworks/hooks`
- MCP stdio server 仍在 `@oneworks/mcp`
