# 移动端 WebView 与工作区标签页经验

本文记录移动端 WebView 壳、工作区 tabs overview、聊天 sender 紧凑布局和相关 PR 收口的维护经验。它是内部协作规则，不是用户使用文档。

## 先判断改动属于哪一层

- 原生 Android / iOS / Electron 只实现设备能力：WebView 创建、JS 注入、无障碍 / IME / 截图 / 调试开关、host networking 和系统窗口 inset。
- 通用 shell 契约放在共享层：device kind、app mode、OS、capability、tab / webview 操作协议、storage/query simulation 语义。不要让 Android 和 Electron 各自定义一套不兼容字段。
- Web 前端只消费通用 shell 状态，决定 compact/mobile 交互和可见入口。不要在页面里直接判断某个 native app 的私有实现细节。
- 业务 UI 和 route 状态留在 `apps/client` route / chat / workspace drawer 层；可复用的 chrome 视觉语言放到 shared layout/components。

## 不要用 demo 验证替代真实接入

移动端 WebView 原型必须接上 OneWorks 真实前端和后端链路。只做单独 demo 会漏掉这些问题：

- launcher / project 打开和后端 workspace version 检查。
- 工作区 drawer、sender、route header、interaction panel 的真实组合。
- i18n、主题、CSS token、AntD 浮层和 WebView remote debugging。
- dev server / backend 在模拟器、真机、浏览器 devtools 下的访问地址差异。

验证页面应优先打开真实 workspace URL，而不是自造 mock 页面。需要 mock 时只能作为壳层能力 smoke test，不能作为最终 UI 结论。

真实接入的完成标准是 WebView 能打开真实 workspace、能访问对应后端、Chrome DevTools 能看到页面 target 和网络请求。后端不默认“跑进模拟器里”；默认做法是让手机 WebView 可达宿主机服务，例如 `adb reverse` 或模拟器 `10.0.2.2`。如果用户明确要求把后端放进 Android / Linux 环境，那是单独的运行时交付，不能用默认移动端壳验证混过去。

## 原生 WebView 壳经验

- Android 代码使用 Kotlin 和现代 AndroidX / Compose / WebView 能力，不新增 Java 入口。
- WebView 远端调试需要开发态打开 `WebView.setWebContentsDebuggingEnabled(true)`，并确认 Chrome DevTools 能看到真实页面 target、URL、console 和 network 请求。
- 真机插入后优先用当前 APK 安装验证真实输入法、状态栏、安全区和 Chrome inspect；模拟器通过的 UI 不代表真机一定通过。
- 模拟器访问宿主机服务通常走 `10.0.2.2` 或 `adb reverse`；真机优先用 `adb reverse tcp:<port> tcp:<port>`。不要让前端硬编码 `127.0.0.1` 作为手机端唯一地址。
- 输入法问题不要按每个输入框单独补逻辑。原生壳应在 WebView focus / input connection 层做通用 IME show/hide，前端只负责正常 focus。
- 修 IME 时不要顺手改全局 edge-to-edge / inset 策略。状态栏、cutout、IME inset 是独立问题；一次改混在一起，很容易把 status bar 内容裁掉。
- Android 状态栏 / cutout 异常先用设备截图和 `WindowInsets` 信息判断，不要只看桌面窗口截图。模拟器 profile 可能自带 cutout 或窗口缩放问题，真机和不同 profile 需要分开验证。
- 用户要求“别关模拟器 / 真机窗口”时，不要在收尾脚本里清理相关进程。后台 web 服务、Android app 进程和可见设备窗口要分别管理；不要为了让设备窗口常驻而依赖一个可见 terminal，也不要用清理后台服务的脚本顺手关掉模拟器。

## Dev shell simulation

开发态需要能模拟 Web、Electron、Mobile 以及 OS。实现时遵守：

