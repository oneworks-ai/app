# Model protocol compatibility and Codex account pool

Status: implemented in the current worktree\
Reference revision: `router-for-me/CLIProxyAPI@f43aad7637ad813745bf7d341acb5663617570c5`\
Reviewed: 2026-08-12

## Goal

Make One Works model services declare their real upstream wire protocol, let Codex keep speaking the OpenAI Responses API while safely consuming four upstream protocol families, and let new Codex tasks select among official ChatGPT/Codex subscription accounts without mixing those accounts into `modelServices`.

The user-visible result is:

- Model Service settings can explicitly select OpenAI Responses, OpenAI Chat Completions, Anthropic Messages, Gemini GenerateContent, or Gemini Interactions as the upstream protocol.
- Codex can translate Responses requests, non-stream responses, and SSE streams for the first four protocol families. Gemini Interactions is represented in the shared contract but fails closed until its semantics are implemented.
- Codex account selection can show `Auto`, prefer a healthy high-priority official account, safely fall back before the first committed result, and then keep the selected physical account sticky for the task.

## Change Brief

### Problems

1. `modelServices` described providers, billing plans, endpoints, and adapter-specific hints, but had no canonical field for the model-call wire protocol. URL and `extra.*.wireApi` inference could not reliably distinguish Responses from Chat Completions and was duplicated across adapters.
2. Codex locally expects Responses semantics, while many useful upstream gateways expose Chat Completions, Anthropic Messages, or Gemini GenerateContent. Endpoint rewriting alone loses tools, reasoning, usage, stream ordering, and terminal status.
3. Official Codex subscription accounts are login identities with quota and session ownership, not API-key model services. Treating them as model-service profiles would combine two independent lifecycles and risk cross-account task continuation.
4. Existing multi-account selection had no safe boundary for automatic recovery. Request-level rotation after output or tool execution could replay work, duplicate side effects, or resume a thread under a different account.

### Non-goals

- Do not expose Codex subscription accounts as `modelServices` or make an account key look like an API key profile.
- Do not rotate accounts per request or in the middle of a committed task.
- Do not silently drop Responses controls, tools, content, structured-output constraints, reasoning signatures, usage, or upstream failure states.
- Do not claim Gemini Interactions conversion before request, non-stream, and stream semantics are all implemented and tested together.
- Do not vendor CLIProxyAPI Go sources or reproduce its complete proxy/runtime architecture inside One Works.

### Invariants

- Explicit `apiProtocol` wins. Existing configurations without it retain legacy adapter/provider/URL behavior.
- A collection profile inherits its parent protocol and may override it.
- Codex remains a Responses-speaking client; translation is an upstream transport concern and never rewrites Codex's native `wire_api` to Chat.
- Unsupported or ambiguous translated semantics fail with a bounded, user-visible error instead of being forwarded in a different meaning.
- Stream conversion is request-scoped, ordered, bounded, and cleans up the upstream reader/connection on failure.
- Explicit account selection never fails over. Resume continues with the persisted physical account.
- `disabled` removes an account from `Auto`; it does not make an explicit selection impossible.
- Automatic fallback is allowed only before the first assistant result, tool/file/web/MCP side effect, approval response, or terminal success has committed the initial turn.
- Runtime cooldown state is separate from account credentials and Relay-synchronized configuration. Credential fingerprint changes invalidate stale cooldown state.

## CLIProxyAPI reference assessment

The fixed reference revision was studied at these primary seams:

- Responses translator families under [`internal/translator/*/openai/responses`](https://github.com/router-for-me/CLIProxyAPI/tree/f43aad7637ad813745bf7d341acb5663617570c5/internal/translator), with separate request, non-stream response, stream response, and fixture coverage.
- Credential priority and availability in [`sdk/cliproxy/auth/selector.go`](https://github.com/router-for-me/CLIProxyAPI/blob/f43aad7637ad813745bf7d341acb5663617570c5/sdk/cliproxy/auth/selector.go).
- Session binding in [`sdk/cliproxy/auth/session_cache.go`](https://github.com/router-for-me/CLIProxyAPI/blob/f43aad7637ad813745bf7d341acb5663617570c5/sdk/cliproxy/auth/session_cache.go).
- Credential/model cooldown classification and storage in [`sdk/cliproxy/auth/conductor_cooldown.go`](https://github.com/router-for-me/CLIProxyAPI/blob/f43aad7637ad813745bf7d341acb5663617570c5/sdk/cliproxy/auth/conductor_cooldown.go) and `cooldown_state.go`.

### Adopt, adapt, and reject

| Reference idea                                           | One Works decision     | Reason                                                                                                                                            |
| -------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical Responses-centered translation star            | Adopt                  | Codex already supplies the canonical local protocol, and every upstream edge can be tested independently.                                         |
| Separate request, non-stream, and stream translators     | Adopt                  | A protocol is not supported if only its endpoint or buffered response is converted.                                                               |
| Request-scoped stream state and high-value fixtures      | Adopt                  | Tool argument deltas, output indexes, usage tails, signatures, and terminal ordering require state.                                               |
| Opaque carrier for provider reasoning signatures         | Adapt                  | One Works uses a versioned `owmp:v1:` carrier and only replays carriers it created; foreign encrypted content fails closed.                       |
| Highest healthy priority tier and model-scoped cooldown  | Adopt                  | It gives deterministic primary/backup behavior and avoids retrying a known-bad account immediately.                                               |
| Session affinity                                         | Adapt                  | The selected physical Codex account is persisted on the One Works task and runtime, which is stronger than request-derived affinity.              |
| Request-level round robin/fill-first                     | Reject for Codex tasks | A coding task owns thread context and side effects; rotating requests can cross account/thread boundaries.                                        |
| Fail over an unavailable bound credential at any request | Restrict               | One Works only retries the first uncommitted turn. Once committed, an error is surfaced without account migration.                                |
| Complete Go proxy/auth registry                          | Reject                 | Existing adapter, server-session, account, proxy, and UI seams already own those lifecycles. Duplicating them would add a second state authority. |

The implementation is an independent TypeScript rewrite. `packages/model-protocol/THIRD_PARTY_NOTICES.md` records the MIT design reference; no upstream source is vendored.

## Responsibility and impact map

```text
Model Service config/UI
  -> @oneworks/types protocol contract
  -> @oneworks/core schema
  -> @oneworks/utils explicit + legacy resolver / collection inheritance
  -> adapter protocol capability checks
  -> Codex local proxy
       -> @oneworks/model-protocol request translator
       -> protocol endpoint + authentication headers
       -> non-stream or request-scoped SSE translator back to Responses

Codex Account settings/login
  -> Codex account catalog + runtime health
  -> new-task sticky-priority candidate list
  -> initial-turn attempt controller
       -> winning physical account init
       -> server DB + cached runtime account
       -> later turns/resume use the same account
  -> chat Account selector Auto state
```

| Area               | Owner and change                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract    | `packages/types/src/model-service-protocol.ts` and `config.ts` define the optional five-value `apiProtocol`.                              |
| Validation         | `packages/core/src/config-schema.ts` validates the top-level field; runtime resolution rejects invalid explicit values.                   |
| Resolution         | `packages/utils/src/model-providers.ts` owns explicit-vs-legacy protocol resolution and collection profile inheritance.                   |
| Translation        | New `packages/model-protocol` owns only wire-format translation and has no endpoint, credential, retry, or account responsibility.        |
| Codex routing      | `packages/adapters/codex/src/runtime/proxy.ts` owns HTTP endpoints, headers, size limits, abort/cancel, and error projection.             |
| Codex accounts     | `accounts.ts` owns candidates, priority, disabled state, credential fingerprint, failure classification, cooldown, and account reporting. |
| Codex attempts     | `session.ts` and `stream.ts` own the uncommitted-first-turn retry boundary and resource cleanup.                                          |
| Server persistence | `apps/server/src/services/session/index.ts` persists the winning physical account and updates the active cached runtime.                  |
| Client             | Model Service configuration declares the protocol; the chat account selector represents `Auto` separately from physical accounts.         |
| Other adapters     | Pi, OpenCode, Gemini, Copilot, Kimi, and Claude Code resolve collection profiles and either map supported protocols or fail closed.       |
| Sync and docs      | Relay keeps the new declarative fields; runtime cooldown is excluded. Chinese and English usage docs describe both features.              |

## Abstraction decisions

### New `@oneworks/model-protocol`

Decision: new shared package.

Evidence: Codex needs the same canonical request/non-stream/stream semantics across three translated upstream families, while existing Claude CCR and Gemini proxy helpers are adapter-coupled and do not provide a tested Responses lifecycle. `packages/utils` explicitly does not own protocol translation, and `runtime-protocol` owns task/session JSONL rather than model APIs.

The primary public entry points are:

```ts
translateResponsesRequest({ target, request })
translateResponseToResponses({ source, response, requestId, reasoningSummary })
createResponseStreamTranslator({
  source,
  requestId,
  reasoningSummary,
  maxInputBytes
})
```

### Extend `ModelServiceConfig`

Decision: extend the existing model-service contract with optional `apiProtocol`; do not introduce another provider record.

Evidence: protocol is an attribute of the model-call endpoint. It is independent of `codingPlan.protocols`, which describes plan-specific OpenAI/Anthropic base URLs and cannot distinguish Responses from Chat Completions.

### Reuse adapter accounts

Decision: extend Codex's existing official-account schema with `priority`, `disabled`, and `accountPool`; do not create model-service profiles or a second account database.

Evidence: existing account descriptors already own Codex auth, quota, source, stable identity, and physical HOME preparation. Server tasks already persist an account key.

### Keep HTTP orchestration in the Codex proxy

Decision: keep endpoint construction, auth headers, request caps, logging, abort, and upstream reader cleanup in `runtime/proxy.ts`.

Evidence: these responsibilities depend on adapter network/profile metadata and are not wire translation. Moving them into the shared package would couple it back to Codex.

## Protocol execution plan

### Phase 1: declare a canonical protocol

1. Add `ModelServiceApiProtocol` with:
   - `openai-responses`
   - `openai-chat-completions`
   - `anthropic-messages`
   - `gemini-generate-content`
   - `gemini-interactions`
2. Add optional `ModelServiceConfig.apiProtocol` to types, Zod schema, form schema, translations, Relay allowlists, docs, and tests.
3. Resolve protocol in one helper with the order: explicit field, legacy adapter hints, then endpoint inference.
4. Preserve a separate explicit-only helper where an adapter's historic provider route must not be changed by URL inference.
5. Inherit the field from collection to profile, with child override.

### Phase 2: build the Responses translation star

Implement and test every supported edge as a unit:

| Upstream                | Request                                       | Non-stream back to Responses                  | SSE back to Responses                                            | Endpoint                                  |
| ----------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| OpenAI Responses        | Deep-copy pass-through in the translation API | Deep-copy pass-through in the translation API | Native proxy byte-stream pass-through                            | `/responses`                              |
| OpenAI Chat Completions | Messages/tools/format/controls                | Message, calls, usage, finish reason          | Text/tool deltas, usage tail, terminal lifecycle                 | `/chat/completions`                       |
| Anthropic Messages      | System/content/tools/thinking                 | Text/tool/thinking/signature/cache usage      | Typed events, block indexes, signature, terminal lifecycle       | `/messages`                               |
| Gemini GenerateContent  | Contents/system/tools/thinking                | Parts/calls/thought signature/usage           | Incremental chunks, calls, thought signature, terminal lifecycle | `models/{model}:{stream,}GenerateContent` |
| Gemini Interactions     | Reject                                        | Reject                                        | Reject                                                           | None until the full edge exists           |

Required semantic coverage:

- Text, data-URL and remote images.
- Multiple parallel function calls and adjacent tool results.
- Function argument JSON validation on successful terminal states.
- JSON Schema structured output where the target has an equivalent.
- Reasoning effort/summary controls and provider signature round-trip.
- Input, output, cached, reasoning, and total token usage.
- Normal completion, truncation/incomplete, safety/protocol failure, and upstream error.
- Monotonic Responses `sequence_number`, stable `output_index`, usage tail before terminal, and exactly one `[DONE]`.
- CRLF and arbitrary transport chunk boundaries, concurrent request isolation, and bounded input/state.

Fail-closed rules:

- Reject built-in/non-function tools, audio, files, heterogeneous response content, foreign reasoning carriers, and malformed tool blocks.
- Preserve supported Chat controls such as sampling, retention, parallel tools, strict function schema, service tier, metadata, and identifiers.
- Reject controls that have no reliable equivalent on the selected target, including unknown Responses controls.
- Never translate a truncation or safety stop into `completed`; partial tools must not emit a successful arguments-done event.

### Phase 3: integrate the Codex proxy

1. Keep Codex's local provider wire API as Responses.
2. Carry the resolved upstream protocol in private proxy metadata.
3. Normalize a configured base URL, build the target endpoint, and set target-specific authentication:
   - Bearer for OpenAI-compatible services.
   - `x-api-key` plus `anthropic-version` for Anthropic.
   - `x-goog-api-key` for Gemini.
4. Translate request JSON before fetch and translate successful response JSON/SSE back to Responses.
5. Keep the native Responses proxy path as a byte-stream pass-through; apply encrypted-reasoning request preparation before forwarding, while preserving only One Works reasoning carriers long enough for translated targets to replay them.
6. Enforce an 8 MiB request limit for translation and a 16 MiB input limit on translated buffered/SSE responses. Native Responses output remains streaming pass-through and does not accumulate conversion state.
7. On conversion failure, cancel the reader, abort upstream, and emit a sequenced Responses failure lifecycle.
8. Handle `/models` locally so Responses-only or non-OpenAI upstreams are not probed with an incompatible endpoint.

### Phase 4: implement the official Codex account pool

Configuration:

```yaml
adapters:
  codex:
    defaultAccount: work
    accountPool:
      enabled: true
      strategy: sticky-priority
      cooldownMs: 300000
    accounts:
      work:
        priority: 100
      personal:
        priority: 50
      paused:
        disabled: true
```

Selection and retry state machine:

```text
new task + no explicit account + pool enabled
  -> collect enabled physical Codex accounts
  -> remove active cooldowns for (workspace, account, model, credential fingerprint)
  -> sort by priority, default-account tie break, stable key
  -> start candidate with outward init buffered
       -> recoverable account failure before commitment
            -> record cooldown and release attempt resources
            -> try next candidate
       -> first assistant/tool/file/web/MCP/approval/success commitment
            -> emit exactly one init with winning physical account
            -> disable failover for the task
  -> persist winning physical account in task DB and active runtime cache
  -> resume/later turns use that account only
```

Failure classification includes recognizable authentication, subscription/quota, rate-limit, and bounded transient service failures. Request/configuration errors, cancellation, explicit account selection, direct mode, resume, and any committed attempt do not switch accounts. Every classified failing candidate, including the last one, is cooled down.

Cooldown is process/runtime state, bounded to 512 entries, visible through the account API, and keyed by credential fingerprint so reauthentication releases stale health state. It is deliberately not Relay-synchronized or written into account credential configuration.

### Phase 5: migrate all model-service consumers

1. Make Codex, Pi, OpenCode, Gemini, Copilot, Kimi, and Claude Code resolve flattened collection/profile keys.
2. Let each adapter map only protocols its native runtime can faithfully express.
3. Fail closed for explicit unsupported protocols instead of silently treating them as OpenAI-compatible.
4. Preserve provider-specific subtypes that carry additional capability within the same wire protocol, such as Kimi/Moonshot Chat plus search/fetch services.
5. Preserve legacy provider inference when `apiProtocol` is absent.
6. Migrate Codex `wire_api` imports into the new top-level field without changing Codex's local Responses contract.

### Phase 6: UI, synchronization, and documentation

1. Add the protocol selector to Model Service Access settings with an `Infer` option plus five explicit values.
2. Use protocol-specific placeholder text in desktop popup and mobile drawer.
3. Add chat `Auto` as a sentinel UI selection that may be saved only as a local UI preference; send no physical account key and never persist the sentinel in server task/account state.
4. Show Auto meaning, physical accounts, quota, and settings actions without losing the existing mobile drawer behavior.
5. Synchronize declarative `accountPool`, `priority`, `disabled`, and `apiProtocol`; exclude cooldown.
6. Document Chinese and English configuration, the distinction between official accounts and model services, supported conversions, and fail-closed boundaries.

### Phase 7: derive Codex-account models for other adapters

1. Keep `shareBuiltinModels` on the Codex adapter as the single opt-in switch. Do not persist an API host, port, protocol, token, or a synthetic Codex account under `modelServices`.
2. Add the reverse Responses star needed by callers: Chat, Anthropic, and Gemini request histories become canonical Responses items; canonical output becomes the caller protocol. The first runtime facade is OpenAI Chat Completions because every supported managed adapter already has a verified Chat-compatible route.
3. Materialize one reserved `oneworks-codex` service only in config responses and cloned task runtime state. The UI descriptor contains model ids and adapter compatibility; the task copy receives a loopback PM URL and a process-random bearer capability. Never expose that capability in config GET, persistence, argv, or logs.
   Adapter-specific generated files must keep the bearer and materialized loopback URL as environment placeholders. A one-way fingerprint may be persisted solely to restart a reused daemon after runtime capability rotation; the raw values remain process-local and generated files stay private (`0600`).
4. Execute canonical requests through the installed official `codex app-server`: create an ephemeral thread in an account-bound isolated home, register caller-provided function tools as `dynamicTools`, inject the complete Responses history, and enable raw Responses events. Disable native shell, browser, apps, plugins, computer use, image generation, and sub-agents.
5. When app-server requests `item/tool/call`, interrupt the native turn and return a canonical `function_call` with the original `call_id`. The caller adapter executes the function, then supplies the function result in its next full-history request. This preserves caller tool ownership without calling ChatGPT private endpoints or impersonating the official Codex client.
6. Reuse Codex Auto candidates for the source account. Retry only classified credential/plan/rate-limit/transient failures before a response is returned; explicit source-account execution never changes accounts. Bound request/response size, item count, execution time, and app-server lifecycle.
7. Keep the raw official-client WebSocket bridge as a separate compatibility surface under the same switch; it is not the adapter-facing executor.

### Phase 8: verification and rollout

The feature is backward-compatible by default:

- `apiProtocol` is optional; old entries keep existing inference.
- `accountPool.enabled` is opt-in; old explicit/default-account behavior remains.
- No database migration is required. The winning account uses the existing task account field.
- Removing `apiProtocol` returns a service to legacy inference. Disabling `accountPool` returns selection to the existing physical/default account flow.

Rollout should stop if a target protocol cannot preserve a hard semantic constraint, a task can change accounts after commitment, a stale failed attempt can overwrite the active session, or the active runtime and persisted physical account diverge.

## Acceptance matrix and current evidence

| Requirement                                                               | Authoritative evidence                                                                           | Result |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Five-value config contract, schema, UI, i18n                              | `model-service-protocol.ts`, core/config form tests, desktop and 390 px real UI                  | Pass   |
| Collection inheritance and legacy inference                               | utils model-service and selection tests; adapter collection consumers                            | Pass   |
| Four complete Codex upstream families                                     | `packages/model-protocol/__tests__`; Codex proxy integration tests                               | Pass   |
| Tools, structured output, reasoning/signatures, usage, terminal semantics | Request/non-stream/SSE fixtures, including cross-turn carrier replay through the real proxy      | Pass   |
| Bounded/clean stream failure                                              | byte-limit, malformed SSE, sequencing tests; proxy reader cancel/abort path                      | Pass   |
| Official account Auto semantics                                           | client Auto tests and real desktop/mobile selector execution                                     | Pass   |
| Sticky priority and safe initial failover                                 | Codex account/session pool tests, including async race and last-candidate failures               | Pass   |
| Persist winning physical account                                          | server session implementation plus independent cross-layer review                                | Pass   |
| No silent unsupported adapter routing                                     | Pi/OpenCode/Gemini/Copilot/Kimi/Claude targeted tests                                            | Pass   |
| Relay and bilingual documentation                                         | Relay normalization/assignment tests and `.oo/docs/{,en/}usage`                                  | Pass   |
| Other adapters can consume Codex account models                           | reverse-ingress fixtures, PM route, runtime materialization, official app-server text/tool smoke | Pass   |

Current revision gates:

- `pnpm --filter @oneworks/model-protocol test`: all current protocol tests passed.
- Targeted cross-layer Vitest gates for protocol, adapters, configuration, client, server, and Relay passed.
- `pnpm typecheck`: all bundler, web, node, and test scopes passed.
- Changed TypeScript/TSX ESLint, changed-file dprint, `git diff --check`, and `@oneworks/model-protocol` build passed.
- Independent code review is a required pre-merge gate for the complete current revision.
- Independent real UI review passed the protocol selector on desktop/mobile and Codex Auto on mobile and a 280 px desktop popup without horizontal overflow. Temporary account-pool changes were restored afterward.

## Known boundaries and follow-up criteria

- Gemini Interactions is a declared protocol identity but not a conversion edge. Implement it only when request, non-stream, stream, tool, reasoning, usage, and error fixtures can land together.
- Audio, files, built-in non-function tools, and target-specific controls without an equivalent remain explicit conversion errors. Add a feature only with round-trip semantics, not with a lossy field drop.
- Cooldown currently has process lifetime. Persistent cooldown may be added in a separate design if restart storms become an observed problem; it must remain separate from credentials and cross-device config sync.
- Automatic account selection is intentionally new-task-only. Supporting account migration for an established task would require a separately reviewed thread/context transfer contract and side-effect idempotency proof.
- The adapter-facing facade currently accepts automatic function-tool choice and full-history continuation. Forced/required/none tool choice and public `previous_response_id` storage remain fail-closed until an opaque, account-bound continuation store is implemented.
- CLIProxyAPI continues to evolve. Future ports must compare against a pinned upstream revision, preserve MIT attribution, and pass One Works-specific session/account invariants rather than copying current-main behavior blindly.
