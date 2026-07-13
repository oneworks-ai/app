# Layout Components Guide

`src/components/layout/` owns the client app shell adapter such as `AppShell`, client-specific `RouteContainerHeader`, route sidebar context, and React Router adapters for shared route layout primitives. The dependency-light `RouteContainerLayout` and shared host shell frame live in `packages/route-layout`; client code should wrap them here when router state, shell state, antd, jotai, i18n, NavRail, or desktop shortcuts are required. Keep route-specific content and mock data in `src/routes/`; layout components should only accept structured props, slots, and callbacks.

## 第一原则

- 布局和交互机制归布局组件。外部 route、plugin adapter、tool surface 不应该重新实现 header 定位、panel resize、tab chrome、关闭动画、focus / hover 样式、图标尺寸、折叠侧边栏 chrome 或 panel 持久化机制。只要外层为了让布局表现正确而复制 CSS、DOM 结构或重复交互状态，就说明组件 API 缺能力，需要沉淀到组件内部。
- 通用能力必须收敛到布局组件，而不是在调用处补丁式修。典型能力包括 side / bottom slots、panel 关闭动画、可 resize 的右侧 panel、共享 panel tab 交互、header action active 图标、统一 chrome icon token、右键菜单注入点、传给 slot 的 route path context。新增时优先设计结构化 prop、callback、slot context field 或共享 token，不写只服务单页的 route CSS / 本地状态。
- 业务扩展点留在组件外部。插件 action、route-specific menu sections、自定义 tab 列表、item filter、选中项详情、分析 / debug 内容都耦合业务路由或插件系统。布局组件只提供 slot 和能力，外部 route / plugin 层负责决定有哪些扩展、如何持久化、如何映射到产品概念。
- 依赖方向必须保持为：可复用布局组件拥有 chrome 与交互契约；route 层拥有业务状态和持久化；plugin / tool integration 拥有扩展注册和策略。不要让 layout import route 业务数据，也不要让 plugin 代码了解 layout DOM 细节。

## 职责边界

新增 route container 代码前先按这个边界判断：

- 放到 `packages/route-layout`：跨 app 可复用且不依赖 client 私有状态的 route surface、body、右侧 / 底部 panel 放置、panel resize、关闭动画、基础 header 结构、host shell frame、HostAppShell content surface、HostNavRail slot 外壳、移动端侧栏 modal/focus、桌面折叠侧栏 preview、focus / hover 样式、共享图标尺寸和 padding token。
- 放到 `src/components/layout/`：client app shell adapter 或 client-only chrome，包括把 `AppShellFrame` 接到 React Router / jotai / i18n / desktop shortcut / NavRail 的 `AppShell`、带 antd 的 `RouteContainerHeader`、React Router location adapter、route sidebar context 和 panel tab workspace。
- 放到 route 层：业务状态或 route policy，包括当前激活入口、panel 是否可见、哪些 tab key 可用、URL / query 持久化、选中项数据、filter 值、route-specific menu sections，以及 body / side / bottom slot 内渲染的真实内容。
- 放到 plugin / tool integration 层：扩展注册，包括哪个 plugin 贡献 action、action 暴露在哪里、权限 / 可见性如何判断，以及业务扩展点如何映射成 route-owned slot 或结构化配置。
- 如果调用方开始写 route-local CSS selector、重复 tab state、复制 resize 逻辑、手动定位 panel、或手写一组 header action button，应先停下来判断是否需要给布局组件补一个结构化 prop / slot / callback。
- 如果需求里出现 plugin、session、request、resource、operation、workspace、account、analytics 等业务名词，不要把这些名词 import 到 layout 组件里。由 route / plugin 层把它们翻译成通用布局 props 或 slot content。

判断流程：

1. 先尝试现有 prop / slot：`header`、`children`、`sidePanel`、`bottomPanel`、`actionItems`、`breadcrumb`、`sidePanelResize` 或 panel dock tab / menu props。
2. 如果现有 API 缺少的是通用布局能力，扩展 layout 组件的结构化 API，并同步更新这里和 JSDoc。
3. 如果需求是业务 / 插件扩展点，由 route 层通过布局 slot 或结构化布局数据暴露出来。
4. 不要用隐藏 route CSS、DOM query、硬编码像素值或业务 route 内的布局状态来绕过通用组件能力缺口。

