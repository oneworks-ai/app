# One Works 0.1.0

- Deliver the first stable One Works release across the CLI, desktop app, web and PWA clients, Relay deployments, adapters, channels, plugins, and public runtime packages.
- Provide one workspace for Claude Code, Codex, Copilot, Gemini, Kimi, and OpenCode, including adapter-owned account, model-service, worktree, and history imports.
- Add searchable plugin and skill marketplaces, installable themes, managed browser and computer control, local media rendering, and shared session and token-usage views.
- Support Cloudflare hibernating WebSockets, Vercel bounded long-polling, and self-hosted Node WebSockets as independent Relay deployment modes.
- Ship the `oneworks`, `ow`, and `owo` CLI entry points together with reproducible Homebrew, Scoop, and Winget metadata generation for stable distribution.
- Correct zero-major runtime protocol compatibility, keep plugin resolution inside the selected workspace, honor workspace-specific configuration while watching for changes, and sort discovered workspace documents for deterministic loading.
- Harden packaged runtime ownership, cache isolation, plugin loading, release identity checks, production dependency auditing, and deterministic release recovery.
- Secure plugin uninstall and presentation, with fail-closed macOS managed-tree and filesystem authority enforcement.
- Create entities, flows, and rules directly from Data Assets with safe save-location previews; when transport completion is uncertain, preserve an indeterminate result instead of retrying creation.
- Restore all four locale/theme documentation videos as byte-safe MP4 assets and enforce complete decode verification in CI.

Compatibility note: the first macOS desktop stable release remains unsigned, but its application bundles now contain only portable internal symlinks, are completely ad-hoc resource sealed, and have every arm64/x64 DMG, PKG, and ZIP strictly verified. Checksums are published and verified. macOS Gatekeeper may still require explicit user approval until Apple Developer ID signing and notarization credentials are configured.
