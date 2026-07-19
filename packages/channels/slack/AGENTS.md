# Slack Channel Maintenance

This package implements the `slack` channel for Slack Socket Mode and Web API.

## Read First

- `README.md` for user-facing setup, token sources, runtime behavior, and troubleshooting.
- `src/types.ts` for config schema, message schema, and platform payload types.
- `src/connection.ts` for Socket Mode lifecycle, event normalization, and Slack API calls.

## Boundaries

- Keep Slack Socket Mode, Slack Web API payloads, token handling, and target encoding in this package.
- Keep server middleware generic. Thread-scoped channel ids should expose root-channel access control through `raw.accessChannelId`.
- Prefer built-in `fetch`, `FormData`, `Blob`, and `WebSocket`; add a Slack SDK only if protocol complexity materially increases.
- Do not log real Slack tokens or full message content.

## Platform API Usage

- `apps.connections.open` opens the Socket Mode WebSocket.
- `chat.postMessage` sends text replies.
- `files.upload` sends downloaded or local file payloads.
- `reactions.add` is used for source-message acknowledgement.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/slack/__tests__/slack-channel.test.ts
```

If shared channel access or command behavior changes too, also run the relevant `apps/server/__tests__/channels/**` tests.
