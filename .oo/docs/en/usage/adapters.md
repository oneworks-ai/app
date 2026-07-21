# Adapter Configuration and Multiple Accounts

This page covers the adapter configuration structure in the Web configuration UI and the shared multiple-account flow.

## Configuration Entry Points

- Adapter tab: `/ui/config?tab=adapters&source=project`
- Adapter detail: `/ui/config?tab=adapters&source=project&detail=<adapter>`
- Account list: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- Account detail: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` can also be `global` or `user` for cross-project defaults or local overrides.

## Frontend Selector

The adapter selector in the chat input shows the native adapters built into the current application. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.

## Multiple Accounts

Adapters that expose account capabilities can keep account snapshots under the project home:

```text
<project-home>/.local/adapters/<adapter>/accounts/<accountKey>/
```

For Codex:

```bash
oneworks accounts add codex
oneworks accounts add codex work
oneworks accounts show codex work
oneworks accounts remove codex work
```

The account key is inferred from login metadata when possible. Account details may include origin information, authentication digest, and quota or rate-limit snapshots.

Account data is local runtime data. Do not commit it to the workspace.

## Adapter CLI and Model Routing

Native CLI installation and version pinning are covered in [Adapter CLI Installation and Versions](./adapter-cli.md).

`modelServices` is shared configuration. Each adapter maps it to the native runtime differently:

- Claude Code connects directly to known official Anthropic-compatible endpoints for Anthropic, Kimi, DeepSeek, Alibaba Qwen/Bailian, Zhipu GLM, MiniMax, OpenRouter, Requesty, Vercel AI Gateway, and Portkey; other OpenAI-compatible routed models can still use Claude Code Router.
- Codex and Gemini use adapter-owned local proxy behavior.
- Some adapters write provider configuration to native config files or session-level state.

If no routed model is selected, the adapter continues to use its native model and binary defaults.

The bottom of **Settings → Model Services** contains a dedicated import row. Its
searchable selector lists only adapters whose packages expose model-service import
capability; choose an adapter on the left and press **Import** on the right. The
selected adapter declares which Global, Project, or User sources it supports.

When the user-level `CODEX_HOME/config.toml` or `~/.codex/config.toml` defines
`model_provider`, `model_providers`, or `openai_base_url`, select **Global**, choose
**Codex config.toml** in that row, and press **Import**. Selecting **Project** imports
provider fields from trusted workspace
`.codex/config.toml` files into the project `.oo.config.*` source.
Native Codex ignores provider and authentication keys at project scope, but One
Works uses the migrated result with its normal `global < project < user`
precedence. Untrusted project layers are skipped, and global/user provider values
are not expanded into the project file.

Import happens only when the button is pressed. Existing One Works services in
the selected source take precedence, and native Codex files are not modified. Codex-only
authentication, AWS, header, query, and retry settings are preserved under the
imported service's `extra.codex` configuration.

The bottom of **Settings → Environment** uses the same generic adapter-import
interaction, with Project and User as the supported destinations. Selecting Codex
discovers bounded regular `*.toml` files in the current workspace's
`.codex/environments` directory, including default, numbered, and named environments.
Codex `setup` scripts map to One Works `create` scripts, while `cleanup` maps to
`destroy`; a matching platform script overrides the default script. An empty base
script is treated as absent, so a platform-only lifecycle script can still be imported.
Environment IDs ending in `.local` (case-insensitive) are normalized because that
suffix is reserved for One Works' User-source display semantics.

Codex environment actions are not lifecycle `start` scripts, so they are reported as
skipped rather than migrated incorrectly. Import creates only missing environments,
never merges into or overwrites an existing environment directory, and never modifies
the native TOML files.

## Environment Boundaries

Adapters run with an isolated runtime HOME by default. The mock home is created under the project home and bridges selected directories from the real user home when needed. This keeps project runtime state isolated while still allowing native tools to find credentials or platform-specific support files.

For Git worktrees, account directories and runtime caches resolve through the project home of the main worktree when possible, so related worktrees share expected adapter state without copying it into each workspace.

## Web UI Behavior

The adapter configuration pages show inherited values from global or extended config as read-only until you explicitly override them in the current source. Scalar fields can be edited directly; collections and detail items usually require an explicit override action so the current file receives a clear local override instead of mutating the inherited source.
