# Client Routes Module

本目录是页面级入口：读取 URL、装配 route 级数据、处理导航和把 API detail 转成页面 view model。纯展示组件不放这里。

## Agent Room 入口

- `LauncherRoute.tsx`
  - launcher / 空项目启动页入口；Electron preload 提供 `window.oneworksDesktop` 时走桌面 host，Web manager role 下也可作为 daemon launcher 入口。
  - 使用 Raycast-like 命令面板：顶部搜索自动聚焦，列表按 action / project 分组，支持上下键切换和 Enter 执行。列表行单击只负责选中和更新操作提示；执行动作必须走 Enter 或显式的右侧 action button，避免误开项目或远端资源。
  - 桌面环境通过 `window.oneworksDesktop.getWorkspaceSelectorState()` 获取 running / recent projects。
  - Android 等 device shell 也复用 `window.oneworksDesktop` 的共享 launcher 子集；优先实现 `listCloneDestinationDirectories()` 复用内部列表 UI，只有没有目录浏览能力但有 `chooseWorkspace()` 时才走系统目录选择器兜底。
  - Web manager role 通过 `/api/launcher/workspaces` 获取 running / recent projects，并通过 `/api/launcher/workspaces/open` 启动 workspace server。
  - Relay 远程项目展示由 `launcher-relay-projects.ts` 从 Relay status 归一化；列表项必须看起来是远程服务上的项目，并携带 `serverId / deviceId / workspaceFolder`，不要创建本地 session tags 伪装远端 workspace。真正打开远程项目需要 relay workspace job 和 HTTP/WS proxy 链路。
  - Relay 远程目录选择只从带 `capabilities.workspaceLauncher === true` 的 manager daemon 生成 target；workspace server 只能作为已打开项目出现在项目列表里，不承担“列目录 / 新建项目 / 启动 workspace server”的 launcher 控制面。
  - launcher 内置命令只放 host-owned 能力，例如本地项目、设置、关于、检查更新和预览。插件业务入口不能写成 `LauncherViewMode`、`builtin:*` 命令、菜单项或插件专属 API 调用；例如 Relay 账号 / profile 入口必须由 Relay 插件通过 manifest route、`launcherSearchProviders` 和 client activation command 注册，并由 `PluginViewHost` 渲染。插件搜索结果的 launcher 分组也由插件通过 `groupId/groupTitle` 或 `sectionId/sectionTitle` 声明，host 只负责通用分组渲染和无声明时的默认“插件”兜底。插件未启用或未注册时，入口自然不存在，host 不要补一个内置兜底入口。
  - launcher host-owned 页面态必须用 path，而不是 `?view=` query：设置 `/launcher/settings`、关于 `/launcher/about`、预览 `/launcher/preview`。旧的 `?view=settings|about|preview` 只能作为兼容入口读取，并应自动 replace 到 path。
  - launcher 内置目录浏览是 host-owned 子路由，URL 形态为 `/launcher/browse/:mode/:targetId/:path`；不要把“新建项目 / 打开项目 / clone 目标目录选择”这类页面态只藏在 `/launcher` 内部 state 里，也不要把当前目录写成 query。目录 path tail 用 URL path segment 编码以保留本机 / 远端路径里的斜杠和特殊字符；旧的 `?path=...` 只能作为兼容入口读取，并应自动 replace 到 path。插件页面仍只能通过插件 manifest route 注册到 `/launcher/plugins/:scope/:routeId/...`，host 不为插件业务补内置目录或账号路由。
  - 桌面环境通过 `window.oneworksDesktop.openWorkspace()` 打开已有项目；Web manager role 打开后把当前 tab 的 server base 切到返回的 workspace server。
  - Web workspace 页内 launcher 由 `ChatRouteShell` 渲染 `LauncherOverlay` 并复用 `LauncherRoute`；只在非 Electron Web 下注册 `Cmd/Ctrl+Shift+P`。
  - 左下角只承载 app 级菜单入口；右下角只承载当前选中项的可用操作提示。
  - `/` 文件搜索模式在 route 层只负责进入/退出模式、展示结果和调用 preload API。全局模式搜索电脑根目录；项目上下文模式搜索当前项目资源。
  - 非桌面环境下必须降级提示能力不可用，不要直接访问 Electron IPC。
- `AgentRoomRoute.tsx`
  - `/rooms/:roomId` 主入口。
  - 使用 SWR 拉取 `/api/agent-rooms/:id`。
  - 装配 `ChatRouteView` 的 `agentRoomTranscript`。
  - 负责 room 收藏/归档、打开 host session、打开 child run、发送 room 消息。
- `AgentRoomSessionRoute.tsx`
  - `/rooms/:roomId/sessions/:sessionId` 子 run 会话入口。
  - 校验 session 是否属于当前 room 的 run，并复用普通 session 详情页展示。
- `ModuleManagementRoute.tsx`
  - `/modules` 模块管理页入口。
  - 页面组件维护在 `src/components/module-updates/ModuleManagementView.tsx`。
  - 负责检测和安装 bootstrap cache 模块更新，并编辑 project `desktop.updateChannel` / `desktop.moduleUpdateChannels`。
- `ChatRoute.tsx`
  - 普通 `/session/:sessionId` 入口。
  - Agent Room 实验开启时，会把绑定了 room 的 host session 导向 room 视图。
