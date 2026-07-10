# Client 目录说明

- `src/App.tsx`：客户端根入口，负责挂载主题、全局订阅、侧边栏导航和应用壳。
- `src/routes/`：页面级 route 入口，只处理 URL、路由参数、页面装配和少量 route 级数据获取。
- `src/components/layout/`：全局布局组件，当前放置 `AppShell` 这类应用骨架。
  - 改 route container、route header、折叠态 header 或 layout slot 时，先读 `src/components/layout/AGENTS.md`。
- `src/components/NavRail.tsx`、`src/components/NavRail.scss`：桌面端左侧 rail、会话列表承载、折叠状态、窗口红绿灯占位和抽屉宽度调整。
- `src/components/`：可复用视图组件和页面内部面板，不承担路由匹配职责。
  - 改通用 overlay、Dropdown、Popover、Tooltip、NavRail、Sidebar 或右键菜单前，先读 `src/components/AGENTS.md`。
- `src/components/config/`：配置页编辑器、worktree environment 面板与配置冲突处理逻辑。
  - 涉及配置页自动保存、热更新、外部配置变更或冲突提示时，先读 `src/components/config/AGENTS.md`。
  - Adapter 账号详情、额度、头像或账号选择器跨配置页与聊天页；这类改动必须同时读 `src/components/config/AGENTS.md` 和 `src/components/chat/AGENTS.md`，共享实现位于 `src/hooks/use-adapter-account-quota-detail.ts`、`src/hooks/use-adapter-accounts-with-quota.ts`、`src/utils/account-quota.ts` 与 `src/components/account-quota/`。
- `src/components/launcher/`：desktop launcher 的设置页、关于页和 launcher 专用交互组件。
  - 改 launcher 设置页、footer hint、section tabs、快捷键提示、毛玻璃或 tooltip 时，先读 `src/components/launcher/AGENTS.md`。
- `src/components/chat/`：聊天页子视图，包含 header、history、timeline、settings、sender 和工具渲染。
  - 消息级操作、sender、账号选择器与账号额度的更细维护说明见 `src/components/chat/AGENTS.md`。
- `src/components/agent-room/`：Agent Room 的 transcript、room chrome、成员列表、气泡渲染和 room 专用展示模型。
  - 改 room 气泡、reaction、审批队列、成员跳转、长消息折叠或 room transcript 时，先读 `src/components/agent-room/AGENTS.md`。
- `src/routes/`：页面级 route 入口，也包含 Agent Room 的 API detail 到 UI view model 映射。
  - 改 Agent Room 路由、URL、发送消息、session/room 切换或投影后的 view model 时，先读 `src/routes/AGENTS.md`。
- `src/hooks/`：跨页面通用 hooks；`src/hooks/chat/` 专门承载聊天会话相关状态和交互逻辑。
- `src/api/`：HTTP API 封装与响应类型，页面和 hooks 统一通过这里访问后端。
- `src/store/`：全局状态原子。
- `src/resources/`：静态资源、适配器元数据和 i18n 文案。
- `src/styles/`：client 全局样式入口。共享设计 token 不在这里定义，统一来自 `@oneworks/route-layout/design-tokens.css`。

## 约定

路由分层：

- 新增页面入口时，优先放在 `src/routes/`。
- route 组件可以读取 `useParams`、`useNavigate`、query params，并做页面级数据装配。
- 纯展示或可复用 UI 不要放在 `src/routes/`，应放回 `src/components/`。

布局分层：

- 全局布局和页面外壳统一放在 `src/components/layout/`。
- 不要再创建 `components/app/routes` 这类把布局和路由混放的目录。

聊天页约定：

- 聊天页面入口统一由 route 组件承接，当前为 `src/routes/ChatRoute.tsx`。
- `ChatRoute` 负责 `/` 与 `/session/:sessionId` 的合并入口、会话解析和空态处理。
- `src/components/chat/` 只保留聊天页面内部视图，不再单独维护旧式 route wrapper。
- 会话列表的“搜索 / 筛选 / 排序 / 收起态”已写入 URL query；后续新增 session 级 UI 状态时，优先先判断是否也应落到 query，而不是只放组件本地 state。
- 会话卡片支持右键上下文菜单；涉及 `收藏 / 重命名 / 归档 / 复制链接 / 复制 ID / 复制控制台指令` 时，优先沿着右键菜单扩展，不要再把所有能力塞回 hover 按钮。
- 桌面端 macOS 会话右键菜单支持“在新窗口打开”；新窗口必须复用桌面主窗口的隐藏 titlebar / traffic light 风格，并默认以折叠左侧栏的 URL 打开。

