# Discord Channel Maintenance

This package implements the `discord` channel for Discord Gateway and REST APIs.

## Read First

- `README.md` for user-facing setup, bot token notes, runtime behavior, and troubleshooting.
- `src/types.ts` for config schema, message schema, and Gateway payload types.
- `src/connection.ts` for Gateway lifecycle, event normalization, and Discord REST calls.

## Boundaries

- Keep Discord Gateway opcodes, REST paths, multipart payloads, and message-content decisions in this package.
- Keep server middleware generic. Discord currently uses the platform channel id directly for binding and access checks.
- Prefer built-in `fetch`, `FormData`, `Blob`, and `WebSocket`; add a Discord SDK only if protocol complexity materially increases.
- Do not log real Discord bot tokens or full message content.

## Platform API Usage

- Gateway identify subscribes to guild messages and direct messages.
- `POST /channels/{channel.id}/messages` sends text and file replies.
- `POST /channels/{channel.id}/typing` is used for acknowledgement.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/discord/__tests__/discord-channel.test.ts
```

If shared channel access or command behavior changes too, also run the relevant `apps/server/__tests__/channels/**` tests.
