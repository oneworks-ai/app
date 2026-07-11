# 前端调试与回归

返回入口：[FRONTEND-STANDARD.md](../FRONTEND-STANDARD.md)

## 先分层，不要上来就猜样式

- 交互触发层：先确认事件有没有打到正确 DOM，popup / tooltip / select 有没有真的 open。
- 视觉层：再看 token、继承链和 computed style，不要只看 SCSS 文件。
- 运行层：最后再看热更新、旧进程、console warning 是否让你读到了旧状态。

## 浮层组件组合经验

- `Tooltip` / `Popover` / `Select` / `Dropdown` 外面如果再包一层组件，包装组件必须把 `ref` 和 DOM props 透传到真实触发节点；会话卡片、sender target 按钮这类直接作为 trigger 的自定义组件尤其容易漏。
- 避免 `span` 包 `div` 这类无效嵌套；这类 React nesting warning 往往会伴随触发器失效。
- 同一个控件同时拥有 tooltip 和 popover / select 时，popup 打开后要禁用 tooltip，不然 hover 层会抢事件或扰乱 focus。
- 自定义 select 箭头时，不要默认 body click 和 arrow click 都还正常；这两个触发区需要分别验证。

## 样式与 token 排查经验

- 全局表面样式例如 tooltip 字号、通用浮层排版、主题 token，优先改 `src/styles/global.scss` 或主题配置，不要只在局部组件里覆盖。
- 如果只想改一个图标或一个状态，selector 要收紧；过宽的 `color` 覆盖很容易误伤其他图标，比如最高推理强度、权限菜单勾选、发送按钮、disabled 态。
- 颜色回归先对照 `git diff` 或最近可用提交，不要凭印象重新猜一套 token。
- `xterm.js` 这类终端视图要分开看外层 surface、`.xterm-viewport` 和 renderer canvas；外层已经切到浅色，不代表 viewport 默认黑底不会继续漏出来。

## 真实界面验证

- overlay / tooltip / focus / hover 相关问题必须在真实 Chrome 回归，不要只跑单测。
- 优先读取这些指标：
  - popup 是否真的 open
  - `computed style`
  - `document.activeElement`
  - console warning
- 改完 tooltip / popover / 全局 token 后，先 reload 页面再读指标；隐藏浮层节点和旧 bundle warning 常常会误导判断。
- 修完一处 `findDOMNode` / trigger warning 后也要 reload 再看 console；同类问题常常会继续暴露下一处没有透传 `ref` 或 DOM props 的 trigger。

## Electron launcher 验证

- launcher 依赖透明窗口、毛玻璃、Electron preload/main IPC 和窗口尺寸；涉及这些能力时必须看真实 Electron 窗口，不要只看普通浏览器页面。
- 只改 client 视图通常可以依赖 HMR；改 main/preload、desktop settings、文件系统搜索或窗口行为后必须重启 desktop dev app。
- launcher 视觉回归至少看：浅色/深色可读性、footer hint 尺寸、tooltip 是否越界、sticky tabs 滚动表现、毛玻璃背景是否足够明显。
- HMR 在 rebase、依赖安装或 Vite 配置变化后容易读到半更新状态；遇到不可解释的旧 UI 或临时 runtime error，先重启 dev app 再判断。

## 插件 HMR 验证

- 本地插件配置 `watch: true` 且 Client dev entry 走 Vite `/@fs/` 时有两条热更新通道：Client source root 下的 `.tsx` / `.jsx` 与样式文件由 Vite HMR / React Fast Refresh 自处理，插件 runtime 会跳过整插件 reload；entry 以及 `.ts` / `.js` 等其他 watch 变更通过插件 WebSocket 的 `plugin.changed` 增加动态 import `pluginVersion`，dispose 旧 scope 后重新 activation。插件视图两种情况都由 React host 渲染。不要把手工 `reload()`、重新导航或重启 dev server 当成插件热更新成功的证据。
- 修改插件 Client 后先停留在当前页面等待 HMR，并用可见文案、DOM 或交互状态确认同一 URL 上自动更新；需要做可回滚探针时，临时加入唯一标记，确认自动出现后恢复源码并确认自动消失。
- 只有确认 watch 未启用、对应的 Vite HMR / Fast Refresh 或 `plugin.changed` 通道未生效、动态 import 失败，或改动落在 Electron main / preload 等非 Client 边界时，才进入重启排查。为了重置表单等交互状态可以刷新或导航，但必须明确它不是代码更新验证。

## Electron / console warning 排查

- Electron 的 insecure CSP warning 不要靠隐藏 console 处理；优先在 client HTML 或静态服务注入不含 `unsafe-eval` 的 CSP。开发态需要保留 Vite / HMR 所需的 `connect-src http: https: ws: wss:`，使用 worker 的页面需要保留 `worker-src 'self' blob:`。
- React DevTools 安装提示属于 React dev 模式提示，不作为业务代码修复目标；真正要追的是 `findDOMNode`、CSP、DOM nesting、runtime error 这类会影响后续升级、安全基线或交互稳定性的 warning。

## CDP / Chrome 启动约定

- 需要通过 CDP 调试前端页面时，先确认自己读过本文件，不要只把页面 `open` 到默认浏览器就开始排查。
- 调试 Chrome 必须从冷启动开始带上 `--remote-debugging-port`；不要指望给一个已经打开的日常 Chrome 追加参数后继续复用。
- 调试必须使用独立 profile，例如单独的 `--user-data-dir=...`；不要和用户日常使用中的 Chrome profile 混用。
- 启动后先验 `http://127.0.0.1:<port>/json/version` 可访问，再确认目标页面真的出现在 target 列表里；不要只看“页面已经开着”。
- 如果仓库里已经沉淀了更细的 Chrome / CDP 操作经验，开始前优先补读对应文档，不要临时猜启动参数。

## Sender / 浮层最小回归清单

1. `更多` 能打开，且二级权限菜单能独立展开。
2. 模型、推理强度的文本区和箭头区都能打开。
3. popup 打开时，对应 tooltip 不显示。
4. popup 关闭后，focus 能回到输入框。
5. reload 后没有 React DOM nesting warning，也没有 Ant deprecation warning。
6. 同时检查浅色 / 深色主题下的 tooltip、icon 和 selected 态颜色。
