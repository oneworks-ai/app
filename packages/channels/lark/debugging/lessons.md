# 经验与坑位

## 下次执行速记

- 用户点名 `@chrome` 或任务依赖已登录 Chrome 时，先用 Codex Chrome 插件。插件断连先走轻量重试和只读排障；仍不稳时，说明现象，再经用户同意打开同 profile 新 Chrome 窗口重连。
- 配置 One Works Lark channel 时，只操作飞书开放平台“企业自建应用”的机器人能力；不要创建“飞书智能体应用”，不要把 CLI 操作用 app 当成 channel bot app。
- 头像、名称、权限、事件订阅、外部群开关等开放平台改动，保存草稿不算完成。必须创建版本、提交发布，并在版本详情页看到 `当前修改均已发布`、目标版本 `已发布`、`审核结果 通过`。
- 开放平台发布页按钮不响应时，Chrome 插件里优先用 `dom_cua.get_visible_dom()` 找 `保存` / `确认发布` 的 `node_id`，再 `dom_cua.click({ node_id })`；避免一上来抓完整 DOM snapshot。
- 文件选择器、系统权限弹窗或浏览器插件异常属于工具边界；选文件这种本地系统弹窗卡住时及时请用户接手，页面内保存、发布、确认这类普通按钮仍由 agent 自己继续完成。
- 群和 channel 闭环验证顺序：先确认目标群是外部群，再确认机器人和调用方 app 都允许外部群；最后用真实用户消息验证 `im.message.receive_v1`、`allowedGroups`、session 调度和群内回复。

## 先记住这些通用结论

- 一定要先从 DB 里拿到“当前这一轮”的 `sessionId`，再看 project home 下对应的 `logs/<ctx>/server/*.log.md` 或 server 日志。同一个 Lark 会话里可能已经积累了多轮历史问题和历史快捷气泡，只看 UI 很容易串台。
- 如果只是想验证完整闭环，优先直接回复文本选项，而不是点击旧消息附近同名的快捷气泡。长会话里可能同时存在多轮相同选项，文本回复更不容易点错历史节点。
- 区分清楚 `Queued interaction request`、`Delivered interaction request to bound channel`、`Received interaction response from channel` / `Resolved interaction response`。只看到排队，不代表用户已经能在 Lark 里看到题目。
- 对 channel-only 会话，不能把“DB 里有绑定”直接当成“当前一定可投递”。更稳的判断是：题目真的下发成功了，或者当前还有活跃 websocket。
- 调试权限问题时，要同时看 adapter 启动参数和 settings 文件；只看到 `defaultMode = bypassPermissions` 还不够，headless 模式下往往还需要真实 CLI flag 才能生效。
- MCP 工具拿 server API 结果时，要确认解包的是统一 envelope 里的真实结果，不能把 `success/data/result` 外层对象直接当最终答案。
- 开放平台应用基础信息、头像或名称修改后还要提交发布并过审。`application/v7/applications/:app_id/base` 只改草稿；头像要先用 `application/v7/app_avatar/upload` 上传图片拿 `avatar_url`，再 patch 到应用基础信息，最后调用 publish 或在页面发布。
- OneWorks 头像页是编辑 / 导出 UI，不是图片直链。外部平台要上传头像时，从编辑器导出 SVG 或 PNG 后再上传；不要把 `https://oneworks.cloud/avatar/` 页面 URL 当图片 URL。
- 飞书开放平台详情页是 SPA，直达 `/app/<app_id>/baseinfo` 或用自动化打开时可能先出现几秒空白 / 黑底。不要立刻判断为打不开；至少等到页面标题和主内容 DOM 都稳定，或重新抓一次 Computer Use 状态后再下结论。若标题已变成目标应用但内容区暂空，优先等待 / 重读状态，不要让用户接手验证。
- 用户明确要求 `@chrome` 或任务依赖已登录 Chrome 状态时，优先用 Codex Chrome 插件，不要默认退到 CUA、AppleScript 或 CLI。只有 Chrome 插件明确失败并已向用户说明后，才考虑 fallback。
- Chrome 插件出现 `native pipe is closed` 时，先按插件排障流程做轻量重试和只读检查：确认 Chrome 正在运行、Codex Chrome Extension 已安装启用、native host manifest 正常。若检查都通过，经用户同意后用同 profile 打开一个新 Chrome 窗口再重连；不要直接改 manifest、安装扩展或绕到系统脚本。
- 飞书开放平台页面 DOM 很重，完整 `domSnapshot()` 或大范围 `evaluate()` 容易超时甚至断开插件连接。优先用小范围状态读取，或者用 `dom_cua.get_visible_dom()` 找目标 `node_id`，再用 `dom_cua.click()` 点“保存”“确认发布”等按钮。
- 已打开的旧 Chrome 标签页有时会报 “not part of browser session”。这种情况下继续使用 Chrome 插件，但新建同登录态标签页并直达目标 Open Platform URL，通常比反复 claim 旧标签更稳。
- 页面视觉层、accessibility tree 和真实路由状态可能短暂不同步；发布确认弹窗也可能在后台已经成功后残留。不要在矛盾状态下反复盲点，先向用户说明观察到的矛盾，再用版本详情页的稳定信号核验：`当前修改均已发布`、`版本详情 已发布`、目标版本号、更新说明、`允许机器人被添加到外部群中使用` 和 `审核结果 通过`。
- 不要为了“再看一眼”反复截图或静默重试。优先用 URL、标题、DOM 小范围读取、可见 DOM node 和版本详情页文案做状态判断；如果必须截图或需要用户帮忙，先说明目的和当前卡点。
- OneWorks Lark channel 配置的是开放平台自建应用的 Bot 能力，不是飞书智能体应用。不要从 `open.feishu.cn/page/launcher` 入口创建“智能体应用”；应进入具体自建应用的基础信息、机器人能力、权限和发布配置页。
- 本仓当前 OneWorks 专用 `lark-cli` profile 固定叫 `owo-cli`。群管理、通讯录解析、用户身份消息等 CLI 操作都显式使用 `--profile owo-cli`；不要临时借用 active profile，也不要把 channel bot app profile 当通用 CLI app。换机器或换组织时先跑 `lark-cli auth status --profile owo-cli --json` 确认存在且身份正确。
- `lark-cli` 一定显式指定 `--profile`。同一台机器上的 active profile 可能属于别的公司或别的测试 app；`open_id` 也随 app 变化，切 app 后要重查管理员和外部联系人的 ID。
- 外部群成员管理校验调用方 app 的外部群能力。被邀请机器人允许进外部群还不够，执行 `chat.members.create` 的 profile 也需要是已发布并允许外部群的应用，否则可能返回 `232033`。
- `im.message.receive_v1` 事件订阅和长连接模式必须在开放平台发布后的版本里生效；只看到 server 日志 `[channels] channel connected` 不代表群消息事件一定会到。
- 开放平台权限、事件订阅、头像、名称、外部群可用范围等改动都要关注发布 / 免审 / 审核状态。排查时不要只看草稿页已保存，要确认线上版本已经生效；如果页面出现“去开启免审”或“进入管理后台审核”，继续处理到线上版本生效，不要停在“已提交”。

