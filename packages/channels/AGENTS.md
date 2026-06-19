# Channel Packages

This directory contains platform channel packages named `@oneworks/channel-<type>`.

## Package Shape

- `src/types.ts`: Zod config and outbound message schemas plus platform payload types.
- `src/index.ts`: exports `channelDefinition` and augments `@oneworks/core/channel` `ChannelMap`.
- `src/connection.ts`: implements platform send/receive behavior and normalizes inbound messages to `ChannelInboundEvent`.
- `README.md`: user-facing setup, token/source notes, runtime behavior, and troubleshooting for that platform.
- `AGENTS.md`: package-specific maintenance boundaries and focused verification commands.
- `__tests__/`: focused connection tests for platform payload normalization and outbound API calls.

## Boundaries

- Keep platform-specific API calls, webhook secret checks, socket payload parsing, and target encoding inside the package.
- Server-side code should stay generic; only add server middleware helpers when several channel packages need the same binding/access semantics.
- When a platform binds sessions more narrowly than its access-control surface, put the broad id in `raw.accessChannelId`. Examples: Slack threads use `C123#thread=...` for session binding but `C123` for access checks; Telegram topics use `chatId#thread=...` for binding but `chatId` for access checks.
- For webhook-first providers such as WeCom, QQ Channel, Telegram, and SMS, keep provider signature/secret validation in the package and reuse the shared `/channels/:channelType/:channelKey/webhook` route.
- Current outbound messages may include `toolCallSummary`. Channel packages should accept the field and render it inside the package, either as platform text or a richer native surface, instead of changing server middleware.
- Prefer built-in `fetch`, `FormData`, `Blob`, and `WebSocket` when the platform API is simple enough; add SDK dependencies only when they remove real protocol complexity.
- Do not log real bot tokens, app tokens, webhook secrets, or channel message content beyond short previews.

## Verification

When changing one channel package, run its focused test file first:

```bash
npx vitest run packages/channels/<type>/__tests__/<type>-channel.test.ts
```

If shared channel middleware or config definitions change, also run the relevant `apps/server/__tests__/channels/**` tests and client config tests.
