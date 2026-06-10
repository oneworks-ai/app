# Components 模块说明

`src/components/` 承载跨 route 复用的前端视图组件、应用壳、NavRail、Sidebar、通用列表与通用浮层入口。页面私有内容优先留在 route 或模块私有目录；只有跨多个页面或布局复用时才提升到这里。

## Overlay / Menu 约定

- 修改 `NavRail`、`Sidebar`、右键菜单、底部菜单、二级菜单或其它通用浮层前，先确认是否已有通用渲染组件可以复用。
- 入口菜单、右键菜单和二级菜单的结构化数据应优先复用 `src/components/nav-rail-more-menu.tsx` 里的菜单 item / section 抽象，或先扩展这个抽象；不要在局部组件里直接拼 AntD `Dropdown menu.children` 后只补少量 class。
- 如果某个业务入口需要注入额外 action，应通过外部传入的结构化配置或 render slot 接入，通用组件只负责触发、布局、选中态、图标态和 submenu chevron。
- 二级菜单必须和一级菜单使用同一套图标尺寸、active / selected 规则、hover 颜色和 popup class；新增菜单能力后要同时看浅色、深色和 hover / submenu open 状态。

## 常见落点

- `NavRail.tsx` / `NavRail.scss`：桌面端左侧 rail、折叠窗口栏、底部更多菜单和 compact drawer。
- `nav-rail-items.tsx`：主导航页面入口的唯一数据源。新增或调整固定展示在侧边栏顶部的真实页面入口时先改这里，再让 `NavRail`、compact drawer 和嵌入 `SidebarHeader` 消费同一份结果；不要在某个视图里单独硬编码一份入口列表。`设置`、`已归档会话` 这类次级全局页面入口属于底部 More 菜单，不放进主导航入口列表。插件市场只覆盖 `/plugins` 与 `/plugins/:scope`，插件注册的 `/plugins/:scope/:routeId` 入口由对应 plugin nav item 自己激活。
- `Sidebar.tsx` / `sidebar/SidebarHeader.tsx`：主导航 quick links 承载会话、定时任务和插件的唯一父入口，不要再额外渲染同语义 primary action。父入口按路由变形：创建态显示创建中的文案并激活，具体子项详情态显示创建动作但不激活，其他页面显示列表 / 市场文案且右侧 action 才提供独立创建按钮。
- `PluginStoreRoute.tsx`：插件市场 / 创建插件的切换入口归属侧栏插件父入口右侧 action；不要在 route header 里再放市场 / 创建的双按钮切换。
- `nav-rail-more-menu.tsx`：底部菜单、外部注入菜单和可复用菜单 item builder。
- `Sidebar.tsx`：侧边栏数据装配、route sidebar 接入和列表状态。
- `sidebar/SidebarHeader.tsx`：侧边栏顶部入口区、搜索区、入口 actions 和入口右键菜单触发。
- `interaction-list/`：通用交互列表，只处理 selection、item 渲染、context menu 触发和外部 action 调用，不承载具体业务语义。

## 验证

- 浮层、右键菜单、submenu、hover、focus 和 active 图标态改动后，必须在真实浏览器里打开对应页面验证，不只跑类型检查。
- 至少验证：popup 是否打开、submenu 是否使用统一样式、hover 后图标颜色是否正确、点击 action 是否只触发外部传入回调。
- 顶部 chrome 图标、图标按钮和 header 内容高度只有一个全局来源：`--app-chrome-icon-size`。`--app-chrome-content-height` 只能作为它的语义别名，整条 chrome 高度只能从 `--app-chrome-overlay-height` / `--route-container-header-overlay-height` 派生，并且该 overlay 高度必须包含 `--app-chrome-border-width`。Route header、带红绿灯的折叠窗口栏、route panel tabs / close actions 都必须引用这些 token 或引用只从它们派生的本地别名。不要再新增独立的 `*-icon-button-size`、`*-bar-height` 或局部 `20px` / `18px` / `40px` 覆盖。
- 顶部 chrome 动作按钮间距统一走 `--app-chrome-action-gap`，折叠窗口栏和 route header actions 要同步引用，不要分别硬编码 gap。
- 折叠窗口栏当前就在 `/` 新会话时，普通 Web、Electron 和 `__oneworks_desktop` 模拟态都不显示 `nav-rail-create-session-indicator`，也不要为这格新建会话 action 预留宽度；Electron / 模拟态仍保留历史导航和对应宽度计算。
- 折叠窗口栏里的红绿灯必须脱离会动画的栏位容器；不要把 `transform`、`filter` 或 `backdrop-filter` 放在它的祖先节点上，需要毛玻璃时用伪元素承载视觉效果，避免 fixed 定位在折叠动画里跳动。红绿灯尺寸和位置是固定锚点；需要修折叠态垂直对齐时，调整旁边 actions，不要改红绿灯高度或 `top`。
- 展开态 `NavRailWindowBar` 在 macOS 原生红绿灯占位和调试页模拟红绿灯时必须使用同一个顶部锚点；`has-reserved-window-controls` 与 `has-window-controls` 都应保持 `top: 0`。不要只修模拟态或只修折叠态，否则 Electron 展开态会比折叠态和调试页向下偏移。
- 普通 Web 展开态 `.nav-rail` 父容器必须保留侧栏背景；只有 `.app-shell--window-controls-reserved` 这种需要避让 macOS 原生/模拟红绿灯的窗口控制预留区，才允许把展开态 `.nav-rail` 父容器置为透明，并把侧栏背景下放到 `.nav-rail-drawer-body` / `.nav-rail-drawer-footer` 等真实内容区域。真实或模拟 macOS vibrancy 场景里，`.nav-rail`、`.nav-rail-drawer-body`、`.nav-rail-drawer-footer`、`.sidebar-container` 和 `.sidebar-utility-footer` 都必须保持透明，不能用下放的实色背景盖住毛玻璃。真实 Electron 的 `.app-shell--macos-vibrancy:not(.app-shell--desktop-simulation)` 顶层背景必须保持透明，并且不能再叠 CSS `backdrop-filter` 或 sidebar tint `::before`；原生窗口已经提供 vibrancy，额外 Web 背景会让 titlebar 和 sidebar 颜色不一致。浏览器里的 macOS 调试模拟态才可以用同一个 pseudo 和 `--app-shell-vibrancy-sidebar-bg` 模拟侧栏毛玻璃，并覆盖全窗口模拟背景。不要直接复用内容 surface token，也不要给 `NavRailWindowBar` 或红绿灯祖先加有色背景。`NavRail.scss` / `Sidebar.scss` 会晚于 `AppShell.scss` 注入，涉及 `.app-shell--macos-vibrancy` / `.app-shell--window-controls-reserved` 的透明规则要在真实背景 owner 内同步兜底；不要把 Electron 红绿灯透明需求全局套到 Web，也不要把背景色重新加到 `app-shell--window-controls-reserved` 整体背景。
- macOS 红绿灯只在非全屏窗口态展示和占位；模拟全屏或原生全屏时，`NavRailWindowBar` 不能继续渲染红绿灯，也不能继续使用红绿灯 offset 计算折叠态宽度。
