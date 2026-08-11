# RFC 0006 Companion: OneWorks Channel And Chat Rooms Plugin

## Decision

OneWorks Channel 由两个独立包组成：

```text
@oneworks/channel-oneworks
  正式 first-party Channel provider
  与 @oneworks/channel-lark、@oneworks/channel-wechat 同级

@oneworks/plugin-channel-oneworks
  OneWorks 聊天室的产品入口
  负责 Room 分享、模拟场景、链路查看和导航偏好
```

它们不是同一个抽象，也不应通过包名特殊判断粘在 server 中。

## Provider Responsibilities

`@oneworks/channel-oneworks`：

- 实现 `ChannelConnection` 和 `oneworks` channel type。
- 规范化 OneWorks 入站事件并进入标准 middleware。
- 执行 OneWorks 出站投递并返回平台 message reference。
- 提供可选 message/conversation/app navigation capability。
- 支持签名 simulation webhook，便于本地测试同一条真实 ingress 链路。
- 不创建 Room、不选择 Entity、不加载记忆、不运行 Agent、不实现产品页面。

provider 必须能在产品插件缺席时独立运行。

## Product Plugin Responsibilities

`@oneworks/plugin-channel-oneworks`：

- 创建/查看 OneWorks Room 产品入口。
- 管理显式 RoomShare 和远端 availability 展示。
- 提供 simulation playground 和可重复 scenario。
- 展示经过脱敏的 ingress/run/delivery trace。
- 保存消息导航偏好和 provider/account override。
- 复用 host 提供的 Room、share、scenario、trace facade。

它明确不负责：

- 列举并管理所有飞书/微信 credential 或连接生命周期。
- 代替内置 Channel 配置能力。
- 直接读取 server DB、ChannelManager 或 Relay store。
- 成为通用会话管理页面。
- 绕过标准 ingress、command、approval 或 audit 链路。

## Host Capability

插件通过受控 capability contribution 获得 `ctx.oneworksChannel`。server 不按包名分支业务；只有内置来源、manifest 声明 capability、workspace role 三项同时满足时才注入。

```ts
interface PluginOneWorksChannelFacade {
  listRooms(): Promise<OneWorksRoomSummary[]>
  listShares(): Promise<OneWorksRoomShareSummary[]>
  listSharedRooms(): Promise<OneWorksSharedRoomSummary[]>
  createRoomShare(
    roomId: string,
    input: unknown
  ): Promise<OneWorksRoomShareSummary>
  revokeRoomShare(roomId: string, shareRef: string): Promise<boolean>
  listSimulationTargets(): Promise<OneWorksChannelSimulationTarget[]>
  getTrace(input?: unknown): Promise<OneWorksTraceItem[]>
  injectSimulation(input: unknown): Promise<OneWorksSimulationResult>
  listScenarios(): Promise<OneWorksScenario[]>
  createScenario(input: unknown): Promise<OneWorksScenario>
  updateScenario(scenarioRef: string, input: unknown): Promise<OneWorksScenario>
  deleteScenario(scenarioRef: string): Promise<boolean>
  runScenario(scenarioRef: string): Promise<OneWorksSimulationResult>
}
```

所有返回值使用 opaque ref 和脱敏 label，不返回 secret、原始 sender ID、真实 credential、workspace path 或未授权 session ID。

每个插件 API 请求都必须携带 host 派生的 `PluginRequestPrincipal`，而不是信任客户端提交的用户字段。已登录 Web 账号和关闭认证的本机 loopback workspace 可获得 `workspace:read` / `workspace:manage`；关闭认证的远程 bind 不产生受信 principal。OneWorks 聊天室 API 默认要求 `workspace:manage`，plugin manager 和 facade 均重复校验，缺少 identity 返回 401，权限不足返回 403。

Room 详情、创建和普通消息操作继续使用 host 的 Agent Room 路由，不在插件 facade 里复制一套 Room API。导航设置通过 manifest 的 `channelNavigation` contribution 声明插件 options 字段，继续使用 host-rendered plugin settings，不通过 server facade 读写。

## Sharing Model

插件发起分享时：

