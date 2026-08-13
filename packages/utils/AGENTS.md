# Utils Package

`@oneworks/utils` 承载跨 runtime 共用的基础 helper。
当前收口的是 markdown logger、log level 解析、字符串 key 转换、路径 helper、uuid、chat-message helper、cache、model selection、managed plugin package installer 和系统通知工具。

## 先看哪里

- `src/create-logger.ts`
  - 主会话 / hook runtime 共用的 markdown logger
- `src/log-level.ts`
  - `normalizeLogLevel()` / `resolveServerLogLevel()`
- `src/string-transform.ts`
  - 对象 key 转换 helper
- `src/document-path.ts`
  - workspace 共享的路径规范化 helper；`normalizePath()` 仅用于协议 / presentation slash serialization，filesystem-relative prompt identity 则按宿主路径分隔符保留 POSIX literal backslash
- `src/filesystem-dir-path.ts`
  - package 内部文件系统目录身份读取：只用 `trim()` 判空，保留原始路径字节；可选尾分隔符归一化不得越过 POSIX、Windows drive、单根与 UNC share 的 root-family floor，POSIX 的 literal `\\` 不是可移除分隔符
  - Git 等命令返回目录时只移除一个平台协议 framing delimiter：POSIX 只移除一个终端 LF 并保留路径自身的前置 CR，Windows 才把单个 CRLF 当 framing；不得复用普通文本 `trim()` 或删除路径自身的连续换行；此 helper 不经 package public facade 导出
- `src/git-worktree.ts`
  - Git worktree 命令和 repository root 发现；repository root 等文件系统 stdout 只能移除末尾 LF / CRLF，不能用通用文本 trim 改写路径身份；branch、status、HEAD、remote、log、numstat、diff 与错误详情仍使用普通文本 `trim()` 语义
- `src/project-env.ts` 与 `src/project-home-migration.ts` 对 workspace/env 和 native `path.relative` 结果使用宿主文件系统语义；POSIX literal backslash 不能触发 metadata 清理或伪造 `.codex/.tmp` 层级。
- `src/managed-npm-cli.ts` / `src/skills-cli/runtime.ts`
  - CLI package 名、版本、参数和普通输出仍按文本规则清理；显式 executable、环境 / 配置候选、system binary 和 shell `command -v` 路径只用 `trim()` 判空，并把原始字节传给 probe、realpath、spawn / execFile。shell `command -v` 必须用 NUL framing 隔离 payload；POSIX 只移除该 payload 的单个记录 LF，不能丢失 executable 名字中的真实 LF / CR，也不能采信 login-shell startup 输出。
- `src/adapter-account.ts` / `src/adapter-account-*.ts`
  - `adapter-account.ts` 只显式导出拆分前已有的公共账户 API 与 revision 兼容 API；private 模块的 layout 常量和 helper 不经 package facade 暴露。portable key/path 在 `path-validation` / `paths`，目录与 metadata 身份检查在 `fs` / `root` / `metadata`，generation 发布在 `storage` / `publication`，写删编排在 `artifacts`
  - adapter 账户 artifact 的账户级加锁、不可变 generation + 原子 current pointer 发布 / 安全删除，以及 credential revision 兼容 API；已解析的旧 generation 保留到显式 remove，避免发布窗口让无锁 reader 失效。未发布的完整 orphan generation 也保留到显式 remove，目前不做可能破坏旧 reader 的自动 GC
  - artifact 写删必须以 canonical project home 为锚逐段拒绝 ancestor symlink / 非目录，并在锁前后和发布 / 删除前复核目录 identity
  - artifact 路径和 adapter/account 单段必须使用这里的统一校验；凭证 revision 的有效域与比较由 `@oneworks/types` 拥有
  - 新 adapter/account state 与 lock 路径使用原始 UTF-8 key 的完整 SHA-256 `v1-` 编码，并以 0600 metadata 逐字核验原始 key；不能 lowercase 合并用户键，`Work/work` 与 NFC/NFD 必须保持独立。legacy raw path 只在 realpath basename 与请求 key 逐字一致时读删
  - `.oneworks-account-store` / `.oneworks-account-locks` 内部 namespace 对 adapter/account 键保留；保留名按 NFKC + locale-independent lowercase 判定，不能依赖宿主文件系统是否区分大小写
- `src/model-selection.ts`
  - model service、defaultModel、adapter/model 兼容性处理
- `src/plugin-resolver.ts`
  - 统一插件实例解析、简写包名解析、manifest / hooks / config hook 入口解析
  - plugin 的 `configHook.entry`、server entry、client `entry` / `root` / `devEntry` / `sourceRoot` 与 icon 是文件系统身份，只判空并保留原始字节；宿主平台的 traversal / containment 校验与 public URL 序列化必须分离。`devServer`、name、version 等非路径字段继续普通文本归一化
- `src/native-host-plugin.ts` / `src/private-root-redaction.ts`
  - real Home、adapter config Home 与 private roots 复用 package 内部文件系统路径 reader；保留原始非空字节，不把 helper 经 public facade 导出；private-root redaction 只把 tagged Windows family 作为大小写不敏感、双分隔符等价，POSIX case 与 literal backslash 必须保持精确。
- `src/marketplace-config*.ts`
  - 跨 config/server/adapter 共用的 marketplace 规范化与分层合并；One Works 官方市场声明在这里投影为普通 runtime plugin config。directory、git subdir、settings pluginRoot 等文件系统字段只判空并保留原始字节，type、id、name、URL、revision 仍按文本契约归一化。
- `src/managed-plugin-package.ts`
  - `@oneworks/plugin-*` package 的 bootstrap cache、registry fallback、metadata 解析与安装 helper
- `src/cache.ts`
  - home project `caches/<task>/<session>/<key>.json` 读写 helper
- `src/system.ts`
  - `notify()`
  - 桌面通知 options schema
  - 默认图标与默认音效资产解析
- `__tests__/create-logger.spec.ts`
- `__tests__/log-level.spec.ts`
- `__tests__/managed-plugin-package.spec.ts`

## 当前边界

- 本包负责：
  - 通用 logger 实现
  - 通用 log level 解析
  - 通用对象 key transform
  - 通用路径 helper
  - 通用 cache helper
  - 通用 model selection helper
  - 通用插件解析 helper
  - managed plugin package cache / installer helper
  - 通用 system helper
- 本包不负责：
  - task 生命周期
  - 配置读取
  - adapter / hook / mcp 协议翻译

## 维护约定

- 只放可复用、无业务编排的 helper；带产品语义的逻辑留在消费包。
- 优先依赖 `@oneworks/types`，不要反向依赖 `core`、`hooks` 或 `mcp`。
- 修改 logger、log level、插件解析或 managed plugin package installer 后，至少回归 `packages/utils/__tests__` 和相关消费方测试。
- `preferBundledOfficialPlugins` 只表示优先使用 runtime package roots（`__ONEWORKS_PROJECT_PACKAGE_DIR__` / `__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__`）内真正随运行时提供的官方插件；不能把当前 workspace 的 `node_modules` 当作 bundled 来源。runtime 未携带目标插件时继续走 managed package cache / registry 解析。
