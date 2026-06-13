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
