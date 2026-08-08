# Channel 会话绑定

## 基本语义

- channel 入口不是直接绑定到某个裸工作目录，而是绑定到 `session`。
- `session` 再绑定自己的 workspace；当 workspace 模式启用时，这个 workspace 通常是独立的 managed worktree。
- 因此，在 channel 里切换 session，本质上也会切换到另一个 session 对应的 workspace。

## 当前行为

- 新建 session 默认复用当前共享 workspace。只有调用方或配置显式启用 worktree 时，server 才会创建独立 managed worktree；显式 worktree 创建失败时会中止 session 创建。
- 删除 session 时，server 会清理它绑定的 managed worktree；如果 worktree 里还有未提交改动，默认会拒绝删除，必须显式强制。
- `/session` 会显示当前绑定 session 的 workspace 路径、模式和清理策略。
- `/session bind <id>` 在切换会话后，会回显目标 session 当前绑定的 workspace。

## 入口对齐

- Web UI、terminal、Git 面板、文件引用器都按当前 session 的 workspace 解析运行目录。
- channel 命令层不直接管理 `git worktree`；它只负责切换 session，workspace 切换由底层统一完成。

## Agent 侧频道记忆

频道触发的 agent 会话会把当前 channel 绑定信息、当前消息上下文路径和一段轻量 `oneworks mem` 使用提示注入到 adapter 环境，agent 可以在 shell 里调用 `oneworks mem` 或 `oneworks mem` 读写记忆。记忆文件默认保存在 server data 目录下的 `channel-memory/v1/`，不写入用户 workspace。

channel session 中的 `oneworks mem` / `oneworks mem`、`oneworks channel` / `oneworks channel` 是已注入的环境能力；提示词会要求 agent 直接按示例调用，不要先用 `which oneworks`、`oneworks --help` 等探测命令确认 CLI 是否存在。只有命令失败、示例不足或用户明确要求时才查询帮助。

server 会在每条入站消息调度前刷新当前消息上下文文件；群聊里 `oneworks mem -s user` 会按当前消息发送者解析 sender id，不依赖 session 启动时的静态 env。

默认 scope 是 `channel`，默认路径是 `README.md`，默认 id 是当前平台会话 id：

```bash
oneworks mem set "长期偏好：回复前先确认线上链路是否可达。"
oneworks mem patch -p ./reference/wechat.md "WechatApi 重连后要重新注册 callback。"
oneworks mem get
oneworks mem get -c wechat -f group_or_wxid
oneworks mem list
```

所有 subcommand 都支持：

- `-p, --path <path>`：指定或过滤 id 下的文件路径，必须是相对路径；`get` / `set` / `patch` 默认 `README.md`，`list` 不传时列出全部路径。
- `-c, --channel <channel>`：指定或过滤 channel，例如 `wechat`。
- `-f, --filter <id>`：指定或过滤平台相关 id；`get` / `set` / `patch` 用它定位目标，`list` 用它过滤结果。
- `-s, --scope <scope>`：记忆维度，支持 `global`、`channel`、`session`、`user`。

scope 语义：

- `global`：全局跨频道记忆，不需要平台 id。
- `channel`：按当前平台会话 id 存储，跨 One Works session 可复用。
- `session`：按当前 One Works session id 存储。
- `user`：按平台用户 id 存储；如果平台没有提供 sender id，私聊会回退到 channel id。

`oneworks mem` / `oneworks mem` 有独立权限键 `bash-oneworks mem`；channel runtime 会默认允许这个内置窄权限，无需写入项目配置。它只放行 `get`、`list`、`set`、`patch` 这组记忆 CLI 子命令，不放开整个 Bash。

## Agent 侧频道发送

频道 session 会把当前 channel key、平台会话 id、reply receive id 和当前消息上下文路径注入到 adapter 环境。agent 如需主动向频道发送消息，应使用 CLI，而不是依赖 session 过程消息自动透传：

```bash
oneworks channel erjie send "已完成配置，稍后会继续观察链路。"
oneworks channel send "这条会发到当前上下文默认目标"
oneworks channel send '{ "type": "text", "text": "把 `help` / `reset` 放后面。" }'
oneworks channel erjie send '{ "type": "image", "src": "https://example.com/result.png" }'
oneworks channel erjie send "oneworks 主命令也支持同样能力"
```