- 用统一 storage/query 配置表达 shell kind 和 OS，例如 web/electron/mobile 与 macOS/Windows/Android/iOS。
- 入口放在开发 UI 的显眼位置，不塞进普通用户菜单项里；标题、group label 这类临时解释文案不要出现在最终 dropdown/sheet。
- Web 端模拟手机样式时保留与真实 mobile app 的差异开关。浏览器 viewport 的 `layout=workspace` 和 native WebView 的入口行为不一定完全一样，差异要显式可控。
- compact sheet 内的模拟入口要适配小尺寸：宽度、按钮高度、图标和文字对齐沿用 nav rail sheet 的现有样式，不要把桌面 dropdown 直接塞进去。

## 工作区 tabs overview

移动端点击右侧区域时展示的是“可滚动标签页 overview”，不是系统任务切换器，也不是把桌面右侧 panel 原样缩窄。实现规则：

- overview 是内部页面，应在 `ChatWorkspaceDrawer` / workspace drawer 语义内处理，不跳到系统 UI。
- 顶部 header 使用项目自己的 route chrome 风格：统一高度、图标尺寸、分割线、左右 padding、leading / title / actions slot 和 action gap。不要照抄 Chrome 截图中的控件比例；如果 header 左侧或右侧出现一段空白条，通常是 slot / flex 布局没复用现有 header 结构。
- tabs overview 的 header 是滚动内容里的静态 header，页面详情 header 也是静态/route chrome 变体；二者应复用 `RouteChromeHeader` 这类基础 chrome，而不是复制 `RouteContainerHeader` 的绝对定位语义。
- 搜索 / URL 类输入条使用 `RouteChromeInput` 这类共享样式组件；不要复用 iframe/webview 的完整业务 toolbar，但要复用同一套视觉 token、分割线和垂直节奏。
- overview 背景色、卡片背景、边框和 hover/active 状态走项目 token，避免生成一套偏蓝、偏亮或只适合暗色的本地 palette。
- 搜索框下方和内容区之间需要保留项目标准分割线；如果截图显示只有文字和背景，没有线，通常是布局 wrapper 或 shared chrome 没套对。
- tab card 高度由内容和上下 padding 撑开，不写死一段过高 header。
- card preview 要尽量渲染真实内容。非 WebView 内容至少渲染对应 panel 的当前 DOM；如果只能拿到截图，退出或隐藏前保存 last snapshot 作为 fallback。
- 打开的 tab 预览应在卡片内撑满可用区域，不要缩成一个居中的小卡片。
- 同类 card 使用统一组件和状态样式；不要出现目录树一套高亮色、改动文件另一套色。

## 移动端 header 和 actions

- 页面左上角通常是“打开左侧”和“返回会话 / 对话”两个语义入口。进入具体 workspace tab 后，“返回会话”应使用对话图标，而不是浏览器 back 箭头。
- 手机端当前 tab 切回“工作区 / tabs overview”的入口应该放在 header 外层 action 中，不能藏在更多菜单里。
- 已经在页面内 toolbar 存在的能力不要在 header 重复，例如 WebView tab 内部 toolbar 有刷新按钮时，顶部 route header 不再放第二个刷新。
- 更多菜单只保留当前页面真正需要的 action。新建网页 / 新建终端等 create actions 不要同时出现在 `+` 菜单和更多菜单。
- Header action icon、panel icon 和 toolbar icon 统一使用 `--app-chrome-icon-size`，当前是 `18px`；不要混出 20/22/24px 的局部按钮。

## 移动端聊天 sender

- mobile compact 下 sender 固定靠页面底部；欢迎语 / announcement 与 sender 之间需要有可读间距，不要贴在一起。
- 如果有快捷操作列表，它位于页面中部区域；sender 不应为了动作列表被推到页面中间。
- 搜索框、快捷操作列表、展开剩余项的水平 padding 要和 sender 对齐；不要只改搜索框而漏掉 list row 和 footer。
- 小尺寸下局部密度用 CSS variable 覆盖，例如把 sender header、composer、status bar 相关 padding 收到 `6px`。不要修改全局 token，也不要把左右 padding 全部清零。
- 需要两个中间区域上下相邻时，移动端可用“半个 padding”的间隔建立层次，但只作用在 sender 内部结构，不影响桌面。
- toolbar button 统一 18px 视觉盒和一致宽度。不要出现左边按钮宽、右边按钮窄，或同一区域一个 18px 一个 24px。
- mobile sender status bar 右侧只保留一个 adapter 图标；不要把 loading/spinner、adapter、状态按钮挤成两个视觉图标。
- 修改 sender、status bar、adapter select 后同时看浅色 / 深色主题和 compact / expanded sender header。

