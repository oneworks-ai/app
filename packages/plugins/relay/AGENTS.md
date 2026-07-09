# Relay Plugin Package

`packages/plugins/relay` 是可选 Relay 插件，不属于默认内置体验。它把当前 workspace 服务注册到 OneWorks 官方或用户自部署的公网 Relay，并通过 scoped plugin API 暴露连接状态和控制命令。远端服务在归一化后统一表现为 server items：官方 Cloudflare / Vercel preset 由开关控制，用户自定义服务继续放在 `servers[]`，即使只有一个自定义 Relay 系统也不要增加 top-level 单服务入口。

## 入口

- `src/client/`：插件 UI 入口，展示连接状态和配置提示。
- `src/client/index.ts`：注册 client activation 能力，包括左下角账号 popover、登录 / 登出命令和 launcher 状态搜索项。Relay 不再向 `sessions.groups` 注册设备或服务分组；其他设备上的 workspace 必须通过 launcher 的远端项目分组进入，不要在左侧会话列表里暴露设备入口。
- `src/client/react-view.ts`：账号、服务器、登录、消息中心、账号详情、团队详情和令牌页面的 React 落地页。账号 popover / profile tabs / 独立消息页体验镜像 Relay Admin 的 `AdminNavRail.tsx`、`features/profile/ProfilePage.tsx` 和 `features/messages/MessageCenterPage.tsx`，但插件客户端不直接持有 session token；账号 / 团队详情 tabs 必须消费 client host 暴露的 `NativeTabs`，账号列表必须消费 host `InteractionList`，并只通过 `view.host.surface` 切换 `grouped` / `launcher` 这类 host variant，不要在 relay 插件里复制通用 tabs / list / launcher 风格。token / list surface 必须消费 `@oneworks/components/admin-list-surface` 的 CSS source、class map 和 native markup helper，不要在插件里复制一套 AdminListTable 样式。不要恢复 legacy string / `innerHTML` 渲染。
- `src/server/index.ts`：插件 server entry。
- `src/server/controller.ts`：插件生命周期、登录 URL / 登录回调、profile 代理、连接 / 断开 / forget 操作编排；profile 代理从 `~/.oneworks/auth.json` 读取登录 session 后代调 Relay Server。
- `src/server/options.ts`：`servers[]` 配置归一化，不能泄露 pairing token。
- `src/server/heartbeat.ts`：设备注册和心跳。
- `src/server/session-worker.ts`：会话快照、job claim 和结果回传 worker。
- `src/server/session-relay-client.ts`：Relay 远端 session forwarding client。
- `src/server/store.ts`：远端签发的 device token 持久化到 project home runtime 目录。
- `src/server/config-source-preferences.ts`：本机对 team/profile/assignment 配置来源的启停偏好；用于插件界面 opt-out 和 config hook 应用前过滤 snapshot。
- `src/server/config-share.ts`：团队配置分享发布编排；只使用登录 session 调用 `/api/relay/*` 团队/profile/secret API，device token 不能用于团队管理。
- `src/shared/config-secrets.ts`：team config snapshot secret envelope 的设备 token 加解密工具；plaintext 只供 config hook 内存应用，不写回 snapshot cache。
- `src/shared/config-share-draft.ts`：团队配置显式分享草稿构建器；负责从用户选择的配置中提取模型服务、插件、marketplaces、skills 等声明型字段，拒绝 env / MCP / permissions / 本地路径，并把 schema 或命名识别出的 secret 变成待上传预览项。
- `__tests__/`：按 API、controller、heartbeat、session worker 等模块拆分测试。
- `.oo/rules/RELAY-DEPLOYMENT.md`：Relay 托管服务、私有化部署、Vercel / Cloudflare 域名、官方 OneWorks 域名 / 邮件拓扑和账号边界；涉及插件默认服务或用户自部署接入时先读。

## 约定

