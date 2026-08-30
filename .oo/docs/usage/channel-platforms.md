# Channel 平台接入

本页记录 Lark、OneWorks Native 与 WeChat 的平台配置和接入经验。通用会话、权限、命令与频道链接语义见 [Channel 会话绑定](./channels.md)。

## Lark 频道

Lark / 飞书频道使用开发者后台里的自建机器人应用接入。最小配置只需要应用凭证和可选的群白名单：

```json
{
  "channels": {
    "lark:team": {
      "type": "lark",
      "appId": "cli_xxx",
      "appSecret": "${ONEWORKS_LARK_APP_SECRET}",
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

把 `ONEWORKS_LARK_APP_SECRET=...` 写在不会提交的 `.env.dev` 中；项目可以提交 App ID、群白名单、ChannelLink 和实体定义。仓库中的 `.env.dev.example` 只列变量名，不包含真实凭证。变量缺失时，对应 channel 会保持未连接并报告缺失变量，不会拿占位符尝试连接平台。

配置步骤：

- 在飞书开放平台创建企业自建应用，添加「机器人」能力；不要走“飞书智能体 / AI Agent / 妙搭”应用入口。
- 只接收群内明确 `@` 的角色机器人，可开启 `im:message`、`im:message:send_as_bot`、`im:message.group_at_msg.include_bot:readonly`。需要用 CLI 或 OpenAPI 管理群成员时，再给用于操作的应用授权 `im:chat.members:write_only`、`im:chat:read`、`im:chat:update` 等 IM 权限。
- 在「事件与回调」里把订阅方式配置为长连接，并订阅消息接收事件 `im.message.receive_v1`；保存订阅后仍需发布线上版本才会生效。服务启动日志出现 `[channels] channel connected` 只代表长连接客户端已连上；是否能收到群消息还取决于事件订阅是否已发布生效。
- 如果机器人要进外部群，必须在版本发布页开启「允许机器人被添加到外部群中使用」，提交发布并由企业管理员审核通过。只保存草稿或停在“审核中”时，线上不会生效。权限、事件订阅、头像、名称和外部群开关等开放平台改动也应以发布后的线上版本为准。
- `appId` / `appSecret` 填 One Works 实际要监听和回复的机器人应用，不要误用个人 CLI 测试应用。多个角色机器人用于群内演示时，通常只把其中一个“演示服务”机器人配置到 One Works channel，其余角色机器人只是飞书群成员。
- `access.allowedGroups` 使用飞书群 `chat_id`（`oc_...`）。`access.admins` 使用该接入应用看到的用户 `open_id`，不同应用下同一个人的 `open_id` 可能不同；这些 ID 应从同一个 channel bot app 的视角解析。

接入经验：

- 区分「通道机器人应用」和「CLI 操作用应用」。通道配置里的 `appId` / `appSecret` 应指向真正负责监听和回复的机器人；群创建、拉人、查成员、发用户消息等 CLI 操作应固定使用一个专门的 `lark-cli --profile`，不要临时借用当前 active profile。若状态显示 `needs_refresh`，但仍有 `offline_access` 且 refresh token 未过期，下一次用户身份 API 调用通常会自动刷新，不一定需要重新扫码。
- 角色矩阵演示时，可以创建多个机器人作为群成员，但通常只把一个演示服务机器人接到 One Works channel，避免凭证、事件订阅和回复身份互相混淆。如果每个角色都要独立回复，则每个 bot app 都需要独立的 channel key 与 `appId` / `appSecret`；同一角色进入多个群时复用同一个实体，并为每个 `bot app × chat` 建立一个 ChannelLink，一个 channel key 不应跨实体复用。
- 在多机器人群里，结构化 `@` 只会触发被点名的机器人，`@` 其它机器人会关闭失败。完全没有 `@` 的 slash command 仍按 ChannelLink 的 `createOnCommand` 处理；如果群内多个 bot 都开启该入口，一条裸命令可能被多个 bot 接收。此时应关闭不需要的 `createOnCommand`，或在实现“群命令必须 `@` 当前 bot”的显式策略后再开启。同一实体的多个 ChannelLink 会复用角色定义和实体级结构化记忆；channel、conversation 和 user 记忆仍保留来源 channel key、会话类型和可见性边界，私聊内容不会因为实体复用而进入群聊 snapshot。
- 外部群链路要同时满足三件事：目标群是外部群，机器人发布版本允许加入外部群，执行成员管理的 CLI 应用本身也具备对应外部群能力。只配置被邀请机器人不够；创建群后应立刻确认群确实是外部群，误建内部群时建议解散并重新创建外部群。若成员管理返回 `232033`，应优先检查当前 CLI profile 对应应用的外部群能力。
- 需要批量核对企业自建应用的 App ID 时，可为专用 CLI 应用申请 `admin:app.info:readonly` 并发布，然后调用 `GET /open-apis/application/v6/applications`。该管理员读取权限应留在 CLI 操作用应用，不要扩散到每个角色机器人。
- 修改项目的 channel 配置文件后，正在运行的 server 可能仍持有旧的长连接；同一个 bot app 也不要同时连接多个旧 worktree 或遗留 server，否则飞书可能把事件交给任意一条连接。排查时用 `pnpm --silent tools dev-service status <target> --json` 确认服务归属，并在得到对应 target 的停止授权后退出旧服务、重启或确认 channel 已重新连接，再做真实群消息验证。
- Web launcher 的 manager server 不应初始化 workspace channel；频道长连接、runtime watcher 和 resume scheduler 应由同一个 workspace server 持有。否则入站去重可能由 manager 抢先完成，而真正的会话执行器看不到该事件。
- 自动创建的 channel session 需要明确可用的默认 adapter 和 model。项目若包含仅供测试的 mock model service，不应依赖“第一个可用模型”的回退结果；在 user / private 配置中设置 `defaultAdapter` / `defaultModel`，再确认 session 使用了目标 model 并走到 `completed`。
- 闭环验证建议分两步：先用 bot 身份发送一条消息确认 `appId` / `appSecret` 和 `im:message` 可用；再让真实用户在目标群里明确 `@` 该机器人，确认结构化 mention、长连接事件、`allowedGroups`、session 调度和回复都生效，并确认同群其它机器人没有被误触发。不要用机器人自己发给自己当作入站验证；只有 bot 自发消息和 server connected 日志还不算完整入站闭环。

排查提示：

- 飞书头像生成页 `https://oneworks.cloud/avatar/` 是预览 / 导出页面，不是图片直链。应从页面导出真实图片或用项目 avatar 工具生成 PNG/JPEG 后上传；自动化时可先 `POST /open-apis/application/v7/app_avatar/upload`，再 `PATCH /open-apis/application/v7/applications/:app_id/base` 设置 `avatar_url`。该流程需要 `application:application:patch` 权限，修改后仍需发布并过审才会上线。
- 用 `lark-cli` 管理外部群成员时，要显式指定正确 profile。默认 active profile 可能是另一个公司或另一个测试应用。

