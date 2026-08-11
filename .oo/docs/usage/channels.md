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

频道触发的 agent 会话会把当前 channel 绑定信息、当前消息上下文路径和一段轻量 `oneworks mem` 使用提示注入到 adapter 环境，agent 可以在 shell 里调用 `oneworks mem` 读写记忆。记忆文件默认保存在 server data 目录下的 `channel-memory/v1/`，不写入用户 workspace。

channel session 中的 `oneworks mem` 和 `oneworks channel` 是已注入的环境能力；提示词会要求 agent 直接按示例调用，不要先用 `which oneworks`、`oneworks --help` 等探测命令确认 CLI 是否存在。只有命令失败、示例不足或用户明确要求时才查询帮助。

server 会在每条入站消息调度前刷新当前消息上下文文件；群聊里 `oneworks mem -s user` 会按当前消息发送者解析 sender id，不依赖 session 启动时的静态 env。

每轮调度前，server 会把当前 `entity`、`channel`、`conversation` 和 `user` 的默认 `README.md` 同步到结构化 Memory Resolver，再按组织、实体、频道、canonical user/account、来源会话类型、可见性、敏感级别和过期时间过滤后生成受预算限制的 MemorySnapshot。channel/user 文件路径同时按 channel key 隔离，user 文件再按 `direct` / `group` 物理隔离，私聊内容不会被后续群聊写入重分类。子会话终态会再次检查文件变化，提交结构化写回并记录审计；没有变化也会记录 `terminal_check`。同一 canonical user 在不同平台绑定后可以复用结构化 user 记忆，同一实体在多个 ChannelLink 工作时可以复用 entity 记忆。

默认 scope 是 `channel`，默认路径是 `README.md`，默认 id 是当前平台会话 id：

```bash
oneworks mem set "长期偏好：回复前先确认线上链路是否可达。"
oneworks mem patch -p ./reference/wechat.md "WechatApi 重连后要重新注册 callback。"
oneworks mem get
oneworks mem get -c wechat -f group_or_wxid
oneworks mem list
```

所有 subcommand 都支持：

- `-p, --path <path>`：指定或过滤 id 下的文件路径，必须是相对路径；`get` / `set` / `patch` 默认 `README.md`，`list` 不传时列出全部路径。只有默认 `README.md` 自动进入结构化 resolver；自定义 reference 文件需要 agent 显式读取。
- `-c, --channel <channel>`：指定或过滤 channel，例如 `wechat`。
- `-f, --filter <id>`：指定或过滤平台相关 id；`get` / `set` / `patch` 用它定位目标，`list` 用它过滤结果。
- `-s, --scope <scope>`：记忆维度，支持 `global`、`entity`、`channel`、`conversation`、`session`、`user`。

scope 语义：

- `global`：CLI 可显式读取的全局文件，不自动注入频道 prompt。
- `entity`：当前实体跨 ChannelLink 复用的长期经验。
- `channel`：按当前平台会话 id 存储，跨 One Works session 可复用。
- `conversation`：按稳定对话状态存储，新的物理 ChildSession 会继续加载。
- `session`：按当前物理 ChildSession id 存储，只适合本轮临时工作信息，不参与自动 resolver。
- `user`：文件按平台用户 id 存储；结构化写回在存在身份绑定时归属 canonical user。

`oneworks mem` 有独立权限键 `bash-oneworks-mem`；channel runtime 会默认允许这个内置窄权限，无需写入项目配置。它只放行 `get`、`list`、`set`、`patch` 这组记忆 CLI 子命令，不放开整个 Bash。

## Agent 侧频道发送

频道 session 会把当前 channel key、平台会话 id、reply receive id 和当前消息上下文路径注入到 adapter 环境。agent 如需主动向频道发送消息，应使用 CLI，而不是依赖 session 过程消息自动透传：

