# 主题冲突与作用域例外

## 待确认冲突

### OW-DM-P001 — 主题侧栏是否保留渐变

- Revision / status: 2 / SCOPED_EXCEPTION
- Rule: Codex 主题侧栏使用单一中性纯色表面；其他主题继续遵循各自表面配方。
- Source: 用户明确要求 Codex 主题移除渐变，2026-07-14；已由 `OW-DM-E002` 的主题范围约束承接。

## 作用域例外

### OW-DM-E003 — 文档站可播放宣传视频

- ID: OW-DM-E003
- Revision: 1
- Status: SCOPED_EXCEPTION
- Base rule: `OW-DM-010` 的高清 MP4 母版只保留在本地素材归档，README 只提交主题自适应 GIF。
- Exception rule: 用户明确要求文档站提供可播放演示时，`.oo/docs` 可以提交从同一批准母版生成的 web 优化 MP4；页面按 locale 和外观只选择一条视频，并保留同语言 / 主题轻量 poster 与 GIF 降级入口。
- Scope: OneWorks project / `.oo/docs` 中文与英文文档首页、对应桌面应用页；不扩展到根 README。
- Applies when: 演示已完成隐私与四变体视觉验收，视频经过 fast-start、体积、编解码兼容性和完整解码检查；画面只包含标准 `adapter-promo` 的品牌演示身份和映射到隔离临时目录的合成展示路径，不含真实个人或机器数据。
- Does not apply when: README、普通产品截图、内部调试录像、尚未确认的原型或含真实账号 / 路径的录屏。
- Positive example: 中文文档引用中文亮 / 暗 MP4，英文文档引用英文亮 / 暗 MP4；一次页面访问只加载当前语言和外观需要的视频，GIF 提供快速预览与降级。
- Negative example: 把 1080p 母版直接塞进 README，或在文档首页同时 autoplay / preload 四个语言与主题视频。
- Source: 用户 2026-08-05 明确要求更新文档站图片并把已确认的视频加入文档站。
- Effective date: 2026-08-05; Automatic enforcement: 文档相对资产检查、媒体 metadata / fast-start / 完整解码验证、locale / theme source 审计、浏览器网络请求与亮暗主题视觉回归，并验证主题切换会暂停已隐藏的视频。

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
- Effective date: 2026-07-14; Automatic enforcement: 四个可选主题的 computed gap / padding、桌面与窄屏、浅色与深色独立视觉回归。

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
- Effective date: 2026-07-14; Automatic enforcement: `neo-workshop` 浅色 / 深色、桌面 / 窄屏 computed border / gap / padding / shadow / content inset 与交互视觉回归；Sender 通过共享样式契约测试覆盖工具栏与状态栏的高度、padding、字号、字重、行高、前景色、表面色、hover / open 状态和默认主题回退。

新增例外时必须使用作用域例外模板；字段不可省略或合并。完整模板见 [`design-memory.md`](../design-memory.md#作用域例外模板)。
