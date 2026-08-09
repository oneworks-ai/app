# Channel Platform Integrations

This page covers platform-specific setup for Lark, OneWorks Native, and WeChat. See [Channel Session Binding](./channels.md) for shared session, authority, command, and channel-link semantics.

## Lark Channel Example

The Lark / Feishu channel connects through a self-built app with the bot capability enabled:

```json
{
  "channels": {
    "lark:team": {
      "type": "lark",
      "appId": "cli_xxx",
      "appSecret": "replace-with-app-secret",
      "domain": "Feishu",
      "access": {
        "allowGroupChat": true,
        "allowedGroups": ["oc_xxx"],
        "admins": ["ou_xxx"]
      }
    }
  }
}
```

Setup notes:

- Create a custom app in the Feishu Open Platform and enable the bot capability; do not use the Feishu intelligent-agent / AI Agent / Miaoda app entry.
- For role bots that only receive explicit group mentions, grant `im:message`, `im:message:send_as_bot`, and `im:message.group_at_msg.include_bot:readonly`. If a CLI or OpenAPI workflow will manage chat members, grant IM chat-member scopes such as `im:chat.members:write_only`, `im:chat:read`, and `im:chat:update` to the app used for that operation.
- In Events and Callbacks, set the subscription mode to persistent connection and subscribe to the message receive event `im.message.receive_v1`; the saved subscription must still be published before it affects the live app. A startup log such as `[channels] channel connected` only means the persistent-connection client is connected; real group-message delivery still depends on the published event subscription.
- To add the bot to external chats, enable external-chat sharing on the version publishing page, submit the version, and wait for admin approval. Drafts and pending reviews do not affect the live app. Permission, event-subscription, icon, name, and external-chat setting changes should be treated as live only after the published version takes effect.
- Configure `appId` / `appSecret` for the bot that One Works should actually listen and reply as. Do not accidentally use a personal CLI test app. When a room contains several role bots for demos, usually only one service bot is configured in the One Works channel; the other role bots are just Feishu chat members.
- `access.allowedGroups` contains Feishu chat IDs (`oc_...`). `access.admins` contains user `open_id` values as seen by this exact app; the same person can have different `open_id` values across apps. Resolve these IDs from the same channel bot app's perspective.

Integration lessons:

- Keep the channel bot app separate from the CLI operator app. The channel config `appId` / `appSecret` should belong to the bot that listens and replies. Chat creation, member management, contact lookup, and user-sent test messages should use one fixed `lark-cli --profile`; do not rely on whatever profile is currently active. If status reports `needs_refresh` while `offline_access` and an unexpired refresh token remain, the next user-identity API call can usually refresh without another scan.
- For a role-bot matrix demo, multiple bots can be added to the same chats as members, but usually only one service/demo bot should be connected to the One Works channel to keep credentials, event subscriptions, and reply identity clear. If every role must reply independently, give each bot app its own channel key and `appId` / `appSecret`; reuse the same entity across chats, create one ChannelLink per `bot app × chat`, and never reuse one channel key across different entities.
- In a multi-bot chat, a structured mention triggers only the named bot, while a mention of another bot fails closed. A slash command with no mention still follows the ChannelLink `createOnCommand` setting; if several bots enable that entry point, one bare command may reach more than one bot. Disable `createOnCommand` where it is unnecessary, or enable it only after implementing an explicit "group commands must mention the current bot" policy.
- Multiple ChannelLinks for one entity reuse its role definition and prompt, but do not automatically provide learned memory across chats. Entity-scoped memory loading and writeback must be implemented and verified separately.
- External-chat setup has three moving parts: the target chat is external, the bot's published version allows external chats, and the CLI app performing member operations also has the required external-chat capability. Configuring only the invited bot is not enough; confirm the chat is really external after creation, and dissolve/recreate it if it was mistakenly created as an internal chat. If member management returns `232033`, first check the external-chat capability of the app behind the current CLI profile.
- To inventory enterprise self-built App IDs in bulk, grant the dedicated CLI app `admin:app.info:readonly`, publish it, and call `GET /open-apis/application/v6/applications`. Keep that administrative read scope on the CLI operations app instead of copying it to every role bot.
- After editing the project's channel config, the running server may still hold the previous persistent connection. Do not connect one bot app from stale worktrees or leftover servers either, because Feishu may deliver an event to any active connection. Use `pnpm --silent tools dev-service status <target> --json` to identify the owner, stop the stale target only with its authorization, then restart or confirm reconnection before testing real inbound messages.
- The Web launcher manager server must not initialize workspace channels. The channel connection, runtime watcher, and resume scheduler should be owned by the same workspace server; otherwise the manager can claim inbound deduplication before the process that actually executes the session sees the event.
- Automatically created channel sessions need an explicit, executable default adapter and model. If the project contains mock model services for tests, do not rely on the first-model fallback; set `defaultAdapter` / `defaultModel` in user or private configuration and verify that the session uses the intended model and reaches `completed`.
- Verify the loop in two steps: first send a bot message to confirm `appId` / `appSecret` and `im:message` work; then have a real user explicitly mention that bot in the target chat to confirm the structured mention, persistent event, `allowedGroups`, session dispatch, and reply. Also confirm that the other bots in the same chat do not trigger. Do not treat a bot self-send as an inbound-message test; a bot-sent message plus a connected server log is not a full inbound-message loop.

