# 项目设计记忆登记表

返回流程：[design-memory.md](./design-memory.md)

本文件只登记 OneWorks 项目级设计规范的身份、作用域、冲突、替代和例外。规范正文仍由 `styles.md`、最近模块 `AGENTS.md`、共享 token 或组件拥有，避免在登记表复制完整规则。

## 有效规范索引

### OW-DM-001 — 相邻边界间距归属

- Revision: 1
- Status: ACTIVE
- Rule: 相邻元素的同一条接缝只能由一层负责留白；项目默认 spacing token 为 10px，双侧内部 padding 同时保留时必须使用可见分割线。
- Scope: OneWorks project / adjacent component and section boundaries
- Applies when: 相邻组件、字段、section、列表行、header 或内容区共享同一条边界。
- Does not apply when: 两个结构各自的内部 padding 由可见分割线明确隔开。
- Positive example: parent gap、前一项底部 padding 或后一项顶部 padding 三选一，并使用项目 token。
- Negative example: parent gap、前一项底部 padding 和后一项顶部 padding 叠加成无语义大空白。
- Owning rule: [`styles.md`](./styles.md) 中的“相邻区块的间距归属”。
- Token or implementation: 由具体 surface 的共享 spacing token / parent gap / 单侧 padding 拥有。
- Source: 用户明确设计标准，已沉淀到 `styles.md`。
- Effective date: 2026-07-11
- Supersedes: none
- Exceptions: 在下方“作用域例外”登记。
- Automatic enforcement: computed box model、DOM 几何检查或模块视觉回归。

### OW-DM-002 — 紧凑 chrome 尺寸语言

- Revision: 1
- Status: ACTIVE
- Rule: Route header actions、panel tab chrome、内嵌网页 toolbar 和窗口控制条使用共享 chrome token；当前 header / toolbar block 与 inline padding 为 10px。
- Scope: OneWorks project / compact chrome
- Applies when: route header actions、panel tab chrome、内嵌网页 toolbar 或窗口控制条使用紧凑 chrome 语言。
- Does not apply when: surface 有已登记的 scoped exception，或不属于紧凑 chrome。
- Positive example: toolbar 直接消费共享 chrome padding 和 icon token，状态变化不改变几何。
- Negative example: 单个 toolbar 在 media query 内硬编码 6px padding，造成同一产品 chrome 密度不一致。
- Owning rule: [`styles.md`](./styles.md) 中的“紧凑 chrome 工具栏”。
- Token or implementation: `packages/route-layout/src/design-tokens.css`
- Source: 项目现有统一视觉标准。
- Effective date: 2026-07-11
- Supersedes: none
- Exceptions: 在下方“作用域例外”登记。
- Automatic enforcement: token consumer 检查、computed padding 和目标 surface 截图。

### OW-DM-003 — 主会话时间线容器阈值与持续可见

- Revision: 6
- Status: ACTIVE
- Rule: 主会话内容容器宽度超过 `820px` 且存在至少一个时间线节点时，左侧 timeline rail 持续展示；未配置时默认使用 `event-line`，用户可通过 global `appearance.historyTimelineMode` 显式切换为原有 `node` 模式。内容是否可滚动只决定上下边缘渐隐，不决定 rail 是否存在。
- Scope: OneWorks project / desktop primary chat history timeline
- Applies when: 宽度超过 `820px`、非嵌入式、非 Agent Room 的主会话消息历史存在时间线节点。
- Does not apply when: 内容容器宽度不超过 `820px`、新会话没有节点、`embeddedSessionChrome`、Agent Room，或用户主动隐藏 rail；用户选择 `node` 时只替换 rail 的渲染模式，不移除可见性约束。
- Positive example: 一问一答的短会话没有滚动空间，左侧仍显示事件短线。
- Negative example: 因消息内容没有超过视口而移除整条 Event lines rail。
- Owning rule: `apps/client/src/components/chat/AGENTS.md` 的消息级操作约束。
- Token or implementation: `history-timeline/timeline-visibility.ts` 与对应单测。
- Source: 用户先要求 Event line 模式在真实聊天页持续展示，随后明确把内容容器阈值调整为 `820px`，并要求在外观设置中支持 Event lines / Nodes 两种展示模式。
- Effective date: 2026-07-13
- Supersedes: OW-DM-003 Revision 3；保留 `820px` 阈值，并把用户显式选择 `node` 登记为 Event lines 默认规则的作用域例外。
- Exceptions: 容器宽度不超过 `820px`、嵌入式会话、Agent Room、无节点、用户主动隐藏，以及用户显式选择 `node` 渲染模式。
- Automatic enforcement: 纯可见性单测、真实短会话 DOM 断言和独立视觉审阅。

