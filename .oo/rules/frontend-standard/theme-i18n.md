# 主题与国际化

返回入口：[FRONTEND-STANDARD.md](../FRONTEND-STANDARD.md)

## CSS 变量与主题

- 跨应用共享的颜色、chrome 尺寸、route header、nav rail 等设计 token 统一定义在 `packages/route-layout/src/design-tokens.css`，通过 `@oneworks/route-layout/design-tokens.css` 引入。
- `apps/client/src/styles/global.scss` 只放 client 自己的全局 AntD / overlay / 页面样式，不再重新定义共享 token 表。
- 暗色模式共享 token 覆盖写在 `design-tokens.css` 的 `html.dark`。
- 样式中不要硬编码颜色，统一使用 `var(--variable-name)`。
- 新增跨应用全局变量时，同时补齐 `design-tokens.css` 的暗色模式对应值，并同步检查 `apps/client`、`apps/relay-admin` 和 `packages/route-layout` 的消费方。
- 使用 AntD 的独立前端入口必须把同一套主题状态同步给 `ConfigProvider`，CSS token 和 AntD algorithm / token 不允许各自维护一套浅深色逻辑。

## 常用变量

- `--bg-color`：页面或容器背景
- `--text-color`：主文本
- `--sub-text-color`：次级文本
- `--border-color`：边框 / 分割线
- `--success-color` / `--warning-color` / `--danger-color`：状态色

## 跨应用同步

- 修改 `--bg-color`、`--text-color`、`--border-color`、`--primary-color`、`--placeholder-color`、route header 或 nav rail 相关 token 时，优先改 `packages/route-layout/src/design-tokens.css`，再检查 client 和 Relay Admin 是否需要同步样式或 AntD theme adapter。
- Relay Admin 不应新增 `--relay-*` 这类独立色板；只有业务语义确实无法映射到共享 token 时，才在 admin 内部新增局部变量。
- 列表、表格、Card、Drawer、Dropdown、Select、Popover 等 AntD surface 的暗色适配应放在应用基础层或共享 UI 基础组件中，不在每个 feature 页面里逐个覆盖。

## 主题包

- 主题包是独立于 `primaryColor` 和 `themeMode` 的组件样式层；它可以统一覆盖共享 design token、AntD token、应用壳和内置组件形态，但不能复制业务组件或建立第二套页面结构。
- 当前主题用 global `appearance.themePack` 选择；主题专属配置统一放在 `appearance.themePacks.<theme-id>`。新增主题配置时扩展自己的命名空间，不向 `appearance` 根层追加主题私有开关。
- 设置页的主题包使用独立“主题”入口；“外观”继续负责主题色、浅色 / 深色 / 系统模式和其它跨主题偏好。非默认主题由客户端插件通过 `ctx.themes.register(...)` 提供，不在宿主增加主题 id 分支、主题私有文案、素材或 CSS。
- 主题包必须同时覆盖浅色、深色、响应式和 AntD `ConfigProvider` 映射；只改 CSS 变量或只改 AntD token 都不算完整接入。
- 主题设置页直接使用平台 divider list 展示主题，不再套一层 chooser card；所选主题通过插件注册声明自己的设置 tabs。默认主题只展示只读概览，不提供编辑控件；可配置主题只展示自己支持的 tab 和开关。
- 主题样式开关继续由主题私有命名空间拥有；基础颜色、普通组件 padding / glyph 和按钮、输入框、菜单、浮层等组件覆盖应分组配置。数值型覆盖必须同时展示只读的具体数值与单位和独立启用开关，不能退化成只有开关或可编辑输入；普通组件尺寸覆盖不能改写 route chrome 的共享 padding / icon token。
- 主题包的普通按钮、图标按钮、菜单和侧栏 hover 使用当前 surface 与文字色的轻量混合，不把 `primaryColor` 当作普通 hover 背景；侧栏背景保持中性 surface 阶梯和渐进层级，强主题色只用于主操作或明确强调态。主题声明紧凑按钮几何时，普通按钮与图标按钮统一使用四向 `5px` padding；该覆盖不能改变 route chrome 的共享几何。
- 可选主题包覆盖宿主紧凑导航控件时，快捷入口、搜索、分组标题与条目、Footer 插件入口和 NativeTabs 必须由主题自己的 control token 统一尺寸与状态；当前这些主题控件使用 `5px` gap，并由单一 parent gap / padding owner 提供。该主题作用域不改变默认主题、业务内容列表或 route chrome 的项目级 `10px` spacing token；`neo-workshop` 的零间距分割线组按 `OW-DM-E002` 作为更窄的主题身份例外。
- “中国方案”主题的结构分割线、容器边框和普通组件边框统一使用金色主题 token；错误、警告、成功等语义状态仍保留各自状态色，`primaryColor` 继续独立负责强调态而不是结构边框。该规则及素材由 `packages/plugins/china-red-theme` 拥有。

## 国际化

- UI 中禁止直接写硬编码中文，统一通过 `i18n` 管理。
- 使用 `useTranslation()` 和 `t('module.key')`。
- 资源文件位于 `src/resources/locales/zh.json` 与 `src/resources/locales/en.json`。
- 新增 key 时，中文和英文文件必须同时补齐。
