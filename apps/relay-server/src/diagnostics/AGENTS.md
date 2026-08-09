# Relay diagnostics

This module is the privacy boundary for standard OTLP/HTTP diagnostic ingestion.

- `otlp.ts` converts OTLP JSON into the narrow `RelayDiagnosticEvent` fact model. Never persist log bodies, prompts, configuration, paths, tool input/output, credentials, or stack traces.
- JavaScript failures may retain only their stable failure code, safe error type, and client-generated one-way fingerprint for grouping.
- `model-usage.ts` recognizes only `oneworks.model.usage` and Codex `response.completed` usage records, projecting safe model/service dimensions and numeric counters into the separate team usage ledger.
- `store.ts` normalizes persisted facts and applies retention.
- Correlation identifiers from clients are pseudonymized before storage. The authenticated Relay user and optional owned device are the only accepted identity source.
- Team attribution comes from a team-scoped token, a validated `x-oneworks-team-id`, or an unambiguous single active membership. Never trust a client attribute for `teamId`.
- Route handling and admin queries live in `src/routes/diagnostics.ts`.
