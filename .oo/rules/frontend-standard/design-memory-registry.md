# 项目设计记忆登记表

返回流程：[design-memory.md](./design-memory.md)。本文件只登记 OneWorks 项目级设计规范的身份、作用域、冲突、替代和例外；规范正文仍由 `styles.md`、最近模块 `AGENTS.md`、共享 token 或组件拥有，避免在登记表复制完整规则。

## 有效规范索引

### OW-DM-001 — 宿主 chrome 与相邻边界单一归属

- Revision / status / rule / scope: 4 / ACTIVE / 相邻元素的同一条接缝只能由一层负责留白；宿主 route header 唯一拥有当前页面或资源名称与 breadcrumb；稳定的集合级入口放到 `nav.items[].actions`，对象级命令才进入 `view.route.setActions(...)`；宿主数据层自动重验证时不暴露手动刷新；项目默认 spacing token 为 10px，双侧内部 padding 同时保留时必须使用可见分割线 / OneWorks project，host chrome、plugin routes、adjacent component and section boundaries。
- Applies / does not apply / examples: 相邻组件、字段、section、列表行、header 或内容区共享同一条边界，或插件嵌入共享 header、sidebar、breadcrumb、SWR query、route body 时适用；正文中真正独立且 header 未表达的 subsection 标题不受限制。正例是选中聊天室后 header 显示聊天室名，集合入口位于左侧聊天室入口右侧，正文直接显示时间线且 parent gap、前一项底部 padding 或后一项顶部 padding 三选一；反例是 header 与正文重复“已分享”、二级页 header actions 再放“聊天室”、自动重验证旁仍保留刷新、宿主和嵌入内容叠加 padding，或把同一额度内容拆成两张卡再用 gap 拼接。
- Ownership / implementation / source / lifecycle / enforcement: [`styles.md`](./styles.md) 的“相邻区块的间距归属”、`apps/client/src/plugins/AGENTS.md` 与 `ui-design-memory` skill 的 `UDM-T008` 共同拥有；实现入口为共享 spacing token、`PluginViewContext.route`、`PluginViewContext.data`、`PluginContributionNavItem.actions` 和共享 route/sidebar components；来源为用户 2026-07-11 至 2026-08-12 的明确设计标准；例外在下方登记；由 computed box model、plugin host 契约测试、SWR revalidation 测试和独立全页面视觉审阅执行。

### OW-DM-002 — 紧凑 chrome 尺寸语言

- Revision / status / rule / scope: 1 / ACTIVE / Route header actions、panel tab chrome、内嵌网页 toolbar 和窗口控制条使用共享 chrome token；当前 header / toolbar block 与 inline padding 为 10px。 / OneWorks project / compact chrome
- Applies / does not apply / examples: route header actions、panel tab chrome、内嵌网页 toolbar 或窗口控制条使用紧凑 chrome 语言时适用；surface 有已登记的 scoped exception，或不属于紧凑 chrome 时不适用。正例是 toolbar 直接消费共享 chrome padding 和 icon token，状态变化不改变几何；反例是单个 toolbar 在 media query 内硬编码 6px padding，造成同一产品 chrome 密度不一致。
- Ownership / implementation / source / lifecycle / enforcement: Owning rule: [`styles.md`](./styles.md) 中的“紧凑 chrome 工具栏”；Token or implementation: `packages/route-layout/src/design-tokens.css`；Source: 项目现有统一视觉标准；Effective date: 2026-07-11；Supersedes: none；Exceptions: 在下方“作用域例外”登记；Automatic enforcement: token consumer 检查、computed padding 和目标 surface 截图。

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

- Revision / status / scope: 2 / ACTIVE / OneWorks project，默认主题的 Launcher 主命令列表、最近选择和设置 section tabs。command 行在 hover、focus、active 时保持透明，以前景色、焦点轮廓、左侧 indicator 与强调文字表达交互；section tab 保持透明，以强调文字、焦点轮廓与下划线表达交互。
- Ownership / source / exceptions / enforcement: `apps/client/src/components/launcher/AGENTS.md`“视觉细节”；实现与契约位于 `apps/client/src/routes/LauncherRoute.scss`、`apps/client/__tests__/launcher-style-contract.spec.ts`；来源为用户 2026-07-23 至 2026-07-24 的明确反馈。显式主题包通过 `--oneworks-launcher-item-hover-bg` / `--oneworks-launcher-item-active-bg` 声明的交互语言及设置内容区 choice / field active 状态不受此规则约束；由 CSS contract、computed `background-color`、鼠标 hover、键盘导航和浅色 / 深色真实页面回归验证。

