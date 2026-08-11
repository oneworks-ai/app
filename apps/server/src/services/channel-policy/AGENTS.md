# Channel Policy Service

This directory owns soft policy decisions that run after hard channel access and before ingress routing.

- `index.ts`: public PolicyEngine facade, subject resolution, escalation, immutable audit events, and muted notice formatting.
- `moderation-review.ts`: narrow structured no-tools review boundary. It intentionally receives only configured rules, a compact behavior summary, and the current message.
- Backlog storage and leases remain in `db/channelPolicies`; this service does not call platform ban APIs or create sessions directly.

Use this service for muted state, review escalation, and policy command actions. Keep deterministic availability timing in `channels/middleware/availability-gate.ts`.
