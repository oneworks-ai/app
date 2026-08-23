# Lark Channel Maintenance

This package implements the `lark` channel for Feishu / Lark bot apps.

## Read First

- `src/types.ts` for the channel config schema and inbound message types.
- `src/connection.ts` for SDK client setup, message receive handling, and outbound sends.
- `src/utils/parse.ts` for inbound text / rich-text normalization.
- `src/utils/tenant-token.ts` and `src/utils/open-api.ts` for low-level OpenAPI helpers.
- `src/mcp/` for the session-scoped companion tools exposed to channel-launched agents.
- `DEBUGGING.md` for browser / Lark messenger verification workflows.

## Boundaries

- Keep Lark-specific payload parsing, SDK usage, and OpenAPI calls in this package, not in `apps/server`.
- The channel route remains the generic `/channels/:channelType/:channelKey/webhook` when HTTP callbacks are involved.
- Do not log real app secrets, tenant tokens, user access tokens, or webhook verification payloads.
- User-facing setup details belong in `.oo/docs/usage/channel-platforms.md`; internal debugging notes belong in `DEBUGGING.md` or `debugging/`.

## App Setup Notes

- `appId` and `appSecret` must belong to the bot app that One Works should listen and reply as. Do not use a personal `lark-cli` test app for a production or demo channel unless that app is intentionally the channel bot.
- A fully connected role-bot matrix needs one channel connection key and credential pair per bot app. Create one ChannelLink for every bot-app/chat binding, reuse the same entity across that role's chats, and never point one channel key at different entities.
- Configure Feishu Open Platform self-built apps and their Bot capability for this channel. Do not use the `open.feishu.cn/page/launcher` intelligent-agent app flow for channel bots.
- Use the dedicated `lark-cli` profile `owo-cli` for this repository's OneWorks CLI-side chat/contact/admin operations. On a new machine or organization, confirm it with `lark-cli auth status --profile owo-cli --json`; do not infer identity from the active profile. Channel bot app profiles are only for their own bot credentials or bot-sent verification.
- Configure Events and Callbacks to receive events through persistent connection, and subscribe to `im.message.receive_v1`. Treat a connected WS client as transport readiness only; group-message delivery also depends on the published event subscription.
- Resolve the current bot `open_id` from `/open-apis/bot/v3/info` before registering the event dispatcher. Group ingress must use the structured mention target and fail closed when a message mentions a different bot; rendered `<at>` text alone is not enough in multi-bot chats.
- External group support is a published-version setting in the Feishu Open Platform. Saving a draft is not enough; the version must be released and approved before the bot can be added to external groups.
- Permission, event-subscription, icon, name, and external-group setting changes are effective only after the relevant published version is live.
- Avatar image URLs should come from exported SVG, PNG, or GIF files. `https://oneworks.cloud/avatar/` is an editor/export UI, not a direct image endpoint; applications that render definitions directly should use the public 3D runtime packages.
- `open_id` values are app-scoped. Re-resolve admin and external member IDs after switching the channel app or CLI profile.
- A bot profile reporting `ready` only proves that local credentials exist. Exercise a real bot API before trusting the secret; synchronize a known-good secret through `lark-cli config init --app-secret-stdin` rather than exposing it in argv.
- When the channel bot lacks member-read scope, capture a known real inbound message to recover that app's sender `open_id`; never copy an admin `open_id` from the CLI app profile.
- Reusing one entity across multiple ChannelLinks currently shares the role definition and prompt. Do not claim cross-chat learned memory unless the memory resolver and writeback path have been implemented and verified separately.
- When using `lark-cli` for external chat operations, pass `--profile` explicitly. The caller app also needs external-group capability; otherwise member operations can fail even when the invited bot is configured correctly.
- To inventory enterprise self-built apps without guessing App IDs, grant the dedicated CLI app `admin:app.info:readonly`, publish it, then query `GET /open-apis/application/v6/applications`. Keep this administrative scope on the CLI app, not on every role bot.
- Before creating external chats, inviting external members, or sending messages on behalf of a user, list the proposed chats, bots, external people, and purpose for the user and wait for confirmation.
- After changing channel credentials, verify the configured channel key, `appId`, matching secret, `allowedGroups`, server restart/reconnect, and a real user-message inbound loop. A bot self-send and a connected WebSocket log are not enough.

## Browser Automation Notes

- When the user explicitly mentions `@chrome`, use the Codex Chrome plugin first against the existing logged-in Chrome state. Do not default to Computer Use, CLI, or `osascript`.
- Prefer Codex Chrome / Browser / Computer Use tools against the existing logged-in web session. Do not use `osascript` to open or steer Open Platform pages unless the browser tools have clearly failed and the user has approved a fallback.
- Feishu Open Platform pages are SPAs and may briefly show a blank or dark content area. Wait for URL, title, and main content state to settle before declaring the page unusable.
- If the Chrome plugin reports `native pipe is closed`, follow the plugin troubleshooting path: retry a lightweight tab listing once, check Chrome / extension / native host state, then open a same-profile Chrome window only after user approval.
- On heavy Open Platform pages, avoid full-page DOM snapshots as the first move. Use small state reads or `dom_cua.get_visible_dom()` + `dom_cua.click({ node_id })` for buttons such as `保存` and `确认发布`.
- Use the desktop Feishu app only as an explicit fallback when the web messenger editor cannot be operated reliably.

## Tests

When changing core channel behavior, run:

```bash
npx vitest run packages/channels/lark/__tests__/lark-channel.test.ts
```

When changing companion MCP behavior, run the relevant `packages/channels/lark/__tests__/lark-mcp*.test.ts` files.
