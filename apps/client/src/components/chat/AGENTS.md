# Chat 组件维护说明

本目录承载聊天页内部视图。涉及消息级交互时，优先从这里读起，而不是只看顶层 route。

## 关键文件职责

- `ChatHistoryView.tsx`
  - 会话消息列表的父层编排。
  - 管理 `editingMessageId`。
  - 负责“已有一条消息正在编辑”的冲突提示。
  - 负责编辑期间隐藏底部主 sender。
- `messages/MessageItem.tsx`
  - 单条消息渲染。
  - 消息 footer 操作按钮。
  - inline edit 的消息内挂载点。
  - 原始文本复制逻辑。
- `messages/MessageFooter.tsx`
  - 消息 footer 的统一承载层。
  - 改 footer 文案或按钮时，优先改这里，不要散落到 `MessageItem`。
- `../MarkdownContent.tsx`、`messages/MessageImage.tsx`、`messages/MessageMedia.tsx`
  - `MarkdownContent` 识别本地图片 / 视频 / 音频链接，`MessageItem` 注入 session-scoped resource URL。
  - 图片继续走可预览的 `MessageImage`；视频 / 音频 controls 与单次失败 fallback 统一由 `MessageMedia` 承载。
  - 本地文件授权、canonical path、Range / HEAD 与 MIME 只在 server workspace resource 链路实现，前端不能直接拼 `file://` 或读取文件系统。
  - Markdown 链接可用 title 元数据显式声明打开意图：`oneworks:open=internal` 进入交互面板，`oneworks:open=external` 进入系统默认浏览器，`oneworks:open=workspace-file` 进入工作区文件标签；未声明时继续服从 `messageLinks` 配置，显式意图不得放宽 URL 或 workspace path 校验。
- `tools/core/ToolRenderer.tsx` / `tools/DefaultTool.tsx`
  - 内置 adapter renderer 继续处理宿主特有工具；plugin MCP 工具的业务展示走通用 `toolUsePresentations` contribution。
  - plugin 只声明图标、标题、摘要目标、字段和结果格式；对象数组走 `records`、短原子数组走 `chips`，大结果用 declared result fields，聊天层不得新增 plugin-specific 条件分支或执行 plugin HTML / JSX。
- `sender/Sender.tsx`
  - 默认 sender 和 inline edit 共用的最外层装配入口。
  - 只保留 sender 壳层、局部视图拼装和少量同目录引用，不再承载大段状态编排。
- `sender/Sender.scss`
  - sender 和 inline edit 的共同样式来源。
  - 定义 `sender-history` container；sender 内 select 的密度断点依赖这个容器宽度，而不是全局 viewport。
- `sender/SenderSurface.scss`
  - chat sender surface 的共同样式来源。
  - `.sender-container--chat-surface` 的外观、status bar 衔接和 select 密度都维护在这里，不放在页面或插件局部样式里。
- 主会话和 interaction panel 子会话必须共用同一套 session composer surface。
  - 修改 `Sender` props、`ChatHistoryView` 的 composer 组装、`ChatStatusBar` 或 `.sender-container--chat-surface` 时，必须同步检查 `interaction-panel/InteractionPanelSessionView.tsx` 的 `embeddedSessionChrome` 路径。
  - `embeddedSessionChrome` 只表示去掉外层 route chrome；不要用它关闭 sender surface、status bar、session target 或创建后 header 折叠这类主/子会话应一致的 composer 行为。
  - 例外：interaction panel 子会话的 status bar 默认折叠，这是为了降低嵌入面板里的垂直占用；只能改默认值，不要移除 status bar 或另造一套 sender surface。
- `sender/@components/`
  - sender 私有的通用视图组件与子模块目录，例如 `sender-toolbar/`、`model-select/`。
- `sender/@core/`
  - sender 私有的编排与纯逻辑，例如 toolbar bindings、content 组装、interaction 判断。
