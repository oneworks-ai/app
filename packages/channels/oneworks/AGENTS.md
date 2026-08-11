# OneWorks Native Channel

本包实现 first-party `oneworks` channel type。它用于产品内房间、演示和本地 simulation，不是临时 debug adapter。

## 边界

- `src/index.ts` 只声明 `channelDefinition`、schema 和类型导出。
- `src/types.ts` 维护 channel config、outbound message 和 simulation webhook payload schema。
- `src/connection.ts` 实现 `ChannelConnection`，负责 webhook payload 规范化、出站消息记录和启动 / 关闭连接。
- `__tests__/` 覆盖 schema、webhook 鉴权、inbound event 规范化和 outbound message id。
- loader 级回归在 `apps/server/__tests__/channels/loader.spec.ts`，覆盖 first-party 包 dist 缺失时回落到本地 `packages/channels/oneworks/src`。
- server manager 级回归在 `apps/server/__tests__/channels/index.spec.ts`，覆盖 `/channels/oneworks/<channelKey>/webhook` 进入 native connection、归一化 inbound event，并携带匹配 channel links 调用 receiving handler。
- connection 保留进程内 local outbox 作为轻量调试观察面，server 同时负责持久化 outbound delivery；不要把 local outbox 当成 room transcript 或审计表。
- 产品入口插件位于 `packages/plugins/channel-oneworks`，负责房间分享、场景与链路体验；不能把 `plugin.json`、client UI 或产品编排放回本包。Channel 必须在该插件缺席时仍能独立运行。

## 运行时约束

- 这个包只能 fake 平台，不能 fake runtime。入站事件必须通过 server channel manager 进入同一条 middleware 管道。
- 不要在包内直接创建 session、写 memory、调用 agent、绕过 ApprovalPolicyResolver，或伪造 child run 结果。
- simulation webhook payload 只表达真实频道事件；scenario runner 必须基于 webhook / channel manager 注入事件，而不是直接调用内部 service 得到结果。
- 管理场景的 `admin` / `participant` 只选择 host facade 提供的已配置管理员或隔离模拟发送者；插件不能提交原始 sender ID，也不能借此提升为桌面用户、CLI profile 或企业管理员。
- webhook 默认拒绝无 secret 请求；只有显式设置 `allowInsecureWebhooks: true` 且请求 Host 为 loopback 时才允许本地 simulation。
