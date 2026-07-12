# 样式与类名

返回入口：[FRONTEND-STANDARD.md](../FRONTEND-STANDARD.md)

## 样式拆分

- 每个组件拥有独立 `.scss` 文件，并在 `.tsx` 中显式引入。
- 禁止把大量无关样式堆在单个大 `.scss` 文件里。
- 静态样式禁止写在 `style={{...}}`；只有运行时必须计算的属性才允许行内样式。

## 设计取向

- 多用图标，少堆重复提示文案。
- 控制信息密度时要区分主结构信息和次级元数据：分组名、当前对象名、用户需要扫描比较的关键值和明确动作文案应直接可见；字段含义、计数、路径、ID、运行时来源等次级信息不要默认常驻成大段文字，优先用图标 + tooltip / aria-label 承载。克制不等于纯图标化；如果去掉文字后需要猜含义，就应恢复短标签或短值。
- 样式保持简约，避免过度装饰和过深层级。
- 只渲染当前任务真正需要的信息。

## 视觉风格

One Works 是高密度工作台，不做营销页式装饰。页面应安静、紧凑、可扫描，优先服务长时间编辑、对比和切换。

- **应用壳**：桌面常规状态下，主工作区可以是带圆角的内容卡片；侧栏折叠或需要沉浸式工作区时，主区域应铺满，不再保留卡片式外框。
- **外层留白**：卡片和主内容区保留稳定外层 padding，让内容不要贴边；不要为了实现浮动 header 把外层 padding 清掉。需要 overlay 时，把 header 放在内容卡片内部浮起。
- **顶部栏**：聊天页、配置页和工作区抽屉的顶部栏统一采用 24px 内容高 + 12px 上下 padding 的节奏，整体高度约 48px。顶部栏可以使用轻量毛玻璃和底部分割线，覆盖在下方滚动内容之上；滚动区域用对应的 top padding / scroll padding 避让。
- **表面层级**：常规字段、列表项和卡片使用 8px 左右圆角；只有页面级外框或输入区组合可以使用更大的圆角。不要在卡片里再套卡片，相关字段可以合并为无 gap 的连续组，不相关字段必须留出间隔。
- **相邻区块的间距归属**：两个相邻元素或 section 的同一条接缝只能由一层负责留白，默认使用共享的 10px spacing token，并在 parent `gap`、前一项 `padding-block-end`、后一项 `padding-block-start` 中三选一；禁止把两侧 padding、parent gap 或 margin 叠加成 20px 以上的无语义空隙。如果两个区块因各自内部节奏必须同时保留接缝侧 padding，两段 padding 之间必须有可见的 1px 分割线，明确它们属于不同结构区。实现和回归时要逐条检查相邻边界，不能只看单个组件自身的盒模型。
- **分割与边框**：边框用于表达结构，不用于堆装饰。连续 action 之间用短分割线；可折叠 status bar、header 衔接层这类覆盖元素不能比本体多出 1px 偏移，避免视觉上变宽。
- **平台列表分隔模式**：原生列表只使用两种分隔语言。资源 / 结果列表，例如文档、团队、设备、配置、版本这类需要扫描比较和打开的同类对象，使用 divider 模式：行之间有 1px 分割线，行上下 padding 为 10px，列表左右不额外加 padding，行之间不再加 gap。分组 / 导航 / content 列表使用 gap / no-divider 模式：列表行不加上下 padding，不加 divider，由列表容器提供 10px gap；不要靠额外 min-height 制造外部间距。gap 和 divider 二选一，不要在同一个列表里同时靠 gap 与分割线表达层级。
- **侧栏列表**：会话列表、配置分组和其他导航列表复用同一套 grouped list 语言。一级入口、搜索框、分组标题和二级项的图标列要对齐；二级项通过缩进表达层级。分组标题整行可折叠，但 hover 不额外加明显背景。
- **列表行信息密度**：行内只放用户可识别和可扫描的名称、短状态和必要动作；长路径、ID、运行时来源、环境诊断、失败详情这类信息默认不要平铺在行里，完整内容放 tooltip、context menu、详情页或复制动作里。状态优先通过图标差异、图标角标或头像角标表达，避免同时再堆重复 tag。
- **图标与按钮**：工具类按钮优先用 Material Symbols / 现有图标组件表达动作，避免用文字按钮替代常见图标。横向 icon / text / action gap 默认 6px；列表图标位和头像尺寸统一 18px，头像或自定义 glyph 必须继承平台图标槽尺寸，不要在页面局部写独立尺寸。顶部栏和折叠侧栏里的图标按 16px 起步，重要入口或 hover filled 态可放大 2px，但按钮点击区域保持稳定。
- **紧凑 chrome 工具栏**：Route header actions、panel tab chrome、嵌入式网页 toolbar、窗口控制条这类紧凑 chrome 必须共享同一套尺寸语言：图标和图标按钮内容尺寸统一走 `--app-chrome-icon-size`，当前是 18px；动作组间距统一走 `--app-chrome-action-gap`；常规 header / toolbar padding 走 `--route-container-header-padding-block` 和 `--route-container-header-padding-inline`，当前是 10px。不要在局部组件或 media query 里硬写 `6px` padding、`0` gap、`26px` 按钮宽度、`30px` 输入高度这类会破坏标准的值；确实要调整密度时先改 token 或新增明确语义 token。
- **chrome icon-only action 状态**：紧凑 chrome 中的图标按钮默认透明背景、`var(--placeholder-color)`；hover / focus / open 只切到 `var(--primary-color)`，不要额外加 hover 背景、inset ring 或 box-shadow，除非该控件本身是明确的 selected / filled 状态。禁用态使用 disabled / muted 颜色，cursor 必须是 `not-allowed`，tooltip 文案必须说明“不可用原因”，不能继续显示正常动作文案。
- **卡片 / 侧栏内联 icon action**：配置卡片标题、侧栏 quick link、列表行尾这类非 route chrome 的内联工具按钮，默认对齐 `.sidebar-header__quick-link-action` 视觉语言：20px 点击槽、16px 图标、5px 圆角、透明背景、无边框无阴影，hover / focus 只把图标切到 `var(--primary-color)`。这类按钮必须是 icon-only，使用 tooltip 和 `aria-label` 说明动作；同一对象的必要快捷动作放在 `更多` 左侧，低频动作收进 `更多` 菜单。不要在局部写成带文字、带边框或 28px 方块按钮，除非它是明确的主操作按钮。
- **列表搜索条**：资源列表、配置列表、插件视图和 admin native list 里的搜索条必须复用平台 `ListSearchInput` 或 host 暴露的 `SearchInput`；使用 `InteractionList.search` 时也由同一组件渲染。平台搜索条使用 native input 结构，搜索图标 18px，图标与输入文字间距 6px，不能依赖 AntD affix wrapper 的隐藏伪元素或默认 padding。业务模块只传 `value`、`onChange`、`placeholder` 和必要的 trailing action，不要在局部手写 search icon、输入高度、prefix gap、focus 颜色或 AntD wrapper 覆盖样式。插件遵守平台规范，不能为了单个插件页面局部覆盖 AntD 或伪元素样式。
- **平台优先级**：列表、搜索、行间距、图标尺寸和状态表达以平台组件、host 组件与共享 token 为准。插件不得局部特殊处理这些基础视觉规则；确实需要新的密度或状态语义时，先扩展平台组件 / token / host prop，再由业务或插件消费。
- **Launcher 插件页面**：`view.host.surface === "launcher"` 的插件页面必须复用 launcher command-shell UX。顶部搜索由 launcher 宿主提供，插件内容区留白由 launcher 宿主提供，插件内不要再加外层 padding 或另起 sticky/header 搜索。列表必须走平台 `InteractionList` / `ListSearchInput` 标准，优先使用 `InteractionList` 的 `mode="launcher"` 与 `search` 配置；launcher mode 是 command-shell 紧凑列表变体，列表容器不加 padding，行距和图标槽由 launcher / host component 统一控制。搜索、分组、行间距、图标槽和空态通过宿主组件 prop 配置，不在插件里手写搜索栏、分组标题、gap / divider 或 AntD wrapper 样式。页面图标、头像和标题通过 `view.route.setLauncherChrome(...)` 声明给宿主，由 launcher 渲染到搜索框和面包屑；插件内容内不要再渲染重复 hero / header。`route` / `workbench` / `drawer` 这类 workspace surface 可以保留常规页面搜索，但仍应复用 host `SearchInput` / `ListSearchInput`。
- **内嵌地址栏 / inline input**：如果输入框放在紧凑 toolbar 里，外层 toolbar 负责 10px padding，输入框本体要按 chrome 内容高度对齐。AntD affix wrapper 不应再保留默认内边距；prefix icon、输入高度和行高都应跟 `--app-chrome-icon-size` 对齐。只有当输入框内部确实覆盖了 trailing action 时，才允许增加对应的局部 padding。
- **菜单与浮层密度**：右键菜单、更多菜单、browser menu 等浮层必须优先复用 Ant Dropdown 或 `oneworks-overlay-*` token。菜单 panel padding 使用 `--oneworks-overlay-panel-padding-y`，行间距使用 `--oneworks-overlay-item-gap`，菜单项 padding 使用 `--oneworks-overlay-item-padding`，图标使用 `--oneworks-overlay-icon-size`，分割线使用 `1px 8px` inset。不要在局部菜单里写一套更大的控制条、独立 hover 背景或不跟随 overlay token 的图标尺寸；特殊行例如 zoom 控制也必须嵌回同一菜单 row 视觉节奏。
- **主题色**：强调态、用户消息气泡、选中态和主操作默认跟随 `--primary-color`。不要在暗色模式或局部组件里硬编码蓝色；需要派生色时用 `color-mix()` 基于主题 token 生成。
- **明暗色**：暗色模式避免不明来源的大面积渐变；玻璃效果应保持可感知但克制，优先用透明背景 + blur + 细分割线，而不是强阴影或高饱和渐变。
- **响应式收缩**：不要用单一 viewport 断点决定所有密度变化。侧栏折叠、聊天 sender 宽度、工作区抽屉宽度和窄屏布局是不同状态，应按实际容器宽度或明确状态分别处理。