- `sender/@hooks/`
  - sender 私有的状态编排、快捷键、focus restore、overlay 控制、提交逻辑等 hooks。
- `sender/@types/`
  - sender 私有类型定义。
- `sender/@utils/`
  - sender 私有常量与轻量工具函数。
- `../../dock-panel/DockPanel.tsx`
  - 聊天页底部可复用 dock 面板壳层。
  - 统一承载标题、meta、关闭动作和拖拽调高能力。
  - terminal 以及后续其他底部面板优先复用这里，不要再各自复制一套 resize/header 逻辑。
- `../../components/workspace/ContextFilePicker.tsx`
  - 工作区文件选择器；如果别的输入入口也要复用文件引用弹窗，直接走这里。
- `../../components/workspace/project-file-tree/ProjectFileTree.tsx`
  - 可复用项目目录树；目录抽屉和文件引用弹窗共用这里，不要在 chat 局部再复制树结构、展开状态或右键菜单逻辑。
- `workspace-drawer/use-workspace-drawer-dock-actions.tsx`
  - 工作区抽屉 tab 的共享 header action / command state。
  - 目录树、改动文件等 workspace drawer tab 可能出现在右侧 drawer，也可能作为底部 interaction panel tab。新增 tab action 时必须接入这里或同级共享 resolver，不要只在 `ChatWorkspaceDrawer` 或底部面板某一处补按钮。
- `interaction-panel/ChatInteractionPanel.tsx` 只负责把各类 tab action resolver 注册进 `InteractionPanelDockWorkspace`；不要新增本地 Dockview header / prefix / tab renderer。展开态底部面板、右侧工作区抽屉和未来 Agent Room 类 pane 都应通过 `RouteContainerPanelDockWorkspace` 的 group active tab context 获取 actions，保证同一个 tab 移动到右侧、底部或 split group 后行为一致。
- 进入 `interaction-panel/` 修改 iframe、webview、页面调试器、移动调试、tab dock 或底部工作区面板前，先读 `interaction-panel/AGENTS.md`。
- 文件 / Markdown 文档片段评论从 `workspace-file-editor/` 采集选区，进入当前会话 sender 的 pending reference draft；改这类功能时必须同时检查 `ChatRouteShell -> ChatRouteBottomPanel -> ChatInteractionPanel -> InteractionPanelDockWorkspace -> WorkspaceFileEditorView` 回调链路，以及 `sender/@utils/sender-pending-reference-draft*.ts` 的持久化 schema。

## 消息级操作的当前约束

- assistant 消息不允许 fork；前端不显示按钮，后端也会拒绝。
- inline edit 必须复用 `Sender`，不要另造一套 textarea/composer。
- 编辑期间底部主 sender 必须隐藏，避免出现双输入源。
- 同一时间只允许一条消息进入编辑态；冲突时保留当前编辑器并提示用户。
- `复制原文` 复制的是原始 markdown/text，不是渲染后的可见 DOM 文本。
- 编辑确认按钮固定使用 `发送`，不要改回实现导向文案。
- 用户消息的 hover 操作按钮固定挂在消息左侧的独立 action rail，不要再塞回 footer 里挤占阅读流。
- assistant 消息的可见 footer 操作按钮只保留最后一条；更早的 assistant / tool 消息只能通过右键菜单触发操作。
- 消息级右键菜单必须同时兼容普通消息和工具调用块；`复制消息链接` 走 `#message-*` hash 锚点，落点要能直接滚动到对应消息位置，而不只是会话页。
- 消息级操作要始终基于原始 message id，而不是渲染拆分后的临时 id；`text/tool-group` 拆分只影响展示，不应影响 `edit / recall / fork / copy id / copy link`。
- `edit / fork` 创建的新 session 会通过 `messageBranchGroupId` 聚合成消息版本；前端版本切换控件应挂在对应用户消息下方，这类内部版本 session 不应在侧边栏会话列表里展示，也不要把路由 path 切到子 session id，当前版本状态放在 `branchSessionId` query 里。
- 多轮分支时，`branchSessionId` 是当前 active leaf / active timeline；消息版本控件要沿 active leaf 祖先链解析各层分支点，只渲染仍存在于当前时间线里的分支点。
- 主会话内容容器宽度超过 `820px` 且存在至少一个历史时间线节点时，左侧 timeline rail 必须持续展示；消息是否产生滚动只控制上下边缘渐隐，不得作为 rail 的可见性门槛。默认使用 `event-line`，global `appearance.historyTimelineMode` 可显式切换为原有 `node` 模式；容器宽度不超过 `820px`、`embeddedSessionChrome`、Agent Room 和用户主动隐藏是明确可见性例外。

