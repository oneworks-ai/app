# Telegram Channel Maintenance

This package implements the `telegram` channel for Telegram Bot API webhooks.

## Read First

- `README.md` for user-facing setup, public webhook exposure, runtime behavior, and troubleshooting.
- `src/types.ts` for config schema, message schema, and Bot API payload types.
- `src/connection.ts` for webhook validation, event normalization, and Telegram Bot API calls.

## Boundaries

- Keep Telegram webhook validation, Bot API methods, and target encoding in this package.
- The server route is always `/channels/:channelType/:channelKey/webhook`; do not introduce Telegram-specific server routes.
- Public callback URL construction should continue to use `serverBaseUrl` inherited from top-level `server.public` unless a channel explicitly overrides it.
- Topic-scoped channel ids should expose root-chat access control through `raw.accessChannelId`.
- Do not log real bot tokens, webhook secrets, or full message content.

## Platform API Usage

- `setWebhook` is optional and controlled by `autoSetWebhook`.
- `sendMessage` sends text replies.
- `sendDocument` sends downloaded or local file payloads.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/telegram/__tests__/telegram-channel.test.ts
```

If shared channel access, webhook routing, or command behavior changes too, also run the relevant `apps/server/__tests__/channels/**` tests.