- `oneworks channel [channelKey] send <text|payload>` 默认从当前 channel 上下文解析 `channelKey`、`receiveId` 和 `receiveIdType`。
- 需要覆盖目标时使用 `--to <receiveId>` 和 `--receive-id-type <type>`；本地 server 地址可用 `--server <baseUrl>` 覆盖。
- One Works Chat History 是 agent 的内部工作记录和简短思路摘要，不等同于已经发送给外部频道用户的消息。对外可见的回复、澄清、通知、图片、文件或表情应通过 `oneworks channel` / `oneworks channel` CLI 触发；发送后 stop 文本只保留简短内部总结，避免复述已经发出的完整话术。
- 文本包含 Markdown 反引号、`$`、括号等 shell 敏感字符时，不要用双引号包住整段正文；优先使用单引号 JSON payload（如上面的 `type: "text"` 示例），避免 shell 命令替换触发额外权限请求。
- 文本载荷直接发送文本；对象载荷支持 `type: "image"` / `type: "file"` 和 `src`。WeChat 图片走 WechatApi `/message/postImage`，因此 `src` 应是平台可访问的图片 URL；支持文件发送的频道可以由 server 读取本地文件或下载 URL 后发送。
- 平台自定义表情按通用 emoji registry 复用：`oneworks channel emoji list --platform wechat --sendable` 查看可发送素材，`oneworks channel emoji list --platform wechat --tag 赞同` 按标签找素材，`oneworks channel emoji list --platform wechat --recent --limit 5` 查看最近自动登记的素材，`oneworks channel emoji get thumbs-up-bear --platform wechat` 读取备注，`oneworks channel emoji send thumbs-up-bear --platform wechat` 发送。保存技术字段用 `oneworks channel emoji save thumbs-up-bear --platform wechat --emoji-md5 ... --emoji-size 102357 --label 点赞小熊 --alias 赞`；补充语义用 `oneworks channel emoji annotate thumbs-up-bear --platform wechat --tag 赞同 --note "适合回应认可、赞赏或没问题"`。WeChat 底层走 `/message/postEmoji`；只有在素材表里有 `emojiMd5` 和 `emojiSize` 时才能发送自定义表情，否则用普通文本或 Unicode emoji 回复。
- WeChat 群聊里如果要发送文本并 @ 成员，正文里必须包含可见 `@昵称` / `@群名片` / `@所有人`，同时通过 CLI 参数传递真实 wxid：`oneworks channel send --at wxid_target "@张三 已处理"`；多人可重复 `--at` 或用 `--ats wxid_a,wxid_b`；@所有人使用 `--at-all "@所有人 服务已恢复"`，底层会转成 WechatApi `ats: "notify@all"`。
- 所有 channel 群聊都不会自动发送 runtime 过程消息，只有 agent 显式调用 `oneworks channel` 才会往群里发普通内容；权限确认和 fatal error 仍会自动发送，避免任务无反馈地卡住或失败。
- WeChat 私聊保留兼容性的首条/stop 自动回传策略；agent 提示词会优先要求通过 `oneworks channel` 主动发送外部回复，并把 Chat History / stop 文本控制为内部简短总结，避免重复打扰用户。
- 频道发送命令有独立权限键 `bash-oneworks channel-send`；channel runtime 会默认允许这个内置窄权限，无需写入项目配置。它只放行 `oneworks channel ... send`、`oneworks channel emoji ...` 及对应 `oneworks channel ...` 窄命令，不放开整个 Bash。

## Agent 侧频道命令工具

运行中的 channel agent 需要查询或调整频道内部状态时，不应往群里发送 `/auth`、`/session`、`/access` 这类斜杠命令，而应使用 sender-scoped 的 typed command CLI：

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

