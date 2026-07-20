# Neo Workshop Theme Plugin

This separately published opt-in package owns the `neo-workshop` theme. Keep its palette, hard-shadow geometry,
component CSS, localized settings, preview, and icon here. Register only through `ctx.themes.register(...)`.

Do not add theme-specific branches or assets to `apps/client`, root dependencies, production default plugin lists, or
built-in caches. The repository `.oo.config.json` enables this local package with `watch: true` only as a development
fixture. Verify settings normalization, light/dark rendering, neutral sidebar layering, responsive geometry, plugin
enable/disable fallback, and the Appearance primary-color lock.

Neo-brutalist structure uses `2px` borders and zero-gap segmented groups where controls share one boundary. The
sidebar quick-link list, grouped navigation, Footer and NativeTabs use zero-gap stacks without duplicated adjacent
borders. Only the footer container owns the top divider, and neither NativeTabs nor footer entries use shadows.
Sidebar header, grouped-list and Footer wrappers remove all outer inset, and
grouped navigation selection does not use a shadow. A boundary shared by adjacent surfaces has exactly one owner: the
window bar owns the header/list boundary and the content shell owns the sidebar/content boundary. The expanded Web
window bar is a full-width row with a bottom divider rather than a detached icon button; its icon follows the same
control padding as the rows below. Theme overlays use the warm
paper surface, square `2px` structure, zero blur and a hard offset shadow; menu items remain square and use structural
dividers. The host content region has no outer inset; its content shell keeps only the left divider against the sidebar
and removes top/right/bottom borders that touch the viewport boundary. Full-width sidebar controls likewise remove the
left border that touches the viewport, while the content shell owns their right edge. Sidebar surfaces stay flat and do
not use soft gradients or diffuse shadows; NavRail top padding follows the shared route header overlay height. Theme
configuration field rows also consume the square-corner override.

Sender and Composer surfaces follow the same shared-boundary rule. Style them through the host's
`--chat-surface-*`, `--chat-composer-card-*`, composer-stack and starter-list tokens plus generic sender selectors;
never add automation- or plugin-create-specific theme selectors. The chat surface owns the square `2px` outer
frame and hard offset shadow, its inner composer drops the duplicate border, the status bar owns one top divider,
and the send action uses the theme's pink primary action treatment. Validate the same contract in chat, automation
creation / editing, and plugin creation.
