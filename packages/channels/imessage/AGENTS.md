# iMessage Channel Maintenance

This package implements the `imessage` channel as a local macOS Messages outbound bridge.

## Read First

- `README.md` for user-facing setup, permissions, capability boundaries, and Apple references.
- `src/types.ts` for config and outbound message schemas.
- `src/send.ts` for the AppleScript bridge and `osascript` process handling.
- `src/connection.ts` for channel lifecycle behavior.

## Boundaries

- Keep this package outbound-only until there is a stable, user-authorized inbound bridge.
- Do not add server webhook routes or claim iMessage has a cloud callback API.
- Do not read or poll `~/Library/Messages/chat.db` from the channel runtime; that database is private local user data and not a stable platform API.
- Do not log real phone numbers, emails, chat IDs, message text, or Apple Account identifiers.
- Do not store real contacts or message contents in tests or documentation.

## Platform API Usage

- Sending uses the local Messages AppleScript dictionary via `osascript`.
- Users must run on macOS with Messages configured and must approve Automation control of Messages for the invoking app or terminal.
- The default service type is `iMessage`. SMS/RCS are only used when explicitly configured.

## Tests

When changing this package, run:

```bash
npx vitest run packages/channels/imessage/__tests__/imessage-channel.test.ts
```