## Sender 结构约束

- sender 只是当前已按“前端模块通用组织规范”落地的一个示例，不是特殊规则来源。
- 进入 `sender/` 子目录继续修改前，先读 `sender/AGENTS.md`；那里记录 select、toolbar、compact drawer 和 container query 的就近约束。
- 通用规则入口：`../../../../.oo/rules/frontend-standard/module-organization.md`
- sender 目录不要长期平铺文件；模块根只保留入口和极少量顶层样式。
- sender 私有实现按 `@components / @core / @hooks / @types / @utils / @store` 分层。
- sender 的状态型 hooks 放在 `sender/@hooks/`，不要再回塞到 `Sender.tsx` 或平铺在模块根目录。
- sender 的纯逻辑和装配放在 `sender/@core/`，不要混进视图组件。
- sender 的类型定义统一放在 `sender/@types/`，不要散在 core 和 component 里。
- sender 中如果出现可跨页面或跨模块复用的组件，应提升到更公共的 `src/components/...` 目录，不继续留在 `sender/` 私有目录。
- sender 相关单文件应尽量收敛在 200 行以内；超过后优先拆视图子组件、hooks、utils、样式文件，而不是继续在原文件加条件分支。
- 子模块如果已经独立成形，例如 `model-select`、`reference-actions`、`sender-toolbar`，应建子目录，并在子目录内继续按职责拆分，而不是把新的辅助文件继续堆回 sender 根目录。

## Header / NavRail 约束

- `useResponsiveLayout` 的 compact 断点当前是 `600px`，只代表手机端 / 窄屏布局，不代表桌面左侧栏折叠。
- `ChatHeader` 的折叠态 chrome 要同时覆盖 `isCompactLayout` 和 `isSidebarCollapsed`：桌面折叠侧栏时也必须渲染左侧操作按钮。
- 折叠侧栏后的 header 左侧按钮固定包含：展开侧栏、返回、前进、新建会话；右侧继续保留 bottom panel、workspace drawer、view switch / more actions。
- 桌面折叠态的“展开侧栏”按钮应触发 desktop sidebar toggle，不要打开 mobile sidebar modal。
- header 的可拖拽区域和按钮点击区域要同时验证：主区域需要支持窗口拖拽，按钮和 tooltip target 必须 `no-drag` 且可点击。

## Sender Select 密度约束

- 手机端 / compact 交互断点是 `600px`，由 `useResponsiveLayout` 统一提供；进入该断点后 select 使用移动抽屉。
- select 的视觉收缩不跟 `600px` 绑定，而是跟 `.sender-container` 的 `sender-history` container 宽度绑定。
- 当前收缩顺序按用户常用程度从低到高：adapter `820px`、account `700px`、effort `560px`、model `430px`。
- 中等桌面宽度下仍使用 Ant Select / Popover 交互，但可以通过 container query 只显示图标；不要为了图标化提前切到移动抽屉。
- `model / effort / account` 的 shell 需要保留稳定 class：`sender-select-shell--model`、`sender-select-shell--effort`、`sender-select-shell--account`，便于容器宽度规则和 CDP 回归断言。
- `account` 的外层 shell 宽度必须和视觉按钮同步；避免 flex item 按 max-content 撑出右侧空白。

