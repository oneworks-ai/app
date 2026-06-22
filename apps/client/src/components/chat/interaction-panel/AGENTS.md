# Interaction Panel 维护说明

本目录承载聊天页底部 / 右侧复用的交互面板，包括 iframe/webview 页面、页面调试器、移动调试、运行命令、workspace tabs 和 dock workspace。

涉及 webview / iframe 更多菜单里的“同步数据”“密码管理”“历史记录”“下载内容”入口、Electron-only gating 或从当前网页 tab 进入管理页的默认项目 / 会话范围时，同时阅读 `../../../../../../.oo/rules/maintenance/browser-data-management.md`。

## 关键入口

- `InteractionPanelIframeView.tsx`
  - iframe / webview 页面容器、地址栏、刷新、页面调试器右侧 dock、设备尺寸工具栏和 Chii target 自动注入。
- `InteractionPanelPageDebuggerListView.tsx`
  - 页面调试器列表 tab；只展示目标列表和内联 devtools iframe，不展示额外工具栏。
- `interaction-panel-iframe-debug.ts`
  - Chii target 脚本拼接和 iframe / webview 注入能力。
- `apps/client/src/api/web-debug.ts`
  - Chii runtime / targets API 封装和 devtools URL 构造。
- `apps/server/src/services/web-debug/chii-devtools-assets.ts`
  - Chii devtools HTML / legacy script / patch script / CSS 注入层。修改 DevTools 内部 toolbar、dock menu 或设备按钮时从这里开始。

## 页面调试器排查经验

- Web 页面调试器的 devtools iframe 会刻意用隔离 origin：外层页面可能是 `127.0.0.1`，devtools iframe 可能是 `localhost`。这能避免同源互相干扰，但父页面脚本不能直接读取 devtools iframe DOM；排查时不要把“父层读不到 DOM”误判为 patch 没生效。
- 判断 Chii patch 是否生效，优先直接检查资源响应：
  - `/__oneworks_chii__/front_end/chii_app.html` 是否注入了 `oneworks-devtools-bootstrap.js`、`oneworks-devtools-patch.js` 和 `oneworks-devtools.css`。
  - `/__oneworks_chii__/front_end/ui/legacy/legacy.js` 是否包含 `__ONEWORKS_DEVTOOLS_REWRITE_TOOLBAR_ITEM__`。
  - `/__oneworks_chii__/oneworks-devtools.css` 是否包含当前预期覆盖。
