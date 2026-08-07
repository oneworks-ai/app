# @oneworks/adapter-codex 0.1.0

- Reuse one Codex app-server across compatible tasks and model providers while keeping thread configuration, approvals, lifecycle, hooks, and project context isolated.
- Add adapter-level HTTP(S) proxy, `NO_PROXY`, and custom CA configuration for both native Codex traffic and routed model-service requests.
- Improve Codex account management with explicit reauthentication completion, merged profile identity, and a shared localized quota view in account details.
- Protect global credentials from stale reauthentication completion and keep generated account metadata read-only.
