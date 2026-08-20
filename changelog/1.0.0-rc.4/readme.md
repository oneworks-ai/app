# One Works 1.0.0-rc.4

- Expand the built-in agent catalog with Cline, Cursor, Factory Droid, DeepSeek Harness (DSH), Goose, Grok, JetBrains Junie, Kiro, and Qwen Code adapters. Their plugin-backed integrations standardize streaming sessions, tools, permissions, skills, MCP, hooks, model routing, isolated runtime state, and supported history import so project and business harnesses can build on one consistent surface.
- Add protocol-safe Model Service routing, Codex account-pool failover, broader Codex runtime discovery, visible login progress, and optional sharing of Codex built-in models with other One Works adapters while keeping every adapter's own account selector unchanged.
- Let the first managed Claude account on macOS safely reference an existing Claude Desktop or default CLI OAuth login without another browser flow or a false isolated `CLAUDE_CONFIG_DIR`, show fresh identity-matched quota and reset details from CLI, Desktop, or an in-memory OAuth usage refresh with bounded rate-limit backoff, and restore the `oneworks accounts` CLI command route.

  ![Codex built-in models in Claude Code](./codex-shared-models-claude-code.jpg)
- Add member-scoped external channel connections and Leaders for Team Chats, including an Auto Leader that delegates and follows up work across selected members, multi-room mappings, per-connection processing policies, deduplicated inbound routing, delivery-state degradation, and related channel/member attribution.
- Add Shikitor and Cordis as organization-scoped vendor modules, with Shikitor using Cordis to power its extensible editor-plugin playground.
- Cut real-workspace Desktop startup latency by about 58% by bundling the packaged server/runtime path and reporting readiness only when the interactive workspace is actually usable.
- Make terminal tab closing reliable across the bottom panel, Workspace drawer, and mobile overview by confirming active processes, preserving terminals that cannot be stopped, restoring focus to visible controls, and keeping canceled native tab closes in place.

  ![Terminal close confirmation in the mobile Workspace overview](./issue-188-terminal-close-confirmation.jpg)
- Make Launcher settings and update behavior follow the active runtime: Electron retains desktop APIs and readiness, Android and partial device shells use Web API configuration without desktop bridge calls, and installed PWAs are identified by their actual display mode.

  ![Launcher settings on the Web runtime](./launcher-settings-web.jpg)
- Restore signed and notarized macOS distribution for rc.4, including post-sign native filesystem-authority integrity, fail-fast packaged-authority checks before Apple submission, recoverable bounded notarization, and strict Gatekeeper/install smoke verification for arm64 and x64 DMG, PKG, and ZIP artifacts.
