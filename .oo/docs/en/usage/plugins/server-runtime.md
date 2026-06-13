# Server Entries, Plugin Store, and Debugging

UI plugins can also provide server-side behavior. Server entries are loaded from the active plugin graph and can expose commands, scoped APIs, and runtime integration points.

## Server Entry

A plugin server entry runs inside the One Works server runtime. It should keep a clear boundary:

- plugin code owns plugin-specific behavior
- server routes stay in the host application
- shared contracts should live in package APIs or manifest metadata
- project data should be accessed through the host-provided scoped APIs

Server entries should not assume a global singleton project. A desktop process can host multiple project services, and the same plugin package can be instantiated with different scopes or options.

## Scoped API

Scoped APIs let frontend plugin views call plugin-owned server behavior without exposing every server internal. The scope ties calls to the active plugin instance and prevents collisions between multiple plugin instances.

Use scoped APIs for:

- plugin commands
- plugin-specific data reads and writes
- integration with plugin assets
- status or diagnostics for plugin runtime behavior

## Plugin Store and Discovery

The host can inspect installed plugin manifests and active plugin instances. This powers plugin details, configuration forms, enabled child plugins, and debugging views.

Manifest metadata should describe:

- plugin name and package
- loadable assets
- UI contributions
- server entry points
- config schema
- child plugin defaults

## Development Watch

`watch: true` enables file watching for a plugin directory and refreshes relevant plugin runtimes through the plugin watch channel. Plugins auto-discovered from `.oo/plugins.dev` enable watch by default.

Use watch mode for local plugin development. For published plugins, rely on package versions and normal dependency updates.

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