## 容易混淆的边界

- `interaction_request` 和普通 assistant 文本是两条不同的出站分支，调试时不要混看。
- 用户对问题的回复必须在 channel 层优先被消费成 `interaction_response`；否则模型会把选项文本当作新的普通输入，链路会偏。
- 快捷气泡更适合单选；多选或长会话复验时，直接回复文本通常更稳。

## 多角色机器人矩阵接入复盘

- 固定身份分工：`owo-cli` 是本仓当前 OneWorks 专用 `lark-cli` profile，负责群管理、通讯录解析、用户身份消息和验收查询；各 channel bot app 只负责 OneWorks channel 的监听和回复。不要把当前 active profile、CLI app、channel bot app 混成一个概念。
- `owo-cli` 的 user token 如果显示 `needs_refresh`，先跑 `lark-cli auth status --profile owo-cli --json`。当 profile 具备 `offline_access` 且 refresh token 仍有效时，可执行一次只读用户 API 让 CLI 尝试自动刷新；刷新失败再重新登录，不要直接假定必须扫码或一定能静默恢复。
- 建外部群前先定矩阵，再批量拉成员，减少返工；涉及创建群、拉外部成员、发送代表用户的消息或修改开放平台线上配置前，先列出群名、机器人、外部成员和用途，等用户确认后再执行。群名宜采用稳定、简短的项目前缀和场景名，不用容易失真的长副标题。
- 创建后立刻确认群是外部群（列表或群详情里应显示外部标签，也可用 API 字段确认 external）。如果错建成内部群，不要继续补机器人和 channel 配置，直接解散并按外部群重新创建，避免成员、权限和体验链路继续返工。
- 群角色要按场景收敛，不要为了“完整团队”把所有机器人塞进每个群。例如需求讨论只需要产品与设计，测试协作再加入研发与测试，发布协作才需要项目、研发、测试和运维；最终成员以用户确认的矩阵为准。
- “机器人已在群里”不等于“角色已接入 OneWorks”。如果每个角色都要独立回复，每个 bot app 都要有独立的 channel key 和 appId/secret；同一角色进入多个群时复用同一个实体，为每个 `bot app × chat` 建一个 ChannelLink。不要让一个 channel key 指向多个实体，也不要用单个演示 bot 的多群链接冒充完整机器人矩阵。
- 同一实体挂到多个群目前只保证复用实体定义和角色提示词，不代表已经实现跨群学习记忆。只有 MemoryResolver 的读取、筛选、写回和实体维度隔离都落地并完成验证后，才能把它描述为跨群记忆。
- 多机器人同群时不能仅凭渲染后的 `<at>` 文本判断意图。Lark 连接启动时应通过 `/open-apis/bot/v3/info` 获取当前 bot `open_id`，把结构化匹配结果传给入口门禁；`@` 其他机器人必须关闭失败。没有结构化 `@` 的 slash command 当前仍遵循 ChannelLink 的 `createOnCommand` 规则；外部多机器人群若不希望一条裸命令触发多个 bot，应关闭该入口，或先实现并启用“群命令必须 `@` 当前 bot”的显式策略。
- 需要批量找企业自建应用的 App ID 时，给专用 `owo-cli` app 增加 `admin:app.info:readonly`、发布生效，再调用 `GET /open-apis/application/v6/applications` 按应用名称核对 App ID、线上版本和状态。该管理员读取权限只放在 CLI 操作用 app，不必复制给每个角色 bot。
- 外部体验者是否进群要按演示目标和用户确认的成员矩阵决定；这是项目策略，不是 Lark channel 的技术要求，也不应固化真实姓名到通用接入文档。
- CLI 创建/拉群能完成大部分成员管理，但开放平台应用名称、头像、外部群可用范围、权限和发布审核仍经常需要页面确认。页面操作时进入具体自建应用详情，不要误点 `open.feishu.cn/page/launcher` 的智能体应用创建流。
- 头像策略要先生成真实图片文件再上传。`https://oneworks.cloud/avatar/?...` 是预览页面；开放平台头像 API 上传需要 `application:application:patch`，缺 scope 会报 permission violation。角色 bot 的名称、表情脸型、颜色和头像文件应登记成表，保证名字和头像一致。头像、名称、外部群开关改完都要发布/免审/审核后才算线上生效。
- Chrome/开放平台页面是 SPA，直达详情页或授权页时可能短暂黑屏或空 DOM。至少等标题、URL、主内容和 accessibility tree 稳定后再判断；不要因为第一次截图黑就认定用户也打不开。
- 浏览器操作优先使用用户点名的工具：用户明确 `@chrome` 时先用 Codex Chrome 插件和已有登录窗口，不要默认切到 Computer Use、CLI 或 `osascript`。Chrome 插件如果断连，先按插件排障流程重连；仍失败时及时说明阻塞并请求用户接手或授权替代路径。
- 开放平台发布流程的稳定页面路径是：进入具体自建应用详情 -> `创建版本` -> 填更新说明 -> 确认移动端/桌面端默认能力是“机器人” -> 确认外部群开关 -> `保存` -> 弹窗 `确认发布`。保存后不要只看 URL，最终以版本详情页的 `已发布`、版本号、更新说明、外部群状态和 `审核结果 通过` 为准。
- Chrome 插件操作开放平台时，Playwright role click 可能能定位但不触发飞书后台按钮；这时优先用 `dom_cua.get_visible_dom()` 解析 `<button node_id=...>保存</button>` / `<button node_id=...>确认发布</button>`，再用 `dom_cua.click({ node_id })`。把这种方式作为页面行为异常时的通用 fallback，并继续用发布状态核验结果。
- 上传头像时如果浏览器 / 系统文件选择器无法完成选择或“打开”按钮灰掉，马上告诉用户需要他在文件选择器里选中目标文件；用户选完后，agent 继续负责页面内保存、创建版本和确认发布。
- Web 飞书消息页可能能读到 accessibility tree，但点击/输入不一定落到 canvas/富文本编辑器。优先用 Codex Chrome / Browser / Computer Use 操作网页版；只有网页版富文本输入确实无法稳定操作时，说明阻塞并请求使用飞书桌面端作为 fallback。发送代表用户的群消息属于对外通信，发送前要说明内容并等待确认。
- 飞书消息页的会话列表可能能稳定截图并读出群名、外部标签和历史回复，但 synthetic Playwright / CUA 点击仍不改变 active feed。先等待页面稳定，核对目标元素可见、命中区域和 console，再尝试一次语义点击与一次可见 DOM/CUA fallback；仍无变化时把它记录为网页自动化输入阻塞，不要宣称发送了新消息，也不要用反复盲点替代证据。可用专用 CLI 验证矩阵与成员，用已可见的真实历史回执作为补充，但 fresh inbound E2E 仍要明确标注是否完成。
- 修改 `.oo.dev.config.json` channel appId/secret 后，正在运行的 server 不一定自动重连 Lark WS。闭环检查顺序是：确认对应 channel key，确认 `appId` 属于演示服务 bot 且 `secret` 来自同一 app，确认 `allowedGroups` 是目标外部群，经授权后用 `pnpm --silent tools dev-service restart web --json` 重启当前 worktree 的服务或确认日志里出现新的 `[channels] channel connected`，再做入站消息验证。
- Web launcher 的 `manager` server 只能负责控制面，不能初始化 workspace channel。频道长连接、runtime store watcher 和 resume scheduler 必须由同一个 workspace server 持有；否则 manager 可能先写入全局去重记录和 session，真正消费 runtime 的 workspace 收不到事件，会话就会长期停在 `running`。
- 同一个 bot app 不能同时被旧 worktree、旧 manager 或遗留 workspace server 持有长连接。飞书可能把事件分配给任意连接，表现为同一条 `@` 偶发命中新旧配置。排查时先从错误回复对应的 server 日志反查 workspace，再通过 `dev-service status <target> --json` 找到所有者；不要只重启当前 worktree 就认为旧连接已经退出。
- 自动创建的 channel session 也必须有可执行的默认 adapter / model。若项目只声明了带 `${ENV_VAR}` 的离线 mock model service，又没有设置 `defaultModel`，模型选择可能落到测试模型并在代理层报 `upstreamBaseUrl must be a valid URL`。真实验收前应在私有配置中明确设置可用的 `defaultAdapter` / `defaultModel`，并同时检查 session 的 model、entity、终态和群内可见回复。
- 验证顺序：先用 channel bot app token 向目标群发消息，验证凭证和 `im:message`；再用 `owo-cli --as user` 或飞书客户端让真实用户明确 `@` 目标机器人，验证 `im.message.receive_v1`、结构化 mention、`allowedGroups`、session 调度和回复。机器人自发消息通常不能代表真实入站闭环；真正闭环要看到用户 `@` 消息触发入站事件、只命中目标 bot、进入允许群、生成 session dispatch，并由该角色机器人回到群里。
- `lark-cli auth status --profile <bot> --json` 的 bot `ready` 只说明本地存在 App ID/secret，不会主动向飞书校验 secret。仍要执行一次只读或发送 API；返回 `20002 invalid_client` 时，从可信的项目私有配置重新同步同一个 app 的 secret，并用 `--app-secret-stdin`，不要把 secret 放进 argv、日志或文档。
- Channel bot 与 `owo-cli` 看到的同一个用户 `open_id` 不同。若角色 bot 不申请成员读取权限，应从该 bot 实际收到的已知用户消息中记录 sender `open_id`，核对身份后再写入对应 channel 的 `access.admins`。不要把 CLI app 的 open_id 直接复制过去，也不要把矩阵里的 `includeBoss` 当作权限配置。
- 外部群写操作要区分错误：`232033` 表示执行成员管理的 app 没有外部群管理能力；`230027` 常见于用户 token 虽有发送 scope，但 app 版本或租户策略不允许代表用户向外部群发消息；`99991672` 表示目标 bot app 根本没有申请对应 API scope。三者都需要在正确自建应用里补配置并发布，重复扫码或换身份不能替代。
- 用户身份已经重新授权 `im:message` / `im:message.send_as_user`，token 校验也正常，但对外部群仍持续返回 `230027` 时，应判定为当前 app/租户的代表用户外部群发送策略限制。不要继续循环扫码；改用已登录飞书网页或客户端做真实用户 `@` 验收，并把 API 限制单独记入验收结论。
- `lark-cli` 较旧时可能没有新的应用自管理命令或输出行为。看到 `_notice.update` 后用 `lark-cli update` 同步升级 CLI 和官方 skills；升级完成后重启 AI Agent 才能让新 skills 在新会话中生效。
