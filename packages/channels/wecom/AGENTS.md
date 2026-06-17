# WeCom Channel Maintenance

This package implements the `wecom` channel for WeCom enterprise applications.

## Read First

- `README.md` for supported platform scope, configuration, callback setup, and official links.
- `src/types.ts` for config and outbound message schemas.
- `src/connection.ts` for channel lifecycle and handler wiring.
- `src/utils/webhook.ts` for WeCom callback signature verification, AES decrypt, XML parsing, and inbound normalization.
- `src/utils/api.ts` for access token caching and WeCom send APIs.

## Boundaries

- Keep WeCom-specific payload parsing, `msg_signature` verification, and AES decrypt logic in this package, not in `apps/server`.
- The server route remains `/channels/:channelType/:channelKey/webhook`; this package handles both WeCom GET URL verification and POST message callbacks through that path.
- This MVP supports enterprise application callbacks plus enterprise application outbound messages. Do not claim group robot inbound support; WeCom group robots are webhook-send only.
- Do not log `corpSecret`, callback `token`, `encodingAesKey`, `access_token`, or full encrypted callback payloads.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/wecom/__tests__/wecom-channel.test.ts apps/server/__tests__/routes/channel-webhooks.spec.ts
```