### OW-DM-004 — 主题包独立配置边界

- Revision: 1
- Status: ACTIVE
- Rule: 主题包独立于主题色与明暗模式，通过设置页独立入口选择；每个主题的私有选项由自己的 `appearance.themePacks.<theme-id>` 命名空间拥有。
- Scope: OneWorks project / app theme packs and settings
- Applies when: 新增或修改会统一覆盖应用壳、共享 token、AntD token 或内置组件样式的主题包。
- Does not apply when: 只调整现有 `primaryColor`、`themeMode` 或单个业务组件的局部样式。
- Positive example: 中国方案通过 `appearance.themePack` 选中，横幅开关保存在 `appearance.themePacks["china-red"].showBanner`。
- Negative example: 把所有主题的私有开关平铺到 `appearance` 根层，或把主题包做成主题色预设。
- Owning rule: [`theme-i18n.md`](./theme-i18n.md) 中的“主题包”和 [`../config/README.md`](../config/README.md) 的配置页语义。
- Token or implementation: `apps/client/src/plugins/plugin-theme-contract.ts`、`apps/client/src/components/config/ThemePackSettingsPanel.tsx` 和插件注册内容。
- Source: 用户明确要求主题包不同于现有主题色、在设置页使用独立入口，并允许不同主题拥有自己的配置。
- Effective date: 2026-07-13
- Supersedes: none
- Exceptions: none
- Automatic enforcement: 配置 schema / 写回测试、主题设置组件测试、真实浅色 / 深色 / 响应式视觉审阅。

### OW-DM-005 — 中国方案主题金色边框

- Revision: 1
- Status: ACTIVE
- Rule: 中国方案主题中的结构分割线、容器边框和普通组件边框统一使用金色主题 token；错误、警告、成功等语义边框继续使用状态色。
- Scope: OneWorks project / `china-red` theme pack border system
- Applies when: 为中国方案主题新增或修改面板、卡片、输入框、菜单、浮层及其他内置组件的普通边框。
- Does not apply when: 组件正在表达错误、警告、成功等明确业务状态，或只涉及非边框的强调色。
- Positive example: 设置页表面、主题卡片、输入框和 AntD 容器使用同一组金色边框 token。
- Negative example: 普通面板保留蓝灰边框，或把错误输入框的红色边框也强制改成金色。
- Owning rule: [`theme-i18n.md`](./theme-i18n.md) 中的“主题包”。
- Token or implementation: `packages/plugins/china-red-theme/client/src/theme.css` 和该插件的主题注册内容。
- Source: 用户明确要求中国方案主题中的项目边框统一改成金色。
- Effective date: 2026-07-13
- Supersedes: none
- Exceptions: 语义状态边框。
- Automatic enforcement: 主题 token 单测、真实浅色 / 深色视觉审阅和语义状态样式检查。

### OW-DM-006 — 主题列表与主题自有配置 tabs