## 扩展点模式

Route container 组件只提供能力，不拥有插件扩展注册表。需要插件扩展点的 route 应按下面的形状接入：

```text
const extensionActions = pluginRegistry.resolveHeaderActions(routeContext)
const panelTabs = pluginRegistry.resolvePanelTabs(routeContext)

<RouteContainerLayout
  header={<RouteContainerHeader actionItems={extensionActions} title={entryTitle} />}
  sidePanel={routePanels.includes('side')
    ? context => (
      <RouteContainerPanelDockWorkspace
        activeTab={sidePanelTab}
        openedTabs={openedSidePanelTabs}
        tabs={panelTabs}
        onTabChange={persistSidePanelTabs}
      />
    )
    : undefined}
>
  {context => renderRouteBody(context)}
</RouteContainerLayout>
```

- Plugin registry 可以决定有哪些 action / tab，但它应该返回 route-owned 的结构化数据或 render function。它不应该知道 route header DOM class、panel DOM 结构、resize handle 或动画时序。
- Layout 组件不直接调用 plugin registry，只渲染收到的 slot 和结构化 props。
- 多个 route 需要同一种扩展点形状时，先做 route-level adapter / helper，把 plugin 数据映射成 layout props。只有当行为已经不再耦合业务时，才移动到 layout 组件。

## Route Container Layout 使用方式

需要固定 route header、主内容区、可选右侧 / 底部区域的页面都应使用 `RouteContainerLayout`。调用方先派生业务状态，再把受控 slot 传给布局：

```text
<RouteContainerLayout
  className='my-route-layout'
  header={
    <RouteContainerHeader
      actionItems={headerActions}
      breadcrumb={breadcrumb}
      icon={routeIcon}
      title={routeTitle}
    />
  }
  sidePanel={isSidePanelOpen
    ? ({ path, search, isClosing }) => (
      <MyRouteSidePanel
        isClosing={isClosing}
        path={path}
        search={search}
        state={routePanelState}
        onTabChange={persistPanelTab}
      />
    )
    : undefined}
  bottomPanel={isBottomPanelOpen
    ? ({ path, isClosing }) => (
      <MyRouteBottomPanel
        isClosing={isClosing}
        path={path}
        onClose={() => setBottomPanelOpen(false)}
      />
    )
    : undefined}
  sidePanelResize={{
    defaultWidth: 300,
    maxWidth: 520,
    minWidth: 240,
    resizeLabel: t('common.resize'),
    storageKey: `my-route:${routeKey}:side-panel-width`
  }}
>
  {({ path }) => <MyRouteBody path={path} />}
</RouteContainerLayout>
```

使用时的职责划分：

- Layout 负责：header / body / panel 放置、右侧 panel resize plumbing、panel enter / exit retention、底部 panel 关闭时序、共享 chrome tokens，以及给 slots 传 URL context。
- Route 负责：panel 可见状态、active / opened tab state、selected item、filter state、右键菜单数据、插件扩展注册、URL / query 持久化，以及每个 slot 里真实渲染的内容。
- Plugin / tool caller 只把结构化扩展注册到 route-owned 层。不要直接改 route header 样式、手动定位 panel、直接操作 layout DOM、或复制布局交互。
- 只要 panel 内容需要 `path`、`pathname`、`search`、`hash` 或 `isClosing`，就使用 function slot。只有完全静态、不依赖 URL context / 关闭动画的内容才用普通 ReactNode。
- 关闭 panel 通常只移除 visible-panel flag。除非业务 route 明确提供 reset / forget 行为，否则保留 active tab 和 opened tab history。
- 如果 route 需要新的通用布局行为，先加到这个组件族；如果行为是业务特定的，就暴露 slot / callback / context field，让业务规则留在 route / plugin 层。

## Route Container Header

