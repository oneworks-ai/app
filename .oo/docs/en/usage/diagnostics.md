# Diagnostics, Telemetry, and Support Bundles

One Works uses OpenTelemetry (OTel) as the transport standard and a narrow, product-owned diagnostic fact model as the contract. One Works, Codex, and other OTLP/HTTP JSON producers can therefore share an analysis path without uploading log text, prompts, or credentials as default telemetry.

## Questions this answers

| Role                | Primary questions                                                                                        | Analysis                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Product             | Startup success, typical and tail latency, regressions by version, affected users                        | Outcome, P50/P95, version/platform/source distribution, affected-user count      |
| Engineering         | Failing stage and domain, retryability, repeated failures in a correlated session                        | Stable error code, failure domain, stage, duration, pseudonymous correlation IDs |
| QA                  | Expected stage progression, distinct timeout/cancel/degraded states, abandoned operations after upgrades | Operation state machine, stage order, terminal state, interrupted-run recovery   |
| Support             | Diagnose “will not open” or “is slow” without requesting project contents                                | Per-user timeline, safe support bundle, version/platform, failure codes          |
| Operations/security | Collection controls, retention, authorization, and sensitive-data boundaries                             | User/device authentication, Admin permission, retention caps, field allowlist    |

The lifecycle distinguishes started, stage transitions, user-ready, stable, and terminal states. Startup success and P50/P95 measure time to a usable UI, not merely process creation or the end of the stability window. A background problem after readiness can be `degraded` rather than incorrectly classifying the whole launch as a failure.

## Data flow

```text
One Works Desktop / Web / PWA / CLI ─┐
                                     ├─ OTLP/HTTP JSON ─ Relay privacy projection/retention ─ Admin stability dashboard
Codex OTel ──────────────┘

Local One Works facts ─ privacy-safe support bundle (manually shared with support)
```

Relay accepts logs at:

```text
POST <relay-origin>/api/relay/diagnostics/v1/logs
Content-Type: application/json
Authorization: Bearer <user-access-token-or-device-token>
X-OneWorks-Team-Id: <team-id>
```

Only OTLP/HTTP JSON is supported, not protobuf or gRPC. Each request is limited to 1 MiB and 512 log records. Relay binds identity from the authenticated user and optionally an owned device; client-supplied user IDs are ignored. Without `X-OneWorks-Team-Id`, usage goes only to the current user's personal scope. Usage enters a team scope only when the header is explicit or the access token is team-scoped. Relay verifies active membership, rejects spoofed teams, and never double-counts one event in both personal and team scopes.

## Data and diagnostics controls

- **Data & Diagnostics** is the unified data-egress control surface. Diagnostics, performance, feature usage, and Model Service statistics are independent categories; the whole settings page is never named after one event family. **Model Service Statistics** is the first Relay-configurable category.
- Personal Model Service statistics default to on. After the Relay plugin is installed and signed in, the switch lives under **Account → Data & Diagnostics**. The tab is absent when Relay is disabled or the Relay Server exposes no configurable categories. When off, the app does not construct personal-scope `oneworks.model.usage` events or send them to the OTLP exporter.
- Relay delivers policy per team and shows it under **Account → Teams → specific team → Data & Diagnostics**. Each team has an independent policy. The member switch appears only when that team allows member choice; team owners/admins can change required versus member-optional reporting in that team detail.
- When signed in to Relay, the **Model Service Statistics** category under **Profile → Data & Diagnostics** syncs bidirectionally using preference update times to resolve multi-device changes. Relay remains a second enforcement boundary for older clients and independent collectors.
- Team reporting defaults to **required**, so members cannot turn it off. A team owner/admin can change the policy to **member optional**. Every member still defaults to on after that change, but may opt out for that team.
- A user's own Model Services are governed only by the personal preference and are never restricted by a team policy. Model Services downloaded from a Relay team carry that team's provenance and are governed only by that team's policy and the member's preference in that team; policies never bleed across teams.
- These controls govern numeric Model Service usage facts only; they do not change the separate product-diagnostics configuration.
- **System Diagnostics** defaults to on and lets the individual disable remote reporting. Bounded, content-free facts remain local for a user-initiated support bundle; when disabled, nothing is sent to Relay or another OTLP endpoint.

## JavaScript exceptions

Web and PWA capture React render failures, `window.error`, unhandled Promise rejections, and client bootstrap failures. Electron additionally captures main-process fatal exceptions and renderer-process exits. The same failure is deduplicated for five seconds, with at most 20 client exception reports per minute to contain error storms and cost.

Normalization happens before data leaves the capture process. The report retains only a stable failure code, safe error type, and a truncated SHA-256 fingerprint derived from the error type and stack shape. Messages, rejection values, stacks, URLs, file paths, and React component stacks never enter the local fact, IPC, HTTP request, or OTLP payload. Admin can group a failure class by fingerprint but cannot recover the source content from it.

Codex is a separate process, so the One Works app switch cannot rewrite Codex's own OTel configuration. Relay discards personal Codex usage when the Relay preference is off; to prevent the request from leaving the machine at all, also disable or remove the Codex exporter in `~/.codex/config.toml`.

## One Works OTLP configuration

