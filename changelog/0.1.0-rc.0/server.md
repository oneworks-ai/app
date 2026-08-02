# @oneworks/server 0.1.0-rc.0

- Add unified token-usage aggregation for runtime sessions, imported history, local adapters, plugins, and Relay-backed sources.
- Add an independently updateable model-provider catalog target and load its active package after restart, falling back to the bundled catalog when a managed package is missing or incompatible.
- Discover models through providers' official OpenAI-compatible `/models` APIs when supported, merge explicit local models, and use credential- and profile-scoped last-known caches only for network or service outages.
- Import external Codex and Claude Code sessions into canonical project history while preserving source metadata and usage records.