## OneWorks Native 频道

OneWorks 内置 `oneworks` channel type，用于产品内房间、演示空间和本地模拟调试。它是正式 channel 实现，不直接调用 agent；入站事件仍会经过 ChannelLink、identity、command、availability、ingress、child session 和权限审计。

`.oo.config.json` 里声明平台连接：

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

`.oo/channels/demo-room/channel.json` 里绑定具体房间和实体：

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

开启 `ambientRouting` 并使用模型判断普通群聊时，应单独配置 `ingress.routerAdapter` 和 `ingress.routerModel`。当前只有 Gemini 实现了可证明不加载工具、MCP 和 skill 的 `structured_no_tools` 路由档位；其它 adapter 会关闭失败为 `observe`，不会创建子会话。业务 ChildSession 的 adapter 仍由 `routing` 独立选择。

本地模拟优先使用 CLI 注入 native 入站事件：

```bash
oneworks channel oneworks-main simulate \
  --room demo-room \
  --sender user-demo \
  --message-id sim-1 \
  --secret replace-with-dev-secret \
  "@OWO hi"
```

也可以用结构化 payload：

```bash
oneworks channel simulate --channel oneworks-main \
  --secret replace-with-dev-secret \
  '{ "roomId": "demo-room", "senderId": "user-demo", "text": "@OWO hi" }'
```

如果命令运行在 OneWorks native channel session 中，`simulate` 会复用当前 context 的 `channelKey`、`senderId` 和 group `roomId`，可以简写为 `oneworks channel simulate "@OWO hi"`。在飞书、微信等非 native channel context 中不会复用当前 channelKey，必须显式传 `--channel`。

CLI 会 POST 到统一 webhook，并自动为原始 body 生成时间戳、nonce 和 HMAC SHA-256 签名。需要排查原始 HTTP 时，可以用相同规则手工签名：

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

签名输入严格为 `timestamp + "\n" + nonce + "\n" + rawBody`。时间戳使用 13 位毫秒值，有效窗口为 5 分钟；nonce 会按 `channelKey` 先取得覆盖签名剩余有效期的 processing reservation，消息成功交给 receiver 后才持久化为 consumed，受控失败则立即释放以允许平台重试。这样长耗时处理不会在尚未结束时被同一签名并发重放，已成功的重复请求即使跨进程或重启也会被拒绝。

