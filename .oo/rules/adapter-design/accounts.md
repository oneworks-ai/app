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
- 状态调用 `claude auth status --json`。只有 portable 且平台能够隔离受管账号凭证时，删除才调用 `claude auth logout`；macOS Keychain 等 device-bound 删除只清除 One Works 账号记录和 binding。
- 每个受管账号使用稳定的 `~/.oneworks/adapters/claude-code/accounts/<account>/config` 作为 `CLAUDE_CONFIG_DIR`；账号 key 不能包含路径分隔符或遍历段。
- macOS 原生凭证留在 Keychain，并记录为 device-bound。Linux / Windows 等平台如果官方 CLI 写出 `.credentials.json`，则按 portable envelope 保存和物化。
- device-bound 删除不能把 One Works 记录删除等同于原生登出；设备登录仍然保留。用户显式执行 `claude auth logout` 时，必须把它视为影响该机器原生登录的机器级操作。
- `.claude.json` 不作为凭证。只同步 `oauthAccount`、`cachedUsageUtilization` 和 onboarding 标记；`machineID`、项目路径、workspace trust 等设备 / 项目状态不进入全局快照。
- 会话物化时重新写当前 workspace trust；托管 hooks 合入 session `--settings`，workspace skills 通过 session 临时 plugin 目录注入，避免 `CLAUDE_CONFIG_DIR` 隔离导致能力丢失。
- quota 只解析官方 CLI 写入本地 `.claude.json` 的 `cachedUsageUtilization`。不要调用未公开 usage API，也不要把缓存值描述成实时额度。
- session `projects/**/*.jsonl` 中的 assistant usage 是单次响应 token 计量，不是订阅窗口利用率；不要用 JSONL 累加值伪造 5 小时 / 7 天 quota。
- 受管账户会话在启动前登记进程租约并在退出时释放；重新认证和删除必须拒绝仍有活动会话的账户，避免账号记录或 portable logout 与新进程读取凭证竞态。
- 默认 Claude home 以只读 `system` 账号展示；One Works 不复制或删除该登录态。

## 多设备边界

| 凭证来源                   | 全局配置保存              | 新设备行为                           |
| -------------------------- | ------------------------- | ------------------------------------ |
| Codex `auth.json`          | portable inline snapshot  | 可物化后使用                         |
| Claude `.credentials.json` | portable inline snapshot  | 可物化后用官方 status 验证           |
| Claude macOS Keychain      | device binding + 脱敏状态 | 显示账号但标记 missing，要求官方登录 |
| `secret` ref               | ref + 元数据              | 只有设备拿到合法 envelope 后才可用   |

复制 `.claude.json` 不能完成 Claude 凭证迁移；它主要保存应用状态、身份缓存和 cached usage。不要依赖未公开的 Keychain service 名称导出数据，也不要假定不同平台使用同一种凭证后端。

## 禁止的登录实现

不要把完整 Claude TUI 常驻在隐藏 PTY 中，再持续注入 `/login`、`/logout` 或 `/usage` 并解析屏幕文本。这种方案依赖交互 UI 文案和焦点状态，难以取消、审计和并发隔离。官方一次性 auth 子命令可以打开浏览器或输出登录提示；这不属于隐藏 TUI 注入。

不要伪造官方客户端名称、版本或 OAuth client identity。One Works 只启动用户安装或受管的官方 CLI，并使用它公开的命令和环境变量。

## 验证

- fake CLI 单测覆盖 login/status/logout、portable/device-bound、第二台设备 missing 和 cached usage。
- 真实 CLI smoke 至少确认：空 `CLAUDE_CONFIG_DIR` 与默认配置的 auth status 相互隔离。
- Relay plugin 和 relay-server 都要验证任意 adapter 的 `defaultAccount`、accounts、`accountTombstones`、credential/state envelope 可以归一化和合并，同时过滤无关 secret-like 字段。
- 不在自动测试中执行真实 logout 或覆盖真实 Keychain。
