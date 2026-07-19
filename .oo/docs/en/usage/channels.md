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

## Hermes Coverage

Hermes gateway supports platforms such as Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS, DingTalk, WeCom, Weixin, BlueBubbles, QQBot, Yuanbao, API Server, Webhook, MSGraph Webhook, and Feishu. OneWorks implements these through its own channel package architecture instead of copying Hermes adapters directly.

Covered or replaced today:

- `lark`: covers Hermes `FEISHU` / Lark scenarios.
- `wechat`: covers Hermes `WEIXIN` scenarios.
- `wecom`: covers Hermes `WECOM` / `WECOM_CALLBACK` scenarios.
- `qq-channel`: covers QQ channel bot scenarios similar to Hermes `QQBOT`.
- `imessage`: covers part of the Apple Messages / BlueBubbles personal messaging scenario.
- `slack`, `discord`, `telegram`: cover the matching Hermes platforms with basic send/receive, session binding, and tool summaries.
- `sms`: covers Hermes `SMS` with Twilio webhook inbound messages and Twilio REST replies.

Hermes-like channels that are not built in yet include DingTalk, Matrix, Email, WhatsApp / WhatsApp Cloud, Signal, Mattermost, BlueBubbles, Yuanbao, generic API Server / Webhook / MSGraph Webhook / Relay. Add them incrementally as `packages/channels/<type>` packages that follow the OneWorks webhook route, channel access, and session binding contracts.

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

## Slack Channel

Slack uses Socket Mode for inbound events and Slack Web API for replies.

Minimal configuration:

```json
{
  "channels": {
    "slack": {
      "type": "slack",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "botUserId": "U123456",
      "access": {
        "admins": ["U_ADMIN"]
      }
    }
  }
}
```

Notes:

- Enable Socket Mode for the Slack app and grant the bot token permissions for message receive/send, reactions, and file upload.
- DMs are handled directly. In channels, One Works handles `@bot` messages, replies in the same Slack thread, and channel commands by default. Set `respondToAllChannelMessages: true` for a dedicated channel.
- Group bindings are thread-scoped, for example `C123#thread=1700000000.000001`; `access.allowedGroups` / `blockedGroups` still match the root channel id such as `C123`.
- Replies go back to the triggering thread. Agents can send explicitly with `oneworks channel send --to 'C123#thread=...' --receive-id-type channel`.
- Current support includes basic send/receive, thread binding, reaction ack, file upload, and the One Works tool-call summary message shape. Tool summaries are rendered from structured metadata into Slack text; Slack Block Kit rendering can evolve inside `packages/channels/slack`.
- Package-level setup and troubleshooting details live in `packages/channels/slack/README.md`.

## Discord Channel

Discord uses the Gateway for inbound events and Discord REST API for replies.

Minimal configuration:

```json
{
  "channels": {
    "discord": {
      "type": "discord",
      "botToken": "discord-bot-token",
      "botUserId": "1234567890",
      "access": {
        "admins": ["1234567890"]
      }
    }
  }
}
```

Notes:

- Enable the Guild Messages, Direct Messages, and Message Content gateway intents for the bot.
- DMs are handled directly. Guild channels handle `@bot` and `/`-prefixed text by default. Set `respondToAllGuildMessages: true` for a dedicated channel.
- Text replies use `/channels/{channel_id}/messages` and are split at Discord's single-message limit. Files are sent through multipart upload.
- Sticker-only and embed-only messages become structured text summaries instead of empty agent input.
- Current support includes basic send/receive, mention and slash-text triggers, typing ack, file upload, sticker/embed structured summaries, and the One Works tool-call summary message shape. Tool summaries are rendered from structured metadata into Discord text; Discord embed rendering can evolve inside `packages/channels/discord`.
- Current support does not include Discord slash command registration, buttons/modal, deep thread binding, or Discord-specific companion MCP tools.
- Package-level setup and troubleshooting details live in `packages/channels/discord/README.md`.

## Telegram Channel

Telegram uses Bot API webhooks. The webhook URL is:

```text
<server public endpoint>/channels/telegram/<channelKey>/webhook?secret=<webhookSecret>
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
    "telegram": {
      "type": "telegram",
      "botToken": "123456:ABC",
      "botUsername": "oneworks_bot",
      "webhookSecret": "replace-with-a-random-secret",
      "autoSetWebhook": true,
      "access": {
        "admins": ["123456"]
      }
    }
  }
}
```

Notes:

- With `autoSetWebhook: true`, startup calls Telegram `setWebhook` using `server.public` or channel-level `serverBaseUrl`. You can also configure the webhook manually.
- `webhookSecret` is checked from query `secret`, `x-oneworks-channel-secret`, or Telegram's `x-telegram-bot-api-secret-token` header.
- Private chats, groups, and supergroups become One Works channel inbound messages. `/help@bot_username` is normalized to `/help`.
- Forum topics are bound separately, for example `-1001#thread=42`, so topics in one supergroup do not share the same session/tag. `access.allowedGroups` / `blockedGroups` still match the root chat id such as `-1001`.
- Replies keep Telegram-native `reply_parameters` and preserve `message_thread_id` inside forum topics.
- Current support includes text/file sending, webhook inbound, topic binding, reply chaining, and the One Works tool-call summary message shape. Tool summaries are rendered from structured metadata into Telegram text; Telegram-native formatting can evolve inside `packages/channels/telegram`.
- Current support does not include topic administration, pin/unpin, or General topic management write operations.
- Package-level setup and troubleshooting details live in `packages/channels/telegram/README.md`.

## SMS Channel

SMS uses Twilio Programmable Messaging webhooks for inbound messages and the Twilio Messages REST API for replies. The webhook URL is:

```text
<server public endpoint>/channels/sms/<channelKey>/webhook
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
    "sms": {
      "type": "sms",
      "accountSid": "AC...",
      "authToken": "twilio-auth-token",
      "fromNumber": "+15550000000",
      "webhookUrl": "https://bot.example.com/channels/sms/sms/webhook",
      "access": {
        "admins": ["+15551112222"]
      }
    }
  }
}
```

Notes:

- The Twilio Messaging webhook URL must exactly match `webhookUrl`. If `webhookUrl` is omitted, the channel derives it from `server.public` or channel-level `serverBaseUrl` plus the channel key.
- `X-Twilio-Signature` is verified by default. Set `verifyWebhookSignature: false` only for local development.
- Inbound SMS messages create direct sessions keyed by the sender phone number. `access.admins`, `allowedSenders`, and `blockedSenders` use E.164 phone numbers.
- MMS attachments are not downloaded in the first implementation; Twilio media URLs and content types are passed to the agent as structured text summaries.
- Outbound SMS text is split into 1600-character chunks. Tool-call summaries are rendered as SMS-friendly plain text.
- Package-level setup and troubleshooting details live in `packages/channels/sms/README.md`.
