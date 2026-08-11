# Channel Policy

- `index.ts` owns issuer-scoped account/user policy subjects, state transitions, expiry, idempotent audit events, and muted notices.
- `moderation-review.ts` owns fail-closed structured review only; it uses the shared `structured_no_tools` invoker and never turns invalid, failed, or low-confidence output into a mute.
- Keep persistence in `../../db/channelPolicies/`; transport short-circuiting stays in `../../channels/middleware/policy-gate.ts`.