- `RouteContainerHeader` supports normal title mode, breadcrumb mode, collapsed sidebar mode, and externally supplied right-side action items. Do not infer route business state inside the component; pass breadcrumb/action configuration from the route layer.
- `route-container-inline-breadcrumb` owns sticky inline breadcrumb behavior for scrollable route bodies. Keep top sticking, background coverage, border, icon sizing, and padded-container bleed (`--route-container-inline-breadcrumb-bleed-inline`) in this shared style; route and plugin pages should only pass breadcrumb data or override the documented CSS variables.
- Mobile static workspace headers, WebView page headers, and tabs overview headers should reuse the shared route chrome shape through `RouteChromeHeader` instead of cloning `RouteContainerHeader` markup or hard-coding a second header. `RouteContainerHeader` remains the route-level overlay/breadcrumb adapter; static in-content chrome should use the shared static chrome variant and receive business actions from the route/drawer layer.
- Header content height, icon visuals, and icon button slots ultimately use the single global chrome size token `--app-chrome-icon-size`, currently `18px`. `--app-chrome-content-height`, `--route-container-header-icon-size`, and `--route-container-header-icon-button-size` are only semantic aliases; title icons, breadcrumb back icons, breadcrumb separators, and action icons must share this fixed visual size.
- Do not introduce local `20px`, `22px`, `24px`, or a new `*-icon-button-size` token for route header / panel chrome without changing `--app-chrome-icon-size` and verifying every header and panel mode.
- Collapsed-sidebar header mode must keep the same overlay height as normal mode. The left `NavRail` collapsed window bar should use the same global chrome tokens for height, button size, action gap, max width, and trailing padding. Its width calculation belongs on the shared shell scope, not on the bar element alone, because `RouteContainerHeader` also needs the same computed width for its collapsed margin.
- Collapsed `NavRail` with macOS window controls must not define its own `*-bar-height`; it still uses `--route-container-header-overlay-height`, with left padding adjusted for traffic-light spacing and right padding kept at `--route-container-header-padding-inline` so route titles do not sit tight against the last action. Height changes should happen through `--app-chrome-icon-size` / `--app-chrome-padding-block` / `--app-chrome-border-width`, then flow into both route header and NavRail.
- SVG and image icons inside the header must render through `renderIconAsset` with the route header classes so active/inactive icon assets keep the same dimensions as Material Symbols.

## Route Container Layout

