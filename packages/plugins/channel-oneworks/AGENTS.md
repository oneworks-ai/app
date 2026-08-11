# OneWorks Chat Rooms Plugin

本包是 `@oneworks/plugin-channel-oneworks`，负责 OneWorks Channel 的产品入口。产品界面入口统一简称「聊天室」，避免和 transport / 配置中的 Channel 概念混淆；内部包名、route id 和 channel type 仍保持 `channel-oneworks` / `oneworks`。它不实现 `ChannelConnection`，也不接管飞书、微信等 provider 的连接管理。

- `plugin.json` 声明 workspace-only 产品路由和插件自有的消息跳转偏好。
- `client/` 通过 `view.route.setSidebar(...)` 把 Room 接入宿主通用二级列表，并通过宿主 `view.ui.AgentRoom` 在 route body 直接呈现真实会话；不要在详情区重复资源列表或复制聊天逻辑。分享、调试、场景与链路入口通过 `view.route.setActions(...)` 放在通用 Header。
- `server/` 只通过 host 注入的 `ctx.oneworksChannel` facade 访问受控的房间分享、simulation、场景和链路能力；不要导入 `apps/server`、数据库或 `ChannelConnection`。
- 飞书、微信和 OneWorks 的 transport、webhook 与消息收发分别属于对应 `@oneworks/channel-*` 包。
- 插件缺席或未激活时，所有 Channel 仍必须能够独立收发消息。

产品 UI 可以使用本地 Room ID 完成应用内路由，并展示用户主动配置的账号标签。不要返回或渲染原始 channel / actor 标识、webhook headers、nonce、签名、credential、raw payload、memory、continuity 或 authorization metadata。
