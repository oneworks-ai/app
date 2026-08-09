# Diagnostics Package

`@oneworks/diagnostics` owns the vendor-neutral diagnostic fact model used by One Works applications and adapters. It defines operation lifecycle events and a bounded Node.js JSONL journal. OTel exporters, Relay ingestion, Admin read models, and support bundles should consume this contract instead of defining parallel event shapes.

## Entry points

- `src/types.ts`: privacy-safe event, resource, context, outcome, and failure contracts.
- `src/operation.ts`: operation lifecycle and exporter orchestration.
- `src/javascript-errors.ts`: browser-safe exception normalization, fingerprinting, deduplication, rate limiting, and diagnostic operation mapping.
- `src/file-journal.ts`: Node.js bounded JSONL persistence and interrupted-operation recovery.
- `src/otlp-http.ts`: dependency-free standard OTLP/HTTP JSON batching, retry, and OTel environment configuration.
- `src/support-bundle.ts`: privacy-safe local bundle generation with pseudonymous correlation identifiers.
- `src/index.ts`: runtime-neutral exports.
- `src/node.ts`: Node.js-only exports.

## Boundaries

- Diagnostic events contain stable identifiers, stages, outcomes, durations, and classified failures only.
- JavaScript error fingerprints are truncated SHA-256 hashes of error type and stack shape. Raw messages, rejection values, stacks, URLs, and paths must never enter the report contract.
- Do not add arbitrary payload, message, stack, prompt, tool input/output, path, URL, environment, token, or configuration fields to the shared event contract.
- `model-usage.ts` records content-free Model Service consumption facts only: stable service/model/adapter identifiers, request outcome, durations, and token counters. It is operational metering, not a provider billing ledger, and must never estimate cost without authoritative pricing/tier data.
- High-cardinality correlation identifiers are `restricted`; they must never become metric dimensions.
- Product-specific instrumentation should use stable lowercase dotted names and stable error codes.
- Relay storage, sampling, consent, retention, and Admin authorization remain consumer concerns; the Node entry point owns only the reusable OTLP transport and local bundle projection.
- Browser-compatible code stays in the root entry point. Node filesystem code is exported only from `@oneworks/diagnostics/node`.

## Verification

Run `pnpm -C packages/diagnostics test` and the relevant consuming app typecheck after changing the contract or lifecycle.
