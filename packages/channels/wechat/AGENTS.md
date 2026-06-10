# WeChat Channel Maintenance

This package implements the `wechat` channel for WechatApi.

## Read First

- `README.md` for user-facing configuration, token source, platform links, and public exposure notes.
- `src/types.ts` for config schema and message schema.
- `src/connection.ts` for channel lifecycle and callback auto-registration.
- `src/utils/api.ts` for WechatApi calls.
- `src/utils/webhook.ts` for callback validation and inbound normalization.

## Boundaries

- Keep platform-specific payload parsing and webhook secret validation in this package, not in `apps/server`.
- The server route is always `/channels/:channelType/:channelKey/webhook`; do not introduce WeChat-specific server routes.
- Public callback URL construction should continue to use `serverBaseUrl` inherited from top-level `server.public` unless a channel explicitly overrides it.
- Do not require users to add `/channels/*/*/webhook` to `server.publicPaths`; that path is a server default. Use `enableWebhook: false` to disable a specific channel webhook.
- Do not log real tokens, callback tokens, or webhook secrets. Redact callback URLs when logging.

## Platform API Usage

- `token` is the WechatApi `TokenId` copied from the API manager access-control area.
- Callback registration uses `/login/setCallback`; `callbackToken` falls back to `token`.
- Text replies use `/message/postText`.
- Keep the default API base URL aligned with the current WechatApi docs before changing it.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/wechat/__tests__/wechat-channel.test.ts
```

If server webhook routing or public access behavior changes too, also run:

```bash
npx vitest run apps/server/__tests__/routes/channel-webhooks.spec.ts apps/server/__tests__/middlewares/index.spec.ts apps/server/__tests__/channels/index.spec.ts
```
