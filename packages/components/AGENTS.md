# Components Package Guide

`packages/components` owns shared high-level React components for OneWorks apps.

## Boundaries

- Put app-agnostic, product-facing React components here when they intentionally depend on UI libraries such as AntD. Pure UI contracts that must be reused by React and non-React plugin surfaces can also live here as focused subpath exports.
- Keep low-level layout primitives in `packages/route-layout`; compose them here when the reusable component needs AntD, tooltip portals, shortcut display, or other higher-level interaction behavior.
- Do not import app-local state, React Router routes, i18n namespaces, plugin registries, desktop IPC, or Jotai atoms from `apps/client`. Accept labels, callbacks, state, and shortcut strings as props instead.
- `src/route-layout` is the high-level route layout component layer. It should wrap `@oneworks/route-layout` classes and tokens while owning AntD-backed action buttons, shortcut tooltip behavior, and other reusable header chrome.
- `src/admin-list-surface` is the shared list surface contract for AdminListTable-style pages. It exports one CSS source plus class names and native markup helpers so Relay Admin React tables and relay plugin string-rendered pages reuse the same toolbar/search/list/token-page structure. Treat it as the single source of truth; do not copy its CSS into admin or plugin modules.
- `RouteChromeHeader` and `RouteChromeInput` are the shared visual primitives for static route chrome such as mobile workspace overview headers, WebView page headers, and search / URL bars. Keep them app-agnostic: accept labels, slots, callbacks, and classes as props; do not import workspace drawer, iframe, router, or native WebView state.
- When a client view starts copying route header/search DOM to match an existing screen, first add the missing slot or prop to these shared primitives. Reuse the design language, not an unrelated business component implementation.

## Verification

- Run `pnpm -C packages/components typecheck` after changing exported component APIs.
- Run the consuming app checks when a client adapter changes, especially `pnpm exec eslint apps/client/src/components/chat/ChatHeader.tsx apps/client/src/components/layout/RouteContainerHeader.tsx`.
