# Plugin Runtime RFC: Client And UI

返回入口：[Plugin Runtime RFC](../../rfc.md)

## Client Architecture

New frontend directory:

```text
apps/client/src/plugins/
  AGENTS.md
  api.ts
  PluginHost.tsx
  PluginProvider.tsx
  plugin-manifest.ts
  plugin-registry.ts
  plugin-runtime.ts
  plugin-slots.tsx
```

The client loads `GET /api/plugins`, then dynamically imports each `client.entry`.

Plugin client entry exports:

```ts
export async function activatePlugin(
  ctx: PluginClientContext
): Promise<void | PluginDisposable>
```

Context:

- `scope`
- `manifest`
- `commands.register(commandId, handler)`
- `commands.execute(commandId, payload)`
- `api.fetch(path, init)`
- `slots.register(slot, contribution)`
- `routes.register(route)`
- `views.register(viewId, renderer)`
- `launcher.registerSearchProvider(provider)`
- `hot.accept(callback)` for dev plugins

The frontend module is named `plugins`; no other public module name is introduced.

The plugin store route lives at `/plugins`. It lists resolved plugin instances, diagnostics, and runtime watch switches. It is a UI entry point for installed/local plugins, not a second config source.

The plugin detail route lives at `/plugins/:scope`. It shows one plugin instance's source metadata, client/server entries, watch switch, declared contribution manifest, runtime registered slots/routes/views/search providers, and scoped diagnostics. Plugin-owned pages continue to live under `/plugins/:scope/:routeId`.

## UI Contribution Points

### Nav Items

Slot:

```text
nav.items
```

Target files:

- `apps/client/src/components/nav-rail-items.tsx`
- `apps/client/src/components/NavRail.tsx`
- `apps/client/src/routes/AppRoutes.tsx`

Plugin routes live under:

```text
/plugins/:scope/:routeId
```

### Nav More Menu

Slot:

```text
nav.moreMenu
```

Plugins can add menu items with commands, external links, or internal plugin routes.

### Chat Header Actions

Slots:

```text
chat.header.actions
chat.header.moreMenu
```

Target file:

- `apps/client/src/components/chat/ChatHeader.tsx`

Actions receive current session metadata and can invoke plugin commands.

### Workbench Tabs

Slot:

```text
workbench.tabs
workbench.addMenu
```

This extends the existing bottom dock. It should support `placement: "bottom" | "right"` so the right workspace drawer and bottom interaction panel can converge on a single workbench tab model.

`workbench.addMenu` contributes commands, links, or plugin routes to the `+` menu in the interaction panel header.

Target files:

- `apps/client/src/components/chat/interaction-panel/use-interaction-panel-tabs.ts`
- `apps/client/src/components/chat/interaction-panel/InteractionPanelDockPanelContent.tsx`
- `apps/client/src/components/chat/workspace-drawer/ChatWorkspaceDrawer.tsx`
- `apps/client/src/components/chat/workspace-drawer/ChatWorkspaceDrawerToolbar.tsx`

Implementation strategy:

1. Add plugin tabs to bottom dock first.
2. Add plugin tabs to right drawer using the same tab descriptor.
3. Then refactor built-in right drawer tabs into the shared descriptor.

### Launcher Search

Slot:

```text
launcher.searchProviders
```

Target route:

- `apps/client/src/routes/LauncherRoute.tsx`

There are two launcher contexts:

- Workspace client launcher context: the launcher route is running inside the normal workspace client origin, so `/api/plugins` is available and workspace plugins can register search providers directly.
- Desktop launcher window context: the launcher runs from the desktop launcher client service, not from the workspace server origin. It cannot call `/api/plugins` same-origin directly.
- Empty launcher context: no workspace server exists yet, so workspace plugins are not loaded. Only future desktop-global plugins may participate here, and that is outside the first implementation.

For the first implementation, launcher plugin search providers are workspace-only. They appear when the launcher is loaded in the workspace client route or when the Electron launcher window is opened from an active workspace service.

Electron exposes a narrow desktop bridge for the standalone launcher window:

```ts
window.oneWorksDesktop.plugins.searchCurrentWorkspace(query)
window.oneWorksDesktop.plugins.invokeCurrentWorkspaceResult(resultId)
```

The desktop main process resolves the launcher window's source workspace through the existing `workspaceFolder`, `launcherSourceUrl`, or source window metadata, then forwards to that workspace service:

```text
POST /api/plugins/launcher/search
POST /api/plugins/launcher/results/:resultId/invoke
```

The bridge only works when a workspace service is known and running. If the launcher is opened without a workspace, plugin search providers are omitted.

Standalone launcher search is server-backed in the first implementation. Plugin search providers declared in the manifest call registered plugin server commands; arbitrary plugin client modules are not loaded into the desktop launcher window. Client-only launcher search providers can still run in the workspace client launcher route.

Providers return scored actions:

- `id`
- `title`
- `description`
- `icon`
- `keywords`
- `perform()`

Search providers can be local-only client code in the workspace client route or server-backed through `/api/plugins/:scope/*`. Manifest-declared providers used by the desktop launcher bridge must be server-backed commands.

### Additional Plugin Freedom

Reserve slots for:

- `commandPalette.items`
- `settings.sections`
- `message.actions`
- `message.renderers`
- `tool.renderers`
- `workspace.fileActions`
- `workspace.resourceOpeners`
- `theme.tokens`
- `statusBar.items`

These do not need all UI surfaces in the first patch, but the registry should allow adding them without changing the core activation model.