### OW-DM-009 — Launcher 内部页面固定搜索 chrome

- Revision / status / scope: 1 / ACTIVE / OneWorks project，Launcher 的设置、关于、用量和插件等内部页面。页面切换继续保留顶部搜索 chrome 及其固定行高；输入语义由各页面显式拥有，内容区不重复顶部 chrome 已表达的标题、作用域或说明。
- Ownership / source / exceptions / enforcement: `apps/client/src/components/launcher/AGENTS.md`“体验边界”；实现与契约位于 `apps/client/src/routes/LauncherRoute.tsx`、`apps/client/__tests__/launcher-style-contract.spec.ts`；来源为用户 2026-07-30 对用量页的明确反馈。用量页明确拥有模型服务、工具、账号与所属插件搜索并留在当前页；其他页面只有在实现对应契约与回归后才能声明新的输入行为。沉浸式预览或插件通过 launcher chrome contract 明确声明的自有搜索语义可替换 placeholder / label，但不能移除固定 chrome；由 source contract、真实输入行为、窗口几何和独立视觉审阅验证。

### OW-DM-010 — 宣传视频语言与明暗主题矩阵

- Revision / status / scope: 3 / ACTIVE / OneWorks project，README、社交平台和发布宣传视频。先生成一个代表性原型；用户确认动画、真实窗口、鼠标节奏和构图整体正确后，再交付中文 / 英文与亮色 / 暗色的完整四变体矩阵。成片中的真实界面语言必须匹配发布入口，主题必须匹配变体，四条视频使用同一 app build、scenario、workspace、窗口几何和同一后期节奏。GitHub README 使用 `<picture>` 与 `prefers-color-scheme` 从同语言的亮 / 暗 GIF 中自动选择，高清 MP4 只保留在本地素材归档。
- Ownership / source / exceptions / enforcement: 规范正文由 [`../maintenance/demo-video.md`](../maintenance/demo-video.md)“场景维护”拥有，真实 Adapter 展示入口为 `launcher-open-workspace-adapter-tour`；来源为用户 2026-08-05 指出英文宣传视频错误复用了中文窗口，明确要求以后同时生成两种语言与两种明暗主题，并进一步要求只在用户确认整体逻辑后批量生成；随后要求 GitHub 使用主题选择器展示 GIF、视频版留在本地。只有用户明确指定单语言或单主题时允许缩减；由原型确认记录、四变体 batch manifest、逐变体 still、媒体 metadata、GIF 体积与帧数、README picture source、光标连续性和隐私检查验证。

### OW-DM-011 — 宣传视频 selector 镜头聚焦

- Revision / status / scope: 1 / ACTIVE / OneWorks project，要求突出真实产品交互区域的宣传录屏，首个适用场景为 `launcher-open-workspace-adapter-tour`。用户要求“放大到鼠标区域”时，对已包含真实窗口与合成光标的整幅录屏像素做平滑镜头推近；只放大鼠标图标不满足要求。
- Applies / does not apply: 适用于场景明确要求局部镜头聚焦并能通过稳定 selector 定位目标；普通产品录屏、用户没有要求聚焦、或聚焦会裁掉关键上下文时不自动启用。
- Positive / negative example: 鼠标接近 Adapter 控件时镜头开始推近，点击前稳定，弹层完整保留并持续到结尾；反例是窗口始终维持全景，只把蓝色光标放大，或用模拟窗口 / 模拟弹层代替真实画面。
- Ownership / source / exceptions / enforcement: 规范正文由 [`../maintenance/demo-video.md`](../maintenance/demo-video.md)“场景维护”拥有，实现在 demo-video recorder 的 selector camera focus timeline；来源为用户 2026-08-05 先要求打开 Adapter 选择器时放大鼠标区域、随后指出最终成片没有实际放大。场景可用窄作用域倍率 / offset 保证浮层不被裁切；由 scenario 调用顺序单测、camera timeline 缓动单测、四变体关键帧和独立逐帧视觉审阅执行。

