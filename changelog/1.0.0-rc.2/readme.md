# One Works 1.0.0-rc.2

- Fix model provider catalog updates failing during installation from the module update screen, while returning stable client errors for malformed or unknown update targets.
- Prefer adapter packages from the current development workspace over stale managed caches, while preserving installed and packaged runtime cache precedence.
- Add Channel Runtime v2 foundations for entity-bound channel links, sender-scoped commands and approvals, cross-channel identity linking, resumable conversations, availability policies, and the first-party OneWorks channel.
- Manage multiple Claude Code accounts through the official CLI login flow, isolated account profiles, portable or device-bound credential handling, cached usage, and Relay-safe account synchronization.
- Add a generic manager-owned runtime broker with owner-bound workspace leases, lease-capable idempotent callbacks, bidirectional events/requests, stale cleanup, and reusable adapter/plugin drivers.
- Reuse Codex app-server processes across manager-launched workspaces, warm up to three configured account profiles without blocking startup, and route managed hooks back to the owning workspace while keeping skills thread-scoped.
- Make Lark role bots in multi-bot chats respond only when the structured mention targets that exact bot, including fail-closed handling for commands addressed to another bot.
- Keep channel connections and runtime-store consumption on the same workspace server in Web launcher mode, preventing duplicate manager connections and channel sessions that remain stuck without an executor.
- Reject ChannelLink sets that reuse one channel key across different entities while allowing one entity to bind multiple external chats.
- Localize chat archive and restore success feedback in English and Chinese.
