# @oneworks/channel-telegram

Telegram channel implementation for receiving Telegram Bot API webhooks and replying through Bot API methods.

## Platform References

- Telegram Bot API: https://core.telegram.org/bots/api
- `setWebhook`: https://core.telegram.org/bots/api#setwebhook
- `sendMessage`: https://core.telegram.org/bots/api#sendmessage
- `sendDocument`: https://core.telegram.org/bots/api#senddocument

## Token

The channel `botToken` is the token returned by BotFather.

Do not commit real tokens. Keep local values in `.oo.dev.config.json` or another private config layer.

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
    "team-telegram": {
      "type": "telegram",
      "title": "Team Telegram",
      "botToken": "123456:ABC",
      "botUsername": "oneworks_bot",
      "webhookSecret": "replace-with-a-random-secret",
      "autoSetWebhook": true,
      "access": {
        "admins": ["123456789"]
      }
    }
  }
}
```

The public callback URL is derived from `server.public` and the channel key:

```text
https://bot.example.com/channels/telegram/team-telegram/webhook?secret=<webhookSecret>
```

`server.publicPaths` is not required for channel webhooks. The server always allows `/channels/*/*/webhook` on public hosts and still blocks other paths unless explicitly configured.

## Public Exposure

Telegram must be able to send an HTTPS POST request to the OneWorks server.

Recommended options:

- Production: expose the server through a stable reverse proxy or Cloudflare Tunnel, then set `server.public.schema`, `server.public.domain`, and optional `server.public.port`.
- Temporary validation: use a tunnel against the local server port, then put the tunnel domain in `server.public.domain`.

Set `autoSetWebhook: true` when OneWorks should call `setWebhook` during channel startup. Leave it disabled when the webhook is managed manually.

## Runtime Behavior

- Incoming callback path: `POST /channels/telegram/<channelKey>/webhook`.
- Secret check: query `secret`, `x-oneworks-channel-secret`, or Telegram `x-telegram-bot-api-secret-token`.
- Supported inbound messages: private, group, and supergroup text/caption messages, plus sticker/document/photo summaries.
- Telegram forum topics are bound as `chatId#thread=<message_thread_id>`. Access control still uses the root chat id from `raw.accessChannelId`, so `/stop` and allow/deny rules apply to the whole Telegram chat.
- Reply targets include `#reply=<message_id>` when available so Bot API `reply_parameters` can be used.
- Outbound text replies call `sendMessage`.
- File replies call `sendDocument`.
- Tool-call summaries are accepted in the current OneWorks message schema and rendered from structured metadata into Telegram text. Richer platform formatting can be added inside this package later without changing server middleware.

## Manual Sends

Agents and operators should use the shared channel CLI:

```bash
oneworks-channel send --channel team-telegram --to '-1001#thread=42' 'Deployment finished'
oneworks-channel send --channel team-telegram --to '-1001#thread=42' '{"type":"file","src":"https://example.com/report.json","filename":"report.json"}'
```

The generic server sender downloads URL or local-file payloads and calls this package's file sender.

## Troubleshooting

- Health check succeeds but Telegram sends no updates: verify the public URL is HTTPS and registered through `setWebhook`.
- Webhooks return unauthorized: check `webhookSecret` and the `x-telegram-bot-api-secret-token` value registered with Telegram.
- Group commands include the bot suffix, such as `/help@oneworks_bot`: configure `botUsername` so the suffix is stripped before command dispatch.
- Replies go to the wrong topic: check that the target id includes `#thread=<message_thread_id>`.