## 账号额度和头像

- 聊天状态栏和账号下拉的额度数据统一走 `src/hooks/use-adapter-accounts-with-quota.ts`；先展示账号列表快照，再通过带 `refresh: true` 的账号请求刷新，不要在各个 surface 内重复请求或各自维护 TTL。
- 五小时 / 七天窗口统一由 `src/utils/account-quota.ts` 解析，并复用 `src/components/account-quota/QuotaUsageRing.tsx`；配置详情、状态栏和下拉选项不要各自猜测 metric id、label 或百分比语义。
- `AccountAvatar` 只消费 adapter 返回的 `avatarUrl`，缺失或图片加载失败时使用本地确定性像素头像；浏览器端不得读取 Codex auth 或自行调用 ChatGPT profile 接口。
- 状态栏额度环必须放在 `.sender-select-shell--account` 外部，与 select 作为 `.chat-status-bar__account-group` 的 sibling；整个 group 是 popup 宽度锚点。不要把额度环塞进 select shell，否则 trigger 内容会被挤压，popup 也只会继承账号文本宽度。
- 账号选项内也要展示对应账号的额度，避免 trigger 与 popup 信息密度不一致。
- 改这条链路时至少覆盖共享额度解析、账号详情、状态栏和下拉列表，并用真实账号刷新验证头像 URL、5h / 7d 两个窗口及图片加载结果。

## Sender 上方 Composer Card 设计约束

- sender 上方的信息卡片统一视为 `composer card stack`，不要为 TODO、thinking、ask-user-question 各自维护一套独立容器样式。
- 这类卡片优先复用 `ChatComposerCard`；新信息块先接入统一 card，再谈局部样式差异。
- `composer card stack` 与 sender 之间默认不留额外空隙；宽度、边框和背景基调保持一致，视觉上应是一组连续的信息层。
- 堆叠时只有最上方卡片保留上圆角，只有最下方的 sender 保留自己的完整圆角；中间卡片不应出现额外圆角或断开的分组感。
- sender 上方卡片的展示优先级固定为：`todos`、`steer messages`、`next messages`、`ask user questions`；当前未接入的项也按这个顺序预留。
- TODO 卡片默认折叠；折叠/展开时只让 body 参与动画，不要让 header 高度跳变。
- TODO、thinking、ask-user-question 在信息密度上保持一致，优先通过布局收紧层级，不要只靠压缩 `padding` / `margin`。
- 标题区的图标、字号、字重、行高应复用同一套节奏；ask-user-question 不应出现比 TODO 更重或更大的标题视觉。
- 卡片表面保持简洁：不加阴影，背景色与 sender 基本一致；需要状态区分时优先用图标、文案和轻量色差，不单独造一套强强调背景。
- 选项型列表默认纵向一行一个；说明信息放进 tooltip 或其他延迟展示入口，不直接铺在主列表里。
- 选项 hover 优先做背景色和边框色过渡，避免通过新增/移除 border 造成闪烁或布局抖动。

## Sender import 约定

- `Sender` 及其子组件按固定顺序组织 import：
  1. 本文件样式
  2. 第三方依赖
  3. workspace 包
  4. `#~/` 绝对路径
  5. 当前目录相对路径
- 每个 group 之间保留一个空行。
- sender 目录内部，同子模块兄弟文件继续使用相对路径。
- sender 入口或跨子模块引用模块私有实现时，优先显式指向 `@components / @core / @hooks / @types / @utils / @store`，避免重新打平目录边界。

## 改动时容易漏掉的地方

### 1. i18n

- 新增或调整消息操作文案时，同时更新：
  - `src/resources/locales/zh.json`
  - `src/resources/locales/en.json`

### 2. 可编辑内容类型

- `Sender` 支持 `ChatMessageContent[]`，但 inline edit 只应该接受 `text / image`。
- 如果在 `MessageItem` 里直接把 `ChatMessageContent[]` 当成可编辑内容使用，`typecheck` 很容易在 `tool_use / tool_result` 分支上失败。