- Revision: 2
- Status: ACTIVE
- Rule: 主题设置页直接展示 divider list；每个主题由客户端插件注册自己的配置 tabs。默认主题只读，可配置主题的覆盖项按基础颜色、普通组件布局和组件类型分组，并写回主题自己的配置命名空间；数值型覆盖必须展示“启用状态 + 具体数值与单位”。
- Scope: OneWorks project / theme-pack settings UI and configuration ownership
- Applies when: 新增主题包、主题专属配置项或修改主题设置页的信息架构。
- Does not apply when: 只修改“外观”页的主题色、明暗模式或与主题包无关的业务组件设置。
- Positive example: 中国方案展示“基础颜色 / 间距与图标 / 组件 / 横幅”tabs，padding 与 icon size 同时显示开关和 px 数值，默认主题只展示只读“概览”。
- Negative example: 所有主题共享一套固定 tabs、把主题列表继续包在无功能意义的 chooser card 里，或数值型覆盖只显示开关。
- Owning rule: [`theme-i18n.md`](./theme-i18n.md) 中的“主题包”和 [`../config/README.md`](../config/README.md) 的配置页语义。
- Token or implementation: `apps/client/src/plugins/plugin-theme-contract.ts`、`ThemePackSettingsPanel.tsx` 和 `appearance.themePacks.<theme-id>` schema。
- Source: 用户明确要求主题直接展示为列表、不同主题展示不同 tabs、默认主题只读、按基础颜色与组件覆盖分组配置，并要求数值类型展示具体数值。
- Effective date: 2026-07-13
- Supersedes: none
- Exceptions: 普通组件 padding / icon size 覆盖不改变 route chrome 的共享几何 token。
- Automatic enforcement: plugin registration / schema 单测、默认主题无编辑控件断言和独立视觉审阅。

### OW-DM-007 — 主题包中性 hover 与侧栏层级

- Revision: 1
- Status: ACTIVE
- Rule: 主题包的普通按钮、图标按钮、菜单和侧栏 hover 从当前 surface 与文字色生成，不使用主题强调色铺底；侧栏保持中性 surface 阶梯和渐进背景。主题声明紧凑按钮几何时，普通按钮与图标按钮统一使用四向 `5px` padding。
- Scope: OneWorks project / plugin theme component recipes
- Applies when: 主题插件覆盖普通按钮、图标按钮、菜单、侧栏或紧凑按钮几何。
- Does not apply when: 主操作、危险操作、明确选中强调态，或主题通过自己的配置明确声明非紧凑按钮几何。
- Positive example: 专注工作台的默认按钮 hover 使用 `bg` 与 `text` 混合后的浅一层 surface，普通按钮和图标按钮均使用四向 `5px` padding；新粗野主题的侧栏仍使用奶油色中性阶梯而不是粉色铺底。
- Negative example: 把 `primaryColor` 的半透明色作为所有普通按钮和整个侧栏 hover，或普通按钮使用 `5px` 而图标按钮继续保留另一套 padding。
- Owning rule: [`theme-i18n.md`](./theme-i18n.md) 中的“主题包”。
- Token or implementation: 各 `packages/plugins/*-theme/client/src/theme.css` 的 scoped component recipe。
- Source: 用户在主题风格研究和组件实验中明确要求普通 hover 使用背景色变体、侧栏保持渐进层级，并统一普通与图标按钮的四向 `5px` padding。
- Effective date: 2026-07-14
- Supersedes: none
- Exceptions: 主操作、危险操作、明确选中强调态，以及主题声明的非紧凑按钮几何。
- Automatic enforcement: computed hover / padding / sidebar background 检查、明暗模式截图和独立视觉审阅。

### OW-DM-008 — Launcher 默认选中态不铺底

