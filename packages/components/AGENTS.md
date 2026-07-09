# Components Package Guide

`packages/components` owns shared high-level React components for OneWorks apps.

## Boundaries

- Put app-agnostic, product-facing React components here when they intentionally depend on UI libraries such as AntD. Pure UI contracts that must be reused by React and non-React plugin surfaces can also live here as focused subpath exports.
- Keep low-level layout primitives in `packages/route-layout`; compose them here when the reusable component needs AntD, tooltip portals, shortcut display, or other higher-level interaction behavior.
- Do not import app-local state, React Router routes, i18n namespaces, plugin registries, desktop IPC, or Jotai atoms from `apps/client`. Accept labels, callbacks, state, and shortcut strings as props instead.
- `src/route-layout` is the high-level route layout component layer. It should wrap `@oneworks/route-layout` classes and tokens while owning AntD-backed action buttons, shortcut tooltip behavior, and other reusable header chrome.
- `RouteContainerHeaderBreadcrumb.ancestors` 按从最外层到最内层传入；共享 header 固定按“返回按钮、ancestors、直接父级、当前页”渲染。业务组件只提供层级数据和导航回调，不得为单个页面重排或复制 breadcrumb DOM。
- `src/admin-list-surface` is the shared list surface contract for AdminListTable-style pages. It exports one CSS source plus class names and native markup helpers so Relay Admin React tables and relay plugin pages reuse the same toolbar/search/list/token-page structure. Treat it as the single source of truth; do not copy its CSS into admin or plugin modules. Native lists have two separation modes only: divider rows have 10px vertical padding and no row gap; gap/no-divider lists have 10px list gap and no row padding. Do not combine row gap with dividers. Horizontal icon/text/action gaps stay 6px, and the native icon/avatar slot stays 18px; avatars or custom glyphs placed in that slot must inherit the slot size instead of carrying page-specific dimensions. Keep long paths, IDs, and diagnostics out of the default row text; expose the full value through tooltips, context menus, details, or copy actions. React plugin views should render native-list search with the client host `SearchInput` / `ListSearchInput` and only attach the admin-list class for layout; do not duplicate AntD affix-wrapper, pseudo-element, or plugin-local search styling.
- `RouteChromeHeader` and `RouteChromeInput` are the shared visual primitives for static route chrome such as mobile workspace overview headers, WebView page headers, and search / URL bars. Keep them app-agnostic: accept labels, slots, callbacks, and classes as props; do not import workspace drawer, iframe, router, or native WebView state.
- When a client view starts copying route header/search DOM to match an existing screen, first add the missing slot or prop to these shared primitives. Reuse the design language, not an unrelated business component implementation.

## Verification

- Run `pnpm -C packages/components typecheck` after changing exported component APIs.
- Run the consuming app checks when a client adapter changes, especially `pnpm exec eslint apps/client/src/components/chat/ChatHeader.tsx apps/client/src/components/layout/RouteContainerHeader.tsx`.
