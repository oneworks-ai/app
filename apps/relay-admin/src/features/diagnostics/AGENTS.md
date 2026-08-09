# Relay Admin diagnostics

This feature provides the stability dimension at `/data-dashboard/stability` and the user-detail timeline backed by `/api/admin/diagnostics`.

- `diagnosticsApi.ts` owns the query contract and cursor pagination.
- `DiagnosticsPage.tsx` maps product, engineering, support, and test questions to summary cards, filters, and a safe event timeline.
- Only the server-normalized diagnostic fact model may be displayed. Do not add raw OTLP bodies, prompts, configuration, paths, tool input/output, credentials, stack traces, or another user's private device metadata.
- Stable filters are URL query parameters. The platform surface is composed by `../data-dashboard`; user detail uses `/users/:userId/diagnostics`.
