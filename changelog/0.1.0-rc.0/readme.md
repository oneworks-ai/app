# One Works 0.1.0-rc.0

- Add unified token-usage analytics across the Launcher and workspace, with account, model, source, and time-range breakdowns.
- Add Launcher and workspace flows for importing Codex and Claude Code history into canonical projects and sessions.
- Split model-provider metadata into an independently updateable catalog, prefer official provider model-list APIs, and add DeepSeek Responses support for Codex.
- Make macOS release candidates resumable and reproducible, accurately label unsigned builds, and give valid cold plugin compilation enough time during packaged smoke tests.
- Publish the VS Code extension as `0.1.1-rc.0`, whose stripped `0.1.1` Marketplace version stays distinct from the existing `0.1.0` prerelease.
- Stop duplicate Browser Control bridges from surviving plugin reloads and repeatedly rewriting credential files, preventing runaway CPU and disk usage.
