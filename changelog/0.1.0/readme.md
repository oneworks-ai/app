# One Works 0.1.0

- Deliver the first stable One Works release across the CLI, desktop app, web and PWA clients, Relay deployments, adapters, channels, plugins, and public runtime packages.
- Provide one workspace for Claude Code, Codex, Copilot, Gemini, Kimi, and OpenCode, including adapter-owned account, model-service, worktree, and history imports.
- Add searchable plugin and skill marketplaces, installable themes, managed browser and computer control, local media rendering, and shared session and token-usage views.
- Support Cloudflare hibernating WebSockets, Vercel bounded long-polling, and self-hosted Node WebSockets as independent Relay deployment modes.
- Ship the `oneworks`, `ow`, and `owo` CLI entry points together with reproducible Homebrew, Scoop, and Winget metadata generation for stable distribution.
- Correct zero-major runtime protocol compatibility, keep plugin resolution inside the selected workspace, honor workspace-specific configuration while watching for changes, and sort discovered workspace documents for deterministic loading.
- Harden packaged runtime ownership, cache isolation, plugin loading, release identity checks, production dependency auditing, and deterministic release recovery.
- Secure plugin uninstall and presentation, with fail-closed macOS managed-tree and filesystem authority enforcement.

Compatibility note: the first macOS desktop stable candidate remains unsigned. Its checksum is published and verified, but macOS Gatekeeper may require explicit user approval until Apple signing and notarization credentials are configured.