```bash
oneworks channel erjie send "已完成配置，稍后会继续观察链路。"
oneworks channel send "这条会发到当前上下文默认目标"
oneworks channel send '{ "type": "text", "text": "把 `help` / `reset` 放后面。" }'
oneworks channel erjie send '{ "type": "image", "src": "https://example.com/result.png" }'
oneworks channel erjie send "oneworks 主命令也支持同样能力"
```

- `oneworks channel [channelKey] send <text|payload>` 默认从当前 channel 上下文解析 `channelKey`、`receiveId` 和 `receiveIdType`；CLI 和 Agent Tool 共用同一个 `channel.send` 命令内核，一个 ChildSession 可以连续调用多次，每次调用只形成一条外部投递，不会因此创建新的 ChildSession。
- 在 Room 中，默认目标是当前入站消息的原始 ChannelLink。跨平台或同平台跨账号发送只能显式选择当前实体可用的 Room ChannelLink，不会自动广播；成功和失败的外部发送都会写入本地 Room 时间线，并保留平台、账号、会话、provider message reference、导航能力和错误状态，界面默认只显示紧凑的平台图标，完整目标信息按需展开。
- 需要覆盖目标时使用 `--to <receiveId>` 和 `--receive-id-type <type>`；本地 server 地址可用 `--server <baseUrl>` 覆盖。One Works Chat History 是 agent 的内部工作记录和简短思路摘要，不等同于已经发送给外部频道用户的消息；对外可见的回复、澄清、通知、图片、文件或表情应通过 `oneworks channel` CLI 触发，发送后 stop 文本只保留简短内部总结，避免复述已经发出的完整话术。
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
- `oneworks channel command invoke <toolName> [jsonInput]` 会携带当前 child run 的短期签名 token；server 由 token 关联的持久化 actor snapshot 和不可变 delivery binding 重建执行上下文，并按当前消息发送者、频道管理员配置、identity link 和授权请求状态执行。CLI 不能自报或切换成机器人、老板、企业管理员或当前登录用户。
- 输出只回到 shell / Chat History，不会自动发到外部频道。需要让群里看到结果时，再用 `oneworks channel send "..."` 发一条简短摘要。
- 当前 One Works 不支持多账号登录闭环，因此 `actor identity` 和 `actor credential` 是分开的：发送者身份可用于权限判断、审计和授权归属；需要代表该用户调用个人 API 时，仍必须先走授权请求，不能借用当前桌面登录态、CLI app 或 bot app secret。
- 从 channel session 内调用 typed command 时，server 只接受当前消息上下文文件中的 invocation token、tool name 和 input；调用方提供的 sender、channel、session 或 reply target 不参与授权。token 过期、跨 channel 使用或无法与 child run / session snapshot / delivery binding 一致时，命令会被拒绝。
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
  "entity": "support-assistant",
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
- 管理员初始化完成后，私聊也必须命中 direct ChannelLink；`allowPrivateChat` 只控制 transport access，不能代替实体绑定。未绑定私聊会关闭失败，不创建无实体 ChildSession。
- `authorization.deliveryThrottleMs` 控制同一个授权请求重复送达的节流窗口，单位毫秒；默认 `1200000`，也就是 20 分钟。
- `authorization.resume.mode` 控制授权处理后的续接方式：`immediate` 会在 grant / deny 后自动创建 `system_resume` child run；`manual` 只记录 resolved pending intent，等待管理员或 agent 通过 `channel.auth.resume` 显式恢复；`next_message` 等待同一 owner、同一 thread 的下一条相关消息，并把恢复上下文注入那一轮 child run。`authorization.resume.delayMs` 可给 `immediate` 增加最小延迟。
- 权限请求送达后会记录 `delivery` 和平台返回的 `deliveryMessageId`，后续 grant / deny 会同步关闭关联的 pending intent。
- 当前单账号兼容阶段，自动续接会以原 session 为 parent 和 workspace 来源创建新的 ChildSession，不会向旧 runtime 追加消息；这不等于获得外部发送者的个人登录态。需要用户级 API 时仍必须检查 `credentialSubjectUserId` 对应凭证是否存在，否则继续走授权、降级或拒绝。

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

