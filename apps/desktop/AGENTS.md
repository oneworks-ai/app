# Desktop Package

`@oneworks/desktop` 是 Electron 桌面壳，负责窗口生命周期、内置 server 生命周期、本地 workspace 选择与安装包产物；业务逻辑仍复用 server 与 client workspace 包。

桌面端浏览器数据同步、密码管理、历史记录、下载内容和对应 client 入口的完整维护经验见 `../../.oo/rules/maintenance/browser-data-management.md`。

本地 dev 安装包 runtime cache、安装后仍像旧代码、`Switch Project` 兜底页和 packaged client/server cacheVersion 排查见 `../../.oo/rules/maintenance/desktop-packaged-runtime-cache.md`。

Review 桌面双运行路径、bundle 外资源、ready 语义或真实安装产物时，加载 `../../.oo/rules/review/profiles/desktop-runtime.md`；本文件继续维护具体代码入口和验证命令。

正式 macOS Release 的候选、下载摘要、安装 smoke、完整 Home / userData 隔离与零写入证据见 `../../.oo/rules/release/macos-signing.md#官方安装-smoke-的用户数据隔离`。

## 先看哪里

- `src/main/index.ts`
  - Electron main 进程薄入口
  - 桌面 app bootstrap 委托到 `src/main/`
- `src/main/`
  - `app-runtime.ts`：单实例锁、应用生命周期和各模块装配
  - `startup-diagnostics.ts`：桌面冷启动阶段、可交互 / 稳定终态与本地诊断 Journal；事件契约来自 `@oneworks/diagnostics`
  - `first-action-diagnostics.ts`：真实首个 submit 到 accepted / renderer response / success、failed 或 terminated 的独立 operation；只消费无内容 milestone，并锁定首次 renderer document source。ACK 不确定的 abandonment timer 必须由 Electron main 持有，renderer retry 或 causal observation 只能通过闭合 milestone 刷新 / 取消
  - `javascript-diagnostics.ts`：Electron 主进程、renderer crash 与客户端受限 IPC 的 JavaScript 异常 Journal / OTLP 门控；只接收归一化后的错误码、类型和不可逆指纹
  - `support-bundle.ts`：从桌面诊断 Journal 生成隐私安全支持包，由 Help 菜单触发
  - `browser-window-factory.ts`：统一 BrowserWindow 创建、titlebar 风格、`window.open` 管控和窗口关闭清理
  - `window-manager.ts`：BrowserWindow 记录、项目选择页 / launcher / workspace 窗口切换
  - `launcher-client-service.ts`：桌面共享 client dev server / packaged static server 生命周期
  - `manager-service-manager.ts`：桌面用户级 manager server 生命周期；为 Launcher 的插件与账号能力提供独立控制面
  - `workspace-service-manager.ts`：每个 workspace 的内置 server 生命周期
  - `window-titles.ts`：workspace、launcher、selector 的窗口标题和加载页 URL 组装
  - `deep-link.ts`：`oneworks://` / `one-works://` schema URL 解析；Relay SSO 根据发起 runtime 回跳到 Launcher 插件页或具体 workspace 插件页，Manager 回跳不能把 manager home 当作 workspace 打开
  - `external-cdp.ts`：agent / 验证工具 opt-in 暴露 Electron CDP，本机默认关闭；必须在 app bootstrap / 单实例锁之前应用
  - `menu.ts`、`ipc-handlers.ts`、`shortcuts.ts`：菜单、IPC 与桌面快捷键
  - `updates.ts`：自动更新检查
  - `browser-data-sync.ts`：桌面端浏览器数据同步与本机加密 vault；密码 CSV / Chromium profile / Authenticator 备份导入和扩展状态同步的 main-process 落点
  - `browser-activity.ts`：interaction panel webview 的历史记录、下载记录和项目 / 会话 scope 追踪；配置页历史 / 下载内容入口通过 preload IPC 读取这里的数据
  - `browser-control-broker.ts` / `browser-control-operations.ts`：IAB Driver 到 interaction-panel webview 的鉴权 broker 与语义操作落点；可见 Agent 操作必须通过 `browser-control-agent-state.ts` 以稳定 page / driver identity 驱动宿主 tab 状态，不能改受控网页的 title 或 favicon
- `src/workspace-state.cjs`
  - 桌面最近项目、workspace 显示名、启动 workspace 解析入口。
  - 作为 project/workspace 打开或记录时，只规约到当前 Git worktree 的 top-level；linked worktree 必须保留为独立 workspace，不能折回 common `.git` 对应的原始 project 目录。
  - 验证 Electron workspace 启动链路时，要同时看启动日志里的 `workspace=...`、窗口首屏是否无需 Cmd+R 退出 loading、以及会话状态栏 / runtime 日志中的 session cwd；三者必须指向同一个当前 worktree。
