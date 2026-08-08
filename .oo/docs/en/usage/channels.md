# Channel Session Binding

Channels connect external messaging systems to One Works sessions. A channel receives inbound messages, resolves access rules, starts or resumes a session, and sends the agent response back to the external service.

## Configuration Shape

Channel configuration lives in project config:

```yaml
channels:
  <channelKey>:
    type: ...
```

Each channel type defines its own credentials and transport settings. Shared concepts include:

- access control for admins or allowed users
- session binding between an external conversation and a One Works session
- optional multimodal model selection for image-capable inbound messages
- webhook secrets for public HTTP callbacks
- channel-level `serverBaseUrl` overrides when the global public server URL is not enough

## Public Server URL

Webhook channels need a URL that the external platform can reach. The server can build it from:

```json
{
  "server": {
    "public": {
      "schema": "https",
      "domain": "bot.example.com",
      "port": 443
    }
  }
}
```

Channel-level `serverBaseUrl` can override it for a specific channel.

Public hosts allow `/channels/*/*/webhook` by default. Additional public paths should be configured with `server.publicPaths`.

## Channel Links

Project `channels` declare platform connections and credentials. A concrete group/direct entry lives in `.oo/channels/<link>/channel.json` and binds that external conversation to exactly one entity:

```json
{
  "channel": "lark:team",
  "entity": "owo-demo",
  "external": {
    "type": "chat",
    "chatId": "oc_xxx"
  },
  "authorization": {
    "deliveryThrottleMs": 1200000,
    "resume": {
      "mode": "immediate",
      "delayMs": 0
    }
  }
}
```

- One channel link maps to one entity.
- `authorization.deliveryThrottleMs` controls how often the same authorization request may be delivered again, in milliseconds. The default is `1200000` (20 minutes).
- `authorization.resume.mode` controls what happens after grant / deny. `immediate` creates a `system_resume` child run automatically, `manual` only records the resolved pending intent until an admin or agent explicitly resumes it with `channel.auth.resume`, and `next_message` waits for the next related inbound message from the same owner in the same thread, then injects the resume context into that child run. `authorization.resume.delayMs` adds a minimum delay for `immediate` resume.
- Delivered authorization requests record `delivery` and the platform `deliveryMessageId`; grant / deny closes the linked pending intent.
- During the current single-login compatibility phase, automatic resume only restores the original One Works session context. It does not grant the external sender's personal login state. User-level APIs must still check the `credentialSubjectUserId` credential and otherwise request authorization, degrade, or deny.

## Agent-Side Channel Command Tools

When a channel agent needs to inspect or update channel-internal state, it should use the sender-scoped typed command CLI instead of sending slash commands such as `/auth`, `/session`, or `/access` into the external chat:

```bash
oneworks channel command list
oneworks channel command invoke channel.whoami
oneworks channel command invoke channel.auth.list
oneworks channel command invoke channel.auth.list '{ "scope": "resumable" }'
oneworks channel command invoke channel.auth.grant '{ "id": "auth-1" }'
oneworks channel command invoke channel.auth.resume '{ "id": "auth-1" }'
oneworks channel command invoke channel.identity.link
oneworks channel command invoke channel.identity.link '{ "code": "ABCD1234" }'
oneworks channel command invoke channel.identity.accounts
```