## 平台接入

Lark、OneWorks Native 与 WeChat 的配置示例和接入经验见 [Channel 平台接入](./channel-platforms.md)。

## OneWorks Channel 与聊天室

频道连接、凭证和 ChannelLink 仍由 OneWorks 内置频道能力统一管理，不需要再安装一个“管理所有频道”的插件。OneWorks 自身由两个可独立运行的部分组成：

- `@oneworks/channel-oneworks` 是与 Lark、WeChat 同级的正式 Channel provider，负责标准收发、签名 webhook、平台引用和导航能力；没有产品插件时仍可正常工作。
- `@oneworks/plugin-channel-oneworks` 是 OneWorks 聊天室产品入口，提供本地 Room、显式分享、OneWorks 模拟场景、脱敏运行链路和消息导航偏好；它不管理 Lark/WeChat 连接，也不替代会话管理。

一个 Room 可以绑定跨平台和同平台多账号的多个 ChannelLink。每条入站消息保留来源，每条 Agent 外发保留目标；二者互不覆盖。Room 的完整消息、run、记忆和投递记录只保存在创建它的 owner 节点。只有显式分享的 Room 才会向 Relay 发布 descriptor 和 ACL；owner 离线时远端只能看到 Room 存在但不可用，Relay 不保存 transcript，也不排队离线消息。第一次分享 Room 时，需要选择当前在线的 Relay 所有者账号；只有一个在线账号时会自动选择。分享后远端 live 结果只包含消息正文、用户可见 label 和 opaque ref，不返回平台 channel/account/message/thread ID、session ID 或原始投递目标。每个远程写操作都必须传稳定的 `x-oneworks-room-operation-id`，并在传输失败后复用；owner 会在调用外部会话前先认领该 operation，因此重试不会重复执行同一副作用。聊天室产品 API 的 principal 由 host 请求派生：已登录 Web 账号和关闭认证的本机 loopback workspace 获得 workspace read/manage 权限；关闭认证的远程请求不获得 principal，并按 fail-closed 拒绝。
“已分享”会聚合当前启用且登录有效的 Relay 账号所能看到的公开 Room 关系；单个账号不可达不会影响其他账号。在线状态来自 owner 实时隧道，而不是仅凭本地配置或历史 descriptor 推断；owner 重连后会重新发布显式分享。目录不会暴露 account key、session token、owner ID、owner-local Room ID 或 transcript。
消息导航顺序由 OneWorks 聊天室插件自己的设置保存，可分别覆盖 provider 和 channel account。provider 只贡献真实可用的消息、会话、网页、原生应用或应用首页引用；用户可以选择优先在右侧 WebView、外部浏览器、原生应用或应用首页打开。

OneWorks Simulation 会为每次请求生成新的 nonce、时间戳和 webhook 签名，再走同一个 OneWorks webhook、connection 与入站 middleware 链路。管理员和普通参与者场景都使用隔离的 synthetic principal；场景角色只用于 prompt 与审计，不授予真实管理员权限，也不会借用配置中的真实管理员 ID。`/access`、`/availability` 等指令仍经过同一 sender-scoped 权限裁决，synthetic principal 未列入频道管理员配置时会被拒绝。界面只显示安全 fingerprint、计数、状态和原因，不显示实际频道 ID、发送者 ID、签名、凭证字段或原始 payload。产品插件缺席不会影响任何 Channel 的收发链路。交付或复查频道矩阵时，可以运行只读验收命令：

```bash
pnpm tools channel-acceptance --workspace . --channel-type lark --expect-channels 10 --expect-entities 10 --expect-groups 6 --expect-links 20 --require-admins --require-credentials --require-group-allowlist --json
```

需要把运行态纳入验收时再传 `--db <runtime.sqlite>`。命令只输出矩阵计数、状态分组、短 fingerprint 和 violation code，不输出 app secret、群 ID、用户 ID、真实名称、原始消息或数据库路径。
