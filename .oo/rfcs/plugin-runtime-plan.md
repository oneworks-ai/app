# Plugin Runtime RFC: HMR And Rollout

返回入口：[Plugin Runtime RFC](../../rfc.md)

## HMR

For `.oo/plugins.dev`, manifest `plugin.client.devServer` can point at Vite or another dev server.

Server returns both production and dev URLs, both same-origin:

```ts
const response = {
  clientEntryUrl: '/api/plugins/my/client/index.js',
  devClientEntryUrl: '/api/plugins/my/dev/src/index.ts'
}
```

Client chooses dev URL in development mode when available.

HMR rules:

- The plugin host disposes only that plugin's registered commands, slots, views, and routes.
- It re-imports the plugin client entry with a version query.
- Built-in app state is not reset.
- Specific plugins can enable runtime `watch` mode; file changes under that plugin root trigger a server runtime reload and a `plugin.changed` event for scoped frontend re-import.
- Dev plugin websocket traffic is proxied through the same server scope when supported. Otherwise the host uses scoped dispose/re-import reload.

If the plugin dev server is unavailable, the host keeps the last loaded production entry and shows a non-fatal warning in the plugin diagnostics panel.

## Security And Stability

- Plugin API proxy only accepts loopback targets unless explicitly configured later.
- The server owns all plugin local service processes and kills them on workspace service shutdown.
- All plugin routes stay under `/api/plugins/:scope`.
- Plugin client code is same-origin JavaScript and therefore trusted at project level. This matches local project plugin expectations and should be documented clearly.
- Plugin commands get structured payloads and return JSON-compatible results.
- Plugin registry validates duplicate IDs before activation.
- Failed plugin activation disables only that plugin and reports diagnostics through `GET /api/plugins`.

## Development Plan

### Phase 1: RFC And Contracts

- Add this RFC.
- Add shared plugin manifest/runtime types.
- Extend config schema only where needed for plugin manifest fields.
- Add resolver support for directory manifests and plugin auto-discovery roots.
- Add `.oo/plugins.dev/` to `.gitignore`.
- Add `PluginChildConfig.version` to the config schema to match existing types and docs.

### Phase 2: Server Plugin Runtime

- Add `services/plugins`.
- Add `/api/plugins`.
- Load plugin manifests and expose contribution list.
- Add command invocation and scoped API proxy.
- Add lifecycle disposal.

### Phase 3: Client Plugin Host

- Add `src/plugins`.
- Fetch plugin list.
- Activate client entries.
- Add route and view mounting.
- Add command execution and plugin API helper.

### Phase 4: Initial Contribution Points

- Nav items and more menu.
- Chat header action and more menu.
- Bottom workbench plugin tabs.
- Workbench `+` add menu items.
- Right workspace drawer plugin tabs.
- Launcher search provider.
- Desktop launcher bridge for workspace plugin search.

### Phase 5: Dev Plugin HMR

- Support `.oo/plugins.dev`.
- Add dev entry URL loading.
- Add scoped dispose/reload.
- Add `/plugins` plugin store entry with per-plugin watch toggles.
- Add server watch mode and websocket `plugin.changed` events for selected plugin scopes.
- Verify Vite dev plugin workflow without full page refresh.

## Agent Work Split

After RFC review passes:

- Worker A owns shared contracts and resolver code:
  - `packages/types/src/plugin.ts`
  - `packages/core/src/config-schema.ts`
  - `packages/utils/src/plugin-resolver.ts`
  - resolver tests
- Worker B owns server plugin runtime:
  - `apps/server/src/services/plugins/*`
  - `apps/server/src/routes/plugins.ts`
  - route mount and server tests
- Worker C owns client plugin host and UI slots:
  - `apps/client/src/plugins/*`
  - nav/chat/workbench/drawer/launcher integration
  - client tests
- Verifier owns validation:
  - focused unit tests
  - typecheck for touched packages
  - Electron smoke with current dev app

Workers must not revert unrelated edits. Each worker should keep its write set disjoint and report changed paths.

## Acceptance Criteria

- `GET /api/plugins` returns configured, project, dev, and global plugins with stable scope and diagnostics.
- Duplicate scopes fail with a clear error.
- A fixture plugin can add:
  - a nav item
  - a chat header button
  - a bottom workbench tab
  - a workbench `+` menu entry
  - a right drawer tab
  - a launcher search result
- The same launcher result works in a workspace client launcher route and through the desktop launcher bridge when opened from an active workspace.
- The same fixture can register a server command and invoke it through `/api/plugins/:scope/commands/:commandId`.
- Plugin server API proxy cannot escape its scope.
- Plugin client asset route serves same-origin modules and rejects path traversal.
- Dev plugin route stays same-origin under CSP and supports HMR or scoped reload without full app refresh.
- `/plugins` opens the plugin store and can toggle watch mode for a specific plugin.
- `/plugins/:scope` opens a plugin detail page without conflicting with `/plugins/:scope/:routeId`.
- A watched plugin file change reloads plugin contributions without refreshing the whole app.
- Duplicate command IDs, route IDs, view IDs, launcher provider IDs, and slot contribution IDs fail within a plugin scope with a clear diagnostic.
- `.oo/plugins` is not a managed install root and is not auto-loaded as a runtime install root.
- `.oo/plugins.dev` plugin client code can reload its contribution without full app refresh.
- Existing `plugins` config, hook plugins, skills, rules, MCP, and native plugin behavior keep working.

## Verification Commands

Focused:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts --project node packages/utils/__tests__/plugin-resolver.spec.ts
pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/server/__tests__/plugins.spec.ts
pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/plugin-host.spec.tsx
```

Broader:

```bash
pnpm typecheck
pnpm exec dprint check
pnpm exec eslint .
```

Electron:

```bash
pnpm -C apps/desktop run build:electron
ONEWORKS_DESKTOP_WORKSPACE="$PWD" pnpm -C apps/desktop exec electron . --user-data-dir="$PWD/.oo/.local/desktop-user-data-plugin-dev"
```
