# 示例目录

仓库根目录提供 [examples/](https://github.com/oneworks-ai/app/tree/main/examples) 作为用户演示与本地调试入口。每个子目录都代表一种明确场景，可以是单一的小场景，也可以逐步扩展成复杂 fixture。这些示例不会加入根 `pnpm-workspace.yaml`，目的是让它们保持“外部用户项目”的形态，避免影响本仓包发布、类型构建和测试扫描。

## 当前示例

- [task-board-demo](https://github.com/oneworks-ai/app/tree/main/examples/task-board-demo)：带 `.oo.config.json`、项目规则、启动预设和 run commands 的单项目任务面板场景，适合给用户演示。
- [source-debug-fixture](https://github.com/oneworks-ai/app/tree/main/examples/source-debug-fixture)：稳定的源码调试场景，适合检查配置加载、文件链接、启动预设、run commands 与 runtime 数据隔离。

## 使用发布包启动

```bash
cd examples/task-board-demo
npx oneworks app
npx oneworks web
npx oneworks "Read the workspace and suggest one small improvement"
```

## 测试场景

测试某个 example 场景时，从对应 example 目录启动命令：

```bash
cd examples/task-board-demo
pnpm test

cd ../source-debug-fixture
node scripts/smoke.mjs
```

如果是在开发 One Works 本仓代码，仍然从仓库根目录执行 `pnpm start`、`pnpm typecheck` 等本仓级命令；只有测试具体 example 场景时才切到对应 example 目录。

## 使用本仓源码调试

从仓库根目录启动本地 server / client，但把示例目录作为用户 workspace：

```bash
EXAMPLE="$PWD/examples/task-board-demo"

__ONEWORKS_PROJECT_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_LAUNCH_CWD__="$EXAMPLE" \
pnpm start
```

切换到 `examples/source-debug-fixture` 即可复用同一套源码调试方式。
