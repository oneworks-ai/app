# Plugin Runtime RFC: Layout And Manifest

返回入口：[Plugin Runtime RFC](../../rfc.md)

## Goal

Add first-class One Works plugins that can change the UI and register local runtime capabilities through the existing server. The public name is `plugin` everywhere: config fields, HTTP APIs, shared contracts, frontend host, server services, route names, and documentation.

This builds on the current `plugins` config and package resolver instead of introducing a separate runtime family.

## Non-Goals

- Do not rename the existing data-asset plugin model.
- Do not let plugins register arbitrary top-level `/api/*` routes.
- Do not let frontend plugins access the file system directly.
- Do not require users to refresh the whole app during local plugin development.
- Do not make Electron main process host plugin business logic.

## User-Facing Layout

Plugins can come from package/config declarations and two local discovery roots:

- Global plugins: `~/.oneworks/global/plugins/*`
- Project dev plugins: `.oo/plugins.dev/*`
- Explicit package or directory entries in `plugins` config

The existing config still works and remains the authoritative user-editable source:

```json
{
  "plugins": [
    { "id": "standard-dev", "scope": "std" },
    { "id": "./packages/plugins/my-plugin", "scope": "my", "watch": true }
  ]
}
```

Auto-discovered plugin directories are a derived runtime layer, not a new config source. They are never written back to config files or config API responses as declared config.
`.oo/plugins.dev/*` auto-discovered plugins default to `watch: true` so local plugin development gets scoped reloads without restarting Electron.

Runtime resolution order is:

1. Global auto-discovered plugins: `~/.oneworks/global/plugins/*`
2. Project dev auto-discovered plugins: `.oo/plugins.dev/*`
3. Existing `plugins` config
4. Runtime or task overlay plugins

Later layers override earlier layers by resolved plugin root or package id, even when the explicit config changes `scope`. This lets users disable or customize an auto-discovered plugin without creating a duplicate scoped instance.

Adapter-native managed plugin installs live in project home under `.local/plugins/<adapter>/<slug>/install`, outside the workspace asset tree. Runtime discovery does not load managed installs as a separate layer. If a converted `oneworks/` directory should act as a One Works runtime plugin, it must be declared explicitly in `plugins`.

`.oo/plugins` is only a suggested place for ordinary local plugin directories in projects that do not have a better package/plugin folder. Discovery must not treat ordinary children of `.oo/plugins` as UI plugin roots. It must:

- leave adapter-native installs to adapter staging code that reads project-home managed metadata;
- load any ordinary directory there only when it is explicitly declared in `plugins`;
- leave development auto-discovery to `.oo/plugins.dev`.

Project dev roots resolve through `resolveProjectAiPath(cwd, env, 'plugins.dev')`. `.oo/plugins.dev/` is local-only and should be ignored by git. Global roots resolve through the same config home resolution used by config loading, with the `global/plugins` child directory. Global plugin discovery follows the same global-config disable semantics as config loading: if `disableGlobalConfig` or `__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__=1` disables global project defaults, global plugin auto-discovery is skipped, while explicitly configured absolute plugin paths still work.

If two enabled plugin instances resolve to the same `scope`, startup fails with a clear conflict error. If a plugin has no explicit scope, the runtime derives one from its package name or directory name. A derived scope still participates in conflict checks.

## Manifest

Plugins expose a root manifest through the existing package root export, or a `plugin.json` / `plugin.yaml` file in directory plugins.

```ts
export interface PluginManifest {
  __oneWorksPluginManifest?: true
  assets?: PluginManifestAssets
  children?: Record<string, PluginManifestChildDefinition>
  plugin?: {
    client?: PluginClientManifest
    server?: PluginServerManifest
    contributions?: PluginContributionManifest
  }
}
```

Directory plugin fallback:

```text
my-plugin/
  plugin.json
  client/index.js
  server/index.js
  rules/
  skills/
  mcp/
```

Example:

```json
{
  "name": "workspace-tools",
  "displayName": "Workspace Tools",
  "plugin": {
    "client": {
      "entry": "./client/index.js",
      "devServer": "http://127.0.0.1:5178"
    },
    "server": {
      "entry": "./server/index.js"
    },
    "contributions": {
      "navItems": [
        {
          "id": "dashboard",
          "title": "Dashboard",
          "icon": "dashboard",
          "route": "/plugins/workspace-tools/dashboard"
        }
      ],
      "chatHeaderActions": [
        {
          "id": "snapshot",
          "title": "Snapshot",
          "icon": "camera_alt",
          "command": "workspace-tools.snapshot"
        }
      ],
      "workbenchTabs": [
        {
          "id": "debug-web",
          "title": "Debug Web",
          "icon": "language",
          "placement": "bottom",
          "clientView": "debug-web"
        }
      ],
      "workbenchAddMenu": [
        {
          "id": "debug-web",
          "title": "Debug Web",
          "icon": "language",
          "tab": "debug-web"
        }
      ],
      "workspaceDrawerTabs": [
        {
          "id": "context",
          "title": "Context",
          "icon": "account_tree",
          "placement": "right",
          "clientView": "context"
        }
      ],
      "launcherSearchProviders": [
        {
          "id": "docs",
          "title": "Docs",
          "command": "workspace-tools.searchDocs"
        }
      ]
    }
  }
}
```

## Shared Contract

Add shared types in `packages/types/src/plugin.ts`:

- `PluginRuntimeInstance`
- `PluginClientManifest`
- `PluginServerManifest`
- `PluginContributionManifest`
- `PluginContributionNavItem`
- `PluginContributionMenuItem`
- `PluginContributionChatHeaderAction`
- `PluginContributionWorkbenchTab`
- `PluginContributionWorkspaceDrawerTab`
- `PluginContributionLauncherSearchProvider`
- `PluginRuntimeApiRegistration`
- `PluginRuntimeCommandInvocation`

The existing `PluginManifest` type owns these fields. Do not add a parallel manifest type with another public name.

`workbenchTabs` describe tab templates that can be created by the host. They are not opened automatically. A
`workbenchAddMenu` item can create a tab by setting `tab` to a `workbenchTabs[].id`; if `tab` is omitted and the menu item
has no `command`, `route`, or `href`, the host may use the menu item `id` as the tab id.
