# Warm Cowork Theme Plugin

This separately published opt-in package owns the `warm-cowork` theme. Keep its ivory grid, coral and blue semantics,
9/14/20 radius ladder, short shadows, localized settings, preview, and icon here. Register only through
`ctx.themes.register(...)`.

Do not add theme-specific branches or assets to `apps/client`, root dependencies, production default plugin lists, or
built-in caches. The repository `.oo.config.json` enables this local package with `watch: true` only as a development
fixture. Verify settings normalization, light/dark shadows, grid responsiveness, neutral sidebar layering, plugin
enable/disable fallback, and the Appearance primary-color lock.