Troubleshooting:

- `https://oneworks.cloud/avatar/` is a preview/export page, not a direct image URL. Export a real image or generate a PNG/JPEG with the project's avatar tooling, then upload it. Automation can first call `POST /open-apis/application/v7/app_avatar/upload`, then `PATCH /open-apis/application/v7/applications/:app_id/base` to set `avatar_url`; this requires `application:application:patch`, and publication plus approval before it is live.
- Always pass the intended `lark-cli --profile`. The active profile may point at another company or a different test app.

## OneWorks Native Channel

One Works includes a first-party `oneworks` channel type for product rooms, demo spaces, and local simulation. It is a real channel implementation and does not call agents directly; inbound events still pass through ChannelLink, identity, command handling, availability, ingress, child sessions, and permission audit.

Declare the platform connection in `.oo.config.json`:

```json
{
  "channels": {
    "oneworks-main": {
      "type": "oneworks",
      "title": "OneWorks Native",
      "webhookSecret": "replace-with-dev-secret"
    }
  }
}
```

Bind a room to an entity in `.oo/channels/demo-room/channel.json`:

```json
{
  "channel": "oneworks-main",
  "entity": "demo-agent",
  "external": {
    "type": "room",
    "roomId": "demo-room"
  },
  "ingress": {
    "ambientRouting": false,
    "mentionPatterns": ["@OWO"]
  }
}
```

For local simulation, prefer the CLI native inbound injector:

```bash
oneworks channel oneworks-main simulate \
  --room demo-room \
  --sender user-demo \
  --message-id sim-1 \
  --secret replace-with-dev-secret \
  "@OWO hi"
```

Structured payloads are supported too:

```bash
oneworks channel simulate --channel oneworks-main \
  --secret replace-with-dev-secret \
  '{ "roomId": "demo-room", "senderId": "user-demo", "text": "@OWO hi" }'
```

When the command runs inside a OneWorks native channel session, `simulate` reuses the current context `channelKey`, `senderId`, and group `roomId`, so `oneworks channel simulate "@OWO hi"` is enough. It does not reuse channel keys from Lark, WeChat, or other non-native channel contexts; pass `--channel` explicitly there.

The CLI posts to the standard webhook route and signs the raw body with a timestamp, nonce, and HMAC SHA-256. For raw HTTP debugging, reproduce the same signing input:

```bash
secret='replace-with-dev-secret'
body='{"roomId":"demo-room","senderId":"user-demo","messageId":"sim-1","text":"@OWO hi"}'
timestamp="$(node -p 'Date.now()')"
nonce="$(uuidgen)"
signature="sha256=$(printf '%s\n%s\n%s' "$timestamp" "$nonce" "$body" \
  | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.*= //')"

curl -X POST 'http://localhost:8787/channels/oneworks/oneworks-main/webhook' \
  -H 'content-type: application/json' \
  -H "x-oneworks-channel-timestamp: $timestamp" \
  -H "x-oneworks-channel-nonce: $nonce" \
  -H "x-oneworks-channel-signature: $signature" \
  --data-binary "$body"
```

The exact signing input is `timestamp + "\n" + nonce + "\n" + rawBody`. The timestamp is a 13-digit millisecond value with a five-minute window. Each nonce first receives a processing reservation scoped by `channelKey` for the signature's remaining lifetime; it becomes durably consumed only after receiver success and is released immediately on controlled failure so the platform can retry. Long-running handlers therefore cannot be replayed concurrently with the same signature, and successful replays are rejected across processes and restarts.

Payload fields:

- `roomId`: group / room id; when present, `sessionType` defaults to `group`.
- `senderId`: sender channel account id, passed into identity middleware.
- `messageId`: optional; generated when omitted and used for deduplication.
- `text`: text message.
- `contentItems`: optional One Works chat content items.
- `sessionType`: optional, `group` or `direct`.

When `webhookSecret` is omitted, the native channel rejects webhook requests by default. Secretless simulation is allowed only when `allowInsecureWebhooks: true` is explicit and both the remote address and Host are loopback. Shared, public, or reverse-proxy environments must configure a secret.

After simulation or a native channel run, inspect outbound messages through the native debug outbox:

```bash
oneworks channel oneworks-main debug outbound
oneworks channel oneworks-main debug outbound --limit 5
oneworks channel oneworks-main debug outbound --clear
```

This reads `/api/channels/<channelKey>/debug/outbound` and is currently supported by the OneWorks native channel. The outbox is an in-memory local observation surface for outbound delivery, not a persistent room transcript or runtime trace.

## WeChat Channel Example

Webhook URL:

```text
<server public endpoint>/channels/wechat/<channelKey>/webhook?secret=<webhookSecret>
```

Minimal configuration:

```json
{
  "server": {
    "public": {
      "schema": "https",
      "domain": "bot.example.com",
      "port": 443
    }
  },
  "channels": {
    "wechat": {
      "type": "wechat",
      "token": "VideosApi-token",
      "appId": "wx_xxx",
      "webhookSecret": "replace-with-a-random-secret",
      "multimodalModel": "gpt-5.5",
      "autoReconnectOnStart": true,
      "access": {
        "admins": ["wxid_admin"]
      }
    }
  }
}
```

Notes:

- WechatApi documentation starts at `https://post.wechatapi.net/a2`; the management console is `https://newmanager.wechatapi.net`.
- `server.public.schema` / `domain` / `port` form the public server URL. Use a stable reverse proxy or tunnel for long-running deployments.
- `webhookSecret` is required. The server validates query `secret` and also accepts `x-oneworks-channel-secret` / `x-wechatapi-secret` headers.
- Set `enableWebhook: false` to return 404 for that channel webhook even if the public path guard allows the route.
- Text inbound messages become agent text input. Image messages prefer callback image data or WechatApi `/message/downloadImage`; GIF stickers are sampled into representative PNG frames; voice, video, shared items, and files become structured text summaries.
- When `multimodalModel` is configured, inbound messages with image attachments use that model.
- Configure `appId` explicitly when possible. Without it, the server can use the last valid callback, but active reply after restart may fail.
- When a callback URL can be built, startup registers it with WechatApi `/login/setCallback` by default. Set `autoRegisterCallback: false` to disable.
- `autoReconnectOnStart: true` calls `/login/reconnection` before registering the callback.
- If `access.admins` is missing or empty, startup logs an `/authorize-admin <token>` instruction. The maintainer must send it to the intended user through a trusted path.

Package-level maintenance details live in `packages/channels/wechat/README.md`.
