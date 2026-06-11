# Relay Admin Handoff

This note summarizes the current Relay Admin / shared layout workstream so the next maintainer can continue from the right modules instead of rediscovering the layout and auth boundaries.

## Scope

The workstream turns Relay Admin from a mostly standalone admin page into a Vite React app that shares the same host shell mechanics as the main Web client:

- `packages/route-layout` now owns reusable route chrome: shared design tokens, host app shell, desktop nav rail, sidebar quick-link header, route container header/layout, side panel primitives, responsive layout helpers, retained values, mobile sidebar helpers, and panel resize.
- `apps/client` consumes those shared layout primitives for `AppShell`, `NavRail`, sidebar header quick links, route container layout, mobile sidebar behavior, and responsive layout state.
- `apps/relay-admin` consumes the same shared primitives through a thin app adapter. Admin route/business state stays in local features; shared package code stays free of React Router, AntD, auth, plugin registries, and admin API knowledge.
- `apps/relay-server` serves `/admin/*` through the Admin React history fallback and serves `/admin/assets/admin.js` plus `/admin/assets/admin.css` from the Vite build.
- `packages/plugins/relay` now consumes plugin host UI primitives for action bars, buttons, lists, and icons instead of hand-rolling its own action/list chrome.

## Design Decisions

- **One shared shell contract.** Host frame mechanics such as sidebar placement, collapsed preview, mobile sidebar modal behavior, resize handles, route surface padding, route header height, and chrome icon sizing belong in `packages/route-layout`.
- **Adapters own business data.** Admin routes, labels, icons, auth state, theme/language state, menu sections, API clients, and status copy stay in `apps/relay-admin`. Web plugin registries and route-specific menu contributions stay in `apps/client`.
- **No manual Admin token field.** Relay Admin now consumes `relay_token` from the Relay `/login` callback, stores the session token locally, verifies the current user with `/api/auth/me`, and loads admin management data only when the user role is `owner` or `admin`.
- **Device privacy boundary.** Device names, capabilities, workspace folders, and plugin scopes are user-private metadata. New relay-server writes store that metadata encrypted and store device tokens as hashes. Admin views must not expose other users' device details; management surfaces can use aggregate `deviceCount` and `maxDevices` only.
- **Shared visual tokens before local CSS.** Route header height, collapsed nav rail window-bar size, quick-link row sizing, quick-link icon size, hover fill icons, border colors, text colors, and dark-mode values should flow from `@oneworks/route-layout/design-tokens.css` and `@oneworks/route-layout/styles.css`.
- **Menu structure must stay semantic.** Theme selection is a radio group. Language is a submenu. Footer menu and route/plugin contributions should be passed as structured menu items instead of flattening nested actions into custom button lists.
- **Build output matters for this new package.** `@oneworks/route-layout` exports `dist/index.js` and `dist/index.d.ts` for normal package consumers, while the repo runtime can resolve `src/index.ts` through the `__oneworks__` condition. Root `.gitignore` ignores `dist`, so release or publish flows must build this package before packaging it.

## Important Files

- `packages/route-layout/src/HostAppShell.tsx` and `HostAppShell.css`: shared app content surface, compact sidebar sheet classes, collapsed content state, and shell-level CSS variables.
- `packages/route-layout/src/HostNavRail.tsx` and `HostNavRail.css`: shared desktop drawer structure, footer slots, resize handle placement, collapsed preview classes, window bar styles, footer button/menu visuals, and quick-link sizing.
- `packages/route-layout/src/HostSidebarListHeader.tsx` and `HostSidebarQuickLinks.tsx`: shared Web-style sidebar quick-link wrapper and rows.
- `packages/route-layout/src/RouteContainerHeader.tsx` and `RouteContainerHeader.css`: route header structure, fixed overlay height, shared action sizing, breadcrumb/title modes, and collapsed-sidebar margin contract.
- `apps/client/src/components/layout/AppShell.tsx`: Web adapter that connects shared shell primitives to React Router, Jotai, desktop APIs, shortcuts, and the existing `NavRail` / `Sidebar`.
- `apps/client/src/components/NavRail.tsx`: Web adapter that passes drawer body/footer/menu/resize data into `HostNavRail`.
- `apps/client/src/components/sidebar/SidebarHeader.tsx`: Web sidebar quick links now use the shared quick-link components.
- `apps/relay-admin/src/app/AdminApp.tsx`: Admin shell adapter, route header action wiring, resizable sidebar width persistence, collapsed state, and route mounting.
- `apps/relay-admin/src/app/AdminNavRail.tsx`: Admin business nav adapter, shared quick links, footer menu, theme radio group, language submenu, and footer Vibe icon.
- `apps/relay-admin/src/features/auth/adminSessionStorage.ts`: login callback token consumption, URL cleanup, session token storage, and `/login?redirect_uri=...` URL construction.
- `apps/relay-admin/src/features/dashboard/useRelayAdminDashboard.ts`: auth state machine, `/api/auth/me` verification, snapshot loading, and feature actions.
- `apps/relay-server/src/server.ts` and `routes/admin-ui.ts`: `/admin/*` history fallback and static admin asset serving.