桌面壳交互约定：

- `useResponsiveLayout` 的 `isCompactLayout` 表示真正的窄屏 / 手机端布局，当前断点是 `600px`；不要把它重新用于中等宽度的桌面密度收缩。
- 左侧栏折叠是桌面状态，不等同于 `isCompactLayout`；header、NavRail、AppShell 需要分别处理桌面折叠和手机端侧栏抽屉。
- 折叠左侧栏后的 `ChatHeader` 仍要保留展开侧栏、返回、前进、新建会话和右侧操作按钮；这些按钮必须继续带 tooltip 和快捷键说明。
- sender/status bar 内 select 的视觉密度按 `.sender-container` 容器宽度逐级收缩，不按 viewport 直接判断；history 区宽度变化时 select 样式应同步调整。
- 桌面端专属设置必须通过 `window.oneworksDesktop` 注入的数据和更新接口读取 / 保存，并且只在这些 API 存在时渲染；普通 Web/PWA 前端不能展示 Electron-only 配置项。
- 桌面端根路径 workspace 由 `App.tsx` 进入 `WorkspaceConnectionGate`，再通过 `window.oneworksDesktop.getWorkspaceConnection()` 等待本机 server URL；不要在 `main.tsx` render 前做一次性阻塞探测，否则首次打开 workspace 超时后不会自动重试，只能靠 reload 修复。
- 维护 homepage iframe 的 fullscreen / macOS 窗口预览时，`NavRail` 左侧窗口按钮栏要保持贴近标题：`.nav-rail-window-bar` 需要允许收缩（例如 `min-width: 0`），fullscreen 场景里的按钮栏宽度不要被 flex 内容撑回默认宽度，避免标题和最后一个按钮之间出现过大的空白。

数据流约定：

- 页面级列表或详情拉取优先放在 route 或对应页面 hook 中，不要散落在纯展示组件内。
- API 请求统一走 `src/api/`，避免在组件里直接手写 `fetch`。
- 能复用的状态逻辑优先抽到 hooks，不在 route 和 view 间复制业务逻辑。
- 配置页收到 `config_updated` 后，订阅层只负责刷新缓存；本地草稿和远端配置的冲突判断必须留在配置编辑器内部完成，避免静默覆盖用户正在编辑的内容。

插件边界：

- workspace 页面里的会话、项目 API 和工作区 server URL 属于当前 workspace runtime；全局 host chrome 的插件贡献，例如 nav/footer、全局账号入口和 launcher 账号能力，属于 manager/global plugin runtime。
- `AuthenticatedApp` 负责显式选择 host-level plugin runtime；不要在 `PluginProvider` 默认推断里耦合某个具体插件，也不要在 `AppShell` / `NavRail` 写死 Relay 账号入口。
- route-based workspace URL 的 workspaceId 来自 `/ui/w/:workspaceId` 路径，是 workspace 页面的身份来源；异步恢复到的 connection 只能补充 server/folder 信息，不能用空 workspaceId 覆盖路由身份。

主题与 token：

- client 入口必须先引入 `@oneworks/route-layout/design-tokens.css`，再引入本应用自己的 `src/styles/global.scss`。
- `src/styles/global.scss` 只维护 client 专属全局样式、overlay、AntD 细节覆盖和页面级通用样式；不要在这里重新定义 `--bg-color`、`--text-color`、`--border-color`、`--primary-color` 或暗色 token 表。
- 修改共享颜色、chrome 尺寸、route header 或 nav rail token 时，去 `packages/route-layout/src/design-tokens.css`，并同步检查 Relay Admin 是否受影响。
- `useAppPreferences` 负责把主题状态同步到 `html.dark` 和 AntD `ConfigProvider`；新增主题入口时不要只改 CSS token 而漏掉 AntD theme。

组件与 hook 归档约定：

