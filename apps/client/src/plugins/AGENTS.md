# Client Plugins

This directory hosts the workspace client plugin runtime.

- `plugin-manifest.ts`: narrow frontend copy of the `/api/plugins` response and contribution contracts until shared package types are available.
- `plugin-i18n.ts`: host-provided plugin i18n helper. Client plugins should read language, localized text selection, contribution title/description resolution, and language-change subscription from `ctx.i18n` instead of guessing browser or URL locale themselves.
- `plugin-registry.ts`: scoped in-memory registry for commands, slots, routes, views, plugin-to-plugin extension points, launcher providers, diagnostics, and cleanup.
- `plugin-runtime.ts`: activation context, host React singleton exposure, host notification queue bridge, dynamic client entry import, scoped API helper, and hot reload plumbing.
- `PluginProvider.tsx`: React provider that fetches `/api/plugins`, activates client entries, and exposes registry snapshots.
- `PluginProvider.tsx` also owns the plugin watch websocket subscription. `plugin.changed` events should refresh plugin instances and re-import the changed plugin without reloading the whole app.
- `PluginHost.tsx`: route and view mounting helpers for plugin-rendered UI.
- `plugin-host-components.tsx`: host-rendered shared components, common controls, overlay dropdowns, and overlay primitives that DOM plugin views can mount through `view.components.render(...)`.
- `plugin-slots.tsx`: hooks for built-in UI surfaces to read plugin slot contributions. Slot consumers receive localized `title` / `description` values resolved from contribution `titleI18n` / `descriptionI18n`.
- Session sidebar grouping is a host slot: plugins contribute `sessionGroups` / `sessions.groups` with declarative match rules and optional header actions; sidebar rendering and action styling stay host-owned.

`PluginViewHost` owns the per-render `PluginViewContext`: it passes current language, i18n text resolution, theme mode, resolved theme, dark-mode state, surface (`route` / `workbench` / `drawer`), plugin-to-plugin `extensions` lookup helpers, scoped `options.value` / `options.update(...)`, imperative `components.render(...)`, and declarative `ui.*` React host components to each plugin view. Add new view-scoped host capabilities here rather than through the activation-only `PluginClientContext`.

Plugin-to-plugin extension points are not built-in host slots. The owning plugin registers `extensionPoints` in manifest or `ctx.extensionPoints.register(...)`; other plugins use `ctx.extensionPoints.onAvailable('<scope>/<point>', point => ctx.extensionPoints.contribute(...))` so contribution setup is triggered when the target point exists, regardless of activation order. The owning view reads contributions with `view.extensions.getContributions(...)` and owns rendering semantics. Use `ctx.extensionPoints.has(...)` only for read-only checks, not for one-shot contribution setup.

Plugin-to-plugin pure APIs live in the client registry via `ctx.pluginApis.register({ id, inputSchema, outputSchema, handler })` and `ctx.pluginApis.call('<scope>/<id>', input)`. Calls must stay promise-based: the promise waits for the target API to be registered and then waits for the handler result. Use this for in-client process calls between plugins instead of routing through commands or server scoped APIs when no HTTP boundary is needed.

Plugin contribution labels and plugin-owned view text must use the plugin i18n helpers. Manifest / slot contribution text is resolved through `plugin-i18n.ts`, including `zh` / `zh-CN` / `zh-Hans` fallback. React plugin views should use `view.i18n.resolveText(...)`; activation-time commands, notification text, and launcher providers should use `ctx.i18n.resolveText(...)` or `ctx.i18n.getLanguage()`. Plugin UI should publish prompts through `ctx.notifications.show(...)` so the host owns source labels, markdown rendering, action callbacks, close controls, and plugin-level muting; do not reintroduce plugin-local fixed toasts.

Common UI controls exposed through `view.ui.*` and `view.components.render(...)` should wrap host-owned components such as icons, Ant Design controls, overlay dropdown triggers, and `components/overlay` primitives. Prefer `view.ui.*` for React plugin views; keep `view.components.render(...)` as the compatibility path for DOM plugins. Do not ask plugin views to import and restyle icons, AntD, menus, trees, search rows, or overlay panels themselves when a small structured host control can preserve the app design language. Prefer `OverlayDropdown` / `overlayDropdown` for real popup behavior; use primitive overlay components only when the host surface already owns popup placement.

Public naming in this module is always `plugin`.
