# China Edition Theme Plugin

This package owns the optional `china-red` theme. Changes to its localized metadata, primary color, settings tabs,
settings normalizer, Ant Design tokens, document attributes, component overrides, preview styling, banner artwork, or
banner copy belong here rather than in `apps/client` or shared route-layout tokens.

This is a separately published opt-in package. Do not add it to the app's root dependencies, production default plugin
lists, or built-in package caches. The repository development workspace intentionally enables the local source package
from the project `.oo.config.json` with `watch: true`; this is a development fixture, not a user-facing built-in.

- `client/src/index.ts`: minimal activation entry that registers the theme through `ctx.themes.register(...)`.
- `client/src/theme.ts` and `client/src/settings.ts`: own theme tokens, banner declaration, normalization, and tabs.
- `client/src/theme.css`: contains every China Edition-specific token and component selector.
- `client/src/banner-panorama.png` and `assets/icon.svg`: plugin-owned visual assets.
- `plugin.json`: plugin discovery metadata; theme runtime behavior stays in the client entry.

The client host may be extended only for reusable theme capabilities. Do not add `china-red` branches, text, assets,
or selectors to the host. Verify plugin enable/disable fallback, settings persistence, light/dark rendering, responsive
banner layout, and the Appearance primary-color lock after theme changes.