- 前端业务模块统一遵循 `../../.oo/rules/frontend-standard/module-organization.md`，这不是 sender 私有约定。
- 模块目录不要长期平铺文件；优先拆成 `@components / @core / @hooks / @types / @utils / @store`。
- 模块私有 hooks、utils、types、store 放在模块自己的 `@*` 目录中，不和全局 `src/hooks`、`src/utils`、`src/store` 混用。
- 只有跨模块复用的 hooks、components、utils、store，才提升到 `src/hooks/`、`src/components/`、`src/utils/`、`src/store/`。
- 如果一个组件明显可被其他页面/模块复用，应放到更公共的 `src/components/` 子目录，而不是继续留在某个页面私有目录。
- 当前例子：
  - sender 私有编排逻辑在 `src/components/chat/sender/@hooks/`
  - sender 私有核心逻辑在 `src/components/chat/sender/@core/`
  - 聊天共用状态提示在 `src/components/chat/`
  - 工作区文件选择器和可复用项目目录树在 `src/components/workspace/`

import 约定：

- 遵循 `.oo/rules/CODING-STYLE.md` 的 group 顺序，并在 group 之间保留一个空行。
- `#~/` 用于 client 包内跨目录引用；不要在组件里持续叠加 `../../`。
- 模块入口引用自己的 `@components / @core / @hooks / @types / @utils` 时，可以使用模块内相对路径。
- 子模块内部如果只是引用同子模块兄弟文件，继续用相对路径；跨到别的子模块或更上层职责目录时，优先保证路径语义清晰，不要为了省几层目录把结构打平。

前端调试入口：

- 如果任务涉及 tooltip / popover / select / theme / sender / focus / hover / 样式回归 / 真实 Chrome 验证 / CDP 调试，开始修改前必须先读 `../../.oo/rules/frontend-standard/debugging.md`。
- 如果任务涉及移动端 WebView、手机端工作区 tabs overview、WebView / iframe chrome、sender compact 密度、Android IME / status bar 或 device shell simulation，还必须先读 `../../.oo/rules/maintenance/mobile-workspace-webview.md`。
- 需要通过 Chrome DevTools Protocol 调试页面时，必须使用独立 profile 和冷启动的调试 Chrome，不要直接复用用户已经打开的日常浏览器实例。
- 样式和交互问题不要只看代码；至少做一次真实 Chrome 的 computed style、open state 和 focus 回归。

## 聊天消息操作维护

如果任务涉及聊天消息级交互，优先读这些入口：

- `src/components/chat/ChatHistoryView.tsx`
  - 列表级状态，包含 `editingMessageId`、编辑冲突提示、编辑期间隐藏底部 sender。
- `src/components/chat/messages/MessageItem.tsx`
  - 单条消息的 `编辑 / 撤回 / 分叉 / 复制原文` UI，以及 inline edit 挂载点。
- `src/components/chat/sender/Sender.tsx`
  - 底部 sender 和 inline edit 共用的 composer；图片上传和资源型输入都从这里走。
- 如果涉及 sender / 浮层组合，还要同步看 `src/components/chat/AGENTS.md` 里的 sender 调试经验。
- `src/hooks/chat/use-chat-session-actions.ts`
  - 消息操作的前端 action 入口。
- `src/api/sessions.ts`
  - 会话/消息分支相关 API 封装。

进一步经验与工具说明：

- 经验沉淀：`../../.oo/rules/maintenance/message-actions.md`
- 工具与使用法：`../../.oo/rules/maintenance/tooling.md`

## 消息级调试与回归

推荐先跑：

```bash
pnpm tools message-actions verify
```

这个命令会串行执行：

- `eslint`
- `dprint check`
- `pnpm typecheck`
- 消息级操作相关回归测试
- 真实 Chrome 手工验证清单输出

真实 Chrome 最低回归项：

1. 编辑态替换原消息，不允许“原消息 + 编辑器”并存。
2. 编辑确认按钮文案是 `发送`。
3. 同时只能编辑一条消息；再次点编辑会提示已有编辑中的消息。
4. 编辑时底部 sender 隐藏，取消后恢复。
5. assistant 消息不允许 fork，`复制原文` 复制的是原始 markdown/text。
6. `edit / recall / fork` 后新分支会继续触发 assistant 回复。
