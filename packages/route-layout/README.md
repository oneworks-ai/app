# @oneworks/route-layout

Shared React route chrome primitives used by OneWorks app surfaces.

## Usage

```tsx
import '@oneworks/route-layout/design-tokens.css'
import '@oneworks/route-layout/styles.css'

import {
  HostAppShell,
  HostNavRail,
  HostNavRailFooterButton,
  HostSidebarListHeader,
  HostSidebarQuickLinks,
  RouteContainerHeader,
  RouteContainerLayout
} from '@oneworks/route-layout'

export function Page() {
  return (
    <HostAppShell
      closeLabel='Close'
      desktopSidebar={() => (
        <HostNavRail
          footerMenu={<HostNavRailFooterButton label='Menu' />}
        >
          <div className='sidebar-container sidebar-container--nav-embedded'>
            <div className='sidebar-content'>
              <HostSidebarListHeader className='sidebar-header'>
                <HostSidebarQuickLinks
                  ariaLabel='Workspace'
                  items={[{
                    active: true,
                    key: 'page',
                    label: 'Page',
                    onSelect: () => {}
                  }]}
                />
              </HostSidebarListHeader>
            </div>
          </div>
        </HostNavRail>
      )}
      isCompactLayout={false}
      isMobileSidebarOpen={false}
      mobileSidebar={() => null}
      onMobileSidebarOpenChange={() => {}}
      routeSidebarAriaLabel='Workspace'
      sidebarCollapsed={false}
      showSidebar
    >
      <RouteContainerLayout
        contentInset
        header={<RouteContainerHeader title='Page' />}
      >
        <main>...</main>
      </RouteContainerLayout>
    </HostAppShell>
  )
}
```

`RouteContainerLayout` owns the route surface, body, optional right panel, optional bottom panel, resize mechanics, and close retention. Callers own business state and pass rendered slots.
`HostAppShell` owns the shared content surface, padding, rounded container, compact mobile sheet classes, and collapsed-content visual states used by the main client and standalone apps such as Relay Admin.
`HostNavRail` owns the shared desktop drawer structure, footer slots, resize handle placement, and collapsed preview classes. `HostSidebarListHeader` and `HostSidebarQuickLinks` own the shared Web sidebar quick-link shell and row visuals used by embedded sidebars and standalone apps such as Relay Admin. Callers still own route state, menu item data, desktop/window integrations, plugin registries, account actions, theme/language preference data, and rendered slots.
`AppShellFrame` owns the lower-level host shell mechanics: workbench sidebar placement, compact mobile sidebar modal behavior, desktop collapsed-sidebar preview, and edge-swipe preview.
`RouteWorkbenchShell` is the lower-level structural frame used by `AppShellFrame`; use it directly only when a surface needs custom shell mechanics.

Client routes that use React Router should pass `location`, or use the client-side adapter at `apps/client/src/components/layout/RouteContainerLayout.tsx`.

## Integration Contract

- Keep this package app agnostic. React Router locations, Jotai state, desktop APIs, AntD themes, plugin registries, auth/session state, admin API data, and product-specific menu sections must be translated by the consuming app before reaching these components.
- Put shared chrome behavior here when both Web and standalone surfaces need it: route header height, chrome icon sizing, collapsed sidebar preview, nav rail window bar, quick-link row sizing, sidebar resize handles, mobile sidebar modal behavior, and route side-panel layout.
- Keep business extension points outside the package. Menu items, route labels, plugin actions, account entries, theme/language preferences, and navigation targets should arrive as structured props or slots.
- `HostSidebarListHeader` and `HostSidebarQuickLinks` are the shared Web-style sidebar quick-link surface. Consumers should not recreate the same DOM or spacing with local primary button lists.
- Route header and nav rail chrome should continue to derive from the shared token chain beginning with `--app-chrome-icon-size` and `--route-container-header-overlay-height`; avoid local pixel overrides in app CSS unless the whole shared token contract changes.

## Styles

- `@oneworks/route-layout/design-tokens.css`: shared app chrome and color CSS variables, including the `html.dark` token table.
- `@oneworks/route-layout/layout.css`: layout and side-panel styles only.
- `@oneworks/route-layout/styles.css`: layout plus base route header, host shell, and host nav rail styles.

Consumers should import `design-tokens.css` unless they already provide the same token contract. Override common tokens only for deliberate app-specific behavior; do not recreate a separate color system when `--bg-color`, `--text-color`, `--border-color`, `--primary-color`, `--placeholder-color`, `--app-chrome-icon-size`, `--route-container-header-overlay-height`, and optionally `--route-workbench-sidebar-*` are sufficient.
Apps that use AntD should map the same resolved theme state to their `ConfigProvider`; this package exposes CSS tokens only and does not own AntD theme objects.
Plugin contribution menus, app page menus, account actions, and app settings must be resolved in the consuming app and passed through slots such as `HostNavRail.footerMenu`, `footerBefore`, or `footerAfter`.

## Development

```bash
pnpm -C packages/route-layout test
pnpm -C packages/route-layout typecheck
pnpm -C packages/route-layout build
```