- `electron.vite.config.ts`
  - 使用 `electron-vite` 编译 main / preload TypeScript 到 `dist/`
- `src/server-child.cjs`
  - dev / packaged 场景下如何桥接到 server workspace package
- `scripts/package.cjs`
  - `pnpm deploy --prod` staging；当前 pnpm 支持 `--legacy` 时脚本会自动加上
  - 本地 dev 打包会把 workspace 包 overlay 到 staging，并把当前 client dist 写入 `runtime-packages/@oneworks/client`
  - multi-arch 预打包
  - auto-update 资源注入
  - 原生依赖裁剪
- `scripts/sync-icons.cjs`
  - 从 `assets/icon` submodule 同步桌面图标资源
  - 维护默认金属风格根图标、macOS `.icon` appearance 包和运行时风格切换资产
- `scripts/mac-*.cjs`、`scripts/make-targets.cjs`
  - macOS `.icon` / `.icns` 工具链探测、图标模式选择、prepackaged app 校验和 make target 参数解析
  - `mac-signing-options.cjs` 只在 signed macOS 的 outer root App callback 刷新包内 native authority 双架构 manifest；嵌套 Mach-O 必须已经完成签名，root App 随后封装该 manifest，unsigned / helper callback 不得刷新
- `scripts/make.cjs`
  - 从 prepackaged app 生成安装 / 分发产物
  - 支持 `--target` 和 macOS `--mac-icon auto|icns|icon`
  - 签名开关
  - macOS 双架构 `latest-mac.yml` 合并
- `scripts/smoke-packaged-server.cjs`
  - 包内 server smoke test 契约；除基础 server 探活外，还必须确认默认内置 Relay、In-App Browser Control、Browser Control Chrome transport 和 Computer Control - CUA 的生产入口存在、runtime 已激活且没有 diagnostics
- `scripts/diagnose-packaged-authority.cjs`
  - fresh signed build 与 `app` notarization recovery 的当前 builder 诊断入口；在任何 Apple app 操作前通过待提交 App executable 加载包内 native authority，在隔离目录验证 broker / peer / open / claim / publish / release / cleanup，只输出固定 phase / error code
- `electron-builder.yml`
  - 目标平台、artifact 命名、GitHub publish 配置
- `build/app-update.yml`
  - 桌面正式更新通道配置

## 当前边界

