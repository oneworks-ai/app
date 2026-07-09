# UI Runtime and Frontend Entries

UI plugins extend the One Works frontend without forking the host application. They can contribute navigation entries, panels, views, buttons, and plugin-specific pages while keeping plugin behavior in a package.

## Runtime Model

The host loads plugin manifests from the active plugin graph. A plugin can declare frontend contributions and, when needed, server entries with scoped APIs or runtime channels. The frontend renders plugin contributions inside host-owned surfaces.

Important boundaries:

- The host owns global routing, app shell, authentication, session state, launcher chrome, and server runtime connection.
- The plugin owns its own views, labels, commands, and plugin-specific state.
- Shared data contracts should be expressed through manifest metadata and scoped APIs.
- A plugin should not rely on private host component internals unless that surface is explicitly documented.
- Launcher pages and workspace pages are surfaces of the same client plugin runtime; both should mount plugin UI through the host `PluginViewHost`.

## Frontend Entries

A frontend entry can contribute UI to known host surfaces such as:

- navigation or launcher entries
- plugin detail pages
- chat header actions
- side panels or tabs
- custom pages

Prefer package exports for frontend entry discovery:

```json
{
  "type": "module",
  "exports": {
    "./client": {
      "source": "./client/src/index.tsx",
      "default": "./client/dist/index.js"
    }
  }
}
```

The manifest should identify the contribution target, display text, optional icon metadata, and the view id used by the host to mount the view. New plugins should not repeat public entry paths in `plugin.client.root` or `plugin.client.entry`.

Local plugin sources use the host Vite dev server for `exports["./client"].source`, so HMR, TypeScript / TSX transforms, source maps, and React Fast Refresh are host-provided. Do not configure `plugin.client.devServer` for new plugins.

When a plugin also exposes a server entry, the manifest must declare `plugin.server.roles`. `exports["./server"]` only supplies an entry path; missing roles make the host reject the server entry and report a diagnostic.

## Launcher Contributions

Launcher-visible plugin behavior must be registered by the plugin. Declare plugin pages in `routes[]` with `surfaces: ["launcher"]`, declare launcher search sources in `launcherSearchProviders[]` with the same surface, and implement each provider command from the plugin's `activatePlugin` entry with `ctx.commands.register(...)`. Search results can select their command-list group with `groupId` / `groupTitle`; `sectionId` / `sectionTitle` are accepted aliases.

The host only discovers these structured contributions, executes scoped commands, and renders the generic route and grouping contracts. It may use a generic fallback group when a result does not declare one, but it must not mirror plugin-specific built-in commands, view modes, menu items, availability checks, account flows, or login APIs. When a plugin is disabled or does not register the contribution, its launcher entry should disappear naturally.

## Configuration UI

Plugin configuration uses the same schema-driven UI as the main configuration page. A manifest can provide:

- `config.schema` or `config.jsonSchema`
- `titleI18n` and `descriptionI18n`
- `x-oneworks-ui` hints for icons, placeholders, and sensitive fields
- `config.uiSchema` when the default JSON Schema renderer is not enough

Saved values are written to the active project config under `plugins[].options` for that plugin instance.

## Frontend to Server Calls

When a plugin needs backend behavior, expose it through a server entry and call it through the plugin scoped API. This keeps plugin calls tied to the active plugin instance and project service.

Use scoped APIs instead of direct host internals for:

- reading plugin-specific data
- writing plugin runtime state
- running plugin commands
- checking plugin diagnostics

Use `ctx.runtime.invokeChannel(channelId, { payload, target })` for same-scope runtime channel calls between `manager` and `workspace` server runtimes. Use `ctx.runtime.listEndpoints()` when a plugin needs the manager or workspace endpoints known by the host. React views receive the same bridge as `view.runtime.endpoint`, `view.runtime.invokeChannel(...)`, and `view.runtime.listEndpoints()`, including launcher-mounted plugin pages. Do not probe server URLs from plugin UI; use runtime endpoints provided by the host.

## State and Persistence

Frontend plugin state should be explicit about where it lives:

- ephemeral UI state can stay in the view
- project configuration belongs in `plugins[].options`
- plugin runtime data belongs in the project home or host-provided plugin data APIs
- user-interface-only preferences can use browser storage when they do not affect project behavior

Do not write plugin runtime data into source-controlled project assets unless the user explicitly chooses that behavior.

## Design Expectations

Plugin UI should match the host application:

- compact controls for repeated work
- predictable navigation and focus behavior
- no marketing-style landing pages inside operational tool surfaces
- icons for common tool actions
- clear empty, loading, error, and disabled states

Plugin UI should not describe itself with tutorial text when a familiar control can make the action obvious.

For common UI, reuse host-owned components exposed through `view.ui.*` or `view.components.render(...)`. Lists, search inputs, icons, dropdowns, overlays, and action buttons should follow the platform components instead of plugin-local Ant Design wrappers or custom CSS.

Launcher plugin pages are not a separate styling system. A React view mounted in the launcher receives the same `PluginViewHost` context as route, workbench, and drawer surfaces, with `view.host.surface === "launcher"`. Plugins should branch on that surface only to choose host component modes and action density, not to fork markup or CSS.

Use `view.ui.InteractionList` for plugin lists that need search, selection, row actions, context menus, nesting, avatars, icons, or presence badges. Its list modes are:

- `mode: "launcher"`: launcher command-list density, 20px icon/avatar slot, compact rows, menu-style actions.
- `mode: "resource"`: divider-separated resource lists with 10px vertical row padding and no row gap.
- `mode: "grouped"`: no-divider grouped lists with a 10px container gap and no vertical row padding.

When a view is mounted on the launcher surface, host interaction lists default to launcher mode, a 20px icon slot, menu-style actions, title-hover descriptions, and hidden inline descriptions. Plugins should override those defaults only for a specific product reason, not to restyle the launcher locally.

Use `view.ui.SearchInput` or `InteractionList.search` for list search. Do not hand-roll a search icon, Ant Design affix wrapper, prefix gap, focus color, or clear button inside plugin packages. When a launcher page needs a different density or state marker, extend the host component API first, then consume that structured option from the plugin.

## Debugging UI Contributions

If a contribution is missing:

1. Check that the plugin package resolves.
2. Check that the manifest declares the frontend contribution.
3. Check that the plugin instance is enabled.
4. Check whether the contribution target exists in the current app version.
5. Check browser console and server logs for plugin loading errors.

If a contribution renders but cannot call server behavior:

1. Verify the plugin server entry is loaded.
2. Verify the scoped API name and scope.
3. Verify the current project service is the expected one.
4. Check authentication and CORS only when using a standalone client or PWA.
