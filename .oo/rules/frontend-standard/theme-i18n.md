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

## 国际化

- UI 中禁止直接写硬编码中文，统一通过 `i18n` 管理。
- 使用 `useTranslation()` 和 `t('module.key')`。
- 资源文件位于 `src/resources/locales/zh.json` 与 `src/resources/locales/en.json`。
- 新增 key 时，中文和英文文件必须同时补齐。
