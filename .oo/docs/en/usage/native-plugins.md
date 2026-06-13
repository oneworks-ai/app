# Adapter Native Plugins and Marketplaces

This page covers native adapter plugin formats, not the unified One Works plugins configured in top-level `plugins`.

## Use Cases

The complete installer currently supports Claude:

- install Claude Code native plugins into the current project's private project home
- resolve `plugin@marketplace` from configured marketplaces
- make reusable Claude plugin capabilities available to the current project

Copilot does not provide a One Works installer. It can still receive local Copilot CLI plugin directories through `adapters.copilot.pluginDirs`, which are passed to the official `--plugin-dir`.

For unified One Works plugins, see [Plugins and Data Assets](./plugins.md).

## Install Command

```bash
oneworks plugin --adapter claude add <source>
```

Supported source forms:

- local path: `./plugins/my-claude-plugin`
- GitHub shorthand: `obra/superpowers`
- explicit GitHub: `github:obra/superpowers`
- Git URL: `https://github.com/obra/superpowers.git#main`
- npm: `npm:@scope/pkg`, `npm:pkg@1.2.3`
- marketplace reference: `plugin-name@marketplace-name`

Notes:

- `plugin@marketplace` resolves as a marketplace reference first.
- If you intended an npm package and the spec contains `@`, write `npm:...` explicitly, such as `npm:superpowers@latest` or `npm:@acme/claude-plugin@1.2.3`.

## Marketplace Configuration

`marketplaces` here is only for adapter-native plugin marketplaces. Skill registries use a different configuration path.

Custom marketplaces can be configured in workspace `.oo.config.*`, `.oo.dev.config.*`, or global `~/.oneworks/.oo.config.json`. If `__ONEWORKS_PROJECT_CONFIG_DIR__` is set, marketplace config is read from that directory.

Claude marketplace entry:

```yaml
marketplaces:
  <marketplace-name>:
    type: claude-code
    enabled: true
    syncOnRun: true | false
    plugins:
      <plugin-name>:
        enabled: true | false
        scope: optional-scope
    options:
      source: ...
```

`options.source` supports `github`, `git`, `directory`, `url`, and `settings`.

When a marketplace plugin is declared:

- The first `oneworks` for a new session installs it into `.local/plugins/<adapter>/<slug>/install` under the project home.
- `syncOnRun: true` syncs before every new session.
- `syncOnRun: false` or omitted installs only when missing.
- Plugin runtime data is stored under `.local/plugins/<adapter>/<slug>/data`.

## Superpowers Marketplace Example

```yaml
marketplaces:
  superpowers-marketplace:
    type: claude-code
    enabled: true
    syncOnRun: true
    plugins:
      superpowers:
        scope: superpowers
      superpowers-chrome:
        enabled: false
    options:
      source:
        source: github
        repo: obra/superpowers-marketplace
        ref: main
```

Install:

```bash
oneworks plugin --adapter claude add superpowers@superpowers-marketplace
oneworks plugin --adapter claude add superpowers-developing-for-claude-code@superpowers-marketplace
oneworks plugin --adapter claude add private-journal-mcp@superpowers-marketplace
oneworks plugin --adapter claude add superpowers-chrome@superpowers-marketplace
```

The plugin name must exist in the marketplace `marketplace.json`. If the plugins are already declared under `marketplaces.<name>.plugins`, running `oneworks` can install or sync them automatically.

For a small locked catalog, use `options.source.source: settings` and list only the plugins you need. See [Marketplace Examples](./native-plugins/marketplaces.md).

## User-visible Behavior

After `oneworks plugin --adapter claude add ...`:

1. The Claude plugin is installed into the project home for the current project.
2. One Works bridges differences between the Claude native plugin format and the adapter runtime.

Effects:

- The Claude adapter stages and enables the native plugin automatically.
- Converted `oneworks/` assets do not automatically enter the One Works runtime; declare that directory in `plugins` if runtime plugin behavior is needed.
- `${CLAUDE_PLUGIN_DATA}` points to private project-home data, not to the repository.
- Converted assets keep `${CLAUDE_PLUGIN_*}` placeholders and resolve them at runtime.
- `.oo/plugins` is only for explicitly declared ordinary local plugins. It is not a managed adapter-native install directory.
- Plugins declared in `marketplaces.<name>.plugins` are installed or synced at `oneworks` startup.

## Current Limits

- Native plugin installer is implemented only for `--adapter claude`.
- Copilot supports only runtime `pluginDirs`.
- Marketplace plugin sources must resolve to a standard Claude plugin root.
- Claude plugins declaring `userConfig` are rejected for now.
- Marketplace names must be configured before `foo@bar` can resolve.
- Claude marketplace `hostPattern` sources are not directly fetched by the installer yet.

## Related Docs

- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Superpowers](https://github.com/obra/superpowers)
- [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace)
- [Superpowers Chrome](https://github.com/obra/superpowers-chrome)
