# 进程环境变量契约

本仓库会在 CLI、Desktop、Server、Hooks、Adapters 与第三方工具之间创建多层子进程。环境变量既是公开配置面，也是跨进程协议；命名和继承必须区分两者，避免宿主工具的同名状态改变 One Works 启动分支。

## 命名空间

- 用户、CI 或部署可配置的公开变量使用 `ONEWORKS_*`。
- One Works 内部跨进程控制变量使用 `__ONEWORKS_*__`。
- 测试专用公开开关使用 `ONEWORKS_TEST_*`；fixture 内的局部变量不得进入生产启动路径。
- 不得新增 `__IS_*__`、`__LOADER_*__` 等无产品命名空间的私有控制变量。
- 内部变量应包含拥有它的子系统，例如 CLI helper loader 使用 `__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__`，Hook loader 使用 `__ONEWORKS_HOOK_LOADER_ACTIVE__`。不要用同一个泛化 marker 表示多个 loader 的生命周期。

## 继承边界

- `spawn` / `fork` 不得把 `{ ...process.env }` 当成无需审查的默认协议；先明确子进程需要继承的公开配置、项目上下文与内部状态。
- 启动独立 One Works 应用或独立 Node runtime 时，先调用 `sanitizeInheritedNodeRuntimeEnv()`，清除宿主的 `NODE_OPTIONS`、`NODE_PATH`、One Works loader marker 与已知旧 marker，再由子进程安装自己的 preload / loader。
- 启动 Adapter 等仍需保留用户 `NODE_PATH` 的外部工具时，调用 `sanitizeOneWorksLoaderEnv()`；`NODE_OPTIONS` 是否保留由对应 runtime 明确决定。
- 标准系统变量（例如 `HOME`、`PATH`）和已公开兼容接口（例如 `DB_PATH`）不机械改名，但每个运行时必须显式覆盖、保留或删除，不能依赖偶然继承。
- 旧的无前缀私有 marker 只允许在边界清洗名单中出现，不得作为兼容读取路径重新启用。

## 门禁与回归

- `pnpm env-contract:check` 扫描仓库内的 JS / TS 源码，拒绝新的无 `__ONEWORKS_*__` 前缀私有双下划线标记。
- 修改 loader、preload、Desktop/Bootstrap 启动或子进程 env 时，必须增加父环境污染回归：至少注入旧 marker，并验证目标 runtime 仍安装自己的 loader 后成功启动。
- Desktop 发版 smoke 必须覆盖 Manager 和 workspace server；只验证 Electron main 进程创建成功不能证明 Launcher 可用。
