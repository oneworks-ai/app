# Channel Sessions DB Module

This directory owns channel-to-session bindings, immutable per-session delivery targets, and channel-scoped runtime preferences.

- `schema.ts`: creates `channel_sessions_v2`, `channel_preferences_v2`, and `channel_session_deliveries`, including safe migration from legacy channel-keyed rows.
- `repo.ts`: reads and writes current bindings, preferences, and immutable delivery snapshots.

Bindings are keyed by `channelKey + sessionType + channelId + threadId`; a missing thread is normalized to an empty key. Preferences remain channel-scoped at `channelKey + sessionType + channelId`. `channelType` alone is not an issuer boundary: two apps or tenants on the same platform may reuse external IDs.

`channel_session_deliveries` is immutable for a `sessionId`. A later inbound message may update the current channel binding, but it must not rewrite an older ChildSession's reply destination or actor-adjacent delivery metadata. New inbound work creates a new ChildSession and a new delivery row.

Use this module for persistence only. Session creation, actor snapshots, permission transfer, and runtime dispatch belong to the channel middleware and session services.