- `oneworks channel command list` 会列出当前版本可调用的 `channel.*` typed tools、slash usage 和权限等级。
- `oneworks channel command invoke <toolName> [jsonInput]` 会把当前 channel context 传给 server，并按当前消息发送者、频道管理员配置、identity link 和授权请求状态执行；它不能切换成机器人、老板、企业管理员或当前 CLI 登录用户。
- 输出只回到 shell / Chat History，不会自动发到外部频道。需要让群里看到结果时，再用 `oneworks channel send "..."` 发一条简短摘要。
- 当前 One Works 不支持多账号登录闭环，因此 `actor identity` 和 `actor credential` 是分开的：发送者身份可用于权限判断、审计和授权归属；需要代表该用户调用个人 API 时，仍必须先走授权请求，不能借用当前桌面登录态、CLI app 或 bot app secret。
- 从 channel session 内调用 typed command 时，server 会优先使用该 session 的 `channelActorSnapshot` 作为真实发送者上下文；CLI 传入的 `context` 只能补齐缺失字段，不能把 sender、channel 或 session type 改成另一个人 / 另一个群。若两者冲突，命令会被拒绝。
- 排查权限归属时，先用 slash `/whoami` 或 typed `channel.whoami` 查看 sender、channel account、canonical user、identity link 和 credential 数量。看到 canonical user 只说明身份已绑定；credential 为 0 或非 active 时，仍不能代表该用户执行个人 API。
- 跨频道账号绑定使用 `/identity link`：先在已控制的账号生成短期 code，再在另一个账号执行 `/identity link <code>`。该流程只证明两个 channel account 属于同一个 canonical user，不会复制 credential，也不会让新账号继承旧账号的 API 登录态。
- 授权请求里 `requesterUserId/requesterAccountId` 表示触发消息的人，`credentialSubjectUserId` 表示真正需要补齐凭证的人。两者不一致时，pending intent 会交给 credential subject，避免把资源 owner 授权误记成触发者授权。
- `channel.auth.list` 默认只列当前发送者待处理授权请求；传 `{ "scope": "resumable" }` 时列出可恢复的 resolved pending intent。普通用户只能看到自己名下的任务；管理员可以看到当前频道类型下全部可恢复任务，再用 `channel.auth.resume` 继续。

当前没有多账号登录闭环时，推荐按 `single-login runner mode` 理解权限：

- 当前桌面登录态 / CLI profile 只是本地运行器权限，可以启动 session、读写项目和调度 runtime。
- bot app secret 是 service principal，可以收发机器人消息和执行 app 级能力。
- 频道发送者是 actor identity，用于权限裁决、审计、记忆和授权归属。
- 只有用户显式授权后的 credential principal 才能代表该用户执行个人 API。

如果工具需要用户级 credential，而当前 actor 或资源 owner 没有 active credential，应创建授权请求、降级或拒绝；不要借用当前桌面用户、CLI app、机器人应用或房间 owner 的权限。

## 频道链接配置

`.oo.config.json` 里的 `channels` 只声明平台连接和凭证；具体某个群/私聊入口绑定哪个实体，放在 `.oo/channels/<link>/channel.json`：

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

- 一个 channel link 只绑定一个实体。
- `authorization.deliveryThrottleMs` 控制同一个授权请求重复送达的节流窗口，单位毫秒；默认 `1200000`，也就是 20 分钟。
- `authorization.resume.mode` 控制授权处理后的续接方式：`immediate` 会在 grant / deny 后自动创建 `system_resume` child run；`manual` 只记录 resolved pending intent，等待管理员或 agent 通过 `channel.auth.resume` 显式恢复；`next_message` 等待同一 owner、同一 thread 的下一条相关消息，并把恢复上下文注入那一轮 child run。`authorization.resume.delayMs` 可给 `immediate` 增加最小延迟。
- 权限请求送达后会记录 `delivery` 和平台返回的 `deliveryMessageId`，后续 grant / deny 会同步关闭关联的 pending intent。
- 当前单账号兼容阶段，自动续接只恢复原 One Works session 的内部执行上下文，不等于获得外部发送者的个人登录态。需要用户级 API 时仍必须检查 `credentialSubjectUserId` 对应凭证是否存在，否则继续走授权、降级或拒绝。

## Channel 过程控制指令

以下指令都需要频道管理员权限。

- `/silent [sessionId]`：静默当前或指定 One Works session。被静默的 session 仍可在 Chat History 里处理上下文，但不能再通过 `oneworks channel` / `oneworks channel` CLI 主动发送频道消息。
- `/stop [sessionId]`：在群聊里停止接收当前群的普通消息。实现上会把当前群 `channelId` 写入 `access.blockedGroups`；管理员仍可发送 `/start` 恢复。
- `/start [sessionId]`：从 `access.blockedGroups` 移除当前群，恢复接收消息。
- `/ban @senderId`：把指定 sender ID 写入 `access.blockedSenders`，后续该发送者消息会在进入会话上下文前被过滤。`@` 前缀会自动去掉；在 WeChat 群里建议使用聊天上下文里显示的原始 `wxid`。
- 运行中的 agent 进程停止改用 `/session stop`，避免和群聊接收控制的 `/stop` 混淆。