### OW-DM-012 — 额度重置卡默认折叠

- Revision / status / scope: 1 / ACTIVE / OneWorks project，所有复用 `AccountQuotaPanel` 的账号额度 surface。额度重置卡标题与可用次数始终可见，卡片或空态正文默认折叠，通过同一原生 disclosure 在原位展开。
- Applies / does not apply / examples: 适用于账号详情、聊天额度弹窗及后续复用共享面板的入口；不影响上方使用限额窗口的常驻展示。正例是默认只显示“额度重置卡 / 可用次数”与展开箭头，点击或键盘操作后出现现有卡片；反例是每个消费页面各自维护展开状态、默认平铺空态，或折叠后留下正文高度。
- Ownership / source / exceptions / enforcement: 规则由 `apps/client/src/components/account-quota/AGENTS.md` 与 `AccountQuotaPanel.tsx` 拥有；来源为用户 2026-08-07 明确要求额度重置卡可折叠且默认折叠。暂无例外；由 `<details>/<summary>` DOM 契约、共享组件交互测试、账号详情与聊天弹窗的深浅主题及响应式视觉回归执行。

### OW-DM-013 — 账号额度区域不因认证状态消失

- Revision / status / scope: 1 / ACTIVE / OneWorks project，已存在账号记录且明确支持额度查询的共享额度 surface；首个适用范围为 Codex 账号详情。
- Rule / examples: 认证缺失或失效时仍保留完整额度卡片，继续展示最后一次额度或空结构，并在使用限额区域内给出本地化的重新登录提示；反例是以 `quota != null` 或登录状态为条件卸载整张卡片，让用户失去问题上下文与重新登录入口。
- Ownership / source / exceptions / enforcement: 规则由 `apps/client/src/components/account-quota/AGENTS.md`、`AccountQuotaPanel.tsx` 与消费方拥有；来源为用户 2026-08-07 明确要求无论登录状态是否丢失都展示额度区域，并在区域内提示。账号记录本身已被删除时不适用；由 missing / error 且无 quota 的组件回归、配置详情与聊天弹窗真实页面视觉审阅执行。

### OW-DM-014 — Agent Room 渠道流向与品牌标记

- Revision / status / scope: 1 / ACTIVE / OneWorks project，Agent Room 外部渠道来源与投递标记，以及复用共享渠道平台图标的页面。
- Rule / examples: 已知渠道必须使用对应品牌资产，只有未知渠道使用通用 `hub` fallback；Agent Room 中 `source` 标记位于气泡左侧，`delivery` 标记位于气泡右侧。正例是飞书入站消息左侧显示飞书品牌，Agent 发回飞书的回复右侧显示飞书品牌；反例是用 `flight`、`chat` 等语义近似 Material glyph 冒充渠道品牌，或把投递标记放在气泡左侧。
- Ownership / source / exceptions / enforcement: 规则由 `apps/client/src/components/agent-room/AGENTS.md`、共享 `ChannelPlatformIcon` 和 Agent Room 气泡组件拥有；来源为用户 2026-08-14 对真实飞书群聊页面的明确反馈。OneWorks 内部投影不显示外部渠道标记；品牌素材必须由 client bundle 或产品资产入口提供，不依赖用户 workspace。由渠道别名参数化测试、`source < surface < delivery` DOM 顺序断言、production build 资产检查和用户可见页面审阅执行。

## 待确认冲突

### OW-DM-P001 — 主题侧栏是否保留渐变

- Revision: 2
- Status: SCOPED_EXCEPTION
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
- Effective date: 2026-08-05
- Automatic enforcement: 文档相对资产检查、媒体 metadata / fast-start / 完整解码验证、locale / theme source 审计、浏览器网络请求与亮暗主题视觉回归，并验证主题切换会暂停已隐藏的视频。

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

新增例外时必须使用作用域例外模板；字段不可省略或合并。完整模板见 [`design-memory.md`](./design-memory.md#作用域例外模板)。