- Revision: 1
- Status: ACTIVE
- Rule: 默认主题的 Launcher command 选中行和设置 section tab 不使用填充 active 背景；command 由左侧 indicator 与强调文字表达选中，section tab 由强调文字与下划线表达选中。hover / focus 期间可以显示临时背景。
- Scope: OneWorks project / default launcher command list and settings section tabs
- Applies when: 默认主题下渲染 Launcher 主命令列表、最近选择和设置页 section tabs。
- Does not apply when: 显式主题包通过 `--oneworks-launcher-item-active-bg` 声明自己的选中语言，或控件属于设置内容区里的 choice / field active 状态。
- Positive example: 最近选择中的当前命令保持透明表面，只显示左侧强调条；“通用”tab 保持透明表面，只显示强调文字和底部 ink。
- Negative example: Launcher 一打开就给第一条命令和当前 section tab 铺一层 10% 主题色背景。
- Owning rule: `apps/client/src/components/launcher/AGENTS.md` 的“视觉细节”。
- Token or implementation: `apps/client/src/routes/LauncherRoute.scss` 的 `--launcher-item-active-bg` 默认 fallback 与 `apps/client/__tests__/launcher-style-contract.spec.ts`。
- Source: 用户明确指出 Launcher 设置 tab 和最近选择命令不应具有选中背景色，2026-07-23。
- Effective date: 2026-07-23
- Supersedes: none
- Exceptions: 显式主题包的 scoped active recipe；设置内容区里的 choice / field active 状态。
- Automatic enforcement: CSS contract test、默认主题 computed `background-color`、键盘导航与浅色 / 深色真实页面回归。

## 待确认冲突

### OW-DM-P001 — 主题侧栏是否保留渐变

- Revision: 2
- Status: SCOPED_EXCEPTION
- Rule: Codex 主题侧栏使用单一中性纯色表面；其他主题继续遵循各自表面配方。
- Source: 用户明确要求 Codex 主题移除渐变，2026-07-14；已由 `OW-DM-E002` 的主题范围约束承接。

## 作用域例外

### OW-DM-E001 — 可选主题包紧凑导航间距

- Revision: 1
- Status: SCOPED_EXCEPTION
- Base rule: `OW-DM-001` 的项目默认 `10px` spacing token。
- Exception rule: 可选主题包覆盖宿主紧凑导航控件时，快捷入口、搜索、配置分组、Footer 插件入口和 NativeTabs 统一消费主题自己的 `5px` control gap token。
- Scope: OneWorks project / opt-in theme-pack compact host navigation controls
- Applies when: `focus-workbench`、`china-red`、`neo-workshop`、`warm-cowork` 等可选主题包启用自己的 menus / buttons / inputs 组件覆盖。
- Does not apply when: 默认主题、业务内容列表、route chrome，或主题关闭对应组件覆盖。
- Positive example: 主题内 quick-link rows、quick links 到 search、group / item、footer slot 和 NativeTabs 都由同一个 `5px` token 提供间距。
- Negative example: 每个 selector 单独硬编码不同 gap，或把主题的 `5px` 间距反向写进默认主题和业务列表。
- Source: 用户先要求 Codex 主题从通用角度统一调整，随后明确要求其他主题按照同一调整方式保证预期，2026-07-14。
- Effective date: 2026-07-14
- Automatic enforcement: 四个可选主题的 computed gap / padding、桌面与窄屏、浅色与深色独立视觉回归。

### OW-DM-E002 — 新粗野主题分割线控件组

