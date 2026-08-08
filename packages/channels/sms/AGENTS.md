# SMS Channel Maintenance

This package implements the `sms` channel for Twilio Programmable Messaging.

## Read First

- `README.md` for user-facing setup, webhook URL notes, runtime behavior, and troubleshooting.
- `src/types.ts` for config and outbound message schemas.
- `src/connection.ts` for Twilio REST sending, webhook parsing, and signature validation.

## Boundaries

- Keep Twilio signature validation, REST paths, and form payload parsing in this package.
- The server route is always `/channels/:channelType/:channelKey/webhook`; do not introduce SMS-specific server routes.
- Do not log real Twilio auth tokens or full SMS content.
- MMS media is currently summarized as text. Add download/caching only inside this package when needed.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/sms/__tests__/sms-channel.test.ts
```

If shared webhook routing changes too, also run `apps/server/__tests__/routes/channel-webhooks.spec.ts`.