## 群聊消息防抖

群聊里的普通消息会默认做短暂防抖合并，避免用户连续发送多条短消息时触发多次 agent 调度。防抖只作用于非 slash command 消息；以 `commandPrefix` 开头的命令（默认 `/help`、`/reset` 等）会立即执行，不等待合并窗口。正在等待权限或确认问题时，用户回复也会立即作为 interaction response 处理。

默认合并窗口是 `1200` 毫秒，可在单个 channel 配置中覆盖：

```json
{
  "channels": {
    "wechat": {
      "type": "wechat",
      "groupMessageDebounceMs": 2000,
      "multimodalModel": "gpt-5.5"
    }
  }
}
```

设为 `0` 可关闭群聊普通消息防抖。合并后的内容会保留每条消息的发送者前缀，例如 `[wxid_a]: ...` 与 `[wxid_b]: ...` 会一起进入同一次 agent 输入。包含图片等非纯文本 `contentItems` 的群聊消息会立即放行，避免合并时丢失附件。

`multimodalModel` 可选；配置后，频道消息里包含图片附件时会用该模型创建或恢复会话。适合默认模型偏向低延迟文本、但不稳定支持视觉输入的场景；未配置时继续使用项目默认模型。

## Lark 频道

Lark / 飞书频道使用开发者后台里的自建机器人应用接入。最小配置只需要应用凭证和可选的群白名单：

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

配置步骤：

- 在飞书开放平台创建企业自建应用，添加「机器人」能力；不要走“飞书智能体 / AI Agent / 妙搭”应用入口。
- 权限至少开启消息接收与发送相关权限，例如 `im:message`、`im:message:readonly`、`im:message:send_as_bot`。需要用 CLI 或 OpenAPI 管理群成员时，再给用于操作的应用授权 `im:chat.members:write_only`、`im:chat:read`、`im:chat:update` 等 IM 权限。
- 在「事件与回调」里把订阅方式配置为长连接，并订阅消息接收事件 `im.message.receive_v1`；保存订阅后仍需发布线上版本才会生效。服务启动日志出现 `[channels] channel connected` 只代表长连接客户端已连上；是否能收到群消息还取决于事件订阅是否已发布生效。
- 如果机器人要进外部群，必须在版本发布页开启「允许机器人被添加到外部群中使用」，提交发布并由企业管理员审核通过。只保存草稿或停在“审核中”时，线上不会生效。权限、事件订阅、头像、名称和外部群开关等开放平台改动也应以发布后的线上版本为准。
- `appId` / `appSecret` 填 One Works 实际要监听和回复的机器人应用，不要误用个人 CLI 测试应用。多个角色机器人用于群内演示时，通常只把其中一个“演示服务”机器人配置到 One Works channel，其余角色机器人只是飞书群成员。
- `access.allowedGroups` 使用飞书群 `chat_id`（`oc_...`）。`access.admins` 使用该接入应用看到的用户 `open_id`，不同应用下同一个人的 `open_id` 可能不同；这些 ID 应从同一个 channel bot app 的视角解析。

接入经验：

- 区分「通道机器人应用」和「CLI 操作用应用」。通道配置里的 `appId` / `appSecret` 应指向真正负责监听和回复的机器人；群创建、拉人、查成员、发用户消息等 CLI 操作应固定使用一个专门的 `lark-cli --profile`，不要临时借用当前 active profile。
- 飞书开放平台里应使用企业自建应用的「机器人」能力，不要走“智能体应用”创建入口。智能体应用适合飞书智能体生态，但不等同于 One Works Lark channel 的 bot 接入。
- 角色矩阵演示时，可以创建多个机器人作为群成员，但通常只把一个演示服务机器人接到 One Works channel。这样能避免多个 bot app 的凭证、事件订阅和回复身份互相混淆。
- 外部群链路要同时满足三件事：目标群是外部群，机器人发布版本允许加入外部群，执行成员管理的 CLI 应用本身也具备对应外部群能力。只配置被邀请机器人不够；创建群后应立刻确认群确实是外部群，误建内部群时建议解散并重新创建外部群。
- 使用 CLI 自动化管理群成员时，`lark-cli auth status --profile <name> --json` 可先判断用户 token 状态。若显示 `needs_refresh` 但还有 `offline_access` 且 refresh token 未过期，下一次用户身份 API 调用通常会自动刷新，不一定需要重新扫码。
- 修改项目的 channel 配置文件后，正在运行的 server 可能仍持有旧的长连接。需要重启或确认 channel 已重新连接后，再做真实群消息验证。
- 闭环验证建议分两步：先用 bot 身份发送一条消息确认 `appId` / `appSecret` 和 `im:message` 可用；再用用户身份在目标群里发一条普通消息，确认长连接事件、allowedGroups、session 调度和回复都生效。不要用机器人自己发给自己当作入站验证；只有 bot 自发消息和 server connected 日志还不算完整入站闭环。

