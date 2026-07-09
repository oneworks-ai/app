# Server Entries, Plugin Store, and Debugging

UI plugins can also provide server-side behavior. Server entries are loaded from the active plugin graph and can expose commands, scoped APIs, launcher providers, and runtime channels.

## Server Entry

A plugin server entry runs inside one or more One Works server runtimes:

- `manager`: the local management server. Use it only for device-level, launcher-level, account-level, or cross-workspace coordination.
- `workspace`: a concrete workspace server. A single management server can supervise multiple workspace servers, and each workspace keeps an isolated plugin registry.

Prefer package exports for entry discovery:

```json
{
  "type": "module",
  "exports": {
    "./server": {
      "source": "./server/src/index.ts",
      "default": "./server/dist/index.js"
    }
  }
}
```

Every plugin with a server entry must explicitly declare the runtime roles in its manifest. `exports["./server"]` only supplies an entry path; it does not choose `manager` or `workspace` for the plugin. If `plugin.server.roles` is missing, the host rejects the server entry and reports a plugin diagnostic.

```json
{
  "plugin": {
    "server": {
      "roles": ["workspace"]
    }
  }
}
```

Use `["manager"]` or `["manager", "workspace"]` only when the plugin truly owns management-plane behavior. Normal project files, scoped APIs, workspace UI, and local services belong in `workspace`.

Server entries should keep a clear boundary:

- plugin code owns plugin-specific behavior
- server routes stay in the host application
- shared contracts should live in package APIs or manifest metadata
- project data should be accessed through the host-provided scoped APIs

Server entries should not assume a global singleton project. The same plugin package can be instantiated with different scopes or options, and one machine may run several workspace servers under the same management server.

## Scoped API

Scoped APIs let frontend plugin views call plugin-owned server behavior without exposing every server internal. The scope ties calls to the active plugin instance and prevents collisions between multiple plugin instances.

Use scoped APIs for:

- plugin commands
- plugin-specific data reads and writes
- integration with plugin assets
- status or diagnostics for plugin runtime behavior

Use runtime channels when the same plugin scope needs structured communication between `manager` and `workspace` runtimes. Register channels with `ctx.runtime.registerChannel(channelId, handler)` and invoke them with `ctx.runtime.invokeChannel(channelId, { payload, target })`. The management server exposes `/api/plugins/runtime/endpoints` with the current manager endpoint and known launcher workspace endpoints; manager-to-workspace calls may target a known workspace by `workspaceId`. Cross-workspace calls and workspace-to-remote calls should still include a concrete `serverBaseUrl`, such as `{ role: "manager", serverBaseUrl }`, so a multi-workspace setup cannot accidentally send work to the wrong server.

## Plugin Store and Discovery

The host can inspect installed plugin manifests and active plugin instances. This powers plugin details, configuration forms, enabled child plugins, and debugging views.

Manifest metadata should describe:

- plugin name and package
- loadable assets
- UI contributions
- server entry points
- config schema
- child plugin defaults

New plugins should rely on `package.json` exports for `./client` and `./server` entry paths instead of public manifest fields such as `plugin.client.root`, `plugin.client.entry`, or `plugin.server.entry`.

## Development Watch

`watch: true` enables file watching for a plugin directory and refreshes relevant plugin runtimes through the plugin watch channel. Plugins auto-discovered from `.oo/plugins.dev` enable watch by default.

Use watch mode for local plugin development. Local plugin sources use the host Vite dev server for `exports["./client"].source`, so HMR, TypeScript / TSX transforms, source maps, and React Fast Refresh are host-provided. Do not configure `plugin.client.devServer` for new plugins. For published plugins, rely on package versions and normal dependency updates.

## Debugging

When a plugin does not appear:

1. Confirm the package or directory can be resolved from the current workspace.
2. Confirm the plugin manifest is valid.
3. Check `enabled`, `scope`, and `children` in the project config.
4. Check server logs for plugin loading errors.
5. For UI plugins, confirm frontend contribution names and routes match the manifest.

When a plugin API call fails:

1. Confirm the active plugin instance scope.
2. Confirm the server entry loaded successfully.
3. Check whether the call is using the correct project service and not another worktree or desktop window.
4. Inspect server logs for scoped API errors.
