# OneWorks Chat Rooms Plugin

本包是 `@oneworks/plugin-channel-oneworks`，负责 OneWorks Channel 的产品入口。产品界面入口统一简称「聊天室」，避免和 transport / 配置中的 Channel 概念混淆；内部包名、route id 和 channel type 仍保持 `channel-oneworks` / `oneworks`。它不实现 `ChannelConnection`，也不接管飞书、微信等 provider 的连接管理。

修改本包客户端页面前先加载 `.oo/skills/oneworks-plugin-ui` 和 `.oo/skills/ui-design-memory`。

- `plugin.json` 声明 workspace-only 产品路由和插件自有的消息跳转偏好。
- `client/` 通过 `view.route.setSidebar(...)` 把 Room 接入宿主通用二级列表，并通过宿主 `view.ui.AgentRoom` 在 route body 直接呈现真实会话；不要在详情区重复资源列表或复制聊天逻辑。route 已拥有页面级内容间距时给 `AgentRoom` 传 `inset={false}`，避免宿主与嵌入组件重复制造 padding。所选 Room 名称由通用 Header 展示，页面正文不再重复标题；已分享、链路等稳定入口声明为 `nav.items[].actions` 并由宿主放在左侧「聊天室」旁，Header actions 只保留分享当前 Room 等对象级命令。列表数据通过 `view.data.useQuery(...)` 自动重验证，不提供无必要的手动刷新。
- workspace-only 客户端入口必须使用宿主注入的 `ctx.runtime.endpoint?.role` 判断运行时身份，不要从 `location.pathname` 推断；packaged Desktop 的兼容 workspace 窗口可能使用共享 `/ui/` 文档，但运行时 endpoint 仍是权威 workspace 身份。
- `server/` 只通过 host 注入的 `ctx.oneworksChannel` facade 访问受控的房间分享、simulation、场景和链路能力；不要导入 `apps/server`、数据库或 `ChannelConnection`。
- 飞书、微信和 OneWorks 的 transport、webhook 与消息收发分别属于对应 `@oneworks/channel-*` 包。
- 插件缺席或未激活时，所有 Channel 仍必须能够独立收发消息。
- 开发态若侧栏入口存在但 route body 为空，先查看 workspace runtime 的 `/api/plugins` 中本插件是否为 `plugin_activation_failed`。本包的 `client/dist` 与 `server/dist` 是 ignored 构建产物；新 worktree 首次运行前执行 `pnpm --filter @oneworks/plugin-channel-oneworks build`，再通过统一 dev-service 对当前 worktree 做已授权重启，不要把半激活空白页误判为浏览器加载慢。

本地验证客户端改动前先运行 `pnpm --filter @oneworks/plugin-channel-oneworks build:client`，再通过统一 `dev-service restart web` 重启当前 worktree 的 Web 服务。插件运行时加载 `client/dist`；只修改 `client/src`、等待 Vite HMR 或仅刷新页面不会更新已加载的插件界面。

产品 UI 可以使用本地 Room ID 完成应用内路由，并展示用户主动配置的账号标签。不要返回或渲染原始 channel / actor 标识、webhook headers、nonce、签名、credential、raw payload、memory、continuity 或 authorization metadata。

创建团队群聊时，Leader 与普通成员是两个选择组：系统内置 Auto Leader 并作为无显式实体 Leader 时的默认选择，它根据已选成员的名称和职责生成服务端 system prompt，通过统一 runtime protocol 分配、跟进并汇总任务；每个可执行请求必须至少委派一次并跟进到终态。Auto Leader 至少需要一个普通成员，且不拥有实体频道连接。外部频道消息由服务端给 Auto Leader 提供一次性委派描述，只有真正拥有该连接的实体子会话可原子领取并获得受限 `channel` authority；回复目标固定为原始入站事件快照，无效委派 fail closed，同 session 可幂等恢复 context，未领取授权按 TTL 过期；Auto Leader 自身、非 owning member 和重复领取都不得获得频道 token。实体 Leader 由实体定义的 `team.role: leader` 注册且只能单选，其 `team.relatedEntities` 由服务端解析并自动加入成员；创建页只负责预选和展示，Leader 卡片用宿主实体头像组件在右下角预览关联成员。Leader 与普通成员卡片区在桌面和中间宽度默认最多展示三行，超出后各自在固定窗口内纵向滚动；手机收为两行三列正方形卡片并隐藏描述，同时保留名称、头像、选择状态和 Leader 关联头像。
