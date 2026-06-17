# @oneworks/channel-qq-channel

QQ Channel implementation for the official QQ Bot API.

This package is intentionally scoped to QQ Channel scenes: text subchannel mentions and channel DMs. It does not claim support for ordinary QQ C2C private chat or QQ group chat.

## Official References

- Entry guide and credentials: https://bot.q.qq.com/wiki/develop/api-v2/
- AccessToken authentication: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
- Webhook / WebSocket event framework: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- Webhook signature algorithm: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html
- Message events: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/event.html
- Send channel message: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/post_messages.html

## Minimal Config

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
    "qq": {
      "type": "qq-channel",
      "title": "OneWorks QQ",
      "appId": "YOUR_APP_ID",
      "appSecret": "YOUR_APP_SECRET",
      "access": {
        "admins": ["QQ_OPEN_ID_OR_MEMBER_ID"]
      }
    }
  }
}
```

Configure the QQ bot callback URL in the QQ Open Platform management console:

```text
https://bot.example.com/channels/qq-channel/qq/webhook
```

The official webhook callback URL must be HTTPS and the documented allowed ports are `80`, `443`, `8080`, and `8443`.

## Runtime Behavior

- Incoming webhook path: `POST /channels/qq-channel/<channelKey>/webhook`.
- Webhook verification:
  - `op: 13` callback validation returns the official `plain_token` and Ed25519 `signature`.
  - Dispatch requests are checked with `X-Signature-Ed25519`, `X-Signature-Timestamp`, and the raw HTTP body when available.
  - The server route passes `rawBody` from `koa-bodyparser`; reverse proxies must not rewrite the body before it reaches OneWorks.
- Supported inbound QQ Channel events:
  - `AT_MESSAGE_CREATE` from text subchannels.
  - `MESSAGE_CREATE` for private-domain full text subchannel events when the bot has that permission.
  - `DIRECT_MESSAGE_CREATE` from channel DMs.
- Outbound text send:
  - `receiveIdType: "channel_id"` sends `POST /channels/{channel_id}/messages`.
  - `receiveIdType: "guild_id"` sends `POST /dms/{guild_id}/messages`.
  - Text uses `msg_type: 0`.
- OneWorks automatic channel delivery currently passes only `receiveId`, `receiveIdType`, and `text`, so QQ replies from sessions are proactive messages. Manual sends may include `msgId`, `eventId`, and `msgSeq` for official passive reply semantics.

## Platform Limits

- The current official authentication flow uses `AppID` + `AppSecret` to obtain an AccessToken from `https://bots.qq.com/app/getAppAccessToken`; API calls use `Authorization: QQBot <ACCESS_TOKEN>`.
- Newer bots may require IP allowlist configuration for production OpenAPI/WebSocket access. Sandbox access is separate and can only operate on sandbox-configured QQ Channel resources.
- `PUBLIC_GUILD_MESSAGES` receives `AT_MESSAGE_CREATE`; full `MESSAGE_CREATE` is private-domain only.
- Channel DMs cannot be configured as sandbox channel events according to the official event page; debug them with user allowlists.
- Official send limits apply. Public docs describe default proactive message limits and per-subchannel rate limits; avoid relying on high-volume proactive sends.
- URL content must be allowed in QQ Open Platform message URL configuration before it can be sent.

## Manual Send Examples

```bash
oneworks channel qq send --receive-id 100010 --receive-id-type channel_id "hello"
```

```bash
oneworks channel qq send --receive-id 18700000000001 --receive-id-type guild_id "hello channel dm"
```

Passive reply fields can be sent through JSON:

```bash
oneworks channel qq send '{"receiveId":"100010","receiveIdType":"channel_id","text":"hello","msgId":"0812345677890abcdef","msgSeq":1}'
```
