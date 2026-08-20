# Adapter 账户与凭证协议

## 分层

账户能力由 `packages/types/src/adapter.ts` 的统一协议暴露：

- `getAccounts`：列出账号、默认账号和 adapter 级动作
- `getAccountDetail`：读取身份、状态、来源和额度快照
- `manageAccount`：执行新增、重新认证、刷新和删除
- `AdapterQueryOptions.account`：把用户选择传入会话准备阶段

通用层只定义生命周期和凭证 envelope；adapter 负责调用官方客户端、解析其状态，并把凭证物化成官方客户端能够读取的本地布局。全局账户配置的更新统一走 `packages/config/src/adapter-accounts.ts`，不要在每个 adapter 里复制配置文件写入逻辑。

`accounts` 之外保留通用 `accountTombstones`：每个账户有一个只在显式重建时变化的 `generation`，删除时把该 generation 追加到 `accountKey -> deletedGenerations[]`。已删除世代不能清除；否则多次删除 / 重建后，长期离线设备仍能把更早的凭证复活。普通身份 / quota 刷新不会改变 generation，只有用户重新新增同名账户才产生新 generation。`credentialRevision` 是 One Works 平台生成的 `counter:uuid` Lamport revision，不是 adapter 自定义字符串；它只在官方登录、重新认证或官方客户端实际刷新凭证时递增。Relay 仅在同一 generation 内用它选择凭证版本；不同 generation 必须选择完整账户记录，不能把新元数据与旧 token 混合，也不能用全局文件 mtime 或普通 metadata `updatedAt` 决定 token 胜负。

## 凭证 envelope

`AdapterAccountCredentialConfig` 区分三种存储语义：

- `storage: inline`
  - `token` 是 adapter 自有格式的 base64 payload。
  - `portability: portable` 表示可以随个人全局配置跨设备恢复。
  - base64 只是一种编码，不是加密。当前 Codex `auth.json` 和非 Keychain 平台的 Claude `.credentials.json` 仍使用这一兼容格式。
- `storage: secret`
  - 全局配置只保存 `ref`，不保存密文或解密密钥。
  - Relay 个人 secret backend 尚未实现；在 backend 和按设备重包裹协议完成前，adapter 必须把无法解析的 ref 报告为当前设备缺少凭证。
- `storage: device`
  - 表示凭证留在系统原生凭证库，只同步 binding、身份元数据和可公开的本地状态快照。
  - 新设备必须再次走官方登录，不能把“同步了账号卡片”误报成“凭证已经可用”。

目标加密方案是：个人全局配置只持有稳定 secret ref；Relay secret store 使用服务端静态加密保存 secret，并针对已认证设备生成 AES-256-GCM envelope；客户端只在内存或权限为 `0600` 的短期物化文件中解密。加密密钥不能和密文一起写进 `.oo.config.json`，也不能用可由公开服务器地址和用户 ID 重算的值冒充零知识密钥。

## Claude Code

实现入口：

- `packages/adapters/claude-code/src/claude/accounts.ts`
- `packages/adapters/claude-code/src/claude/cli.ts`
- `packages/adapters/claude-code/src/claude/prepare.ts`

当前行为：