- 插件必须保持可选；不要把 Relay 行为写进默认 server/client 启动路径。
- Relay 详情页使用 host `NativeTabs` 时，tabs 自身的标准 margin 负责与上方内容分隔；包裹 tabs 的业务详情容器不得再叠加 `padding-block-start`。tabs panel 只负责面板内容布局，不能用第二层顶部间距补偿单个页面。
- 项目规则详情是独立 route detail：完整 breadcrumb 已承担团队与规则上下文，页面内不得重复渲染团队 hero。应用设置中的离散选择操作必须即时保存，保存期间禁用对应控件，失败时回滚并展示错误；不要恢复“保存设置”按钮，也不要用监听整个 draft 的 effect 触发初始化保存。
- Relay 的 launcher 账号入口属于插件：`package.json` 通过 `plugin.contributions.routes` 暴露 `home` route 的 `launcher` surface，通过 `launcherSearchProviders` 暴露账号列表搜索项，`src/client/index.ts` 用 `ctx.commands.register('search', ...)` 产生命令结果，并用 `groupId/groupTitle` 声明 launcher 分组。core `LauncherRoute` 只能消费通用 plugin route / search provider，不得再添加 `builtin:account`、`view=account`、Relay 账号菜单项或 Relay 账号 / 登录 API 调用；Relay 未启用时 launcher 不展示账号入口是正确行为。
- Relay server entry 同时运行在 `manager` / `workspace` runtime，`package.json` 的 `plugin.server.roles` 必须保持 `["manager", "workspace"]`，client/server 入口都由 `exports["./client"]` / `exports["./server"]` 提供。management server 负责设备身份、launcher 设备管理和跨 workspace 协调；workspace server 只负责当前项目能力与本地 workspace metadata。跨 runtime 通信必须走平台插件 runtime channel / endpoint 机制，不要在 Relay 插件里私建跨进程桥。
- 远端服务在 `normalizeOptions()` 后统一是 server item；官方服务来自集中 preset 常量和开关，用户自定义服务来自 `servers[]`。`server` / `port` / `protocol` 是 server item 内部字段，默认连接项用 `activeServerId`。
- 产品默认路径是 OneWorks 托管 Relay，默认登录入口优先 Cloudflare 官方 preset；官方服务域名和邮件拓扑以 `.oo/rules/RELAY-DEPLOYMENT.md` 为准，不在插件示例配置中另设隐藏常量。
- 私有化部署必须先确认用户要自托管，并使用用户提供的域名、DNS 托管、邮件策略和平台账号。插件示例使用占位域名，不写入真实账号、测试凭据、私人邮箱或一次性部署 URL。
- 多服务下 device token 按 server id 分开保存；不要把一个 Relay 系统的 token 覆盖到另一个系统。
- 设备展示名统一使用 `alias ?? name ?? deviceId`；`alias` 只能作为 OneWorks / Relay 内的用户别名写回 relay-server device metadata，不能改系统机器名，也不能参与 device id / device token 身份判断。设备 tab 可编辑 alias；真实机器名和 device id 只用于兜底显示、tooltip 或排查。
- 插件登录必须打开所选 Relay Server 的 `/login` 页面；Web 回跳使用当前插件页，Electron 回跳使用 `oneworks://relay/auth` schema URL，再由桌面壳打开对应 workspace 的插件页面。
- 账号入口体验与 Relay Admin 保持镜像：左下角账号按钮是 popover，菜单项进入对应账号详情或独立消息页；插件详情 tabs 固定为 `account`、`teams`、`documents`、`devices`、`security`、`tokens`，Admin 详情 tabs 固定为 `account`、`documents`、`teams`、`devices`、`security`、`tokens`、`audit`。消息中心不能重新塞回账号详情 tabs。修改插件或 admin 任一侧的账号菜单 / profile tabs / 消息列表 / token 列表 / 文案结构时，必须检查另一侧是否需要同步，并确认 `audit` 仍是 Admin-only 差异点。
- launcher 可以展示 Relay 发现到的远程项目，但只能使用 `serverId / deviceId / workspaceFolder` 三元组描述对象，subtitle 要明确这是远程服务上的工作区，不要把远程路径伪装成本机项目路径。不要通过创建带 `oneworks:plugin:relay:*` tags 的本地会话来伪装远端 workspace；真正打开远程项目必须走 `launcher -> relay plugin API -> relay server device workspace job -> 目标 daemon 启动 workspace server -> relay server 代理 HTTP/WS 请求 -> 当前 client` 的链路。
- 设备身份按系统用户级理解：同一个系统用户下的同一台本机应复用一个 device id，device id 由本机 management server 的 `manager` runtime 持有并放在用户目录稳定文件中；一个 management server 实例是一条设备运行实例，`workspaceFolder` 只是该实例下挂载的 workspace metadata，不应作为 device identity。relay-server 的设备响应可包含 `managementServers[]`；UI 只有在同一 device 下出现多个 management server 时才展开树形子节点。
- 本地验证 Relay 多客户端链路时，优先用真实 Relay Server API 或真实 client/project-home/device token 登录同一账号：确认多台设备都心跳在线；同一设备下多个 Electron / Web / daemon / workspace server 心跳应落到同一个 device 的 `managementServers[]`，不要互相覆盖 `workspaceFolder`。调试数据保留在本地 auth / relay store，除非用户明确要求，不要为了切换场景删除账号或设备数据。
- 多客户端调试不要通过手工编辑 `auth.json`、relay store 或设备列表硬塞数据；使用真实登录 / `login-callback` / `connect` / heartbeat API。`~/.oneworks/auth.json` 只代表登录 session，设备身份与 management server 上报要走真实 register / heartbeat contract。需要模拟多设备 / 多 management server 时，用真实 API 写入临时 Relay Server store 或启动真实管理进程，不要在前端 fixture 里造展示数据。
- Linux / Docker 远端 daemon 验证也必须走真实 Relay 链路：用打包产物安装 runtime，并以 `npx oneworks daemon` 启动容器内服务；不要复制 repo 源码进容器运行，也不要手工改 relay store 造远端项目。涉及 Codex global config 同步和 agent 对话恢复时，按 `packages/adapters/codex/AGENTS.md` 的 Docker / Linux sync smoke 清单验收。
- 在同一台机器模拟“多设备”时，临时 workspace 放到当前 git 仓库外，例如 `/tmp/oneworks-relay-sim/workspace-a` 和 `/tmp/oneworks-relay-sim/workspace-b`；放在仓库内部会被 launcher/workspace 归一化成同一个仓库根目录，无法代表独立设备。空 workspace 默认不会加载可选 Relay 插件，必须在该 workspace 的 `.oo.config.json` 显式启用 relay 插件和本地 Relay Server 配置。
- Relay session snapshot 只能带远端会话列表所需的最小元数据，例如 `id`、`title`、`userId`、`adapter`、`messageCount`、`workspaceFolder`，不要持久化会话正文、last message 或任意 metadata。relay-server 的 snapshot store 与读回 normalize 都要保留 `title` / `workspaceFolder`，否则后续 launcher / 远端会话调试会丢上下文。
- 插件运行时加载 `dist/`；改动 `packages/plugins/relay/src/server/*` 后要执行 `pnpm --filter @oneworks/plugin-relay build` 并重启对应 workspace 服务，否则真实浏览器验证仍会跑旧代码。
- Admin 与插件的差异点必须保留：Admin 浏览器端通过 `adminSessionStorage.ts` 持有当前 session token 并直接请求 `/api/profile/*`；插件浏览器端只请求 scoped plugin API，插件 server 用本地 `~/.oneworks/auth.json` 中的登录 session token 代调远端，并避免在 UI 暴露服务端类型和地址。
- 不记录会话正文；插件只转发当前 in-memory job payload / result，持久化仅限 device identity 和每个 server 的 token。
- 个人全局配置同步走 `/api/relay/config/global`，只把 global `~/.oneworks/.oo.config.json` 中经过 safe-field 过滤的字段同步到当前 Relay user 的唯一快照；当前第一版只同步 `adapters`，用于 Codex 等 adapter 账号。不要把 Relay server 列表、device token、project-local config 或团队 profile 写进个人全局同步。团队共享配置仍走 RFC 0006 的 team profile / version / assignment / secret overlay 模型，两者不要混成多份个人配置。
- 个人 / 团队文档同步复用 `/api/relay/config/global` 的个人快照和 `/api/relay/teams/:teamId/documents` 的团队快照，但服务端只保存密文 payload 和 `documentCount / totalSizeBytes / countsByKind` 元数据，不能读取 `AGENTS.md` 正文。个人同步按三个用户根路径开关控制：`~/AGENTS.md`、`~/.oo/AGENTS.md`、`~/.oo/rules/**/*.md`；`.local.md` 永远只保留本地，不上传。团队同步继续只读写 `~/.oo/teams/<team-id>/AGENTS.md` 与团队 rules 命名空间。同步实现落在 `src/server/personal-document-sync.ts`，写入远端版本到本机前如遇已有不同内容，要先生成同目录 `*.relay-conflict-*.md` 备份，不要静默覆盖。
- Relay config snapshot cache 只能保存 encrypted secret envelope；config hook 可以用本地 device token 解密并在内存中注入 secret 字段，但不能把 plaintext 写回 project home。
- 修改插件行为后跑 `pnpm -C packages/plugins/relay test`、`pnpm -C packages/plugins/relay typecheck` 和 `pnpm -C packages/plugins/relay build`。
