# Focus Workbench Theme Plugin

This separately published opt-in package owns the `focus-workbench` theme. Keep its neutral token ladder, compact
geometry, component CSS, localized settings, preview, and icon here. Register only through `ctx.themes.register(...)`.

Do not add theme-specific branches or assets to `apps/client`, root dependencies, production default plugin lists, or
built-in caches. The repository `.oo.config.json` enables this local package with `watch: true` only as a development
fixture. Verify settings normalization, light/dark rendering, neutral hover feedback, responsive geometry, plugin
enable/disable fallback, and the Appearance primary-color lock.
