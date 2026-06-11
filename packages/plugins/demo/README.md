# Plugin Demo

Built-in workspace plugin loaded from `@oneworks/plugin-demo`. It is intentionally small, but it exercises the plugin
detail page with README language variants, localized contribution names, contribution descriptions, and search.

It demonstrates these surfaces:

- app nav route: `/plugins/demo/home`
- nav more menu command
- nav footer action rendered above the bottom sidebar menu
- chat header action and more menu command
- bottom workbench tab
- right workspace drawer tab
- launcher search provider
- server command: `server-ping`
- scoped API: `echo/*` with title, description, input schema, output schema, and header schema metadata
- plugin extension point: `demo/quick-actions`
- client plugin API: `demo/describe-extension-point`
- React `renderNode` plugin views using host-provided `ctx.react`
- plugin view i18n through `view.i18n.resolveText(...)` and command i18n through `ctx.i18n.resolveText(...)`
- host notification queue prompts through `ctx.notifications.show(...)`, including markdown descriptions and action callbacks
- a thin `client/src/index.tsx` that loads split ESM modules for the React view, i18n messages, shared model helpers, and styles
- view host state: language, theme, resolved theme, and surface
- host-rendered shared components: sender, project file tree, and overlay menu/tree/search surfaces
- host-rendered common controls: icon, segmented, switch, input, overlay dropdown, and overlay primitives
- controlled sender options: surface, density, visibility, defaults, adapter, and model
- interactive configuration rendered from `plugin.json` JSON Schema

Try it in the plugin detail page:

- Switch the app language from the bottom-left menu to verify that README, contribution text, route titles,
  tabs, controls, placeholders, and overlay labels follow the current language.
- Open **Extension points** and search for `server`, `drawer`, `Launcher`, or `command` to filter the point list.
- Toggle an extension group or a single point to verify that the registered client contributions update.
- Open **Config** to edit the demo options. The form is generated from `config.schema`, and saved values are
  written to this plugin instance's `options`.
- Open the demo route and use **Run server command**, **Call scoped API**, or **Run local command** to verify plugin prompts appear in the host notification queue with source, time, markdown body, and action buttons.
- Use **Render sender**, **Render file tree**, or **Render overlay** to verify React plugin views can mount host shared components through `view.ui` without copying their DOM or styles. The overlay demo uses left tabs to switch the active host overlay surface. The sender demo includes controlled surface, density, visibility, default text, placeholder, adapter, and model options rendered through host common controls.
- Keep `@oneworks/plugin-demo-extension` enabled to verify that another plugin contributes to `demo/quick-actions`, observes the extension point with `onAvailable(...)`, and calls the demo plugin API when the contributed action runs.

Frontend source layout:

- `client/src/index.tsx`: thin runtime entry, dynamic module loading, registration, and cleanup.
- `client/src/view.tsx`: React view factory using host `ctx.react` and `view.ui`.
- `client/src/i18n.ts`: localized strings and text resolver helpers.
- `client/src/demo-model.ts`: shared demo actions, tab data, events, and result helpers.
- `client/src/styles.ts`: CSS that uses host variables.
- `client/dist/*.js`: generated browser ESM loaded by the host when the host Vite source entry is not active.
- `server/src/index.ts`: TypeScript server entry loaded directly by the host in watch mode.
- `server/dist/index.js`: built server entry used when watch mode is disabled.

The package exports use the plugin source/default convention: `./client.source` points to `client/src/index.tsx`, `./client.default` points to `client/dist/index.js`, `./server.source` points to `server/src/index.ts`, and `./server.default` points to the built server entry. In host frontend dev mode, local plugin client source is loaded through the host Vite dev server so React Fast Refresh can handle TSX component updates and Vite can hot-update style modules. Static plugin client files are browser ESM and are not TypeScript-transpiled by the host; run `pnpm -C packages/plugins/demo build` after editing client TS/TSX unless the host Vite source entry is active. Server TS is loaded through the host esbuild register when watch mode uses the source entry. Watch mode for `.oo/plugins.dev/*`, explicit `watch: true`, and the plugin detail page performs plugin-level reload for non-self-handled client source, manifest, server, README, and static entry changes.
