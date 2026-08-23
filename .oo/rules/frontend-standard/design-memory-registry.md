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

- Revision / status / scope: 6 / ACTIVE / OneWorks project，desktop primary chat history timeline。
- Rule / applicability: 主会话内容容器宽度超过 `820px`、非嵌入式、非 Agent Room 且存在至少一个时间线节点时，左侧 timeline rail 持续展示；未配置时默认使用 `event-line`，用户可通过 global `appearance.historyTimelineMode` 显式切换为原有 `node` 模式。内容是否可滚动只决定上下边缘渐隐，不决定 rail 是否存在。内容容器不超过 `820px`、新会话没有节点、`embeddedSessionChrome`、Agent Room、用户主动隐藏 rail 时不适用；选择 `node` 只替换渲染模式，不移除可见性约束。
- Examples: 正例是一问一答的短会话没有滚动空间，左侧仍显示事件短线；反例是因消息内容没有超过视口而移除整条 Event lines rail。
- Ownership / implementation / source / lifecycle / enforcement: `apps/client/src/components/chat/AGENTS.md` 的消息级操作约束拥有，实现在 `history-timeline/timeline-visibility.ts` 与对应单测；来源为用户先要求 Event line 模式在真实聊天页持续展示，随后明确把阈值调整为 `820px` 并要求支持 Event lines / Nodes；生效日期 2026-07-13；替代 OW-DM-003 Revision 3；例外为容器不超过 `820px`、嵌入式会话、Agent Room、无节点、用户主动隐藏及显式 `node` 模式；由纯可见性单测、真实短会话 DOM 断言和独立视觉审阅执行。

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

### OW-DM-015 — Team Chat Leader 与关联成员选择

- Revision / status / scope: 5 / ACTIVE / OneWorks project，Team Chat 创建页的 Leader 和普通成员选择。
- Rule / examples: Leader 是独立单选组，系统内置 Auto Leader 并作为没有显式实体 Leader 时的默认选择；Auto Leader 根据已选成员的名称和职责自动拆解、分配、跟进并汇总任务，至少需要一个普通成员，且不拥有实体频道连接。选择实体 Leader 后自动预选其定义中的关联成员，并在 Leader 卡片右下角展示关联成员头像；普通成员保持多选。两个选择组在桌面和中间宽度默认最多展示三行并各自纵向滚动；手机收为两行三列正方形卡片并隐藏描述，仍保留名称、头像、选择状态和 Leader 关联头像。正例是大量实体不会无限拉长页面，手机仍可紧凑扫描和选择且不制造外层与分组之间的竞争滚动；外部频道消息中，Auto Leader 只能把服务端生成的一次性委派交给真正拥有来源连接的实体子会话。反例是把 Leader 混入普通多选列表、要求先注册 Leader 才能创建群聊、给 Auto Leader 或非 owning member 发频道 token、允许同一委派被多会话重放、只在客户端临时保存关联关系，或让任一分组随实体数量无限增高。
- Ownership / source / exceptions / enforcement: 规则由 `packages/plugins/channel-oneworks`、OneWorks Channel 服务、Agent Room host session、共享 `EntityCard` 和 `Entity.team` 契约拥有；来源为用户 2026-08-14 先要求实体 Leader 单选与关联成员和内置 Auto Leader，随后明确创建页分组三行滚动及手机正方形紧凑卡片。服务端必须权威解析 Leader 模式与 `team.role` / `team.relatedEntities`，Auto Leader 的动态 roster prompt 只包含已选实体且通过统一 runtime protocol 调度；每个可执行请求必须至少委派一次并跟进到终态。外部回复 authority 必须由服务端按 room / host / owning member / active connection 原子绑定到专用实体子会话，回复目标固定为原始入站事件快照，无效委派必须 fail closed，已绑定 session 可幂等恢复 context，未领取授权必须按 TTL 过期，并拒绝跨 session 重放。由 schema、创建服务、外部入站 host 投递、原子 delegation claim、command authority、过期清理、交互测试，以及桌面/中间宽度/手机的行数、滚动、正方形几何和真实页面审阅执行。

