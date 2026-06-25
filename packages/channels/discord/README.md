# @oneworks/channel-discord

Discord channel implementation for receiving Discord Gateway events and replying through the Discord REST API.

## Platform References

- Discord developer portal: https://discord.com/developers/applications
- Gateway: https://discord.com/developers/docs/topics/gateway
- Message create events: https://discord.com/developers/docs/topics/gateway-events#message-create
- Create message REST API: https://discord.com/developers/docs/resources/message#create-message

## Token

The channel `botToken` is the Discord bot token copied from the Discord developer portal.

Enable the bot and invite it to the target server with permissions to read messages and send messages in the channels it should handle. If the bot should read ordinary message content, enable the Message Content privileged intent in the developer portal.

Do not commit real tokens. Keep local values in `.oo.dev.config.json` or another private config layer.

## Minimal Config

```json
{
  "channels": {
    "team-discord": {
      "type": "discord",
      "title": "Team Discord",
      "botToken": "discord-bot-token",
      "botUserId": "999",
      "access": {
        "admins": ["1234567890"]
      }
    }
  }
}
```

`botUserId` is optional but recommended, because guild mentions are detected against this id.

## Runtime Behavior

- Incoming transport: Discord Gateway WebSocket.
- Supported inbound events: DMs, guild messages that mention the bot, guild messages that start with `/`, and all non-bot guild messages when `respondToAllGuildMessages: true`.
- Discord channel ids are used directly for group session binding and access control.
- Outbound text replies call `POST /channels/{channel.id}/messages`.
- Text longer than Discord's content limit is split before sending.
- File replies use multipart `attachments`.
- Acknowledgement uses Discord typing indicators when a source channel is available.
- Sticker-only and embed-only messages are converted into structured text so the agent still receives meaningful context.
- Tool-call summaries are accepted in the current OneWorks message schema and rendered from structured metadata into Discord text. Richer embeds can be added inside this package later without changing server middleware.

## Manual Sends

Agents and operators should use the shared channel CLI:

```bash
oneworks-channel send --channel team-discord --to '123456789012345678' 'Deployment finished'
oneworks-channel send --channel team-discord --to '123456789012345678' '{"type":"file","src":"https://example.com/report.json","filename":"report.json"}'
```

The generic server sender downloads URL or local-file payloads and calls this package's file sender.

## Troubleshooting

- Gateway connects but no guild text arrives: enable the Message Content intent and confirm the bot can read the target channel.
- Guild messages are ignored: mention the bot, start with `/`, or set `respondToAllGuildMessages: true`.
- Replies fail with permission errors: confirm the bot role can send messages and attach files in the target channel.
- Unexpected duplicate sessions usually mean multiple Discord channel configs or services are connected with the same bot token.
