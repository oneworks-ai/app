# Relay diagnostics

This module is the privacy boundary for standard OTLP/HTTP diagnostic ingestion.

- `otlp.ts` converts OTLP JSON into the narrow `RelayDiagnosticEvent` fact model. Never persist log bodies, prompts, configuration, paths, tool input/output, credentials, or stack traces.
- JavaScript failures may retain only their stable failure code, safe error type, and client-generated one-way fingerprint for grouping.
- `model-usage.ts` recognizes only `oneworks.model.usage` and Codex `response.completed` usage records, projecting safe model/service dimensions and numeric counters into the separate team usage ledger.
- `store.ts` normalizes persisted facts and applies retention.
- Correlation identifiers from clients are pseudonymized before storage. The authenticated Relay user and optional owned device are the only accepted identity source.
- `oneworks.app.first_action` uses the `first-action` category. Its summary keeps submit→accepted/response/success separate and joins app-start→submit only through the pseudonymous app session correlation; correlation IDs never become metric dimensions. Success rate uses terminal success/error/cancelled/abandoned attempts only, while genuinely in-flight operations remain visible as pending attempts.
- Daily first-action series are submit cohorts: aggregate the complete operation before assigning it to the UTC date of its first submit. A terminal fact received on a later date must stay in the original cohort, while raw event volume remains grouped by occurrence date.
- Team attribution comes from a team-scoped token, a validated `x-oneworks-team-id`, or an unambiguous single active membership. Never trust a client attribute for `teamId`.
- Route handling and admin queries live in `src/routes/diagnostics.ts`.