### OW-DM-016–024 — Avatar 设计记忆（已路由）

Avatar 几何表情、编辑 / 相机边界、阴影、视图状态、预设历史、关键帧动画、分段按钮导航、舞台手势和可调毛玻璃面板的规则正文位于 [design-memory-registry/avatar.md](./design-memory-registry/avatar.md)；本登记表保留编号索引，正文与当前状态措辞由该窄作用域文件拥有。

### OW-DM-025 — 悬停卡片动作覆盖而非占槽

- Revision / status / scope: 1 / ACTIVE / OneWorks project，带有仅 hover / focus 可见动作的卡片和列表行。
- Rule / applicability: 此类动作在默认态不占正常布局空间；出现时覆盖在记录右侧内容层，正文的可用宽度、换行、位置和记录几何保持稳定。覆盖层必须有足够的当前 surface 背景或渐隐来保证可读。永久可见、且刻意承担主信息结构的 primary / semantic column action 可以正常参与布局，但不能把这种例外伪装成 hover-only action。
- Examples: 正例是账号列表卡片在 hover 时把星标和删除等低频快捷操作覆盖在右侧，默认正文占满可用空间；反例是在默认态留下空白 action 槽，或 hover 后用 flex 宽度、padding、margin、文本截断或换行来腾出按钮位置。
- Ownership / source / exceptions / enforcement: [`styles.md`](./styles.md) 的“卡片 / 侧栏内联 icon action”拥有规范，`apps/client/src/components/config/AGENTS.md` 负责配置页落地；这是 `UDM-T003` 稳定几何规则的具体记录，不替代它。来源为用户 2026-08-22 对会话预设 / 内置动作及账号卡片的明确反馈；生效日期 2026-08-22；例外为刻意常驻的 primary / semantic column action；由 default / hover / focus DOM 几何与文本换行比较、深浅主题可读性、键盘可达性和独立视觉审阅执行。

### OW-DM-026 — 卡片网格排序方向跟随可见邻居

- Revision / status / scope: 1 / ACTIVE / OneWorks project，允许用户重排的 card grid 和单列记录列表。
- Rule / applicability: 只有存在用户可调顺序时才渲染排序动作；每个动作都必须有实际的目标记录。多列网格只对同一行横向邻居使用左 / 右图标，真正单列的上下邻居才使用上 / 下图标；行尾跨到下一行不是“向右”，需要跨行排序时使用拖拽或明确的目标选择。不能以“前移 / 后移”这类抽象文案替代方向，也不渲染没有目标的动作。响应式布局改变邻居方向时，动作图标、tooltip / `aria-label`、Tab 可达性与 Enter / Space 激活必须同步复核。
- Examples: 正例是首张网格卡片只有同一行内可达的向右控制，末张卡片只显示可达方向；反例是在横向并列卡片上展示上 / 下箭头、把行尾伪装为向右，或为第一个元素保留不可用的“前移”按钮。
- Ownership / source / exceptions / enforcement: [`styles.md`](./styles.md) 的“卡片网格排序动作”拥有规范。来源为用户 2026-08-22 对会话预设卡片的明确反馈；生效日期 2026-08-22；不适用于没有用户排序语义的目录卡、状态卡或静态列表；由多列和单列视口的真实目标检查、tooltip / `aria-label`、Tab / Enter / Space 可达性、首末元素及部分末行的独立视觉审阅执行。

## 主题冲突与作用域例外（已路由）

主题侧栏冲突、文档站视频、可选主题紧凑间距和新粗野主题控件组的规则正文位于 [design-memory-registry/theme.md](./design-memory-registry/theme.md)；本登记表保留入口，正文与当前状态措辞由该窄作用域文件拥有。