### 3. 真实界面验证

- 这块交互非常依赖真实布局、hover 和按钮语义。
- 只跑单测或后端测试不够；改完必须用真实 Chrome 回归。

### 4. 临时脚本脆弱性

- 浏览器验证不要强依赖易变按钮文案。
- 更稳妥的是依赖 `aria-label`、稳定类名或结构断言。

## Sender / 浮层调试经验

- `ChatHeader` 需要同时保留显式和隐藏两条调试入口：
  - 右上角 `更多` 左边的 debug 状态按钮默认隐藏，只有当前 URL 已经带 `debug` query 时才显示；显示后点击按钮切换 URL 上的 `debug` query。
  - debug 状态切换只在 `debug=true / debug=false` 之间切，不要通过按钮把 `debug` query 直接删掉。
  - 标题支持隐藏调试入口：连续点击标题 5 次时，同样切换 URL 上的 `debug` 状态；不能只留在 console 里。
- 只要 URL 上存在 `debug` query，就视为 debug 模式：
  - `debug=true` 才算真正开启调试模式；`debug=false` 只保留入口，不展示调试内容。
  - 调试元信息展示在 `settings` 视图，不再展示在标题下面。
  - 消息时间戳只在 `debug=true` 时展示。
  - 后续如果继续精简 header 或 settings，也要保留这条 query 驱动的可见调试通路。
- `Sender.tsx` 同时组合了 `Tooltip`、`Popover`、`Select` 和自定义 trigger；一旦外层包装组件不透传 `ref` 或 DOM props，触发器很容易直接失效。
- 包装触发器时不要用无效 DOM 结构，例如 `span` 包 `div`；这类 nesting warning 往往伴随点击异常。
- 同一个控件如果既有 tooltip 又有 popup，popup 打开时要显式禁用 tooltip；否则 hover 层会抢事件或扰乱 focus。
- 自定义 select 箭头后，必须分别验证：
  - 文本区能打开
  - 箭头区能打开
  - 关闭后 focus 回输入框
- sender 的颜色改动要谨慎收窄 selector，避免把下面这些一起误伤：
  - 最高推理强度图标
  - 权限菜单勾选图标
  - 发送按钮
  - disabled / hover / selected 态
- 通用 tooltip 的字号、min-height 这类全局表面样式，优先改 `src/styles/global.scss` 或主题配置，不要只在 sender 局部覆盖。
- 调 tooltip / popover / 主题样式后，先 reload 页面，再看 computed style 和 console warning；隐藏浮层节点和旧 bundle warning 很容易导致误判。

## Sender 最小回归清单

1. `更多` 主菜单能打开，权限二级菜单能展开。
2. 模型和推理强度的文本区、箭头区都能打开。
3. popup 打开时不会叠出自己的 tooltip。
4. popup 关闭后输入框重新获得 focus。
5. reload 后没有 React DOM nesting warning，也没有 Ant deprecation warning。
6. 同时检查浅色 / 深色主题下的 tooltip、勾选图标、推理强度图标和发送按钮。

## 推荐调试顺序

1. 先看 `ChatHistoryView.tsx`，确认父层状态是不是放对了。
2. 再看 `MessageItem.tsx`，确认消息级入口和 sender 挂载点。
3. 如涉及输入能力，再看 `Sender.tsx`。
4. 如涉及消息操作请求，再看 `src/hooks/chat/use-chat-session-actions.ts` 和 `src/api/sessions.ts`。
5. 最后回到真实 Chrome 做界面验证。

## 推荐回归命令

```bash
pnpm tools message-actions verify
```

如果需要只看最终结果，不看中间子命令输出：

```bash
pnpm tools message-actions verify --quiet
```

进一步的经验和工具说明见：

- `../../../../../.oo/rules/maintenance/message-actions.md`
- `../../../../../.oo/rules/maintenance/tooling.md`