- `RouteContainerLayout` owns only the shell slots: header, main route body, optional right-side panel, and optional bottom panel. The route layer decides when those panels are open and what they render.
- Right and bottom regions must be passed through `sidePanel` / `bottomPanel` slots. Do not hard-code route business panels, terminal content, workspace content, or mock data into the layout component.
- Right-side panel fullscreen is a shared layout capability. Routes control the boolean state with `sidePanelFullscreen` and expose the toggle through panel chrome actions; `RouteContainerLayout` owns covering the main route area, z-index, exit retention, animation, and disabling resize while fullscreen. Fullscreen transitions should morph the same side panel from its configured width to the full route width instead of swapping in a faded overlay. Do not implement a second fullscreen drawer in chat, Agent Room, or route CSS.
- Fullscreen right-side panel chrome must reserve the collapsed `NavRail` window bar using the same shell variables as `RouteContainerHeader`: `--nav-rail-collapsed-window-bar-width` capped by `--nav-rail-collapsed-window-bar-max-width`. This offset must stay on the shared side-panel / panel-tab chrome path so Electron, desktop simulation, macOS fullscreen, traffic-light spacing, and route window actions follow the same calculation as the header. Do not hard-code local fullscreen left padding or apply route-specific tab offsets.
- `NavRail` More 菜单的内置项只保留通用偏好设置，即主题切换和语言切换。设置、归档、插件调试命令、页面专属 action、入口显隐控制等都属于 route / plugin 层扩展，应通过 `route.moreMenu.items`、`nav.moreMenu` 或 `RouteMoreMenuOverride.sections` 注入，不要在 NavRail / layout 组件里写固定业务入口。
- Compact `NavRail` 的 More sheet 必须消费结构化 menu sections，而不是把 menu / submenu / custom item 拍平成一组按钮。`RouteMoreMenuOverride.contextMenuSections` 只属于桌面右键菜单，不允许混入 compact sheet 的普通 action 列表；如果移动端需要右键 / 长按语义，应单独设计 context action 入口。
- Route side-panel chrome should reuse the route header padding tokens: `--route-container-header-padding-block` and `--route-container-header-padding-inline`. The shared header padding tokens are currently `10px`; tab/action/close icon size must stay tied to `--app-chrome-icon-size`, not route header content height. Dockview tab headers and empty dock headers must use `--route-container-panel-chrome-height`, which is calculated from `--app-chrome-icon-size`, the panel's own `--route-container-panel-dock-header-padding-block`, and `--route-container-panel-chrome-border-width`. Do not replace that with `--route-container-header-overlay-height` in panels that have different vertical padding, especially bottom panels.
- Route pages that need to open or close the shared sidebar from route content should use `useRouteContainerSidebarOpener`. Do not duplicate the mobile drawer vs desktop collapsed-sidebar branching in each page.
- Routes that need special bottom-panel vertical padding should only override the existing panel padding token (`--route-container-panel-dock-header-padding-block`) and, if a sibling dock header needs the same height, the existing `--route-container-panel-chrome-height`. Do not introduce route-specific height aliases such as `--some-route-bottom-panel-chrome-height`.
- Dockview header wrappers such as `.dv-react-part` inside `.dv-tabs-and-actions-container` should also be constrained to `--app-chrome-icon-size`; Dockview writes inline `height: 100%` on that wrapper, so the shared panel CSS must override the wrapper height instead of adding panel-specific variables.
- Bottom-panel chrome should still reuse the same content-height and inline padding tokens, but its vertical header padding is intentionally half of the inline padding to keep the dock header visually lighter. Keep that relationship token-based instead of hard-coding a separate pixel value.
- Slot render functions receive the same path context as the main body. Use that path context in the route layer when a panel needs URL-aware content instead of reading route-specific state inside layout.
- Bottom-panel slots that need close animation should be function slots and use the `isClosing` value from `RouteContainerLayoutSlotContext` to render their controlled panel chrome with `isOpen={false}`. Do not pass a static ReactNode and rely on layout unmount timing if the panel body needs its own exit motion.
- Bottom-panel fullscreen inset must derive from `--route-container-header-overlay-height` through `--dock-panel-fullscreen-inset-top`; the header overlay token already includes the chrome border width, so do not add a second local border offset or hard-code `40px`, `54px`, or any separate fullscreen top offset when route header height changes.
- Panel visibility and tab persistence are external state. When a route wants restore-on-return behavior, store visible panels, current tab, and opened tab history in query or route-owned state, then pass/omit `sidePanel` and `bottomPanel` from that state. Panel tab components should report both the next active tab and the accumulated opened tab list so the route can persist it; `RouteContainerLayout` must not write query params itself.
- Route side and bottom panel tabs that need chat-aligned interactions must use `RouteContainerPanelDockWorkspace`, not a local tablist. It owns the shared Dockview interaction contract: controlled active tab, externally persisted opened tab list, drag / split / floating groups, close fallback, tooltip titles, top-right group header actions, and optional right-click menu injection through structured callbacks. Right-click menu callbacks must receive whether the target is a concrete tab or blank tab-strip space, plus panel key, active/opened tabs, visible tabs, and tab metadata when present. Keep route-specific tab labels, visibility, menu items, content rendering, and persistence in the route layer; keep the visual sizing tied back to `--app-chrome-icon-size` through the route panel aliases so tab icons, header actions, close buttons, and collapsed chrome stay synchronized.
- Dock tab actions must resolve from the active tab of the current Dockview group through `getHeaderActions` or a route-owned action resolver that feeds into it. Do not attach tab-specific actions to a fixed parent header, because the same tab may live in the right panel, the bottom panel, or a split group. If a tab kind such as workspace tree, changed files, markdown file, or future Agent Room pane needs actions, expose those as structured action items from the tab/route layer so they follow the tab across placements.
- Dock panel chrome actions that do not belong to a specific tab, such as fullscreen and minimize, must be passed through `panelChromeActions`. Do not append these from chat / Agent Room / route-specific `getHeaderActions`; the shared dock owns their placement in the top-right group, empty dock header, tooltip behavior, icon sizing, and active icon switching. Route code only supplies labels and callbacks.
- Ephemeral tab status that must remain visible when Dockview collapses the owning tab belongs in the tab descriptor's structured `headerStatus`. The shared dock mirrors it in that group's visible chrome and makes it select the owning tab; callers own the status meaning and node. Do not query Dockview overflow DOM or add business-specific header selectors.
- Minimized bottom panels that contain `RouteContainerPanelDockWorkspace` must preserve that same dock workspace header and reduce the outer `DockPanel` height to the shared chrome token. Do not render a separate folded/minimized tab strip or `DockPanelHeader` for the minimized state; that duplicates tab styling, drops Dockview actions/menus, and loses the shared open/close height animation.
- `RouteContainerPanelDockWorkspace` must mark each Dockview panel content as visible or hidden from the Dockview panel API and force-hide descendants for hidden panels. Some reusable content such as project trees, change lists, and future Agent Room panes may use `visibility: visible` internally for virtualization or hover actions; inactive Dockview panels must still prevent those descendants from punching through into the active tab. Fix this at the shared dock content wrapper, not with route-specific CSS.
- Panel tab dividers are owned by `--route-container-panel-tab-divider-width`, currently `3px`, with the divider inserted only between adjacent tabs. Do not add first/last-child divider overrides in route-specific CSS.
- `RouteContainerPanelDockWorkspace` context menus must anchor from `document.body`, not from inside the dock or bottom panel DOM. Dockview groups and bottom panels can sit under transformed containers, which changes the containing block for `position: fixed` and makes cursor-positioned menus appear at the wrong viewport coordinates. Multiple panel workspaces can coexist on one route, so opening one context menu must close other route panel context menus.
- When a route panel needs a fixed "create / add" control on the left side of its tabs, pass `createMenuSections` to `RouteContainerPanelDockWorkspace`. The menu data must come from the route layer and should reuse `nav-rail-more-menu` sections/items so nested menus, selected state, shortcuts, and custom-rendered items stay visually consistent with other app menus. Keep the default create icon unless the product explicitly changes the shared visual language; the current default is the framed `add_box` icon used by the route container debug page, not the plain `add` icon.
- `RouteContainerPanelTabs` remains only for lightweight non-dock tab rows. Do not use it for route side or bottom panels when the user expects the same drag, split, and detach behavior as chat panel tabs.
- Closing a panel should usually remove only the visible-panel flag. Keep active tab and opened-tab history unless the route explicitly wants a "forget this panel" action; this lets a user close and reopen a panel without losing the previous tab context.
- New route container panel integrations should follow this sequence: read query/store state at the route boundary, derive whether each panel slot is present, pass function slots when the panel needs `path` / `search` context, and write active/opened tab changes back from panel callbacks. Do not create local `useState` inside panel tabs for restore-sensitive state.
- Resizable panels use the shared `usePanelResize` hook so NavRail, `RouteContainerLayout` side panels, and `DockPanel` keep the same pointer, keyboard, cursor, and cleanup behavior. Do not reimplement one-off resize listeners in route-specific panels.

## Verification

- After changing route header layout, verify normal title mode, breadcrumb mode, collapsed sidebar mode, and right-side active action icons in the browser.
- After changing mobile workspace / WebView chrome, also read `../../../../../.oo/rules/maintenance/mobile-workspace-webview.md` and verify the tabs overview header, opened tab header, search / URL input, card preview, and duplicate header actions.
- For breadcrumb changes, inspect both the selected element box size and computed icon size; they should match the header token rather than relying on inherited AntD button defaults.
- After changing route panel slots, verify main-only, right-panel, bottom-panel, and right-plus-bottom states in the browser.