- Electron main 进程不重复实现 server 业务逻辑；桌面端 server 仍通过 `src/server-child.cjs` 复用 server workspace package。
- 桌面启动诊断写入 Electron `userData/diagnostics/startup`：只记录稳定事件名、阶段、耗时、终态和分类错误，不写 workspace 路径、URL、原始错误消息、stack、配置或凭据。启动成功必须经过 renderer 可交互并持续稳定一段时间；上次进程未完成的启动会在下次启动标记为 `abandoned`。
- 设置标准 `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` / `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json` 时，桌面诊断会异步导出；发送失败不能阻断启动。Help 菜单支持导出同一事实模型的支持包，关联 ID 必须脱敏且不得补入 raw logs。
- 本地 dev 安装包内的 cli/server/client 是 runtime cache 的来源：`src/main/workspace-runtime-cache-manager.ts` 在桌面 core ready 后调度 `src/main/workspace-runtime-cache-refresh.ts`，后者通过 `src/builtin-adapter-cache.cjs` 按 `desktop-build-source.json` 里的 dev cacheVersion 刷新 `~/.oneworks/bootstrap/npm/oneworks__cli/<cacheVersion>`、`oneworks__server/<cacheVersion>` 与 `oneworks__client/<cacheVersion>`；manifest 快路径还必须匹配每次打包唯一的 `runtimePackageBuildFingerprint` 及当前 platform/arch。`src/server-child.cjs` 只消费已准备的 cache，并在缺失时使用包内 runtime，不能在 server ready 的关键路径物化可选 cache。排查“安装包还是旧代码”时必须核对这个 cache 里的真实文件，不要只看 `/Applications/.../Resources/app`。
- `pnpm desktop:dev` 默认打开不绑定 workspace 的空项目启动页；`pnpm desktop:dev:workspace` 才以当前仓库作为 workspace 启动。两者都转发到统一 `dev-service ensure` 生命周期，由 Electron 启动共享 Vite client，并为每个 workspace 启动独立本机 server；前端改动应走共享 client 的 HMR，不需要重复构建静态 dist。`electron` 与 `electron-workspace` 受单实例约束，切换前必须先获得用户对当前 target 的显式停止授权。
- 多 worktree / 多 AI 会话可能同时运行桌面开发态实例；排查崩溃或端口占用时，不要因为看到其他 worktree 的 Electron、`apps/desktop/src/server-child.cjs` 或 `apps/client/cli.cjs` 进程就直接清理。先列出 PID、启动时间、worktree 路径和命令来源，只有确认属于当前终端会话、明确是当前崩溃实例残留，或用户同意后才停止。
- 桌面 main / preload 使用 `electron-vite` 构建，Electron 运行入口是 `dist/main/index.js`。
- 外部 CDP 只作为 agent 控制面使用，默认关闭；通过 `ONEWORKS_DESKTOP_CDP_PORT` / `--oneworks-cdp-port` 显式启用，并优先配合独立 `ONEWORKS_DESKTOP_USER_DATA_DIR` / `--oneworks-user-data-dir` 冷启动，避免被单实例锁转发到真实用户实例。
- Electron 窗口启用 `sandbox: true`，preload 不能保留普通 workspace / npm 包的运行时 `require()`。新增 preload 运行时依赖时，必须同步维护 `electron.vite.config.ts` 的 `externalizeDeps.exclude` 与 `ssr.noExternal`；只有依赖需要从 workspace 源码解析时才补 preload alias。构建产物必须通过 `scripts/verify-sandboxed-preload.cjs` 检查，否则 preload 可能整体加载失败，renderer 也拿不到 `window.oneworksDesktop`。
- 完整 agent bridge protocol、runtime evidence 编排和 `desktop-control` CLI 属于仓库 `scripts/` 层，入口见 `scripts/AGENTS.md` 和 `scripts/desktop-control-protocol.md`；桌面 app 侧只维护 bootstrap 前的 opt-in CDP hook。
- 空项目启动页和所有 workspace 窗口共用 launcher client service 管理的 client；Electron 另行维护一个用户级 manager server，Launcher 必须通过 preload IPC 获取其精确 `serverBaseUrl`，不能回退到固定 8787；每个 workspace service 仍只启动自己的 server。打开 workspace 后，main/preload 通过 IPC 告诉对应 renderer 当前窗口绑定的 `serverBaseUrl`，请求仍由前端直连 server HTTP / WebSocket。不要再为每个 workspace 启动独立 client。
- 空项目启动页默认可通过 `CommandOrControl+Space` 全局快捷键打开；快捷键值来自 Electron 注入的 desktop settings，可在桌面端配置页更新。macOS 上如果系统快捷键占用了 `Command+Space`，Electron 注册会失败并只打印 warning，不要在代码里静默换成另一个快捷键。
- 桌面窗口统一使用隐藏 titlebar / traffic light 风格；新建窗口、右键会话新窗口、launcher 和 workspace selector 都必须通过 `browser-window-factory` 创建，避免出现系统默认标题栏。
- macOS workspace 窗口的原生毛玻璃依赖 `vibrancy: 'sidebar'` 和 `transparent: true` 同时存在；client 侧会把 sidebar / titlebar 背景让给原生窗口材质。不要只设置透明背景色或只改前端 CSS，否则展开态 sidebar 容易退成实色灰块，和 launcher / 折叠态表现不一致。
- workspace 内部 `window.open` 只允许打开同 workspace client base 下的 URL；跨 origin 或离开 client base 的 URL 必须拒绝或走外部浏览器，不要直接生成不受管控的新窗口。
- IAB Driver 的操作状态属于宿主 tab chrome：桌面 main 进程按 webContents / page id 管理 moving / acting / settle 租约，并在导航、tab close、driver disconnect 与 broker stop 时恢复。受控页面 favicon 只作为站点数据同步，不能承担 Agent 状态或清理职责。
- Relay SSO 登录回跳使用 `oneworks://relay/auth?workspace=<workspace>&scope=<scope>&serverId=<serverId>#relay_token=<token>`。改 custom scheme、单实例锁、启动参数或 workspace 路由打开逻辑时，要同时检查 `src/main/deep-link.ts`、`src/main/app-runtime.ts`、`src/main/window-manager.ts` 和 `electron-builder.yml`。
- macOS 会话右键“在新窗口打开”应创建同风格 workspace 窗口，并通过 URL 参数让左侧栏默认折叠。
- 最小窗口宽度当前支持到 `300px`；改 header / nav / sender 布局时要验证这个尺寸，不要只看大窗口。
- `pnpm desktop:package`、`pnpm desktop:make` 仍依赖静态 client dist，并默认先构建 client。
- `pnpm desktop:package` / `package:icon` 必须先运行 `build:plugins`，为 `BUILTIN_PLUGIN_PACKAGES` 中带生产 client/server entry 的插件准备 `dist`。Browser Control 必须包含 client/server 产物，Relay 必须包含 client/server 与 config 的 CJS/ESM 产物；只把 workspace package overlay 进 staging 不能替代构建。
- `BUILTIN_PLUGIN_PACKAGES` 必须与 `apps/desktop/package.json` 的 production dependencies、`packages/utils/src/plugin-resolver.ts` 的默认官方插件，以及 `apps/server/src/services/plugins/discovery.ts` 的宿主来源归类保持一致。In-App Browser Control、Browser Control 的当前 Chrome transport 与 Computer Control - CUA 是桌面默认内置能力；源码仓库可用同 manifest `name` 的 directory plugin 覆盖内置副本以继续 watch 调试，但不能同时生成两个运行实例。
- macOS `.pkg` 安装向导包通过 `pnpm desktop:make:pkg` 或 `node apps/desktop/scripts/make.cjs --target pkg` 生成；`ONEWORKS_DESKTOP_MAKE_TARGETS` 只作为 CI / 临时覆盖入口，不作为用户文档里的主要入口。
- 当前 GitHub `desktop-package` workflow 先在 Ubuntu 用 validation-scope v2 分类：普通 client、adapter、品牌资产、文档、`assets/avatar` gitlink 与其他明确不影响 Desktop package closure 的 PR / Merge Queue 组合只运行几秒钟的同名 `macOS installer` required gate，不申请 macOS runner；avatar 仍由 client production build、full typecheck 与 lint 覆盖。桌面源码、native authority、桌面打包工具、根 manifest / lockfile、正式包内 runtime closure 或未知路径才运行 unsigned package smoke：PR 为 arm64，Merge Queue 组合 revision 为 arm64,x64。PR 后续 revision 只有在同一 base 上存在成功 Desktop evidence，且当前改动逐字节等于 ESLint 对上一 revision 的自动修复时才能跳过重复 macOS runner；body edit 只复用 exact base / head，base retarget 强制重检，队列组合 revision 不复用证据。`merge_group` 显式不能进入 release installer、签名、公证或发布 job。真正的 `macOS release installer` 只由 `pkg/oneworks-desktop/v*` tag 或手动 dispatch 触发，运行 package preflight 后按仓库签名策略生成预打包 app 与 `.dmg` / `.pkg` / `.zip`，并完成挂载、复制到 `/Applications` 和已安装 app smoke。main push 不构建完整安装包；发版前可手动 dispatch 验证。Windows / Linux builder 目标保留，但暂时不作为 CI gate。
- 桌面图标资产来自 `assets/icon` submodule；更新 submodule 后运行 `pnpm desktop:icons:sync`，默认根图标是工业风格。macOS package / make 默认 `--mac-icon auto`，只有完整 Xcode 26+ 的 `actool` 支持 Icon Composer 时才启用 `.icon` / `Assets.car`，否则继续使用 `.icns`；显式验证可用 `pnpm desktop:make:pkg:icon`。
- 内置本机服务默认关闭 `webAuth`；server 数据库、日志和运行数据写入 project home。桌面自身运行状态（例如最近项目）继续写入 Electron `userData`；launcher 快捷键与系统应用图标同步偏好写入全局 `~/.oneworks/.oo.config.json` 的 `desktop` section。
- 当前打包保持 `asar: false`，因为 staging 仍依赖 `pnpm deploy` 生成的依赖布局与原生模块路径。
- `pnpm-workspace.yaml` 通过 `patchedDependencies` 对 `@electron/osx-sign@2.4.0` 的未封包应用遍历做串行化；上游仍使用无界 `Promise.all` 扫描每个文件，`asar: false` 的大目录会在 macOS runner 上触发 `EMFILE`。升级或移除补丁前必须先让 `osx-sign-walk.spec.ts` 和一次不创建 Release 的真实签名构建通过。
- signed macOS 打包依赖 `@electron/osx-sign` 以 deepest-first 顺序逐个签名，并在所有嵌套 binary 后调用 outer root App 的 `optionsForFile`。只有这个回调可以从已签名的 `@oneworks/fs-authority-native` arm64 / x64 regular file 原子刷新 exact size / SHA-256 manifest，再由 root App 签名封装；不得启用会让 options callback 先于嵌套签名求值的 batch 模式，也不得在 unsigned 路径刷新。
- macOS 正式产物按 `arm64` / `x64` 分别构建并分别发布，不做 universal 合包。
- Windows 当前 builder 目标仍是 `nsis-web`；正式安装包体验还未收口时，不要提前在外层文档里承诺 MSI / 完整离线安装器。

