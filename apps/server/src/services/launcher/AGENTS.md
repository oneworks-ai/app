# Server Launcher Service

本目录承载 manager role 的 launcher 控制面服务。

## 入口

- `manager.ts`
  - 维护 manager project-home 下的最近 workspace 状态。
  - 提供 launcher 目录浏览、创建 workspace 目录、打开 workspace。
  - 作为 workspace 打开或记录前，只规约到当前 Git worktree 的 top-level；linked worktree 必须保留为独立 workspace，不能折回 common `.git` 对应的原始 project 目录。
  - 打开 workspace 时按需启动独立 workspace server，并返回该 workspace server 的 `serverBaseUrl` 给共享 client 使用。
  - 启动 workspace server 时，传入的 `workspaceFolder`、primary/current project 目录、home/db/log 目录必须全部来自被打开的 workspace；不要继承 manager 或外层 shell 的旧目录。

## 边界

- 这里只服务 `__ONEWORKS_PROJECT_SERVER_ROLE__=manager` 的控制面；不要让 workspace server 在请求级别切换目录。
- workspace 长期运行态仍是独立 server 进程；manager 只负责发现、启动和记录状态。
- 同一 workspace 的 workspace server 启动必须通过 project-home 下的 `.local/server/instance.json` 与文件锁做跨进程去重；live 且同实现版本 / 启动配置的实例直接复用，不一致时返回 409，由外部决定是否停止旧实例或重试。
- workspace server 的实现版本 identity 只代表 server runtime 及其依赖；client-only dirty 改动不应改变 implementation identity，避免前端热改触发误判复用冲突。
- workspace server 兼容性优先看 `runtimeCompatibilityVersion` 的 semver 家族；runtime hash/source hash 主要用于诊断展示。服务端通信或运行时契约出现不兼容变化时，先更新 `manager.ts` 里的兼容版本。
- Electron main 可以继续管理窗口生命周期，但 launcher 的 Node/文件系统/启动 workspace server 能力应优先落在这里，再由桌面或 Web 前端调用。