## 页面布局标准

会话列表页和配置页共同定义应用内页面的默认布局语言：外层 shell 管留白与背景，页面内容只负责自身结构，避免多个层级重复 padding / margin。

- **Shell 留白归属**：桌面态页面外侧留白放在 `.app-shell__content-region` 一层，上下通常 6px，右侧可按视觉平衡略大，左侧由侧栏边界自然衔接。具体页面容器不要再额外加外层 margin 去模拟同一圈留白。
- **内容卡片归属**：主内容卡片由 `.app-shell__content > *` 或页面根容器承接圆角、背景和 overflow。会话页常规态可以是卡片，侧栏折叠、沉浸式工作区或需要铺满画布时应去掉卡片外框并撑满。
- **页面内容容器**：配置页这类 route-sidebar 页面，`.config-view__desktop-content` 不再管理外边距；它只承接内容卡片背景、圆角、内部 overlay header 和滚动区域。会话页同理，`.chat-container` 处理聊天结构，外层 shell 不再二次加 padding。
- **Header 覆盖方式**：页面 header 应贴在内容卡片顶部边缘，作为卡片内部的 overlay / sticky 层覆盖滚动内容；下方 history、配置列表或文件树通过 top padding / scroll padding 避让。不要用 header 外层 margin 把它从边缘推开。
- **背景穿透**：凡是把 padding 放在外层容器上，该容器必须设置与内容区域一致的背景 token，尤其暗色模式下不能让 padding 区域透出 `.app-shell` 的更深底色。
- **侧栏列表密度**：侧栏顶部入口、搜索、quick links 和 grouped list 之间默认不靠额外 margin/gap 分隔；结构层级用 28px 行高、图标列对齐、二级缩进和必要的 group label 表达。
- **相关与不相关分组**：相关配置项可以在同一个 field group 中无 gap 连续排列；不相关 section 之间用 section 标题和 12px 左右的 editor gap 隔开。不要为了统一高度把所有字段强行合成一个连续列表。

## 类名规范

- 类名使用 kebab-case，例如 `.chat-message-item`。
- 组件根节点类名建议与文件名语义一致。
- 推荐使用 BEM 配合 SCSS 嵌套：
  - Block：`.a-b-c`
  - Element：`.a-b-c__d-e`
  - Modifier：`.a-b-c--active`

```scss
.a-b-c {
  &__d-e {
    &--disabled {
      opacity: .5;
    }
  }

  &--active {
    border-color: var(--border-color);
  }
}
```

- 嵌套深度建议控制在 3 层以内。
- 避免使用 `div span` 这类标签嵌套选择器，优先语义化类名。