## 维护约定

- 改内置 server 启动参数、workspace 解析或资源路径时，至少同时检查：
  - `src/main/`
  - `electron.vite.config.ts`
  - `src/server-child.cjs`
  - `scripts/smoke-packaged-server.cjs`
- 改桌面启动阶段、首屏就绪条件或启动失败兜底时，至少同时检查 `src/main/startup-diagnostics.ts`、`src/main/app-runtime.ts`、`src/main/window-manager.ts`、`src/preload/index.ts`、`apps/client/src/desktop/use-desktop-ui-ready.ts` 和各 surface 的实际挂载点；不要在 provider commit 或 `Suspense fallback={null}` 阶段提前上报 UI ready，也不要把后台预加载失败误算成用户可见的启动失败。`revealWorkspaceStartupSurface` 只能在可见、可理解的 React 启动面挂载后移除静态 preload overlay；只有 `markWorkspaceStartupReady` 可以通过 IPC 完成 workspace 启动诊断，两个信号不得合并。
- 打包桌面端时，`build:server` 会先生成 `apps/server/dist/__INTERNAL__home/index.mjs` 与按需加载的 ESM chunks；打包态 workspace server 通过显式环境变量优先使用这份 bundle，缺失时回退源码。bundle 只内联 `@oneworks/*` 启动图，server 自己声明的第三方运行时依赖继续由包目录解析；不要把 adapter / plugin 的运行时发现路径静态化。ESM banner 中的 `__dirname` 属于 entry / chunk，不再代表被内联包的原始目录；package-owned 资源必须从 `src/server-child.cjs` 注入的稳定 app root 或明确的 package root 解析。`scripts/smoke-packaged-server.cjs` 必须强制走 dist entry，并在启动前断言 entry/chunks 及运行时资产都存在；源码 fallback smoke 不能替代打包契约验证。
- 改窗口创建、标题栏、`window.open`、多窗口或右键新窗口时，至少同时检查：
  - `src/main/browser-window-factory.ts`
  - `src/main/window-manager.ts`
  - `src/main/ipc-handlers.ts`
  - `apps/client/src/utils/chat-links.ts`
  - `apps/client/src/components/sidebar/SessionContextMenu.tsx`