- Revision: 4
- Status: SCOPED_EXCEPTION
- Base rule: `OW-DM-E001` 的可选主题包 `5px` 紧凑导航间距，以及 `OW-DM-007` 的普通控件中性 hover。
- Exception rule: `neo-workshop` 的快捷入口列表、分组导航、Footer、NativeTabs、Sender 工具栏和 Sender 状态栏使用零间距结构，所需的 `2px` 分割线必须由相邻表面中的单一元素拥有；Route Header action group 同样保持零间距，独立 actions 由后一个 action 在左侧拥有 `2px` 分割线，但“通过其他应用打开”这类 joined 复合动作内部不绘制分割线。Footer 只由外层容器拥有顶部 `2px` 分割线。侧栏 header、分组列表和 Footer 外层不保留 inset，Tabs、Footer 与分组导航选中项不使用阴影。Sender 工具栏和状态栏的外层不保留 padding 或 gap，交互项自身拥有统一的点击内边距，相邻项只由后一个项目绘制全高分割线；上下两行必须消费同一套 action 高度、响应式字号、字重、行高、空闲前景色与表面色，布局 bleed 和装饰分割线不得参与行高计算。同一 Sender 控件组内的“更多”、通用 Select、状态栏动作、账号、额度与适配器使用一致的黄色 hover / open 表面、黑色前景和零阴影，不沿用普通控件的中性 hover。窗口栏拥有 header/list 边界，内容 shell 拥有 sidebar/content 边界；满宽侧栏控件不绘制贴视口的左边框。展开态 Web 窗口栏使用带底部分割线的整行点击区，并与下方导航条目使用相同的 control padding 对齐图标。主题浮层使用暖纸表面、方形 `2px` 结构框、零模糊和硬偏移阴影，菜单项保持方形并用结构分割线切组；主题配置行也使用直角覆盖。侧栏表面不使用软渐变或晕染阴影。主题启用时宿主内容区不保留外层 inset，内容 shell 仅保留与侧栏相邻的左边界，NavRail 顶部间距跟随共享 header 高度。
- Scope: OneWorks project / `neo-workshop` theme structural navigation, Sender controls, and content chrome
- Applies when: `neo-workshop` 启用 borders / buttons / menus / shadows 对应覆盖，渲染宿主侧栏、Footer、NativeTabs、Sender 工具栏、Sender 状态栏和内容区结构边界。
- Does not apply when: 默认主题、其他主题包、业务内容列表，或新粗野主题关闭对应覆盖。
- Positive example: 相邻 tab 通过重叠边框共享一条 `2px` 分割线；分组导航和 Footer 都是零 gap；Route Header 的“通过其他应用打开”双动作保持 `40px + 40px`、零 gap 且无内部线，运行指令、下方面板和工作区抽屉等独立 actions 各自由左侧单一 `2px` 线分隔；Sender 的“更多”、通用 Select、推理强度、语音和发送操作紧密拼接，状态栏左右动作组也以单一全高分割线切分，相关 hover / open 状态都使用同一黄色表面、黑色前景且不产生阴影；窗口栏与快捷入口只绘制一条相邻边界且图标在同一水平起点；主题配置行保持直角；菜单浮层使用方形硬框与硬阴影。
- Negative example: 在快捷入口、分组导航、Footer、tab、Sender 工具栏或 Sender 状态栏的分割线组内部继续保留 `5px` gap、让外层和子项同时拥有 padding、重复绘制相邻边框；在 joined 复合动作内部画线，或只给部分独立 Route Header actions 分隔而留下不一致边界；或让 Sender 的模型、状态栏、账号、额度、适配器分别使用文字变色、圆环缩放、灰底或内描边等不同 hover；或让窗口栏图标偏离下方导航图标、给主题配置行保留圆角、给 tab / Footer / 选中分组条目添加硬阴影、给浮层保留默认蓝灰圆角和模糊阴影、用渐变制造 Footer 上方晕染，或在贴视口的内容区上/右/下边缘重复画框。
- Source: 用户明确指出新粗野主题应使用分割线切分交互元素，并要求移除 Footer 与 tab 阴影、统一检查结构边框宽度；随后要求 Sender 工具栏和状态栏沿用同一零间距结构，以“更多”为基准统一模型、状态栏、账号、额度和适配器的 hover，并要求上下两行的高度、padding、字体和表面语义完全匹配；最后明确 joined 的“通过其他应用打开”内部不画线，但运行指令、下方面板和工作区抽屉等独立 Header actions 左侧需要一致分割线，2026-07-14 至 2026-07-20。
- Effective date: 2026-07-14
- Automatic enforcement: `neo-workshop` 浅色 / 深色、桌面 / 窄屏 computed border / gap / padding / shadow / content inset 与交互视觉回归；Sender 通过共享样式契约测试覆盖工具栏与状态栏的高度、padding、字号、字重、行高、前景色、表面色、hover / open 状态和默认主题回退。

新增例外时使用：

```text
ID:
Revision:
Status: SCOPED_EXCEPTION
Base rule:
Exception rule:
Scope:
Applies when:
Does not apply when:
Positive example:
Negative example:
Source:
Effective date:
Automatic enforcement:
```

## 已替代规范

当前无。规范被替代后保留旧 ID、最后 revision、生效区间、替代它的新 ID 和用户确认来源。
