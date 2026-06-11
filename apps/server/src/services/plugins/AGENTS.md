# Plugin Services Module

本目录承载 server 侧 plugin runtime。这里负责从 workspace 配置解析 plugin 实例、读取 runtime manifest、激活 `server.entry`、维护 scoped command/API registry，并为 HTTP route 提供资产解析、命令执行、proxy 与 launcher search 能力。

## 边界

- `runtime.ts`：plugin manager 生命周期、注册上下文、命令/API/launcher 调用，以及按 scope 管理 watch 模式和 plugin 变更通知。
- `discovery.ts`：通过 server config service 与 resolver 获取当前 workspace plugin 实例。
- `marketplace.ts`：读取当前配置里的插件市场源，解析 catalog，并为前端插件市场返回可搜索的插件条目。
- `manifest.ts`：读取目录或 package manifest 中的 `plugin.client/server/contributions` runtime 字段，并按 `package.json` exports 约定补齐 `./client`、`./server` 默认入口。
- `proxy.ts`：loopback target 校验和 HTTP 代理转发。
- `types.ts`：server 内部窄类型；共享 contract 完成后应迁移到 `packages/types/src/plugin.ts`。

Route 只做 URL、HTTP 状态和 stream/proxy 写回；不要在 route 中保存 plugin registry 状态。

`ctx.registerApi` 是插件 server 的 scoped route 注册入口。新 API 注册必须携带 `title`、`description`、`inputSchema`、`outputSchema` 和 `headerSchema`，运行时会把这些字段序列化到 `/api/plugins` 的 `plugins[].apis`，供插件详情页和创建插件文档展示；旧插件缺失字段只做兼容 warning。
