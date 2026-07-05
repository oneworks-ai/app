# Relay Admin Shared UI

`src/shared/ui` 放 Relay Admin 内部跨 feature 复用的基础界面组件。

## 入口

- `AdminActionButton.tsx`：管理端统一 action button，负责接入已有 `AdminIcon`，表格行操作、面板主操作和 header action 的同类按钮优先复用它。
- `AdminColumnFilter.tsx`：表格列头里的单列过滤入口；过滤条件应该靠近对应列，不放在列表顶部 toolbar。
- `AdminListTable.tsx`：管理端列表页标准表格，负责顶部搜索、展示列配置、批量操作行、滚动表格区和固定分页器；它的 class map / CSS source 来自 `@oneworks/components/admin-list-surface`，不要在本目录重新新增 `AdminListTable.css`。
- `AdminTabs.tsx`：管理端详情页 tabs 的统一 label / 样式入口；Relay Admin ProfilePage 与 client relay 插件账号详情页共享 `relay-admin-tabs` / `relay-admin-native-tabs` / `relay-admin-tab-label` 这套 class 语义，改 tabs 样式时需要同步确认插件侧是否需要更新。
- `DataPanel.tsx`：管理域数据区块的 card 外壳，消费 AntD `Card` 并接入 route surface token；users / invites / sso 这类数据页面不要自己重写 card header。
- `StatusBadge.tsx`：表格和状态条里的紧凑状态标签。
- `AdminIcon.tsx`：管理端 Material Symbols 图标入口；新增按钮或菜单图标时先在这里补映射，再由组件消费。

## 约定

- feature 组件只组合业务表单、表格和操作，不在各自目录重复实现 card、基础 action button 或 status badge。
- 列表型基础展示优先消费 AntD `List` / `Table` 这类结构组件，再通过本目录样式接入共享设计 token。
- 管理端列表页必须使用 `AdminListTable` 或保持同等交互：顶部 toolbar 默认只放搜索、刷新 / 创建等列表级动作和展示列配置；过滤条件放到对应 table header 列头，通过 `AdminColumnFilter` 或同等图标按钮打开浮层，状态、时间范围、类型等列过滤不要放到 toolbar；多选后才在 toolbar 下一行展示批量操作；表头可见；分页器固定在列表底部；中间数据区独立滚动。表格行内操作默认只显示图标，通过 `aria-label` / `title` 暴露含义；低频排查字段例如 UUID 不默认展示，只在详情页或展示列配置中出现。涉及 React 表格和非 React 插件端都要复用 `@oneworks/components/admin-list-surface` 的 class / CSS / native markup helper，不允许复制一份样式到业务模块。
- 表格排序只给“排序本身能帮助用户完成判断”的列，例如时间序列、数值指标或明确排序语义的业务字段；不要给状态、操作、mask 后的 key preview、普通名称等列机械加 sorter。时间列需要筛选时，排序和时间范围过滤可以共存在同一个 table header：列名旁保留排序交互，过滤按钮打开浮层。
- 列表 toolbar 的搜索应填满展示列按钮左侧空间，不加输入框边框 / 外层 padding，搜索图标走 `AdminIcon` 并保持和 header action icon 同尺寸。展示列这类辅助图标按钮应学习 `route-container-header__action-button`：透明背景、无边框、轻量 hover，只切换图标色。不要直接使用 `Input.Search` 这类会把搜索图标拆成额外按钮的默认组合样式。
- 本目录样式必须使用 `@oneworks/route-layout/design-tokens.css` 提供的 `--bg-color`、`--text-color`、`--sub-text-color`、`--border-color`、`--primary-color`、`--success-color`、`--warning-color`、`--danger-color` 等 token，不要新增 feature 私有色板。
- AntD `Table`、`Card`、`Empty`、`Select`、`Drawer`、`Popover`、`Popconfirm` 这类 surface 的暗色适配应优先放在 `DataPanel.css`、`StatusBadge.css`、`AdminActionButton.css` 或 app shell 基础层；不要在 users / invites / sso 页面里逐个补背景和文字颜色。
