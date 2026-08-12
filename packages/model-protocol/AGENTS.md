# Model Protocol Package

`@oneworks/model-protocol` owns wire-format translation only. Its egress path
accepts an OpenAI Responses request, produces one explicit upstream format,
then turns that upstream format back into Responses JSON or Responses SSE
events. Its ingress path normalizes Chat, Anthropic, or Gemini requests into
Responses and translates completed Responses results back to the caller format.

## Boundaries

- Keep each converter request-scoped. Stream state must never be shared across requests.
- Add a format by registering its request, response, and stream conversion together.
- Unsupported semantic features must throw `UnsupportedProtocolFeatureError`; never silently drop tools, content, or structured-output constraints.
- This package does not choose credentials, endpoints, accounts, retries, or provider models.

## Validation

Run `pnpm --filter @oneworks/model-protocol test` and `pnpm --filter @oneworks/model-protocol exec tsc -p tsconfig.json` after changes.
