# Marketplace Examples

This page provides fuller user-side plugin marketplace examples for bringing Claude Code plugins into a project.

The `marketplaces` configuration here is for adapter-native Claude Code marketplaces. Skill marketplace configuration uses `skillRegistries[]` and is not covered here.

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

- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Superpowers](https://github.com/obra/superpowers)
- [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace)
- [Superpowers Chrome](https://github.com/obra/superpowers-chrome)
