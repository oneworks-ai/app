# @oneworks/channel-slack

Slack channel implementation for receiving Slack Socket Mode events and replying through Slack Web API.

## Platform References

- Slack API entry: https://api.slack.com/apis
- Socket Mode: https://api.slack.com/apis/connections/socket
- Web API `chat.postMessage`: https://api.slack.com/methods/chat.postMessage
- Web API `files.upload`: https://api.slack.com/methods/files.upload
- Web API `reactions.add`: https://api.slack.com/methods/reactions.add

## Tokens

The channel needs two Slack tokens:

- `botToken`: Bot User OAuth Token, usually `xoxb-...`.
- `appToken`: Socket Mode app-level token, usually `xapp-...`.

Enable Socket Mode for the Slack app and grant the bot enough scopes for the behavior used here, typically message read events, `chat:write`, `files:write`, and `reactions:write`.

Do not commit real tokens. Keep local values in `.oo.dev.config.json` or another private config layer.

## Minimal Config

```json
{
  "channels": {
    "team-slack": {
      "type": "slack",
      "title": "Team Slack",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "botUserId": "U_BOT",
      "access": {
        "admins": ["U_ADMIN"]
      }
    }
  }
}
```

`botUserId` is optional. When it is omitted, the package calls `auth.test` during receiving startup to learn the bot user id for mention detection.

## Runtime Behavior

- Incoming transport: Slack Socket Mode WebSocket.
- Supported inbound events: DMs, app mentions, and replies inside a thread already bound to the agent session.
- `respondToAllChannelMessages: true` lets ordinary non-bot channel messages enter the channel pipeline. Leave it disabled for shared Slack channels unless the workspace expects broad listening.
- Group session binding is thread-scoped as `C123#thread=1700000000.000001`. Access control still uses the root Slack channel id from `raw.accessChannelId`, so `/stop` and allow/deny rules apply to the whole Slack channel.
- Outbound text replies call `chat.postMessage`. If the target id includes `#thread=...`, the reply is sent with `thread_ts`.
- File replies call `files.upload` with the target channel and optional `thread_ts`.
- Acknowledgement uses `reactions.add` against the source message when a source message id is available.
- Tool-call summaries are accepted in the current OneWorks message schema and rendered from structured metadata into Slack text. Rich Slack Block Kit rendering can be added inside this package later without changing server middleware.

## Manual Sends

Agents and operators should use the shared channel CLI instead of platform-specific code paths:

```bash
oneworks-channel send --channel team-slack --to 'C123#thread=1700000000.000001' 'Deployment finished'
oneworks-channel send --channel team-slack --to 'C123' '{"type":"file","src":"https://example.com/report.json","filename":"report.json"}'
```

The generic server sender downloads URL or local-file payloads and calls this package's file sender.

## Troubleshooting

- Socket startup fails with `not_authed` or `invalid_auth`: verify `botToken` and `appToken`, and make sure the app-level token is a Socket Mode token.
- Messages arrive in Slack but not OneWorks: confirm the Slack app subscribes to the relevant bot events and Socket Mode is enabled.
- Channel messages are ignored: either mention the bot, continue in a bound thread, or set `respondToAllChannelMessages: true`.
- Replies appear outside the expected thread: check the encoded target includes `#thread=<root-thread-ts>`.