Desktop and CLI support standard OTel environment variables:

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="https://relay.example.com/api/relay/diagnostics/v1/logs"
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_LOGS_HEADERS="authorization=Bearer%20<user-access-token>"
```

One Works selects personal versus team scope from the active Model Service provenance and adds a validated `x-oneworks-team-id` only for a team-provided service. Do not use one static team header that could misattribute a user's own service. A collector dedicated to exactly one team may still send the header explicitly.

`OTEL_EXPORTER_OTLP_ENDPOINT` is also supported and gets the standard `/v1/logs` suffix. Set `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` directly for Relay's custom path. Export failures never block Desktop startup or CLI commands.

## Connect Codex OTel to Relay

Put `otel` in the user-level `~/.codex/config.toml`; project `.codex/config.toml` files cannot change telemetry routing. Keep prompt export disabled:

```toml
[otel]
environment = "prod"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "https://relay.example.com/api/relay/diagnostics/v1/logs", protocol = "json", headers = { "authorization" = "Bearer owrt_REPLACE_WITH_ACCESS_TOKEN", "x-oneworks-team-id" = "TEAM_ID" } } }
```

This example targets a team scope. Omit `x-oneworks-team-id` for the personal scope.

Replace the example value directly with a Relay personal access token. Codex currently sends header values literally and does not expand `${ENV_VAR}` in this field.

Relay recognizes Codex API, SSE/WebSocket, conversation, tool-decision, and tool-result events, but retains only event names, status, duration, stable error types, and pseudonymous correlation IDs. Relay never persists the OTLP log body, even if an upstream producer includes prompt text or tool-result snippets there.

## Personal, platform, and team Model Service usage

Signed-in users can open the **Data & Diagnostics** tab at `/admin/profile/diagnostics` for personal cross-device aggregates, safe event details, and the Model Service statistics control. Team policy and the member preference for that team live in the corresponding team detail instead of being flattened into the personal page.

Platform owners/admins can open `/admin/model-usage` for requests, input/output/cached tokens, active teams, deduplicated active members, cache rate, P95 latency, daily trends, Model Service distribution, and team rankings across the platform. Filters cover team, member, Model Service, source, and time; they live in the URL; and a ranked team can be opened at `/admin/teams/:teamId/usage`.

Team owners/admins can see the same team-scoped metrics and member ranking only for their own team. Platform owners/admins can also open that team page. Both scopes can export the current safe filtered JSON, without prompt or response content.

One Works emits a `oneworks.model.usage` fact when a final assistant message is committed. Relay maps a Codex `codex.sse_event` with `event.kind=response.completed` to its input, output, cached tokens, and model. Only stable dimensions and numeric counters are accepted; prompts, responses, tool I/O, paths, configuration, and the raw log body are never retained. Session and client event IDs are hashed, and duplicate safe event IDs are deduplicated.

This is operational telemetry for adoption, capacity, performance, and incident analysis. It is not a provider billing statement and does not estimate currency. Provider invoices, quotas, and budgets remain the authority for settlement and financial controls.

## Admin analysis

Platform owners/admins can open `/data-dashboard/stability` to:

- view event count, anomalies, affected users, version/platform coverage, startup success rate, and startup P50/P95;
- filter by One Works/Codex, version, platform, outcome, category, time, event, stage, failure code, or exception fingerprint;
- open `/admin/users/:userId/diagnostics` for an ordered user timeline;
- use cursor pagination and replayable URL query filters.

The page displays only server-normalized facts and opaque device correlation IDs. It does not expose another user's device name, workspace, plugin scope, or local files.

## Local support bundles

Use `Help -> Export Diagnostic Support Bundle...` in Desktop, or:

```bash
oneworks report
oneworks report my-support-case
```

Desktop bundles include startup and JavaScript exception facts. CLI bundles include CLI and current-workspace Web/PWA JavaScript exception facts. Bundles otherwise contain diagnostic events, aggregate summaries, product version, and platform only. Event, operation, and session identifiers are truncated SHA-256 values. Raw logs, configuration, paths, prompts, credentials, stacks, tool inputs, and tool outputs are excluded. A valid empty bundle is created when no events exist.

## Retention and privacy boundary

Relay keeps 30 days and at most 10,000 events by default. Configure:

- `ONEWORKS_RELAY_DIAGNOSTICS_RETENTION_DAYS`
- `ONEWORKS_RELAY_DIAGNOSTICS_MAX_EVENTS`
- `ONEWORKS_RELAY_RATE_LIMIT_DIAGNOSTICS_INGEST_MAX`
- `ONEWORKS_RELAY_RATE_LIMIT_DIAGNOSTICS_INGEST_WINDOW_SECONDS`

Model Service usage keeps 90 days and at most 100,000 events by default. Configure:

- `ONEWORKS_RELAY_MODEL_USAGE_RETENTION_DAYS`
- `ONEWORKS_RELAY_MODEL_USAGE_MAX_EVENTS`

Do not add arbitrary `message`, `payload`, `stack`, `path`, `url`, `config`, or tool-I/O fields. Add stable enums, stages, or error codes when more context is required, and reassess cardinality, authorization, retention, and bundle redaction.
