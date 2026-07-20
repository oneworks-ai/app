# China Edition Theme

An optional, separately published OneWorks theme plugin. It is not enabled or bundled by the core app. When installed
and enabled, it registers the `china-red` theme pack and contributes its own
localized name, settings tabs, Ant Design tokens, CSS overrides, and workspace banner.

Install the published package in the target workspace:

```bash
pnpm add -D @oneworks/plugin-china-red-theme
```

Then opt in from `.oo.config.json`:

```json
{
  "plugins": [
    {
      "id": "@oneworks/plugin-china-red-theme",
      "scope": "china-red-theme"
    }
  ]
}
```

Select **China Edition** under **Settings → Themes**. Disabling or
removing the plugin leaves the saved theme id and settings intact, while the UI safely falls back to the default theme.