排查提示：

- 飞书头像生成页 `https://oneworks.cloud/avatar/` 是预览 / 导出页面，不是图片直链。给开放平台设置头像时，应从 Avatar 页面导出真实图片文件，或用项目提供的 avatar 工具生成 PNG/JPEG 后上传；不要把预览页面 URL 当头像 URL。
- 开放平台页面可以手动上传头像；需要自动化时，基础信息 API 支持先 `POST /open-apis/application/v7/app_avatar/upload` 上传图片，再 `PATCH /open-apis/application/v7/applications/:app_id/base` 设置 `avatar_url`。该流程需要 `application:application:patch` 权限，修改后仍需发布并过审才会上线。
- 用 `lark-cli` 管理外部群成员时，要显式指定正确 profile。默认 active profile 可能是另一个公司或另一个测试应用。
- 外部群管理会校验“调用方应用”本身的外部群能力。即使被邀请的机器人已经允许进外部群，如果执行 `chat.members.create` 的 profile 不是已发布且允许外部群的应用，可能返回 `232033`。

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

`.oo/channels/wan-ke-native/channel.json` 里绑定具体房间和实体：

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

本地模拟优先使用 CLI 注入 native 入站事件：

```bash
oneworks channel oneworks-main simulate \
  --room wan-ke-native \
  --sender user-yijie \
  --message-id sim-1 \
  --secret replace-with-dev-secret \
  "@OWO hi"
```

也可以用结构化 payload：

```bash
oneworks channel simulate --channel oneworks-main \
  --secret replace-with-dev-secret \
  '{ "roomId": "wan-ke-native", "senderId": "user-yijie", "text": "@OWO hi" }'
```

如果命令运行在 OneWorks native channel session 中，`simulate` 会复用当前 context 的 `channelKey`、`senderId` 和 group `roomId`，可以简写为 `oneworks channel simulate "@OWO hi"`。在飞书、微信等非 native channel context 中不会复用当前 channelKey，必须显式传 `--channel`。

CLI 会 POST 到统一 webhook；需要排查原始 HTTP 时可直接调用：

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

payload 字段：

- `roomId`：群/房间 id；存在时默认 `sessionType=group`。
- `senderId`：发送者 channel account id，会进入 identity middleware。
- `messageId`：可选；不传会自动生成，用于去重。
- `text`：文本消息。
- `contentItems`：可选，结构与 OneWorks chat content item 一致。
- `sessionType`：可选，`group` 或 `direct`。

如果没有配置 `webhookSecret`，native channel 默认拒绝 webhook。只有显式设置 `allowInsecureWebhooks: true` 且请求 Host 为 loopback 时才允许无 secret 的本地 simulation；共享或公网环境必须配置 secret。

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

- WechatApi 文档入口是 https://post.wechatapi.net/a2；管理后台 / TokenId 获取入口是 https://newmanager.wechatapi.net。平台接入页说明：开通 API 权限后，在访问控制里填写消息回调地址并复制 TokenId；本频道的 `token` 就填这个 TokenId。
- 相关平台文档：消息回调和 API 规范见 https://post.wechatapi.net/doc-4217385；本频道发送回复使用的文本接口是 https://post.wechatapi.net/message/posttext。
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
- 如果 `access.admins` 缺失或为空，频道启动时 server 会在日志里打印 `/authorize-admin <token>` 授权指令。该指令不会通过微信自动下发；未授权用户只会收到“管理员尚未初始化，请联系服务维护者获取授权指令。”。维护者从启动日志中取出指令后，通过可信渠道交给目标用户，由对方在同一个 channel 发送该指令完成首次管理员授权。服务重启会生成新的内存 token。
- package 级维护与配置细节见 `packages/channels/wechat/README.md`。
