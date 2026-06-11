# @oneworks/channel-wechat

WechatApi channel implementation for receiving WeChat message callbacks and replying through WechatApi.

## Platform References

- WechatApi docs entry: https://post.wechatapi.net/a2
- API manager / token console: https://newmanager.wechatapi.net
- Message callback / API usage notes: https://post.wechatapi.net/doc-4217385
- Send text API used by this package: https://post.wechatapi.net/message/posttext
- Send image API used by `oneworks-channel` manual sends: https://post.wechatapi.net/message/postimage
- Send emoji API used by `oneworks-channel` manual sends: https://post.wechatapi.net/message/postemoji
- Download image API used for inbound image callbacks: https://post.wechatapi.net/message/downloadimage

## Token

The channel `token` is the WechatApi `TokenId`.

According to the WechatApi onboarding page, open the API manager, enable or purchase API access, then go to access control and copy the `TokenId`. Configure that value as `channels.<key>.token`. `callbackToken` is optional and defaults to the same value.

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
    "erjie": {
      "type": "wechat",
      "title": "erjie",
      "token": "WechatApi-TokenId",
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

The public callback URL is derived from `server.public` and the channel key:

```text
https://bot.example.com/channels/wechat/erjie/webhook?secret=<webhookSecret>
```

`server.publicPaths` is not required for channel webhooks. The server always allows `/channels/*/*/webhook` on public hosts and still blocks other paths unless explicitly configured. Set `enableWebhook: false` on one channel to disable that channel's webhook.

## Public Exposure

WechatApi must be able to send an HTTPS POST request to the OneWorks server.

Recommended options:

- Production: expose the server through a stable reverse proxy or Cloudflare Tunnel, then set `server.public.schema`, `server.public.domain`, and optional `server.public.port`.
- Temporary validation: use a tunnel such as localtunnel against the local server port, then put the tunnel domain in `server.public.domain`.

The channel auto-registers the callback with WechatApi `/login/setCallback` when `server.public` or channel-level `serverBaseUrl` can produce a callback URL. Disable this with `autoRegisterCallback: false` if the callback should be managed manually in the WechatApi console.

Set `autoReconnectOnStart: true` when the WechatApi app can remain online while callbacks stop being pushed after a local restart. The channel will call `/login/reconnection` for the configured `appId` before registering the callback again.

## Runtime Behavior

- Incoming callback path: `POST /channels/wechat/<channelKey>/webhook`.
- Secret check: query `secret`, `x-oneworks-channel-secret`, or `x-wechatapi-secret`.
- Supported inbound messages: `TypeName: "AddMsg"` with text `MsgType: 1`, image `MsgType: 3`, voice `MsgType: 34`, video `MsgType: 43`, emoji `MsgType: 47`, and app/share/file `MsgType: 49`.
- WeChat GIF emoji callbacks are downloaded and sampled into three PNG images: first frame, middle frame, and last frame. Each image `contentItem` keeps both a preview data URL and a temporary local file path so Codex can receive it as a real local image attachment.
- Static image callbacks are passed to the agent with image `contentItems` when the callback includes inline image bytes, a downloadable image URL, or WechatApi `/message/downloadImage` can convert the callback XML into a temporary `fileUrl`. Voice, video, and app/share/file callbacks are converted to structured text summaries until a platform media fetch path is available.
- Set channel-level `multimodalModel` when the default model is optimized for text and does not reliably understand image attachments. Image and GIF-frame messages use that model; ordinary text keeps the default session behavior.
- Outbound direct auto replies: `POST /message/postText` with `appId`, `toWxid`, and `content`.
- Manual `oneworks-channel ... send '{ "type": "image", "src": "https://..." }'` sends URL images through `POST /message/postImage`.
- Manual `oneworks-channel emoji send <id> --platform wechat` sends WeChat custom emoji through `POST /message/postEmoji` with `appId`, `toWxid`, `emojiMd5`, and `emojiSize` resolved from the shared emoji registry. Use `oneworks-channel emoji save <id> --platform wechat --emoji-md5 ... --emoji-size 102357` to add known send metadata, and `oneworks-channel emoji annotate <id> --platform wechat --tag 赞同 --note "适合回应认可、赞赏或没问题"` to teach the agent what the emoji means.
- Manual WeChat group text mentions use the shared `mentions` shape and are converted to WechatApi `ats` on send. Agents should call `oneworks-channel send --at <wxid> "@昵称 ..."` for one user, repeat `--at` or use `--ats wxid_a,wxid_b` for multiple users, and use `--at-all "@所有人 ..."` for `notify@all`. The visible message text must still contain the `@` mention text.
- WeChat direct sessions still keep a compatibility auto-delivery path for the first assistant text and final stop text, de-duplicating identical content. Channel prompts prefer deliberate external replies through `oneworks-channel`, and Chat History / stop text should stay as a short internal summary after a manual send. WeChat group sessions do not auto-send runtime progress; send deliberate group-visible messages with `oneworks-channel`.
- In WeChat group chats, a leading mention of the bot is removed before command/session dispatch. The channel resolves the bot's per-chatroom `displayName` via `/group/getChatroomMemberList`, then falls back to `nickName` or the configured channel `title`, so `@二介 /help` enters the pipeline as `/help`.
- WeChat group inbound text prefixes include the raw sender wxid plus available member names, for example `[wxid_xxx（昵称）（群内名）]:\n消息`. Duplicate labels are omitted when `nickName` and `displayName` are the same.
- Group chat ordinary text is debounced by the server before dispatch. Configure `groupMessageDebounceMs` per channel to change the merge window, or set it to `0` to disable. Slash commands still run immediately.
- If `appId` is not configured, the channel can learn it from incoming callback payloads, but proactive replies after restart are more reliable when `appId` is configured.
- Messages from the logged-in bot wxid itself are ignored. WeChat Team system-account direct callbacks from `weixin`, and WechatApi system/sync callbacks such as `MsgType: 51` or `MsgType: 10002`, are also ignored and should not produce replies.
- When `access.admins` is missing or empty, nobody is treated as an admin. During channel startup, the server log will include an authorization command such as `/authorize-admin <token>`.
- The authorization command is intentionally not sent through WeChat. Supported text messages before authorization receive only:

```text
管理员尚未初始化，请联系服务维护者获取授权指令。
```

Send the exact logged command back through the same channel to add the sender to `access.admins`. Restarting the service creates a new in-memory bootstrap token. Multiple text messages before authorization can each receive the generic bootstrap reply.

Health check example:

```bash
curl -i 'https://bot.example.com/channels/wechat/erjie/webhook?secret=<webhookSecret>' \
  -H 'content-type: application/json' \
  -d '{"TypeName":"HealthCheck"}'
```

## WechatApi Login Runbook

The OneWorks channel does not keep the WeChat account online by itself; it depends on the WechatApi app instance identified by `appId`.

1. Check whether the account is online:

```bash
curl -sS '<apiBaseUrl>/login/checkOnline' \
  -H 'content-type: application/json' \
  -H 'VideosApi-token: <token>' \
  -d '{"appId":"<appId>"}'
```

`data: true` means WechatApi considers the account online.

2. If the account is offline, get a login QR code and scan it:

```bash
curl -sS '<apiBaseUrl>/login/getLoginQrCode' \
  -H 'content-type: application/json' \
  -H 'VideosApi-token: <token>' \
  -d '{"appId":"<appId>","type":"mac"}'
```

Render either `data.qrImgBase64` or `data.qrUrl`, scan it in WeChat, then poll `/login/checkLogin` with the returned `uuid` about every 5 seconds until the response includes login data or a failure. WechatApi documents the QR code timeout as about 120 seconds.

```bash
curl -sS '<apiBaseUrl>/login/checkLogin' \
  -H 'content-type: application/json' \
  -H 'VideosApi-token: <token>' \
  -d '{"appId":"<appId>","uuid":"<uuid>","autoSliding":true}'
```

3. After a successful login, register the callback again if the server was restarted while the account was offline:

```bash
curl -sS '<apiBaseUrl>/login/setCallback' \
  -H 'content-type: application/json' \
  -H 'VideosApi-token: <token>' \
  -d '{"token":"<callbackToken-or-token>","callbackUrl":"https://bot.example.com/channels/wechat/erjie/webhook?secret=<webhookSecret>"}'
```

4. If the phone shows the account online but OneWorks receives no text callbacks, call WechatApi `/login/reconnection` and then re-test with a plain text message:

```bash
curl -sS '<apiBaseUrl>/login/reconnection' \
  -H 'content-type: application/json' \
  -H 'VideosApi-token: <token>' \
  -d '{"appId":"<appId>"}'
```

Test with a plain text message from another WeChat account. Messages sent by the bot's own logged-in account can show up as self/sync callbacks and will be ignored.

## macOS PhDDNS / PeanutHull Notes

When using Oray PeanutHull on macOS, prefer the official `PhDDNS.app` tunnel state for a domain that was configured in the GUI. Launching the standalone SDK `phtunnel` with only AppID/AppKey can create a different device SN with no mappings, so the public domain can resolve and complete TLS but still return an empty response.

For a local server on port `8787`, the active mapping should look like:

```text
<domain>:443 -> 127.0.0.1:8787
```

Useful checks:

```bash
curl -sS http://127.0.0.1:8787/api/auth/status
curl -sS http://127.0.0.1:16062/ora_service/getstatus
```

Healthy PeanutHull state includes:

- `status: 1` for the device.
- `hsk.is_forward: true`.
- `hsk.mappings[]` contains the expected domain, `host: "127.0.0.1"`, `service: 8787`, `port: 443`, and `status_code: 0`.

If `ora_service/getmgrurl` returns an empty `url`/`account`, or `fw_service/GetStatus` returns `mappings: []`, the tunnel process is online but the current device is not bound to the domain mapping. Start the official PhDDNS app or bind the mapping to the current device before debugging OneWorks.

## Troubleshooting

- Public health check returns `200`, but no reply: inspect the server log. `ignored webhook because payload is not a supported inbound text message` means the callback reached the server but the message type is not currently dispatchable.
- Logs show `received inbound webhook`, but no WeChat message: look for `[wechat] sending text reply via postText`, `[wechat] sent text reply via postText`, or `[wechat] failed to send text reply via postText`.
- If WechatApi reconnects or re-registers a callback, it may replay older `AddMsg` callbacks. OneWorks stores inbound message ids in SQLite for cross-restart deduplication and drops callbacks whose `CreateTime` is clearly older than the current handler startup window.
- Two identical generic bootstrap replies are usually two plain text messages arriving before an admin has been initialized.
- Callback registration failures such as `push msg err` often mean the public URL was not reachable at registration time. Verify the public health check and call `/login/setCallback` again.
- Logs show WechatApi system callbacks such as `MsgType: 51` / `10002`, but user text is not arriving: call `/login/reconnection`, then `/login/setCallback`; for local long-running setups set `autoReconnectOnStart: true`.
