# Android 设备调试页维护经验

本文记录 standalone Android 设备调试页、设备状态面板、ADB / scrcpy 视频预览和相关 PR 收口的维护经验。它是内部协作规则，不是用户使用文档。

如果任务还处在启动 Android 模拟器 / AVD / 虚拟机阶段，先读 [Android 模拟器启动排查耗时](./common-issues.md#android-模拟器启动排查耗时)。本文件只覆盖设备已经可被调试页识别后的页面、API 和收口经验。

## 先确认实际服务 worktree

移动调试页经常由另一个 Codex worktree 的 dev server 提供，不一定是当前终端的 `cwd`。

标准处理：

- 先看 IAB 当前 URL、页面标题和 dev server 状态，不要只凭当前 shell 路径判断代码落点。
- 当前 worktree 没有目标文件时，用 `rg` 在 `.codex/worktrees` 内找稳定 class、i18n key 或 API 路由，定位实际服务中的副本。
- 如果页面在 `http://127.0.0.1:5173/ui/standalone/devices/<serial>/debug`，代码通常同时涉及：
  - `apps/client/src/components/chat/interaction-panel/InteractionPanelMobileDevice*.tsx`
  - `apps/client/src/components/chat/interaction-panel/mobile-debug-platform.ts`
  - `apps/client/src/api/mobile-debug.ts`
  - `apps/server/src/routes/mobile-debug.ts`
  - `apps/server/src/services/mobile-debug/index.ts`
- API 返回 404 时先判断 server 是否还跑着旧代码。修改 server route / service 后，Vite HMR 不会更新后端；用 `pnpm tools dev-start web` 复用或重启当前 target，再探 API。

典型坑：

- 用户给的 `cwd` 是新的 detached worktree，但 IAB 页面来自另一个 feature worktree；直接在 `cwd` 改会完全不反映到页面。
- 用旧 IAB tab 句柄验证会报 tab not found。重新读取 browser tab 列表或新开 tab 后再操作，不要继续用失效句柄判断页面坏了。

## 设备状态 UI 的交互约定

设备状态面板是右侧调试面板的替代视图，不是独立设置页。

实现规则：

- 不要在面板内部重复标题和关闭按钮；入口已经在 standalone header 的 settings action 上。
- 面板外层贴边，内容区和 tab nav 保留与右侧调试 tab 一致的左右 padding、tab 高度、active 下划线和 icon 尺寸。
- 不要把所有状态控制塞在一个大组件里。按 Battery / Cellular / Location / Phone / Fingerprint 拆组件，公共布局、选项和自动应用逻辑单独抽出。
- 连续状态使用合适控件：
  - 电量百分比用 `Slider`，显示当前百分比。
  - 充电连接、电话动作这类枚举模式用 `Segmented`。
  - 状态、健康、网络 profile 等较多枚举用 `Select`。
  - 电话 / SMS / 指纹是一次性事件，保留按钮。
- 设备环境状态默认实时生效，不额外要求用户点“应用”。对 ADB 操作做短防抖，并用 silent success，避免每次拖动 slider 都 toast。
- `重置电池`、`发送短信`、`触发指纹` 这类一次性动作继续保留明确按钮。

位置控制经验：

- 可以用 Google Maps `output=embed` iframe 做当前经纬度预览。
- 普通 Google Maps iframe 是跨域内容，没有 Maps JS API key 时不能可靠读取内部点击坐标。需要点地图回写时，用本地 overlay 捕获点击，再按当前 zoom 的 Web Mercator 近似换算经纬度；不要把点击事件绑定到 iframe 内部。
- 坐标输入框仍是精确编辑入口；地图点击只负责快速定位并触发同一套实时状态更新。

## ADB / 视频预览类型安全

移动调试同时跑浏览器端 WebSocket、Electron preload IPC 和 Node server。类型收窄要显式，不能依赖运行时条件隐式让 TypeScript 推断。

常见修法：

- 可选 preload API 先读到局部常量，再做空值判断；后续调用局部常量，TypeScript 才能稳定收窄。
- `ws` 里 `WebSocket` 若作为运行时构造器使用，必须使用值 import，例如 `WebSocketImpl`；只用 `import type { WebSocket }` 时不能 `new WebSocket(...)`。
- 从 `Object.entries()` 过滤成 readonly tuple 时，不要写不可赋值的 type predicate；用 `flatMap` 明确构造 `as const` tuple。
- `key` 不能和 `...props` 里已有 `key` 重复；map 时先 `({ key, ...action }) => <Component key={key} {...action} />`。
- 对非法类型输入抛 `TypeError`，不要用泛化 `Error`，否则会触发 `unicorn/prefer-type-error`。
- DOM 查询值在传给只接受 `HTMLElement` 的 helper 前必须先 guard，不能依赖 optional chaining 后的上下文。

## 文件拆分和 lint 红线

本仓前端默认 `max-lines` 是 200 行。移动设备调试页很容易超过这个限制，不能靠不断堆料。

拆分优先级：

- 容器组件只保留状态编排、header action 和布局分支。
- 右侧面板 / 详情区 / 环境控制页分别拆文件。
- 业务 tab 的布局小组件、选项表和 hook 单独拆文件。
- 只有生命周期强耦合且拆开会降低可读性时，才用局部 `eslint-disable max-lines` 并写清楚原因，例如视频 stream lifecycle 或 ADB service。

收口前本地跑：

- `pnpm exec dprint check`
- `pnpm exec eslint .`
- `pnpm typecheck`

不要只跑局部格式化。merge `origin/main` 后尤其要全量 `dprint fmt` 或至少 `dprint check`，冲突自动合并附近最容易出现格式差异。

## IAB 验证清单

用户对 standalone 页给浏览器标注时，必须实际打开 IAB 看界面，不要只改代码。

建议验证顺序：

1. 打开 `/ui/standalone/devices/<serial>/debug`。
2. 确认设备预览可见，右侧默认 Elements / Targets / Input / Logs tab 正常。
3. 点击 header settings action，确认设备状态面板替换右侧区域。
4. Battery：电量是 slider，只有 `重置电池`，状态变化会实时触发 API。
5. Location：有地图预览，无 `应用` 按钮，坐标变化后地图 URL 更新。
6. tab nav 和内容区 padding 与右侧调试 tabs 对齐。
7. 读 browser console 的 error / warn；Google iframe 的跨域限制不要误判为业务错误。

如果 Playwright 验证需要截请求，但 IAB 沙箱不允许给 `window` 或 `sessionStorage` 挂临时字段，换用 DOM 状态、console、后端 API 探活组合验证，不要在测试脚本上消耗过久。

## PR 与 merge 收口

移动调试页是 UI + server + desktop 的跨模块 PR，CI policy 会检查得很全。

PR 前必须补齐：

- `changelog/<version>/client.md`
- PR body 里的截图证据
- `## Experience Review` checklist
- 本地 `pnpm tools pr-change-check <base> <head> --body-file <path>`

截图经验：

- 截图应来自当前 IAB / 真实页面，不要复用用户标注截图冒充验证结果。
- 如果截图提交到 `.github/pr-screenshots/<pr>/...`，PR body 不要长期指向会删除的 head branch；合并后需要确认截图链接仍可访问，必要时改成 merge commit 或 `main` 上的稳定链接。

merge 经验：

- `main` 是保护分支，直接 `git push origin HEAD:main` 会被 required checks 拒绝。走 PR，不要尝试绕过。
- 如果主 worktree checkout 着 `main` 且有本地改动，不要在里面 merge。用当前干净 worktree 开 PR 分支，或临时 detached worktree 做只读/试合并。
- 仓库可能不允许 GitHub auto-merge。`gh pr merge --auto` 返回 `Auto merge is not allowed for this repository` 时，等待所有 required checks 全绿后再 `gh pr merge <pr> --merge`。
- `gh pr checks --watch` 输出很长。只剩 `macOS installer` 这类长任务时，停止 watcher，用 `gh run view <run> --json jobs` 看它是在排队还是正在 `Build desktop artifacts`，避免刷爆上下文。
- `macOS installer` 可能跑 10 分钟以上；只要仍在正常步骤中，不要提前 admin bypass。

## 最小落地清单

改 standalone Android 调试页时按这个顺序走：

1. 确认 IAB 页面对应的实际 worktree。
2. 前端先读 `apps/client/src/components/chat/interaction-panel/AGENTS.md`，后端先看 `apps/server/src/services/mobile-debug/AGENTS.md`。
3. UI 改动拆组件，避免单文件超过 200 行。
4. ADB / video / environment API 改动同步跑 typecheck。
5. IAB 截图验证关键状态。
6. PR 前补 changelog、截图、Experience Review checklist 和 `pr-change-check`。
7. 等远端 lint / format-check / typecheck / pr-change-policy / installer 全部通过后再 merge。

## Luna DOM Viewer 刷新经验

- 移动端元素树是高频轮询数据。不要每次接口返回就替换整棵 React state 或重建 Luna viewer；内容没变时保持节点引用不变，内容变更时做结构共享 merge。
- Luna DOM Viewer 的展开、选中和滚动状态绑定在内部 DOM 上。更新元素树时优先 patch synthetic DOM attribute / child list，让 `MutationObserver` 驱动 Luna 局部刷新；只有 root tag 改变这类结构断裂场景才重建 viewer。
- 不要用 viewer destroy 阶段的 `onDeselect` 清空业务选中态。React effect 重跑、设备树轮询或 tab 切换都可能触发 destroy；业务选择应由用户操作、设备切换或节点确实消失来清理。
- 选中行自动定位只做垂直滚动。横向 `scrollIntoView` 会把长 XML 行推到右侧，破坏 Elements 面板的可读性。
