# Relay Plugin Package

`packages/plugins/relay` 是可选 Relay 插件，不属于默认内置体验。它把当前 workspace 服务注册到用户自部署的公网 Relay，并通过 scoped plugin API 暴露连接状态和控制命令。远端服务统一配置在 `servers[]`，即使只有一个 Relay 系统也不要增加 top-level 单服务入口。

## 入口

- `src/client/`：插件 UI 入口，展示连接状态和配置提示。
- `src/client/index.ts`：注册 client activation 能力，包括基于 Relay 已知设备的 `sessions.groups` 会话分组和“基于此连接新建会话”标题 action；只有拿不到设备状态时才回退到 `servers[]` 连接级分组。
- `src/server/index.ts`：插件 server entry。
- `src/server/controller.ts`：插件生命周期、登录 URL / 登录回调、连接 / 断开 / forget 操作编排。
- `src/server/options.ts`：`servers[]` 配置归一化，不能泄露 pairing token。
- `src/server/heartbeat.ts`：设备注册和心跳。
- `src/server/session-worker.ts`：会话快照、job claim 和结果回传 worker。
- `src/server/session-relay-client.ts`：Relay 远端 session forwarding client。
- `src/server/store.ts`：远端签发的 device token 持久化到 project home runtime 目录。
- `__tests__/`：按 API、controller、heartbeat、session worker 等模块拆分测试。

## 约定

- 插件必须保持可选；不要把 Relay 行为写进默认 server/client 启动路径。
- 远端服务只能来自 `servers[]`；`server` / `port` / `protocol` 是 server item 内部字段，默认连接项用 `activeServerId`。
- 多服务下 device token 按 server id 分开保存；不要把一个 Relay 系统的 token 覆盖到另一个系统。
- 插件登录必须打开所选 Relay Server 的 `/login` 页面；Web 回跳使用当前插件页，Electron 回跳使用 `oneworks://relay/auth` schema URL，再由桌面壳打开对应 workspace 的插件页面。
- 不记录会话正文；插件只转发当前 in-memory job payload / result，持久化仅限 device identity 和每个 server 的 token。
- 修改插件行为后跑 `pnpm -C packages/plugins/relay test`、`pnpm -C packages/plugins/relay typecheck` 和 `pnpm -C packages/plugins/relay build`。