- `apps/server/src/services/web-debug/chii-devtools-assets.ts` 是服务端拼接资产；只改这里时 Vite HMR 不一定能让 `/__oneworks_chii__/` 响应更新。排查前先用 `chii_app.html` 里的 `oneworks-devtools-patch.js?v=...` 确认版本，必要时重启 `pnpm tools dev-start web`。
- 宿主 iframe toolbar 和 DevTools 内部 toolbar 是两套样式。修改 DevTools 内部 toolbar 应放在 `chii-devtools-assets.ts` 的 patch CSS / JS；不要通过 `ChatInteractionPanel.scss` 改宿主 `.chat-interaction-panel__iframe-toolbar` 来迁就 DevTools。
- 页面调试器日志默认关闭。需要排查宿主注入和 target 轮询时，在外层页面 URL 加 `oneworks_debug=1`。不要把普通 `oneworks_debug=1` 透传成 DevTools iframe 内的协议 WebSocket monkey patch；需要协议日志时用单独的 `oneworks_protocol_debug=1`。
- `apps/client/src/api/web-debug.ts` 读取 Chii runtime 必须固定走当前 Web 宿主 origin 的 `/api/web-debug/chii`，不能走通用 `fetchApiJson` / `getServerBaseUrl()`。workspace 页面会把 API base 切到 workspace server；如果页面调试器跟随这个 base，target.js 和 devtools iframe 会连到 workspace server 端口，重启或端口变化后就会出现 `/__oneworks_chii__/targets` 为空、Elements 空白或 devtools iframe 停在旧端口。
- `target.js` 应优先用浏览器当前 origin 的 `/__oneworks_chii__/target.js?oneworks_chii_server_url=...` 注入目标页，避免同源 iframe 的 CSP 拦截跨端口脚本；脚本内部通过 `window.ChiiServerUrl` 指向当前 runtime server，DevTools iframe 可以继续使用隔离 origin。
- Chii 默认把 target id 放在 `sessionStorage['chii-id']`，同源多 iframe 会共享并互相覆盖。自动注入时必须先写入当前 panel 独立 target id，并在打开 / 健康检查时优先按这个 id 找 target；遇到 Elements 空白先查 `/__oneworks_chii__/targets` 是否还有该 id。
- DevTools 内部 toolbar 尺寸和背景色由宿主 iframe toolbar 的 computed metrics 通过 devtools URL 参数传入；排查高度 / padding / 背景色时，先确认 URL 上的 `oneworks_toolbar_icon_size`、`oneworks_toolbar_total_height`、`oneworks_toolbar_background_color` 是否存在，再看 patch CSS。
- Chii 左上角的尺寸入口可能不是标准 `emulation.toggle-device-mode`，而是 `ScreencastApp.ToolbarButtonProvider`；接管设备尺寸按钮时要在 legacy toolbar registry 层处理这两个来源，并保证同一轮只注册一个 OneWorks 按钮，避免 native 和自定义按钮重复。
- 给 devtools iframe 发 `postMessage` 前，必须确认 iframe 已经离开初始 `about:blank`。初始窗口会继承外层 `127.0.0.1` origin，即使最终 `src` 是 `localhost`，过早按 URL origin 发送也会触发 target origin mismatch；iframe `load` 后要同步 dock 和 device 两类状态。
- 相关日志前缀：
  - `[web-debug]`：runtime、targets 和 devtools URL 构造。
  - `[iframe-debug]`：宿主侧注入、target 轮询、postMessage 收发和 dock/device 状态同步。
  - `[oneworks-devtools]`：devtools iframe 内部 bootstrap、toolbar registry rewrite、dock menu 注入、shadow root style 注入和父层 message。
- DevTools 原生 toolbar 有自己的尺寸规则。Chii 的 `.tabbed-pane-header-tab` 原生高度是 `26px`，外层 `.tabbed-pane-header` 可能因为分隔线显示为 `27px`；遇到高度问题先区分“原生值回来了”还是“我们的覆盖没加载”。

## 上下文捕获与页面标注经验

- 页面标注的目标会话必须来自创建标注入口所属的 session / interaction panel owner，不要从被标注页面的 URL 反推。iframe 里打开 One Works、其他页面或嵌套会话时，页面 URL 只作为证据来源。
- 标注输入框和标注点都应锚定用户点击位置。元素 rect 只用于 hover 高亮、信息卡和截图 overlay；不要把输入框固定贴到元素边缘，否则大元素或容器边界附近会显得跳位。
- 标注模式里打开输入框后要暂停 hover capture layer。此时不应继续检测其他元素，也不应触发底层页面 hover 效果；Esc 先关闭当前选中 / 输入框，再决定是否退出标注模式。
- 待发送的标注点必须和 sender 上方 pending annotation 引用绑定。进入标注模式时展示点，退出时隐藏；从 sender 移除引用后，iframe/webview 侧对应点也要消失。
- pending text selection、annotation chip、message comment chip 这类浮层预览应通过全局 portal / fixed positioning 展示，避免被 iframe/webview、split pane 或 sender 容器裁剪。
- iframe 场景不要承诺可用页面截图：同源 iframe 可以读 DOM，但 canvas / foreignObject 截图容易受跨域图片、字体、样式和浏览器安全策略影响。Electron webview 场景优先用 `capturePage()`，普通 iframe 标注可以只发送结构化证据。
- 标注 hover 高亮的圆角应跟随目标元素 computed `border-radius`，但 overlay 自身必须 `pointer-events: none`，避免改变目标页面 hover 状态。
- 标注 toolbar 状态要成组处理：进入标注模式后隐藏截图按钮，注释按钮变为 active 并显示“注释中”；再次点击或按 Esc 能退出。新增 toolbar action 时同步检查标注 active 态，不要让多个互斥捕获入口同时可用。
