# Marketplace Examples

This page provides fuller user-side plugin marketplace examples for bringing One Works, Claude Code, and Codex plugins into a project.

The plugin marketplace includes the One Works, OpenAI Plugins, and Anthropic official sources by default. Plugins can be installed into the current project or globally. Official sources can be disabled but not deleted, and custom Git sources can be added. Skill marketplace configuration uses `skillRegistries[]` and is not covered here.

The One Works official source lists optional `@oneworks/plugin-*` packages matching the current app version. Installation downloads a missing package into the shared package cache and reloads the plugin runtime immediately. Removal only drops the project or global declaration; the cache remains available to other projects. Built-in Relay is omitted from the install catalog, and Standard Development is exposed as the optional child of Plugin Demo instead of a separate marketplace entry.

## Custom Codex Marketplace

Codex marketplaces use `.agents/plugins/marketplace.json` in the source repository:

```yaml
marketplaces:
  company-codex-plugins:
    type: codex
    enabled: true
    plugins:
      reviewer:
        scope: review
    options:
      source:
        source: github
        repo: acme/codex-plugins
        ref: main
```

Codex sources support `github`, `git`, and `directory`. One Works reads each `.codex-plugin/plugin.json` and converts reusable skills, commands, agents, MCP servers, and hooks.

## Superpowers Marketplace

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

The plugin name must exist in the marketplace `marketplace.json`.

## Inline a Minimal Marketplace

If you do not want to depend on a full external marketplace, declare only the plugins your project needs:

```yaml
marketplaces:
  superpowers:
    type: claude-code
    enabled: true
    plugins:
      superpowers:
        scope: superpowers
      superpowers-chrome:
        enabled: false
    options:
      source:
        source: settings
        plugins:
          - name: superpowers
            source:
              source: github
              repo: obra/superpowers
              ref: main
          - name: superpowers-chrome
            source:
              source: github
              repo: obra/superpowers-chrome
              ref: main
          - name: private-journal-mcp
            source:
              source: github
              repo: obra/private-journal-mcp
              ref: main
```

Install:

```bash
oneworks plugin --adapter claude add superpowers@superpowers
oneworks plugin --adapter claude add superpowers-chrome@superpowers
oneworks plugin --adapter claude add private-journal-mcp@superpowers
```

Notes:

- `source: settings` is useful when you want the project to pin exact repositories and refs.
- Inline catalog `plugins[].source` must be an explicit object, not a relative path string.
- Relative plugin source paths are only valid for directory marketplaces because only those marketplaces have a local root for resolution.

## Automatic Sync

When plugins are declared under `marketplaces.<name>.plugins`:

- The first `oneworks` for a new session installs missing plugins.
- `syncOnRun: true` syncs before every new session.
- `resume` does not resync, so an existing session does not drift mid-run.

## Related Docs

- [OpenAI Plugins](https://github.com/openai/plugins)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Superpowers](https://github.com/obra/superpowers)
- [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace)
- [Superpowers Chrome](https://github.com/obra/superpowers-chrome)
