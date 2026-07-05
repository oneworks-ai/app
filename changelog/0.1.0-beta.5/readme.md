# One Works 0.1.0-beta.5

- Align public workspace packages on the beta.5 prerelease sequence so `oneworks@beta` resolves matching runtime packages instead of mixing older alpha or beta submodules.
- Improve Electron desktop startup and workspace loading so the main shell can appear before slower secondary resources finish mounting.
- Add adapter CLI preparation visibility and compatibility-aware runtime fallback for bundled, cached, user-installed, and auto-installed adapter CLIs.
- Extend Codex and Claude Code adapter support with account/model compatibility fixes and clearer runtime evidence for packaged app verification.
- Add the desktop control and demo-video tooling used for AI-native packaged app validation, including system-recorded Electron demos, load timing reports, per-second frames, and documented recording standards.
- Refine Electron demo-video cursor timing, motion continuity checks, and launcher workspace selection so visual click feedback aligns with the resulting UI transition.