- 改 launcher / 项目选择页时，至少同时检查：
  - `src/main/launcher-client-service.ts`
  - `src/main/window-manager.ts`
  - `src/main/workspace-selector-state.ts`
  - `apps/client/src/routes/LauncherRoute.tsx`
  - `apps/client/src/vite-env.d.ts`
- 改菜单或快捷键时，`src/main/menu.ts` 与 `apps/client/src/desktop/view-shortcuts.ts` 要一起看；菜单项、tooltip 展示和 Monaco 内快捷键转发要保持同一套 action 名称。
- 改 launcher 全局快捷键时，还要检查 `src/main/app-runtime.ts` 的 `globalShortcut` 注册 / 注销逻辑、`src/main/desktop-state-store.ts` 的持久化，以及 preload 注入给前端的 `getDesktopSettings` / `updateDesktopSettings`，避免 app 退出后快捷键残留或普通 Web 前端误展示桌面配置。
- 改打包资源布局时，`scripts/package.cjs`、`scripts/make.cjs`、`scripts/sync-icons.cjs`、`scripts/mac-*.cjs`、`electron-builder.yml` 与 smoke test 要一起看；不要只改其中一个入口。
- 改本地 dev 打包、workspace server 启动或 runtime package cache 时，必须同时检查 `scripts/package.cjs`、`src/builtin-adapter-cache.cjs`、`src/main/workspace-runtime-cache-manager.ts`、`src/main/workspace-runtime-cache-refresh.ts`、`src/main/app-runtime.ts`、`src/server-child.cjs` 和 `packages/types/src/adapter-package-cache.ts`；cache manager 是后台任务的唯一生命周期 owner，负责去重、重排、取消、等待与失败重试，updates 和 workspace service 不应再各自触发物化。完整 cache refresh 不得在 `core.ready` 到真实 `renderer.interactive` 的窗口抢跑；沿用延迟后台预热，并以真实交互、退出取消和无 orphan 为边界。验证时至少核对安装后的 `desktop-build-source.json`、`/Applications/.../Resources/app/runtime-packages/@oneworks/client`、以及 `~/.oneworks/bootstrap/npm/oneworks__cli/<cacheVersion>` / `oneworks__server/<cacheVersion>` / `oneworks__client/<cacheVersion>` 里的真实文件内容。
- 改打包脚本、图标同步脚本或生成资产时，提交前跑全仓 `pnpm dprint check` 和 `pnpm exec eslint .`，不要只跑改动文件范围；CI 的 format / lint 就是全仓检查。
- 改图标生成资产时，同时检查 `dprint.json` 与 `.gitattributes`：生成 SVG 可按产物排除，`.icns` / `.ico` / `.png` 等二进制图标必须使用 `-text`，避免 Git EOL 规范化破坏文件。
- 改 make target 校验时，要对照 `.github/workflows/desktop-package.yml`：tag / 手动完整构建使用 `ONEWORKS_DESKTOP_MAKE_TARGETS=dmg,zip,pkg`，并依赖 `dmg` 产物做安装验证。
- 改 auto-update 时，要一起验证：
  - `build/app-update.yml`
  - `electron-builder.yml` 的 `publish`
  - `ONEWORKS_DESKTOP_ENABLE_AUTO_UPDATE`
  - `DESKTOP_AUTO_UPDATE`
    目标是继续保证手动非 release artifact 不会误进稳定更新通道。
