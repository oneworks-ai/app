# Channel Links Service

本目录负责把 `.oo/channels/<link>/channel.json|yaml|yml` 里的 ChannelLink 定义解析成 server 入站事件可用的实体频道绑定。

- `index.ts`：加载 workspace channel links，并按 `channelKey + inbound channel/account ids` 匹配当前消息。

边界约定：

- 这里只做定义加载、规范化和匹配，不创建 session、不执行策略、不调用平台 API。
- `channels/` 接入管道可以读取匹配结果，但不要在接入层直接扫描 `.oo/channels`。
- ChannelLink 的 `channel` 字段对应 `.oo.config.json` 中的 channel key；`external` 字段对应平台外部会话目标，例如飞书 chat id、微信群 id、OneWorks native `roomId` / `directId` / `threadId` 或私聊 sender id。
- 同一个 channel key 可以绑定同一实体的多个外部会话，但不能跨实体复用；loader 必须在启动时拒绝这种配置，避免凭据、access 与 identity issuer namespace 被不同实体共享。