- 新增和重新认证只调用短生命周期官方命令 `claude auth login --claudeai`。
- 状态调用 `claude auth status --json`。删除只有在官方 CLI 能把 logout 精确限定到所选账号时才调用 `claude auth logout`；默认 Claude home / Desktop 等机器级引用只清除 One Works 账号记录和 binding。
- 通过官方登录建立的受管账号使用稳定的 `~/.oneworks/adapters/claude-code/accounts/<account>/config` 作为 `CLAUDE_CONFIG_DIR`；账号 key 不能包含路径分隔符或遍历段。
- macOS 原生凭证留在 Keychain，并记录为 device-bound。默认 Claude home / Desktop 是机器级引用；通过官方 CLI 在稳定 `CLAUDE_CONFIG_DIR` 登录的其他账号只有在 login 前、成功后和 logout 前的 status 探测都证明没有继承 default / 其他 profile 凭证时，才按隔离设备凭证管理并允许并行或精确 logout。旧 CLI 若把 Keychain 凭证带入新 profile，必须在任何 login mutation 前拒绝。Linux / Windows 等平台如果官方 CLI 写出 `.credentials.json`，则按 portable envelope 保存和物化。
- macOS 第一次新增受管 Claude 账号时，可以复用 Desktop / 默认 CLI 已存在且经官方 status 验证的机器级 Claude.ai 登录，直接建立 device binding。该账号的凭证来源必须标记为默认 Claude home 引用，探测和运行时不得注入会让官方 CLI 报未登录的隔离 `CLAUDE_CONFIG_DIR`；但仍按 managed account 清理 API Key、Router 和 settings 认证覆盖。存在其他受管账号或重新认证时仍执行官方 login，避免无意复制同一机器身份为多个账号。
- 默认 Claude home 的 device-bound 删除不能把 One Works 记录删除等同于原生登出；设备登录仍然保留。隔离 `CLAUDE_CONFIG_DIR` 的 device-bound 账号可在该目录内执行官方 logout，不影响默认 home 或其他账号。
- `.claude.json` 不作为凭证。只同步 `oauthAccount`、`cachedUsageUtilization` 和 onboarding 标记；`machineID`、项目路径、workspace trust 等设备 / 项目状态不进入全局快照。
- 会话物化时重新写当前 workspace trust；托管 hooks 合入 session `--settings`，workspace skills 通过 session 临时 plugin 目录注入，避免 `CLAUDE_CONFIG_DIR` 隔离导致能力丢失。
- quota 优先解析身份匹配的新鲜本地数据：CLI `.claude.json` 的 `cachedUsageUtilization` 必须匹配 `oauthAccount.accountUuid` 且窗口尚未 reset；macOS Claude Desktop `plan-usage-history.json` 和本地 HTTP cache 中的 usage 响应必须匹配当前 organization，年龄不超过 30 分钟，并只提取利用率 / reset 字段。Desktop HTTP cache 是 adapter 私有、可选的只读来源，格式变化必须安全回退，不能提升为通用账户协议。用户主动刷新时，可以按 Claude OAuth 的 profile + usage 只读链路查询；凭证只在内存中使用，profile email / organization 必须和所选账号完全匹配，响应有大小与超时上限，429 必须遵守 `Retry-After`，失败时保留安全的本地值。不得伪造 Claude Code 客户端名称、版本、设备 ID、TLS 或计费请求头，也不得把 OAuth token 写进 One Works 配置或日志。
- session `projects/**/*.jsonl` 中的 assistant usage 是单次响应 token 计量，不是订阅窗口利用率；不要用 JSONL 累加值伪造 5 小时 / 7 天 quota。
- Desktop 与 CLI 的默认机器登录和部分配置可以互通，但 session history 保持独立；不得把 Desktop 历史合并或声明成 One Works / CLI 历史。
- 受管账户会话在启动前登记进程租约并在退出时释放；重新认证和删除必须拒绝仍有活动会话的账户，避免账号记录或 logout 与新进程读取凭证竞态。默认 Claude home 使用机器级租约；隔离账号使用账户级租约并允许不同账号并行。
- 默认 Claude home 以只读 `system` 账号展示；One Works 不复制或删除该登录态。

## 多设备边界

| 凭证来源                   | 全局配置保存              | 新设备行为                           |
| -------------------------- | ------------------------- | ------------------------------------ |
| Codex `auth.json`          | portable inline snapshot  | 可物化后使用                         |
| Claude `.credentials.json` | portable inline snapshot  | 可物化后用官方 status 验证           |
| Claude macOS Keychain      | device binding + 脱敏状态 | 显示账号但标记 missing，要求官方登录 |
| `secret` ref               | ref + 元数据              | 只有设备拿到合法 envelope 后才可用   |

复制 `.claude.json` 不能完成 Claude 凭证迁移；它主要保存应用状态、身份缓存和 cached usage。macOS usage 刷新只允许通过受限的本机 Keychain 读取把当前 OAuth token 临时送入 profile / usage 请求，不得导出、同步或持久化该 token；Keychain 名称或响应变化必须安全回退到本地缓存。不要假定不同平台使用同一种凭证后端。

## 禁止的登录实现

不要把完整 Claude TUI 常驻在隐藏 PTY 中，再持续注入 `/login`、`/logout` 或 `/usage` 并解析屏幕文本。这种方案依赖交互 UI 文案和焦点状态，难以取消、审计和并发隔离。官方一次性 auth 子命令可以打开浏览器或输出登录提示；这不属于隐藏 TUI 注入。

不要伪造官方客户端名称、版本或 OAuth client identity。One Works 只启动用户安装或受管的官方 CLI，并使用它公开的命令和环境变量。

## 验证

- fake CLI 单测覆盖 login/status/logout、portable/device-bound、第二台设备 missing 和 cached usage。
- 真实 CLI smoke 至少确认：空 `CLAUDE_CONFIG_DIR` 与默认配置的 auth status 相互隔离。
- Relay plugin 和 relay-server 都要验证任意 adapter 的 `defaultAccount`、accounts、`accountTombstones`、credential/state envelope 可以归一化和合并，同时过滤无关 secret-like 字段。
- 不在自动测试中执行真实 logout 或覆盖真实 Keychain。