- 改签名逻辑时，不要破坏本地 / 普通 CI 默认 unsigned 的行为；版本化 release 使用 `apps/desktop/package.json` 私有 `oneworks.release.macosSigningPolicy`，`auto` 下 alpha / beta 为 unsigned、rc 为 signed、stable 强制 signed，具体 rc 才可显式锁为 unsigned。`workflow_dispatch` 可请求 `auto` / `signed` / `unsigned`，但官方 tag 必须与 manifest 一致；`DESKTOP_SIGN` 只作为 signed 能力 / 凭据总开关，不能改变版本语义。普通 PR 不进入安装包 job，也不读取签名 secrets；signed 完整 CI 仍要求 Application 与 Installer 两套证书 secret。
- effective policy 为 unsigned 时仍必须先把 app 内 workspace 绝对 symlink 重写为可移植的 bundle 内相对链接、拒绝断链，再完整 ad-hoc seal prepackaged app，并逐一解包验证 arm64 / x64 的 DMG、PKG、ZIP；候选 manifest 记录 `effectiveSigningPolicy=unsigned`、`adHocSealed=true`、product source SHA 与 builder SHA，同 tag promotion / recovery 不得漂移。Release notes 必须明确 unsigned、未提交 Apple notarization 和 Gatekeeper 手动批准要求；signed 时仍必须要求完整凭据并完成签名与 notarization，stable 禁止 unsigned 降级。
- 启用签名的正式 macOS 构建不仅要 notarize `.app`：生成后的 `.dmg` 与 Developer ID Installer 签名 `.pkg` 也必须提交 notarization 并 staple；安装验证同时覆盖 `codesign` / `spctl --type execute`、`pkgutil` / `spctl --type install` 和 installer staple，避免只验证 DMG 内应用却发布不可安装的 PKG。
- rc 候选只在 `package` job 的签名 / 公证 / 安装验证前经过一次 Production 审批；其候选清单、tag source、签名策略和 asset 摘要全部通过后，Release 与 Homepage 走 `Release Automation`，不得把同一不可变候选拆成重复人工审批。stable 保持独立 `Production` 发布门禁。Desktop GitHub Release 上传前还必须为完整已验证资产集生成 artifact attestation。
- DMG 在 electron-builder 完成后还会因 staple 改变字节，因此 `dmg.writeUpdateInfo` 必须保持关闭，不能发布 stapling 前生成的 DMG blockmap / update digest；macOS 自动更新元数据只引用已包含 stapled app 的 ZIP，并由最终候选 manifest 对所有发布文件重新计算摘要。
- `scripts/notarization-state.cjs` 是 app / DMG / PKG 公证恢复状态的唯一 owner：提交必须使用 `notarytool --no-wait`，等待前保存来源、build metadata、精确 payload 大小与 SHA-256、attempt marker / submission ID 并上传 recovery artifact；恢复时先按 history 唯一对账结果不明的 attempt，只提交从未尝试过的剩余 target，再保存更新状态，校验并还原同一字节、Accepted 后 staple。Apple 长时间 `In Progress`、连接中断或 runner 超时都不能触发重新签名、重复 submit 或绕过摘要验证。
- fresh signed build 与 `app` recovery 在 signature-only 验证后、任何 Apple app prepare / reconcile / submit / wait 前，都必须运行当前 builder 的 packaged authority 诊断；unsigned 与 installer-only recovery 跳过。诊断只检查包内实现与 executable 的兼容性，不能改 App 字节、重试业务 asset 请求、跳过或替代最终 signed/notarized 验证后的 product smoke。stderr 必须有界内收，外部只允许看到稳定 phase / error code。
- 改版本号传递或 artifact 命名时，保持 `pkg/oneworks-desktop/v*` tag、`artifactName` 与 `latest*.yml` 中的 URL 一致，否则自动更新会直接失效。
- 正式包的 runtime package cache version 必须读取 Electron 最终应用版本（`app.getVersion()`），不能读取依赖包版本。打包 staging 的应用 manifest 必须先写入 `ONEWORKS_DESKTOP_VERSION`，保证 Electron runtime、原生 bundle 与 runtime cache 目录使用同一最终版本；release tag 覆盖桌面版本但内部 workspace 包尚未对齐时也不能复用上一版 server / adapter 缓存。
- 可信 packaged cache 首次落盘可以用 immutable cache version / build fingerprint 作为完整性标识，并在 APFS 等支持的文件系统上优先 clone 文件；不要在启动关键路径重复哈希和物理复制相同 bundle 内容。built-in plugin 的版本 cache 只读链接回不可变应用包，`latest` cache 再作为版本 cache 的轻量别名；应用位置或 build fingerprint 变化时必须由 manifest 校验重建链接。
- `pnpm deploy --legacy --prod` 会让共享 workspace 的依赖状态暂时变成 production-only；`scripts/package.cjs` 在所有架构完成或失败后都必须用 frozen lockfile 恢复 dev dependencies，之后才能运行 packaged server smoke 或其他 workspace 脚本。不要依赖调用方额外执行 `pnpm install` 来修复打包命令留下的状态。
- packaged server smoke 必须分别验证干净 cache 下的 server readiness 与显式后台 cache refresh：server ready 不能等待完整 runtime package cache 物化，refresh 成功后仍要核对 cache 产物，并在任一阶段超时时输出 `server.log` 尾部，不能只留下无上下文的 “did not become ready”。如需实验性收紧可设置 `ONEWORKS_DESKTOP_SMOKE_TIMEOUT_MS`，但正式 workflow 使用覆盖低速 CI 的默认值。普通 HTTP 请求使用 `ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS`（默认 30 秒）；首次 Vite 编译本地插件源码使用独立的 `ONEWORKS_DESKTOP_SMOKE_COMPILE_TIMEOUT_MS`（默认 120 秒），不能通过全局放宽请求时限或跳过源码请求来规避发布 smoke。