## 样式复用的正确抽象

不要把“复用”理解成把整个业务组件塞到另一个业务场景里。这里需要的是复用设计语言和基础 chrome：

- `RouteChromeHeader`：基础 header DOM、title、leading、actions、static/overlay placement 和 shared route header class。
- `RouteChromeInput`：基础搜索 / URL 输入条的容器、prefix/suffix、field 样式。
- `RouteHeaderActionButton`：统一图标按钮、tooltip、active、disabled 和快捷键展示。
- 业务层负责传 label、icon、callback、menu sections、active tab、opened tabs、preview 内容。
- 如果调用方必须复制一段 header/search DOM 或硬编码 padding、border、icon size，说明 shared chrome 还缺 prop 或 slot。

## 验证与截图

- 用户明确要求每次完成都给截图时，UI 任务收尾必须提供足够截图；Android 相关优先给设备内截图，不要只截桌面窗口外框。
- 对移动端工作区至少看这几类截图：会话页底部 sender、overview 列表、具体目录树 tab、具体 WebView tab、浅色和深色主题各一个关键页面。
- 浏览器 devtools device mode 只能验证前端响应式；Android WebView / IME / status bar / cutout 必须用模拟器或真机验证。
- 状态栏裁切问题不要只截整窗口；要单独截左上角 / status bar 区域确认是 app inset、模拟器 profile 还是宿主窗口显示问题。

## PR 与 CI 收口

- UI 变更需要 changelog 和截图资产，确保 `pnpm tools pr-change-check <base> <head> --body <file>` 通过。
- resolve conflict 后运行 `pnpm exec dprint fmt` 或至少全量 `dprint check`，不要只格式化刚编辑的文件；冲突标记附近最容易触发 format-check。
- `pnpm typecheck` 可能因为 `node_modules` 落后于 `origin/main` 新依赖而失败；先跑 `pnpm install --frozen-lockfile` 同步依赖，再判断是否是代码问题。
- 不要重复声明已经提升到 `@oneworks/types` 的 DTO / error details。server manager、route 和 client API 应使用同一份共享类型。
- 本地 Android build 产物可能让 `pnpm exec eslint .` 扫到 `apps/android/app/build/**` 生成文件；确认这些文件未入库，CI 在干净环境才是源码 lint 结论。需要本地全量 lint 前先清理生成目录或使用 repo 已约定的 lint 范围。
- `gh pr checks --watch` 输出很长；当只剩一个长任务 pending 时，停止 watcher，改用 `gh pr view --json statusCheckRollup` 定点查，避免刷爆上下文。
- 如果仓库不允许 auto-merge，等 checks 全部完成后再 direct merge。
- 多 worktree 下 `gh pr merge ... --delete-branch` 可能在远端已经合并后，因为本地 `main` 被另一个 worktree checkout 而报错。遇到这种情况先查 `gh pr view <pr> --json state,mergedAt,mergeCommit`，确认已合并后再单独删远端分支，不要重复 merge。

## 最小检查清单

改移动端 WebView / workspace tabs / sender 前后按这个顺序走：

1. 确认需求落层：native shell、shared shell contract、shared chrome、client route 还是业务 tab。
2. 先读 `apps/client/AGENTS.md`、`apps/client/src/components/layout/AGENTS.md`、本文件；涉及聊天 sender 再读 `apps/client/src/components/chat/AGENTS.md`。
3. 新 UI 先找 `RouteChromeHeader`、`RouteChromeInput`、`RouteHeaderActionButton` 和现有 nav/dropdown/sheet 样式。
4. 小屏 padding 只用局部 CSS variable 覆盖；不动全局 token。
5. 手机端 header action 去重：返回会话、工作区 overview、刷新、更多菜单逐一核对。
6. 同时验证 Web device mode、模拟器/真机关键路径和浅色/深色主题。
7. PR 前跑 dprint、相关 eslint、typecheck / targeted tests，并补 changelog、截图和 PR body。
