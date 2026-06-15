# Relay Plugin Package

`packages/plugins/relay` 是可选 Relay 插件，不属于默认内置体验。它把当前 workspace 服务注册到 OneWorks 官方或用户自部署的公网 Relay，并通过 scoped plugin API 暴露连接状态和控制命令。远端服务在归一化后统一表现为 server items：官方 Cloudflare / Vercel preset 由开关控制，用户自定义服务继续放在 `servers[]`，即使只有一个自定义 Relay 系统也不要增加 top-level 单服务入口。

## 入口

- `src/client/`：插件 UI 入口，展示连接状态和配置提示。
- `src/client/index.ts`：注册 client activation 能力，包括基于 Relay 已知设备的 `sessions.groups` 会话分组和“基于此连接新建会话”标题 action；只有拿不到设备状态时才回退到 `servers[]` 连接级分组。
- `src/server/index.ts`：插件 server entry。
- `src/server/controller.ts`：插件生命周期、登录 URL / 登录回调、连接 / 断开 / forget 操作编排。
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
- 远端服务在 `normalizeOptions()` 后统一是 server item；官方服务来自集中 preset 常量和开关，用户自定义服务来自 `servers[]`。`server` / `port` / `protocol` 是 server item 内部字段，默认连接项用 `activeServerId`。
- 产品默认路径是 OneWorks 托管 Relay，默认登录入口优先 Cloudflare 官方 preset；官方服务域名和邮件拓扑以 `.oo/rules/RELAY-DEPLOYMENT.md` 为准，不在插件示例配置中另设隐藏常量。
- 私有化部署必须先确认用户要自托管，并使用用户提供的域名、DNS 托管、邮件策略和平台账号。插件示例使用占位域名，不写入真实账号、测试凭据、私人邮箱或一次性部署 URL。
- 多服务下 device token 按 server id 分开保存；不要把一个 Relay 系统的 token 覆盖到另一个系统。
- 插件登录必须打开所选 Relay Server 的 `/login` 页面；Web 回跳使用当前插件页，Electron 回跳使用 `oneworks://relay/auth` schema URL，再由桌面壳打开对应 workspace 的插件页面。
- 不记录会话正文；插件只转发当前 in-memory job payload / result，持久化仅限 device identity 和每个 server 的 token。
- Relay config snapshot cache 只能保存 encrypted secret envelope；config hook 可以用本地 device token 解密并在内存中注入 secret 字段，但不能把 plaintext 写回 project home。
- 修改插件行为后跑 `pnpm -C packages/plugins/relay test`、`pnpm -C packages/plugins/relay typecheck` 和 `pnpm -C packages/plugins/relay build`。
