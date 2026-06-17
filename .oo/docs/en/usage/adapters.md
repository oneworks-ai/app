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

## Environment Boundaries

Adapters run with an isolated runtime HOME by default. The mock home is created under the project home and bridges selected directories from the real user home when needed. This keeps project runtime state isolated while still allowing native tools to find credentials or platform-specific support files.

For Git worktrees, account directories and runtime caches resolve through the project home of the main worktree when possible, so related worktrees share expected adapter state without copying it into each workspace.

## Web UI Behavior

The adapter configuration pages show inherited values from global or extended config as read-only until you explicitly override them in the current source. Scalar fields can be edited directly; collections and detail items usually require an explicit override action so the current file receives a clear local override instead of mutating the inherited source.
