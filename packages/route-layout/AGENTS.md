# Route Layout Package Guide

`packages/route-layout` owns reusable route container primitives that can be consumed by multiple React apps in this repo, including `apps/client` and `apps/relay-admin`.

## Boundaries

- Keep this package free of app-specific dependencies such as React Router, antd, jotai, i18next, desktop shortcut stores, plugin registries, and route business state.
- `RouteContainerLayout` may accept structured location, slot, resize, and compact-mode props. It must not import app route modules or write URL/query state itself.
- `RouteContainerHeader` is the dependency-light base header. App-specific headers can wrap or compose it, but shared visual sizing and CSS tokens should stay here when they are generic.
- `HostAppShell` is the preferred high-level host surface for app-like routes. It wraps `AppShellFrame` with the shared content surface, padding, radius, compact mobile sheet classes, and collapsed-content tokens used by the main client and standalone apps such as Relay Admin.
- `HostNavRail` provides the shared desktop drawer structure, footer slots, resize handle placement, collapsed preview classes, and primary nav item visuals. It must stay slot-based: callers provide body content, footer menu buttons, route items, preference menus, plugin contribution menus, and account actions from their own app layer.
- `AppShellFrame` provides the lower-level host shell mechanics for client-like app surfaces: desktop workbench sidebar placement, compact mobile sidebar modal/focus behavior, collapsed-sidebar preview, and edge-swipe preview. It should stay route/app agnostic: callers provide items, active state, icons, labels, click behavior, desktop chrome slots, and route content.
- `RouteWorkbenchShell` is the lower-level structural frame used by `AppShellFrame`. Prefer `AppShellFrame` when a surface needs the same shell behavior as the main client; use `RouteWorkbenchShell` directly only for custom shell mechanics.
- `design-tokens.css` owns the shared app chrome and color CSS variables used by both `apps/client` and standalone surfaces such as Relay Admin. Consumers should import it instead of recreating `--bg-color`, `--text-color`, `--border-color`, `--primary-color`, or dark-mode token tables locally.
- This package must not import AntD or own AntD theme objects. Apps that use AntD must map the same resolved theme state to both `html.dark` and their own `ConfigProvider` theme adapter.
- AntD-backed, product-facing route layout components belong in `packages/components/src/route-layout`. Keep this package as the lower-level primitive layer and expose higher-level action buttons, shortcut tooltips, and portal-backed chrome from `@oneworks/components/route-layout`.
- CSS lives in plain `.css` so standalone Vite apps can consume it without requiring Sass.

## Consumer Pattern

- Apps with React Router should pass router state from their own adapter layer instead of adding `react-router-dom` to this package.
- Import `@oneworks/route-layout/layout.css` when only the route body/side-panel layout is needed.
- Import `@oneworks/route-layout/styles.css` when the base header, `HostAppShell`, `HostNavRail`, `AppShellFrame`, or workbench/sidebar shell is also used.
- Import `@oneworks/route-layout/design-tokens.css` when a consumer needs the shared app chrome and color token defaults.
- Consumers may override shared tokens for app-specific needs, but should not define a separate color system when the common `--bg-color`, `--text-color`, `--border-color`, `--primary-color`, `--placeholder-color`, `--app-chrome-icon-size`, and route header tokens are sufficient.
- When editing `design-tokens.css`, check `apps/client/src/main.tsx`, `apps/client/src/hooks/use-app-preferences.ts`, `apps/relay-admin/src/app/AdminThemeProvider.tsx`, and app-level surface styles so CSS variables and AntD theme tokens stay aligned.
- Do not import plugin registries, i18next, React Router, antd, jotai, auth state, or app settings into `packages/route-layout`. Translate those business concerns into `HostNavRail` slots or structured item props in the consuming app.

## Verification

- Run `pnpm -C packages/route-layout test` after changing slot context, header structure, side-panel behavior, or exported types.
- Run the consuming app checks as well when an app adapter changes, for example `pnpm -C apps/client build` or `pnpm -C apps/relay-admin build`.