## 已验证经验

- 打包链路最好分两段理解：
  - `pnpm desktop:package` 负责产出“当前平台可运行的 app”
  - `pnpm desktop:make` 负责基于 prepackaged app 生成安装 / 分发产物
    这两段混在一起排查时最容易看错问题发生层级。
- 当用户要求本地编译桌面包时，先询问是否需要自动安装验证；确认后先完成本地构建与 `pnpm -C apps/desktop smoke:package`，再用 `ditto "apps/desktop/out/One Works Dev-darwin-arm64/One Works Dev.app" "/Applications/One Works Dev.app"` 覆盖安装 Dev 版并校验 bundle metadata。默认不要卸载或覆盖正式 `/Applications/One Works.app`。
- GitHub 手动非 release artifact 和默认本地构建一样使用 `One Works Dev` 身份；`pkg/oneworks-desktop/v*` release、手动 release 输入或明确的本地 production 验证可以通过 `ONEWORKS_DESKTOP_RELEASE_BUILD=true` 切到正式 `One Works` 身份，但本地 production 验证不能冒充官方不可变发布。
- 本地或普通 CI 桌面包会注入 `desktop-build-source.json`，由配置页“关于 / 应用来源”展示 git hash、分支、构建时间和唯一 runtime cacheVersion；即使本地显式使用正式 `One Works` 身份，也必须保留该文件，避免同一 semver 的连续本地 production 构建复用旧 client/server/plugin。只有带 `ONEWORKS_DESKTOP_OFFICIAL_RELEASE_BUILD=true` 的官方 tag / release workflow 产物才不注入，继续按不可变 semver 复用缓存。
- macOS 双架构打包依赖 `scripts/make.cjs` 在 release 目录里合并 `latest-mac.yml`；改动多架构逻辑后，要确认最终只留下一个对外使用的 `latest-mac.yml`。
- 包内 server 是否真的可启动，不要只看 Electron 能不能打开窗口；优先跑 `pnpm -C apps/desktop smoke:package`，让 packaged server 真正响应 `/api/auth/status`。
- `node-pty`、`node-notifier` 这类平台相关依赖会直接影响包体大小和运行稳定性；改 native 依赖或目标架构时，要连同 `scripts/package.cjs` 里的裁剪逻辑一起验证。
- `ELECTRON_RUN_AS_NODE`、`__ONEWORKS_PROJECT_CLIENT_DIST_PATH__`、`__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` 这些环境变量缺任何一个，都容易让 packaged server 启不来或连不上正确的前端资源。
- macOS 崩溃报告中的 `Electron` 进程可能来自旧 worktree 或其他会话。先用报告里的 PID、启动时间和本机 `ps` 结果对齐来源；如果弹窗来自非当前会话，优先关闭报告窗口，不要点“重新打开”去复活旧实例。
- 在 macOS 上做可恢复的正式 release 安装验证时，必须按[官方安装 smoke 的用户数据隔离](../../.oo/rules/release/macos-signing.md#官方安装-smoke-的用户数据隔离)完成全部 real / config / project / package-cache / userData / Home 输入隔离和 pre / post 零写入 fingerprint。旧应用备份只保留到新下载的官方产物通过身份、版本、架构、strict seal 与 quarantine 边界检查，并完成隔离启动和正常退出；全部通过后立即把 `/Applications` 下的临时备份和 release 安装归档移到可恢复的废纸篓，避免 Spotlight 继续暴露过期主应用或其中嵌套的 Electron Helper。只有安全卸载后的 mount point、空目录和隔离 profile 临时文件可以直接移除；不要永久删除当前应用、用户数据或唯一发布证据。Spotlight 中的 Electron Helper 条目可能只是 `.app` 内嵌套的 helper bundle，不代表另一份独立安装。

## 后续回归点

- 验证“GitHub 流水线产物能安装”时，必须触发 GitHub Actions、下载该 run 上传的 artifact，再用下载回来的 `.dmg` 安装验证；本地 `pnpm desktop:make` 产物只能证明本机打包链路，不等价于流水线产物。
- macOS 用户主安装路径是 `.dmg`，不要只验证 `.pkg` 或 prepackaged `.app`。`.pkg` 只能作为 Installer.app 流程的补充验证，不能替代 DMG 下载后挂载、复制到 `/Applications` 的路径。
- 手动非 release artifact 必须继续使用 `One Works Dev` 与 `ai.oneworks.desktop.dev`，否则下载到开发机后会覆盖正式 `/Applications/One Works.app`。只有 `pkg/oneworks-desktop/v*` release 或手动 release 输入允许设置 `ONEWORKS_DESKTOP_RELEASE_BUILD=true`。
- `pnpm -C apps/desktop smoke:package` 只证明 prepackaged app 内的 server 能启动；它不能证明 `.dmg` 内容、安装复制路径、bundle metadata、构建来源元数据或安装后的资源路径正确。安装产物验证要跑 `pnpm -C apps/desktop verify:macos-install`，并在需要时从下载的 artifact 目录执行。
- GitHub Actions 可能提示 Node.js 20 actions deprecation。该 warning 不影响当前 macOS DMG 验证结果，但后续升级 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 或 `pnpm/action-setup` 时要重新跑 desktop-package workflow。
- 普通 PR 不再自动生成安装包；触及桌面直接源码、正式包内 workspace 依赖、内置 adapter / plugin、server 或 client 的发版，应在 release tag 前手动 dispatch `desktop-package.yml` 验证真实安装产物。
- `smoke:package` 之后 pnpm 可能把 `apps/desktop/node_modules` 重建成 production-only，导致后续 `make:from-package` 找不到 `electron-builder`。如果 CI 顺序保持 smoke 在 make 前，make 前必须先用 `pnpm install --frozen-lockfile --prod=false` 恢复 devDependencies；否则就把 make 放到 smoke 前。

## 常见坑位

- 只改 `electron-builder.yml`，不改 `scripts/make.cjs` / `scripts/package.cjs`：通常会出现本地能打包、CI 产物却不对，或者反过来。
- 只验证 dev 模式，不验证 packaged 模式：很多桌面问题只会在 `out/` 或安装产物里出现。
- 让桌面自动更新读取全仓 GitHub Latest：其他 package release 可能抢占 Latest；桌面更新必须按 `pkg/oneworks-desktop/v*` tag 前缀查找 release。
- 提前开启自动更新而没有签名：即使更新元数据可用，真实分发体验通常也会被系统安全策略拦住。