- `ChatRouteView.tsx`
  - chat route 的壳层装配；Agent Room 模式通过 `agentRoomTranscript` 注入。
- `agent-room-route-view-model.ts`
  - 把 `AgentRoomDetailResponse` 转成前端 `AgentRoomViewModel`。
  - 这里负责可见消息过滤、leader/child attribution、reaction 推导、approval batch 聚合、target label 生成。
- `agent-room-session-paths.ts`
  - room 与 room-scoped session URL 生成。

## 分层约束

- route 可以读 `useParams`、query params、SWR、`navigate` 和 API 封装。
- route 不直接写复杂 DOM 结构；room 消息 UI 去 `src/components/agent-room/`。
- `agent-room-route-view-model.ts` 可以解析后端 payload 并生成展示字段；组件层不要重复解析原始 payload。
- 发送 room 消息统一走 `src/api/agent-rooms.ts` 的 `sendAgentRoomMessage`，不要在组件里手写 fetch。
- 新增 URL 状态时，优先用 `agent-room-session-paths.ts` 或已有 query helper，避免多个入口拼出不同链接。
- route container 的右侧 / 下方面板是 route-owned URL 状态：用 query 记录哪些 panel 可见、每个 panel 当前 tab、以及用户打开过的 tab 列表，再把 slot 传给 layout。layout 只根据 slot 是否存在渲染，不直接保存或写回 query。
- 交互结构页当前采用 `routePanels=side,bottom` 记录可见面板，`sidePanelTab` / `bottomPanelTab` 记录当前 tab，`sidePanelTabs` / `bottomPanelTabs` 记录打开过的 tab。切换这些状态时用 `navigate(..., { replace: true })`，避免面板开合污染浏览器历史；tab 组件必须回传 next active tab 和累计 opened tabs，外部 route 再决定写 query、store 或其他持久化介质。
- 关闭 route container 面板时默认只从 `routePanels` 移除对应 panel，不清理 `sidePanelTab` / `bottomPanelTab` 或 opened-tab query。这样外部能继续知道用户打开过哪些 tab，并在用户回到页面或重新打开面板时恢复到之前状态；只有明确的“重置 / 忘记面板状态”操作才清掉 tab query。
- 交互结构页左下角 footer/debug tools 是 sidebar footer 信息区，不属于顶部 chrome。这里的图标槽统一用 `--interaction-structure-debug-icon-size: 16px`，不要复用 `--app-chrome-icon-size` 或单独写 17px/18px/20px，避免与 footer slot、platform switch、fullscreen switch 尺寸不同步。
- 交互结构页左下角 debug tools 的操作系统切换必须是 `radiogroup` / `radio` 语义并支持方向键切换，视觉上对齐配置页右上角 source switch；全屏切换必须用真实 `Switch` 控件。两行的控件都靠右，左侧只保留说明图标。
- 新增桌面 launcher 能力时，route 只做展示和 preload API 调用；窗口生命周期、workspace service 复用和最近项目状态留在 `apps/desktop/src/main/`。
- 新增 device app launcher 能力时，优先把前端可见契约放到 `packages/types/src/device-shell.ts`；route 只消费共享 shell API，各 device app 负责 native 实现。
- 新增 Web manager launcher 能力时，route 仍只做展示和 API 调用；项目发现、workspace server 生命周期和文件系统操作应落在 server manager route / service。
- launcher 视觉组件、设置页 section、footer hint 细节维护在 `src/components/launcher/`；route 不要继续吸收复杂 DOM 和局部控件状态。

## Desktop Launcher 数据流

Desktop preload / Web manager API:

`window.oneworksDesktop` / `/api/launcher/*`

Route:

`LauncherRoute -> normalizeWorkspaceSelectorState -> openWorkspace / listLauncherDirectories / searchWorkspaceResources`

Desktop main:

`shared desktop client -> window-manager -> workspace-selector-state / workspace-file-search`

Server manager:

`shared web client -> launcher manager route -> launcher manager service -> workspace server process`

最终行为：

`空项目启动页 -> 选择项目 -> 复用共享 client、启动对应 workspace server -> 通过 IPC 注入 serverBaseUrl -> 加载 workspace route`

## Desktop Launcher 交互边界

- `Cmd+,` 这类 app 级快捷键在 launcher route 层处理，但必须避开 IME composition 和快捷键录入输入框。
- launcher view mode 切换要清理当前列表状态、搜索状态和 footer hint，不要让 settings/about 的 hint 泄漏到 command 列表。
- 全局文件搜索打开目录时走项目模式；打开文件时走用户偏好的外部编辑器。项目上下文文件搜索打开文件走项目 tabs，打开目录走右侧目录树定位。
- launcher 的语言切换入口应写入 global config，而不是只改当前页面 i18n 状态。

## Agent Room 数据流

Server detail:

`room + members + runs + messages`

Route view model:

`buildAgentRoomRouteViewModel(detail)`

Component view model:

`buildAgentRoomViewModel(routeViewModel)`

最终渲染：

`AgentRoomTranscript -> AgentRoomMessageList -> AgentRoomBubble`

## 回归

- Route/view model：`pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/agent-room-navigation.spec.ts`
- Transcript/rendering：`pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/agent-room-rendering.spec.tsx`