- `oneworks channel command list` shows available `channel.*` typed tools, slash usage, and permission level.
- `oneworks channel command invoke <toolName> [jsonInput]` sends the current channel context to the server and executes as the current message sender according to channel admins, identity links, and authorization-request state. It cannot switch to the bot, owner, enterprise admin, desktop login, or active CLI profile.
- Command output returns only to the shell and Chat History. It is not automatically posted to the external channel. Send a short visible summary separately with `oneworks channel send "..."` when the channel should see the result.
- One Works does not currently provide a complete multi-account login loop. `actor identity` and `actor credential` stay separate: sender identity can drive permissions, audit, and authorization ownership; user-level API execution still requires an explicit credential/authorization request and must not borrow the desktop login, CLI app, or bot app secret.
- When a typed command is invoked from a channel session, the server treats that session's `channelActorSnapshot` as the authoritative sender context. The CLI-provided `context` can fill missing fields, but it cannot switch the sender, channel, or session type to another person or chat. Conflicts are rejected.
- When debugging permission ownership, start with slash `/whoami` or typed `channel.whoami` to inspect the sender, channel account, canonical user, identity link, and credential count. A canonical user only means the identity is linked; zero credentials or non-active credentials still cannot execute user-level APIs for that person.
- Cross-channel account linking uses `/identity link`: generate a short-lived code from an account the user controls, then run `/identity link <code>` from the other account. This only proves both channel accounts belong to the same canonical user; it does not copy credentials or grant the new account the old account's API login state.
- Authorization requests keep the same split: `requesterUserId/requesterAccountId` is the sender that triggered the work, while `credentialSubjectUserId` is the user whose executable credential is missing. When they differ, the pending intent belongs to the credential subject so resource-owner approval is not confused with requester approval.
- `channel.auth.list` lists the current sender's pending authorization requests by default. With `{ "scope": "resumable" }`, it lists resolved pending intents that can still be resumed. Regular users only see their own tasks; admins can see all resumable tasks for the current channel type and resume them with `channel.auth.resume`.

Without a complete multi-account login loop, read permissions as `single-login runner mode`:

- The desktop login / CLI profile is only the local runner principal, used to start sessions, access the project, and schedule runtime work.
- The bot app secret is a service principal, used for bot messaging and app-level channel capabilities.
- The channel sender is the actor identity, used for policy decisions, audit, memory ownership, and authorization ownership.
- Only an explicitly authorized credential principal can execute user-level APIs for that user.

When a tool needs a user credential and the actor or resource owner has no active credential, create an authorization request, degrade, or deny. Do not borrow the desktop user, CLI app, bot app, or room owner permission.

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
- Grant the message scopes needed by the channel, such as `im:message`, `im:message:readonly`, and `im:message:send_as_bot`. If a CLI or OpenAPI workflow will manage chat members, grant IM chat-member scopes such as `im:chat.members:write_only`, `im:chat:read`, and `im:chat:update` to the app used for that operation.
- In Events and Callbacks, set the subscription mode to persistent connection and subscribe to the message receive event `im.message.receive_v1`; the saved subscription must still be published before it affects the live app. A startup log such as `[channels] channel connected` only means the persistent-connection client is connected; real group-message delivery still depends on the published event subscription.
- To add the bot to external chats, enable external-chat sharing on the version publishing page, submit the version, and wait for admin approval. Drafts and pending reviews do not affect the live app. Permission, event-subscription, icon, name, and external-chat setting changes should be treated as live only after the published version takes effect.
- Configure `appId` / `appSecret` for the bot that One Works should actually listen and reply as. Do not accidentally use a personal CLI test app. When a room contains several role bots for demos, usually only one service bot is configured in the One Works channel; the other role bots are just Feishu chat members.
- `access.allowedGroups` contains Feishu chat IDs (`oc_...`). `access.admins` contains user `open_id` values as seen by this exact app; the same person can have different `open_id` values across apps. Resolve these IDs from the same channel bot app's perspective.

Integration lessons:

- Keep the channel bot app separate from the CLI operator app. The channel config `appId` / `appSecret` should belong to the bot that listens and replies. Chat creation, member management, contact lookup, and user-sent test messages should use one fixed `lark-cli --profile`; do not rely on whatever profile is currently active.
- Use the Feishu Open Platform self-built app bot capability. Do not use the intelligent-agent app launcher for One Works channel bots.
- For a role-bot matrix demo, multiple bots can be added to the same chats as members, but usually only one service/demo bot should be connected to the One Works channel. This keeps credentials, event subscriptions, and reply identity clear.
- External-chat setup has three moving parts: the target chat is external, the bot's published version allows external chats, and the CLI app performing member operations also has the required external-chat capability. Configuring only the invited bot is not enough; confirm the chat is really external after creation, and dissolve/recreate it if it was mistakenly created as an internal chat.
- When using CLI automation to manage chat members, run `lark-cli auth status --profile <name> --json` before assuming a user profile needs a new scan. If it shows `needs_refresh` but still has `offline_access` and an unexpired refresh token, the next user-identity API call often refreshes automatically.
- After editing the project's channel config file, the running server may still hold the previous persistent connection. Restart the server or confirm the channel reconnected before testing real inbound messages.
- Verify the loop in two steps: first send a bot message to confirm `appId` / `appSecret` and `im:message` work; then send a normal user message in the target chat to confirm persistent events, `allowedGroups`, session dispatch, and replies. Do not treat a bot self-send as an inbound-message test; a bot-sent message plus a connected server log is not a full inbound-message loop.

Troubleshooting:

- `https://oneworks.cloud/avatar/` is a preview/export page, not a direct image URL. Export a real image file from the Avatar page, or use the project's avatar tooling to generate a PNG/JPEG, then upload that file to the Open Platform.
- The Open Platform UI can upload an app icon manually. For automation, the base-info API can upload an icon with `POST /open-apis/application/v7/app_avatar/upload`, then set `avatar_url` with `PATCH /open-apis/application/v7/applications/:app_id/base`. The app or user token needs `application:application:patch`, and the change still needs a version publish and approval before it is live.
- Always pass the intended `lark-cli --profile`. The active profile may point at another company or a different test app.
- External chat member management also checks the caller app. Even if the invited bot allows external chats, `chat.members.create` can fail with `232033` when the profile performing the operation is not itself an approved external-chat app.

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

Bind a room to an entity in `.oo/channels/wan-ke-native/channel.json`:

```json
{
  "channel": "oneworks-main",
  "entity": "owo-demo",
  "external": {
    "type": "room",
    "roomId": "wan-ke-native"
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
  --room wan-ke-native \
  --sender user-yijie \
  --message-id sim-1 \
  --secret replace-with-dev-secret \
  "@OWO hi"
```

Structured payloads are supported too:

```bash
oneworks channel simulate --channel oneworks-main \
  --secret replace-with-dev-secret \
  '{ "roomId": "wan-ke-native", "senderId": "user-yijie", "text": "@OWO hi" }'
```

When the command runs inside a OneWorks native channel session, `simulate` reuses the current context `channelKey`, `senderId`, and group `roomId`, so `oneworks channel simulate "@OWO hi"` is enough. It does not reuse channel keys from Lark, WeChat, or other non-native channel contexts; pass `--channel` explicitly there.

The CLI posts to the standard webhook route. For raw HTTP debugging, call it directly:

```bash
curl -X POST 'http://localhost:8787/channels/oneworks/oneworks-main/webhook?secret=replace-with-dev-secret' \
  -H 'content-type: application/json' \
  -d '{
    "roomId": "wan-ke-native",
    "senderId": "user-yijie",
    "messageId": "sim-1",
    "text": "@OWO hi"
  }'
```

Payload fields:

- `roomId`: group / room id; when present, `sessionType` defaults to `group`.
- `senderId`: sender channel account id, passed into identity middleware.
- `messageId`: optional; generated when omitted and used for deduplication.
- `text`: text message.
- `contentItems`: optional One Works chat content items.
- `sessionType`: optional, `group` or `direct`.

When `webhookSecret` is omitted, the native channel rejects webhook requests by default. Secretless simulation is allowed only when `allowInsecureWebhooks: true` is explicit and the request Host is loopback. Shared or public environments must configure a secret.

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
