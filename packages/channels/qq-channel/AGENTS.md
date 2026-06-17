# QQ Channel Maintenance

This package implements the `qq-channel` channel for QQ Channel scenarios on the official QQ Bot API.

## Read First

- `README.md` for platform limits, credentials, webhook configuration, and public exposure notes.
- `src/types.ts` for config and outbound message schemas.
- `src/connection.ts` for channel lifecycle.
- `src/utils/api.ts` for AccessToken and message send calls.
- `src/utils/webhook.ts` for Ed25519 validation and inbound event normalization.

## Boundaries

- Keep QQ-specific payload parsing, signature validation, and API response handling in this package.
- Server route remains `/channels/:channelType/:channelKey/webhook`; do not add QQ-specific routes.
- This package targets QQ Channel text subchannels and channel DMs. Do not document ordinary QQ C2C or QQ group chat as supported here unless the implementation explicitly adds those event families.
- Webhook signature validation depends on raw HTTP body bytes. If changing server webhook routing, preserve `ChannelWebhookRequest.rawBody`.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/qq-channel/__tests__/qq-channel.test.ts
```

If server webhook routing changes too, also run:

```bash
npx vitest run apps/server/__tests__/routes/channel-webhooks.spec.ts
```
