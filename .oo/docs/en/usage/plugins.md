# Plugins, UI Extensions, and Data Assets

## Two Plugin Systems

One Works currently has two plugin paths:

- Unified One Works plugins: load `rules / skills / specs / entities / mcp / hooks` from npm packages through the top-level `plugins` config, and optionally provide UI entries, frontend views, server commands, and scoped APIs.
- Adapter-native plugins: install a native adapter plugin format with `oneworks plugin --adapter <adapter> add ...`, then convert reusable capabilities into One Works project assets.

For Claude Code plugins and marketplaces, see [Adapter Native Plugins and Marketplaces](./native-plugins.md).

## Installation

- Built-in One Works plugins resolve from the global package cache at the version declared by the runtime. Missing packages are installed into that cache.
- Other plugins are installed into your project workspace through npm or referenced by directory path. Resolution failure is an error.
- `id` supports shorthand. For example, `logger` first resolves as `logger`, then as `@oneworks/plugin-logger`; legacy `@vibe-forge/plugin-logger` remains a compatibility fallback.

The global package cache defaults to `~/.oneworks/bootstrap/npm`. Override it with `__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__`.

For automatic built-in plugin installs, registry and auth settings follow standard npm config: user `~/.npmrc`, project
`.npmrc`, then environment variables, with later sources taking precedence. One Works supports standard entries such as
`registry=...`, `@oneworks:registry=...`, and `//registry.example.com/:_authToken=...`. If no registry is explicitly
configured, One Works probes the default npm registry first; on network errors, timeouts, or 5xx responses, it falls back
to `https://registry.npmmirror.com`. When you configure a company registry or any other explicit registry, One Works does
not switch to a public mirror unless you also set `ONEWORKS_NPM_REGISTRY_FALLBACKS` with a comma-separated fallback list.

Project `.npmrc` example:

```ini
@oneworks:registry=https://registry.npmmirror.com
//registry.npmmirror.com/:_authToken=${NPM_TOKEN}
```

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

## Config Hook

Plugins can also provide a config hook. After One Works reads global/project/user config, the hook can return a temporary config patch. That patch is merged into the final user layer, so runtime code, Web UI, and adapters see the resulting `modelServices`, default model, MCP, permissions, and other effective config.

Good fits for this hook include:

- Relay services assigning `modelServices` by user, team, or project allowlist
- A plugin using `plugins[].options` to decide which fields may be merged
- A plugin reading config that a service has already synced to a local directory before startup

These rules should not be edited in the ordinary settings page. User-facing rules, project allow/deny lists, merge-field allowlists, and local-change sync should live in that plugin's own plugin page or service protocol. The ordinary config page should only show the final merged config.

A package can expose `./config` through package exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./config": "./dist/config.js"
  }
}
```

It can also declare a relative entry in the manifest. The manifest `config` field is still reserved for plugin instance configuration UI schema; config hooks use the separate `configHook` field:

```js
module.exports = {
  __oneWorksPluginManifest: true,
  configHook: { entry: './dist/config.js' }
}
```

The `./config` entry exports a function that returns the patch to merge:

```js
module.exports = async (ctx) => {
  const service = ctx.plugin.options.serviceKey || 'relay'
  return {
    defaultModelService: service,
    modelServices: {
      [service]: {
        apiBaseUrl: ctx.jsonVariables.RELAY_BASE_URL,
        apiKey: ctx.jsonVariables.RELAY_API_KEY,
        models: ['gpt-relay']
      }
    }
  }
}
```

`ctx` includes `cwd`, `env`, `jsonVariables`, `projectConfig`, `userConfig`, `mergedConfig`, and the current plugin instance metadata. Prefer reading locally synced data; if a hook needs network access, the plugin should provide its own cache and failure fallback.

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
