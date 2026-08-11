# Channel Ingress Router Runs DB Module

This module stores one auditable result for every linked inbound message after ingress routing. It is intentionally independent from `channel_child_session_runs`: ignore, observe, and defer decisions must remain explainable without a child session.

- `schema.ts`: additive table and indexes.
- `repo.ts`: create/read plus idempotent `attachChildRun` after successful dispatch preparation.

Never store raw message content, credentials, tool arguments, or model chain-of-thought in this audit.