## Current State

- Admin routes are `/admin/devices`, `/admin/devices/:deviceId`, `/admin/users`, `/admin/users/:userId`, `/admin/profile`, `/admin/invites`, and `/admin/sso`; `/admin` redirects to devices in the React app. Devices and profile are available to all authenticated Relay roles; users / invites / SSO are owner/admin-only in the UI and remain protected by server-side permission guards.
- Vite dev server supports HMR for Admin. Use `pnpm -C apps/relay-admin dev` and open `/admin` or `/login` on that Vite origin. The static relay server at `http://127.0.0.1:48888/admin` will not HMR.
- Admin dev server proxies `/api/*` to `http://127.0.0.1:48888` by default. Override with `ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET`.
- Admin dev server generates `/login` and `/login/complete` shell/config locally from relay-server source through `vite.relayLoginDev.ts`. `/login` loads `src/login/main.tsx` as a React + AntD entry with HMR; when opened without `redirect_uri`, dev mode defaults back to `/admin/users` on the current Vite origin. Relay-server login shell/config source changes still trigger a full reload.
- Relay login now supports remembered accounts, password login / registration with invite code, SSO provider buttons, Google provider presets, and light/dark favicon links that match the Admin app shell icon.
- The Admin header no longer renders an `Admin token` input. Devices are the first admin navigation domain for Relay device interconnection, but `/api/relay/devices` is scoped to the current session user's own devices. Sidebar entries are filtered by `shared/model/adminPermissions.ts`; ordinary member/viewer sessions should only see devices plus footer profile/account actions and should not request users / invites / SSO snapshot endpoints. List-page create actions for users, invites, and SSO providers live in `RouteContainerHeader` actions; page-local duplicate section headers were removed from those list panels.
- User management displays per-user device count and max-device limit. Admins can set `maxDevices` on a user; relay-server enforces that limit on new device registration while letting existing devices refresh with their own token.
- `/admin/users/:userId` is the admin user-detail route with breadcrumb header and admin operations such as role changes, reset password, and disabled state. `/admin/profile` is the current-account page from the nav footer account entry, keeps only current-page account actions such as logout in the route header, keeps account switching in the footer account menu, and intentionally avoids admin-management controls.
- Admin sidebar width is resizable through `usePanelResize`, clamped between 180 and 520 pixels, and persisted in localStorage under `relay-admin.sidebarWidth`.
- Admin list pages use the shared `AdminListTable` standard: top toolbar search plus display-column configuration only, column-specific filters in the corresponding table headers, row selection with batch actions in a second row only when selected, sticky table headers, a bottom-fixed paginator, icon-only row actions, and low-frequency identifiers hidden from default columns. List totals stay in the bottom paginator; route header titles do not render count badges for list pages. List toolbar search fills the space before the display-column button without input chrome or wrapper padding, uses an `AdminIcon` search icon at header-action size, and auxiliary icon buttons follow `route-container-header__action-button` styling; do not reintroduce AntD `Input.Search` split-button styling or toolbar-level filter selects there. Pure icon header actions must carry tooltip labels through the shared route header action contract. Current accounts cannot modify their own role from list or detail pages, and relay-server rejects session-authenticated self role PATCH requests. Device UUIDs, workspace folders, plugin scopes, and capabilities JSON default to the current user's own detail route / column configuration rather than admin user management.
- Admin quick links use the shared Web sidebar quick-link DOM and visual classes. Do not reintroduce `HostNavRailPrimaryNav` or route-local primary-item button lists for this area.
- Admin footer account/menu actions stay pinned to the bottom rail area in the expanded and preview states. Current-account avatar resolution falls back to remembered login accounts so Google SSO avatars can appear in the footer, account menu, and profile page.
- Admin status shows sign-in / forbidden / checking states from the session auth flow and links to `/login`.
- Relay server admin APIs continue to accept the deployment `ONEWORKS_RELAY_ADMIN_TOKEN`, but the Admin UI path is now session-first. The same permission matrix grants `owner` and `admin` users admin capabilities.

