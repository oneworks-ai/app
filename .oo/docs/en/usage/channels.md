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