```text
local RoomShare write
  -> publish SharedRoomDescriptor to Relay
  -> Relay stores descriptor + ACL + owner route
  -> remote user's authenticated Relay account lists the shared Room relation
  -> owner tunnel connected: descriptor is online and a live route can be established
  -> owner offline: show unavailable, no transcript
```

只有分享出去的 Room 发布 descriptor。插件不能调用“列出 execution node 所有 Room”的 Relay API，也不能把未分享 Room 当作远端可发现资源。

## Local And Cloud Execution

OneWorks 聊天室不引入一个持有 Room 数据的独立云端执行服务。owner 节点本地执行、存储和授权；Relay 只做有限连接。

远端操作的数据路径：

```text
remote client
  -> Relay authenticated shared-room live request
  -> owner node live gateway
  -> owner validates share scope + actor + Room state
  -> owner Room service / command kernel
  -> live result projection
```

Relay 不缓存请求正文供离线重试。连接中断时调用失败，客户端明确显示 owner offline 或 route interrupted。

`listSharedRooms` 只聚合当前启用且登录有效的 Relay 账号。每个账号独立读取公开目录，一个账号不可达不会隐藏其他账号的结果。返回值只包含来源 label、opaque source/share ref、标题、图标、分享状态、更新时间和由 owner tunnel 实时连接推导的 availability；不包含 account key、session token、owner ID、owner-local Room ID 或 transcript。owner 重新连接时会重新发布它名下的显式分享，离线期间不会排队 descriptor 或消息正文。

## Navigation Preferences

导航偏好属于产品插件，而不是 `.oo.config.json` 的 provider credential：

```json
{
  "navigation": {
    "default": ["rightPanel", "externalWeb", "nativeApp", "appHome"],
    "providers": {
      "wechat": ["nativeApp", "appHome"],
      "lark": ["rightPanel", "externalWeb", "nativeApp"]
    },
    "accounts": {
      "lark:product-bot": ["externalWeb", "rightPanel"]
    }
  }
}
```

provider 决定哪些 URL 存在和能否嵌入；插件只决定用户偏好的尝试顺序。`rightPanel` 复用现有 `ChatWorkspaceDrawer`，iframe 不可用时继续 fallback。

## Product Surface

第一屏是实际 Room/分享工作区，不做营销 landing page。推荐视图：

- **聊天室**：左侧复用 host 的通用资源列表与搜索，主区域直接显示当前选中的真实 Room；不在主区域再复制一层 Room 列表，也不冒充所有 provider 的连接管理。
- **已分享**：本地显式分享、权限摘要和撤销操作，以及当前 Relay 登录账号可见的远端 descriptor 与实时在线状态。
- **Scenarios**：OneWorks provider simulation 和可重复场景；场景角色只进入 prompt 与审计，不能提升真实频道权限。
- **Trace**：脱敏 ingress、ChildSession、command、delivery 链路。
- **Settings**：host-rendered plugin config 保存消息导航顺序和 provider/account override，不在工作台重复一页表单。

Room 内消息只显示紧凑的平台图标和目标 label；完整账号、组织、状态、deep link 放在 popover。点击后按导航偏好在右侧 WebView 或外部应用打开。

## Capability And Package Discovery

- 官方默认插件 ID：`@oneworks/plugin-channel-oneworks`
- server capability：`oneworksChannel`
- client contribution：`channelNavigation`
- channel type：`oneworks`
- 不保留 `@oneworks/plugin-channel-management`、`channelManagement` 或 `channel-management` alias。
- packaged desktop 必须同时包含 provider 和产品插件，但二者可独立启停。

## Testing

- provider：schema、签名、重放保护、入站规范化、出站 message ref、navigation resolution。
- host capability：仅 built-in + workspace 注入，project/manager 不注入。
- product plugin：Room/share/scenario/trace/navigation facade，不出现通用 provider credential 管理。
- security：synthetic admin 场景不能执行真实 admin command；未绑定 direct inbound 不能创建无实体 ChildSession。
- Relay：仅显式 share descriptor，owner offline 不返回 content，不存在离线 content queue。
- UI：本地/远端 unavailable、紧凑平台图标、失败 delivery、right WebView 与 fallback。
