# Token Usage

One Works collects token usage reported by supported adapters and plugins into one view.

## Where to view usage

- Open **Usage** from the Launcher to see totals across available workspaces and extension sources.
- Open **Configuration > Apps > Usage** in a workspace window to see the current workspace. This view does not mix in other workspaces by default.
- Open the **Usage** tab on a model service to inspect that service. Account details keep usage collapsed by default and lock the expanded view to the current account and tool.

The page exposes filters for model service, model, account, tool, device, workspace, owning plugin, and sync plugin only when the data contains meaningful choices. Select a model service, account, or tool directly from the breakdown to drill in, then return to the overview.

## Data sources

One Works prefers actual usage fields returned by a model service or CLI. Built-in paths accept token data exposed by adapters such as Claude Code, Codex, and Kimi. For example, when Claude Code uses a Kimi API endpoint, reported usage can be attributed to the Claude Code tool, the Kimi model service, the selected model, and the selected account at the same time.

Not every subscription account or third-party proxy reports tokens or cost. Requests without usage are not presented as precise measurements. The page shows only reported data, identifies offline or incomplete sources, and displays cost only when a provider reports it.

## Multiple accounts and Relay

Accounts, model services, and subscription resources use stable IDs, so a model service may have multiple accounts. Plugin observations preserve two separate relationships:

- Owning plugin: the plugin that created and manages the model service or account.
- Sync plugin: the plugin that transported the observation from another device.

Relay-style plugins can use the usage-source extension contract to synchronize observations and resource metadata from other devices. Stable observation IDs are deduplicated, and cumulative totals are not added on top of delta observations. The global view can therefore merge several machines while remaining traceable by device, workspace, account, and owning plugin.