payload 字段：

- `roomId`：群/房间 id；存在时默认 `sessionType=group`。
- `senderId`：发送者 channel account id，会进入 identity middleware。
- `messageId`：可选；不传会自动生成，用于去重。
- `text`：文本消息。
- `contentItems`：可选，结构与 OneWorks chat content item 一致。
- `sessionType`：可选，`group` 或 `direct`。

如果没有配置 `webhookSecret`，native channel 默认拒绝 webhook。只有显式设置 `allowInsecureWebhooks: true`，且远端地址和 Host 都是 loopback 时才允许无 secret 的本地 simulation；共享、公网或反向代理环境必须配置 secret。

模拟消息或 native channel session 运行后，可以查看出站调试消息：

```bash
oneworks channel oneworks-main debug outbound
oneworks channel oneworks-main debug outbound --limit 5
oneworks channel oneworks-main debug outbound --clear
```

这个命令读取 `/api/channels/<channelKey>/debug/outbound`，当前由 OneWorks native channel 支持。它是内存里的本地出站观察面，用来验证 bot 实际准备发给频道的内容；它不是持久化 room transcript，也不是完整 runtime trace。

## WeChat 频道

WeChat 频道基于 WechatApi 回调接入，公网入口固定为：

```text
<server public endpoint>/channels/wechat/<channelKey>/webhook?secret=<webhookSecret>
```

最小配置示例：

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

- WechatApi 文档入口是 https://post.wechatapi.net/a2；管理后台 / TokenId 获取入口是 https://newmanager.wechatapi.net。平台接入页说明：开通 API 权限后，在访问控制里填写消息回调地址并复制 TokenId；本频道的 `token` 就填这个 TokenId。消息回调和 API 规范见 https://post.wechatapi.net/doc-4217385；本频道发送回复使用的文本接口是 https://post.wechatapi.net/message/posttext。
- `server.public.schema` / `domain` / `port` 会拼成 WechatApi 能访问到的公网 server 地址；临时验证可以用 tunnel，长期运行应使用稳定反向代理或 Cloudflare Tunnel。单个 channel 如需覆盖，可继续配置 channel 级 `serverBaseUrl`。
- 公网 Host 下 server 默认放行 `/channels/*/*/webhook`，不需要在 `publicPaths` 或 channel 配置里重复声明；其他额外公网 path 可以通过 `server.publicPaths` 配置。
- 是否真正暴露某个 channel webhook 由对应 channel 配置控制，例如 `enableWebhook: false`。
- `webhookSecret` 必填；server 会校验 query `secret`，也兼容 `x-oneworks-channel-secret` / `x-wechatapi-secret` header。
- `enableWebhook: false` 可关闭该 channel 的 HTTP webhook；关闭后即使 public path guard 放行了 `/channels/*/*/webhook`，对应 channel 仍返回 404。
- 入站文本 `MsgType: 1` 会作为文本进入 agent；图片 `MsgType: 3` 会优先使用回调里的图片数据或调用 WechatApi `/message/downloadImage` 生成图片 `contentItems`，同时保留预览 data URL 和本地临时文件路径；GIF 表情 `MsgType: 47` 会抽取第一帧、中间帧、最后一帧三张 PNG，并作为图片附件一起发送给 agent；语音、视频、分享/文件会先转成结构化文本摘要。
- 当频道配置了 `multimodalModel` 时，包含图片附件的入站消息会使用该模型，避免文本优先模型收到图片后无法识别内容；普通文本消息仍按默认模型或会话模型执行。
- `appId` 建议显式配置；如果缺省，server 会使用最近一次有效回调里的 `Appid`，但重启后已有会话可能无法主动回复。
- 只要能从 `server.public` 或 channel 级 `serverBaseUrl` 生成回调地址，频道启动时默认会在后台调用 WechatApi `/login/setCallback` 自动写入回调地址；`callbackToken` 未配置时复用 `token`。如需关闭，显式设置 `"autoRegisterCallback": false`。
- 如果 WechatApi 账号在线但重启后不再推送真实用户消息，可配置 `"autoReconnectOnStart": true`；频道启动时会先对配置的 `appId` 调用 `/login/reconnection`，再重新注册 callback。
- 如果 `access.admins` 缺失或为空，频道启动时 server 会在日志里打印 `/authorize-admin <token>` 授权指令。该指令不会通过微信自动下发；未授权用户只会收到“管理员尚未初始化，请联系服务维护者获取授权指令。”。维护者从启动日志中取出指令后，通过可信渠道交给目标用户，由对方在同一个 channel 发送该指令完成首次管理员授权。服务重启会生成新的内存 token；package 级维护与配置细节见 `packages/channels/wechat/README.md`。
