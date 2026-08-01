# @oneworks/server 0.1.0-beta.10

- Scope Core update checks and installs to the packages owned by the active host, reject downgrades and cross-host targets, and verify staged package identity before replacing an active cache.
- Add an independently updateable model-provider catalog target and load its active package after restart, falling back to the bundled catalog when a managed package is missing or incompatible.
- Discover models through providers' official OpenAI-compatible `/models` APIs when supported, merge explicit local models, and use credential- and profile-scoped last-known caches only for network or service outages.
