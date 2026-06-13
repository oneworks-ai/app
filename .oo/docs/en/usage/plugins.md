# Plugins, UI Extensions, and Data Assets

## Two Plugin Systems

One Works currently has two plugin paths:

- Unified One Works plugins: load `rules / skills / specs / entities / mcp / hooks` from npm packages through the top-level `plugins` config, and optionally provide UI entries, frontend views, server commands, and scoped APIs.
- Adapter-native plugins: install a native adapter plugin format with `oneworks plugin --adapter <adapter> add ...`, then convert reusable capabilities into One Works project assets.

For Claude Code plugins and marketplaces, see [Adapter Native Plugins and Marketplaces](./native-plugins.md).

## Installation

- Built-in One Works plugins resolve from the global package cache at the version declared by the runtime. Missing packages are installed into that cache.
- Other plugins are installed into your project workspace through npm or referenced by directory path. Resolution failure is an error.
- `id` supports shorthand. For example, `logger` first resolves as `logger`, then as `@oneworks/plugin-logger`.

The global package cache defaults to `~/.oneworks/bootstrap/npm`. Override it with `__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__`.

```bash
pnpm add -D @oneworks/plugin-standard-dev @oneworks/plugin-logger
```

## Basic Configuration

Configure plugins in `.oo.config.json` or `.oo.config.yaml` at the resolved workspace root:

```json
{
  "plugins": [
    {
      "id": "standard-dev",
      "scope": "std"
    },
    {
      "id": "logger",
      "enabled": false
    }
  ]
}
```

Fields:

- `id`: plugin package name or shorthand
- `version`: optional version for built-in One Works plugins in the global package cache; defaults to `latest`
- `scope`: optional namespace for resources from this plugin instance
- `enabled`: optional, defaults to `true`
- `watch`: optional; watches the plugin directory and refreshes plugin runtimes through the plugin watch channel
- `options`: per-instance plugin config values
- `children`: explicit child plugin enablement or overrides

## Plugin Instance Configuration

Plugin authors can describe configuration UI with the manifest `config` field. Users save concrete values in `plugins[].options`.

```json
{
  "__oneworksPluginManifest": true,
  "name": "@acme/plugin-workspace-tools",
  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "greeting": {
          "type": "string",
          "default": "Hello",
          "titleI18n": {
            "en": "Greeting",
            "zh-Hans": "Greeting"
          },
          "descriptionI18n": {
            "en": "Text shown by plugin commands.",
            "zh-Hans": "Text shown by plugin commands."
          },
          "x-oneworks-ui": {
            "icon": "waving_hand",
            "placeholder": "Hello"
          }
        },
        "mode": {
          "type": "string",
          "default": "auto",
          "oneOf": [
            { "const": "auto", "titleI18n": { "en": "Auto" } },
            { "const": "manual", "titleI18n": { "en": "Manual" } }
          ]
        }
      }
    }
  }
}
```

The plugin detail page `/ui/plugins/<scope>?tab=config` renders `config.schema` or `config.jsonSchema` as the same interactive form system used by the main config pages. Save writes back to the same plugin instance:

```json
{
  "plugins": [
    {
      "id": "@acme/plugin-workspace-tools",
      "scope": "tools",
      "options": {
        "greeting": "Hello",
        "mode": "auto"
      }
    }
  ]
}
```

Supported form fields include strings, numbers, integers, booleans, string arrays, enums, string `const` options in `oneOf` / `anyOf`, and JSON fallback fields. Sensitive fields use `format: "password"`, `writeOnly: true`, or `x-oneworks-ui.sensitive: true`. For full UI control, a manifest can provide `config.uiSchema`.

## Scope and Resource References

- Scope is controlled by the user, not the plugin author.
- With `scope`, resource IDs become `scope/name`, for example `std/standard-dev-flow`.
- Without `scope`, plain `name` works only when that resource is globally unique.
- If local project assets and plugin assets share a name, add a plugin scope to avoid ambiguity.

## Child Plugins

Plugins can declare child plugins, and users can override them:

```json
{
  "plugins": [
    {
      "id": "bundle",
      "scope": "corp",
      "children": [
        { "id": "review", "enabled": false },
        { "id": "logger", "scope": "corp-logger" }
      ]
    }
  ]
}
```

Child plugins can come from the parent manifest or from installed dependencies. Without an explicit scope, a child inherits the parent instance scope. `children[].enabled: false` disables a default child plugin.

## Loadable Assets

Unified plugins can contribute:

- `rules`
- `skills`
- `specs`
- `entities`
- `mcp`
- `hooks`

`spec` and `entity` frontmatter can use `plugins: { mode, list }` to `extend` or `override` the plugin list for the current task.

## UI Plugin Runtime

UI plugins use the same `plugins` config and manifest. They can provide data assets, UI contributions, server commands, and scoped APIs:

- [UI Runtime and Frontend Entries](./plugins/ui-runtime.md)
- [Server Entries, Plugin Store, and Debugging](./plugins/server-runtime.md)
- [Asset Directories and Adapter Compatibility](./plugins/assets-and-adapters.md)