## Verified Locally

- `pnpm exec dprint check apps/relay-admin/index.html apps/relay-admin/vite.relayLoginDev.ts apps/relay-server/src/routes/login-page.ts apps/relay-server/src/routes/login-page-client-config.ts apps/relay-server/src/routes/admin-ui.ts apps/relay-server/__tests__/admin.spec.ts apps/relay-server/__tests__/auth.spec.ts`
- `pnpm -C packages/route-layout typecheck`
- `pnpm -C packages/route-layout test`
- `pnpm -C apps/relay-admin typecheck`
- `pnpm -C apps/relay-admin test`
- `pnpm -C apps/relay-admin build`
- `pnpm -C apps/relay-server typecheck`
- `pnpm -C apps/relay-server test`
- `pnpm --filter @oneworks/client prepublish`
- Browser regression on Admin Vite origin:
  - `/admin/users`, `/admin/users/:userId`, `/admin/profile`, `/admin/invites`, `/admin/sso`, and `/login`
  - shared `39px` route header, list-page container actions, user-detail breadcrumb, profile account surface, sidebar resize persistence, collapse/expand offsets, footer avatar/menu, theme radio group, language submenu, login callback token cleanup, and Google SSO redirect callback to `http://127.0.0.1:48888/api/auth/oauth/google-sso/callback`

`@oneworks/client` build completes with the existing Rollup large-chunk warning.

## Handoff Checklist

Before merging, the next maintainer should run or confirm the browser checks appropriate for the changed area.

- Browser verify Admin on the Vite dev origin:
  - `/admin/devices`, `/admin/devices/:deviceId`, `/admin/users`, `/admin/users/:userId`, `/admin/profile`, `/admin/invites`, and `/admin/sso` render through the shared route container.
  - Header height stays at the shared `39px` overlay height.
  - List-page create actions appear in the container header, not as duplicate page-local section headers.
  - User detail routes use breadcrumb header chrome; profile routes use the current-account header/content, keep logout as the profile header action, keep account switching in the footer account menu, and do not show admin-management controls.
  - Sidebar drag resize controls the route content width and persists after reload.
  - Sidebar collapse/preview keeps the shared window-bar icon size, filled-hover icon, top padding, and route header offset aligned with the Web layout debug page.
  - Sidebar quick-link icons compute to the shared `16px` quick-link size, not the Admin `18px` chrome icon size.
  - Footer account and menu entries remain pinned to the bottom and show account avatars when remembered SSO data has an avatar URL.
  - Footer menu keeps theme as a radio group and language as a nested submenu.
  - Login callback removes `relay_token` from the URL, stores the session token, calls `/api/auth/me`, and rejects non-admin roles.
- Browser verify Relay login on the Vite dev origin:
  - `/login` uses the React + AntD login form and HMR.
  - Empty remembered-account and empty SSO sections stay hidden.
  - Password login / registration requires password confirmation in registration mode.
  - Google SSO uses the expected redirect URI for the currently served origin.
  - `/login` and `/admin` both show the OneWorks favicon.
- Compare with the Web layout debug page:
  - `/ui/__interaction-structure/requests?routePanels=side,bottom&__oneworks_desktop=macos`
  - Focus on sidebar wrapper DOM, quick-link rows, collapsed sidebar chrome, resize behavior, and route header height.
- If `packages/route-layout/src/index.ts` exports change, make sure the package build still produces matching `dist` output before release.

## Known Follow-ups

- Confirm the package publish job builds `packages/route-layout` before packaging; `dist` is intentionally ignored in this repo, but the current package export map expects it in published artifacts.
- Continue reducing Admin-specific visual overrides in `AdminApp.css` after the shared package owns enough chrome primitives.
- Move any future shared menu rendering primitive into `packages/route-layout` only after both Web and Admin can feed it structured section/item data without leaking app-specific state into the package.
- Audit remaining Admin strings for localization if the management UI is expected to fully switch language; the footer language control currently owns local menu state but Admin feature copy is still mostly literal English/Chinese.
