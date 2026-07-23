# Plugin Services Module

本目录承载 server 侧 plugin runtime。这里负责从 workspace 配置解析 plugin 实例、读取 runtime manifest、激活 `server.entry`、维护 scoped command/API registry，并为 HTTP route 提供资产解析、命令执行、proxy 与 launcher search 能力。

## 边界

- `runtime.ts`：plugin manager 生命周期、注册上下文、命令/API/launcher 调用，以及按 scope 管理 watch 模式和 plugin 变更通知。
- `discovery.ts`：通过 server config service 与 resolver 获取当前 workspace plugin 实例。
- `marketplace.ts`：读取当前配置里的插件市场源，解析 catalog，并为前端插件市场返回可搜索的插件条目。
- `oneworks-official-marketplace.ts`：维护内置 One Works npm 插件白名单与当前应用版本目录；官方包的选择、安装和卸载继续走 `marketplace-selection.ts` / `marketplace-sync.ts`，不要在 route 或前端硬编码包列表。
- `native-host.ts`：聚合各 adapter 对真实用户 Home 原生插件的只读发现；原生条目与 OneWorks runtime plugin 分开返回，不能进入 runtime activation。
- `manifest.ts`：读取目录或 package manifest 中的 `plugin.client/server/contributions` runtime 字段，并按 `package.json` exports 约定补齐 `./client`、`./server` 默认入口。
- `proxy.ts`：loopback target 校验和 HTTP 代理转发。
- `types.ts`：server 内部窄类型；共享 contract 完成后应迁移到 `packages/types/src/plugin.ts`。

Route 只做 URL、HTTP 状态和 stream/proxy 写回；不要在 route 中保存 plugin registry 状态。

## Runtime 分层

- `manager` runtime 运行在 management server 进程，负责设备 / daemon 级管理面：发现和启动 workspace server、聚合运行中的 workspace metadata、承接 launcher 控制面，以及通过平台 channel 路由跨 runtime 消息。它不直接承载某个 workspace 的 plugin registry。Relay 通过默认官方 plugin config 同时进入 manager / workspace runtime，但宿主仍只承载通用 plugin runtime，不得把 Relay 业务行为写进默认管理链路。
- `workspace` runtime 运行在 workspace server 进程，负责单个 workspace 内的插件实例：读取该 workspace 配置、解析 manifest、激活 `server.entry`、维护 scoped command/API/launcher provider registry，并把当前 workspace 的插件能力暴露给本 workspace client。一个 management server 下可以同时存在多个 workspace server；每个 workspace server 的插件状态必须按 workspace 隔离。
- manager 侧 runtime endpoint 列表由 `runtime.ts` 聚合当前 manager 与 launcher 已知 workspace server，并通过 `/api/plugins/runtime/endpoints` 暴露；跨 runtime channel 如果只传 `workspaceId`，也必须先经这个列表解析到真实 `serverBaseUrl`。不要在插件内重复维护 workspace server 地址表。
- 有 server entry 的插件必须声明 `plugin.server.roles`。`package.json` 的 `exports["./server"]` 只补入口路径；未声明 roles 时注册失败并通过 plugin diagnostics 暴露错误，不自动猜测运行层级。需要 management server 控制面能力时必须显式写 `["manager"]` 或 `["manager", "workspace"]`。
- `launcherSearchProviders` 必须和 client registry 使用同一套 `roles` / `surfaces` 可用性规则。server 侧 launcher search 只暴露当前 runtime role 且包含 `launcher` surface 的 provider；`workspace`-only provider 只能留在 workspace 内部，不能被 management server / launcher 搜索入口调用。
- 跨 runtime 通信必须走平台提供的 channel / launcher / workspace proxy 能力，由管理面统一路由和鉴权。插件如果需要让远端或其他 workspace 触发能力，应注册 scoped API、command 或 launcher provider，让平台 channel 转发；不要在插件内部私搭 Relay 专用桥、跨进程全局 singleton 或绕过平台的 HTTP/WS 隧道。
- Relay 插件只是上述平台 channel 的一个消费者和远端发现来源。新增插件运行时能力时先判断它属于 `manager` 控制面还是 `workspace` 执行面，再落到对应 route / service / registry；不要为了某个 Relay 场景把职责塞进错误的 runtime。

`ctx.registerApi` 是插件 server 的 scoped route 注册入口。新 API 注册必须携带 `title`、`description`、`inputSchema`、`outputSchema` 和 `headerSchema`，运行时会把这些字段序列化到 `/api/plugins` 的 `plugins[].apis`，供插件详情页和创建插件文档展示；旧插件缺失字段只做兼容 warning。
