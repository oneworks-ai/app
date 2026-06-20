# Desktop Package

`@oneworks/desktop` 是 Electron 桌面壳，负责窗口生命周期、内置 server 生命周期、本地 workspace 选择与安装包产物；业务逻辑仍复用 server 与 client workspace 包。

## 先看哪里

- `src/main/index.ts`
  - Electron main 进程薄入口
  - 桌面 app bootstrap 委托到 `src/main/`
- `src/main/`
  - `app-runtime.ts`：单实例锁、应用生命周期和各模块装配
  - `browser-window-factory.ts`：统一 BrowserWindow 创建、titlebar 风格、`window.open` 管控和窗口关闭清理
  - `window-manager.ts`：BrowserWindow 记录、项目选择页 / launcher / workspace 窗口切换
  - `launcher-client-service.ts`：桌面共享 client dev server / packaged static server 生命周期
  - `workspace-service-manager.ts`：每个 workspace 的内置 server 生命周期
  - `window-titles.ts`：workspace、launcher、selector 的窗口标题和加载页 URL 组装
  - `deep-link.ts`：`oneworks://` / `one-works://` schema URL 解析，目前用于 Relay SSO 回跳到 workspace 插件页
  - `menu.ts`、`ipc-handlers.ts`、`shortcuts.ts`：菜单、IPC 与桌面快捷键
  - `updates.ts`：自动更新检查
  - `browser-data-sync.ts`：桌面端浏览器数据同步与本机加密 vault；Authenticator 备份导入、未来 Chrome 密码导入和扩展同步的 main-process 落点
- `src/workspace-state.cjs`
  - 桌面最近项目、workspace 显示名、启动 workspace 解析入口。
  - 作为 project/workspace 打开或记录时，会把 Git linked worktree 归一到 common `.git` 对应的原始 project 目录；普通目录浏览仍使用真实路径。
- `electron.vite.config.ts`
  - 使用 `electron-vite` 编译 main / preload TypeScript 到 `dist/`
- `src/server-child.cjs`
  - dev / packaged 场景下如何桥接到 server workspace package
- `scripts/package.cjs`
  - `pnpm deploy --prod` staging；当前 pnpm 支持 `--legacy` 时脚本会自动加上
  - multi-arch 预打包
  - auto-update 资源注入
  - 原生依赖裁剪
- `scripts/sync-icons.cjs`
  - 从 `assets/icon` submodule 同步桌面图标资源
  - 维护默认金属风格根图标、macOS `.icon` appearance 包和运行时风格切换资产
- `scripts/mac-*.cjs`、`scripts/make-targets.cjs`
  - macOS `.icon` / `.icns` 工具链探测、图标模式选择、prepackaged app 校验和 make target 参数解析
- `scripts/make.cjs`
  - 从 prepackaged app 生成安装 / 分发产物
  - 支持 `--target` 和 macOS `--mac-icon auto|icns|icon`
  - 签名开关
  - macOS 双架构 `latest-mac.yml` 合并
- `scripts/smoke-packaged-server.cjs`
  - 包内 server smoke test 契约
- `electron-builder.yml`
  - 目标平台、artifact 命名、GitHub publish 配置
- `build/app-update.yml`
  - 桌面正式更新通道配置

## 当前边界

- Electron main 进程不重复实现 server 业务逻辑；桌面端 server 仍通过 `src/server-child.cjs` 复用 server workspace package。
- `pnpm desktop:dev` 默认打开不绑定 workspace 的空项目启动页；`pnpm desktop:dev:workspace` 才以当前仓库作为 workspace 启动。两者都转发到 `pnpm tools dev-start`，由 Electron 启动一个共享 Vite client，并为每个 workspace 启动独立本机 server；前端改动应走共享 client 的 HMR，不需要重复构建静态 dist。
- 多 worktree / 多 AI 会话可能同时运行桌面开发态实例；排查崩溃或端口占用时，不要因为看到其他 worktree 的 Electron、`apps/desktop/src/server-child.cjs` 或 `apps/client/cli.cjs` 进程就直接清理。先列出 PID、启动时间、worktree 路径和命令来源，只有确认属于当前终端会话、明确是当前崩溃实例残留，或用户同意后才停止。
- 桌面 main / preload 使用 `electron-vite` 构建，Electron 运行入口是 `dist/main/index.js`。
- 空项目启动页和所有 workspace 窗口共用 launcher client service 管理的 client；workspace service 只启动 server。打开 workspace 后，main/preload 通过 IPC 告诉对应 renderer 当前窗口绑定的 `serverBaseUrl`，请求仍由前端直连 server HTTP / WebSocket。不要再为每个 workspace 启动独立 client。
- 空项目启动页默认可通过 `CommandOrControl+Space` 全局快捷键打开；快捷键值来自 Electron 注入的 desktop settings，可在桌面端配置页更新。macOS 上如果系统快捷键占用了 `Command+Space`，Electron 注册会失败并只打印 warning，不要在代码里静默换成另一个快捷键。
- 桌面窗口统一使用隐藏 titlebar / traffic light 风格；新建窗口、右键会话新窗口、launcher 和 workspace selector 都必须通过 `browser-window-factory` 创建，避免出现系统默认标题栏。
- macOS workspace 窗口的原生毛玻璃依赖 `vibrancy: 'sidebar'` 和 `transparent: true` 同时存在；client 侧会把 sidebar / titlebar 背景让给原生窗口材质。不要只设置透明背景色或只改前端 CSS，否则展开态 sidebar 容易退成实色灰块，和 launcher / 折叠态表现不一致。
- workspace 内部 `window.open` 只允许打开同 workspace client base 下的 URL；跨 origin 或离开 client base 的 URL 必须拒绝或走外部浏览器，不要直接生成不受管控的新窗口。
- Relay SSO 登录回跳使用 `oneworks://relay/auth?workspace=<workspace>&scope=<scope>&serverId=<serverId>#relay_token=<token>`。改 custom scheme、单实例锁、启动参数或 workspace 路由打开逻辑时，要同时检查 `src/main/deep-link.ts`、`src/main/app-runtime.ts`、`src/main/window-manager.ts` 和 `electron-builder.yml`。
- macOS 会话右键“在新窗口打开”应创建同风格 workspace 窗口，并通过 URL 参数让左侧栏默认折叠。
- 最小窗口宽度当前支持到 `300px`；改 header / nav / sender 布局时要验证这个尺寸，不要只看大窗口。
- `pnpm desktop:package`、`pnpm desktop:make` 仍依赖静态 client dist，并默认先构建 client。
- macOS `.pkg` 安装向导包通过 `pnpm desktop:make:pkg` 或 `node apps/desktop/scripts/make.cjs --target pkg` 生成；`ONEWORKS_DESKTOP_MAKE_TARGETS` 只作为 CI / 临时覆盖入口，不作为用户文档里的主要入口。
- 当前 GitHub `desktop-package` workflow 先收口 macOS：生成 `arm64,x64` 预打包 app 与 `.dmg` / `.pkg` / `.zip`，再挂载 `arm64` `.dmg`、复制安装到 `/Applications`，并从已安装 app 跑 smoke。Windows / Linux builder 目标保留，但暂时不作为 CI gate。
- 桌面图标资产来自 `assets/icon` submodule；更新 submodule 后运行 `pnpm desktop:icons:sync`，默认根图标是工业风格。macOS package / make 默认 `--mac-icon auto`，只有完整 Xcode 26+ 的 `actool` 支持 Icon Composer 时才启用 `.icon` / `Assets.car`，否则继续使用 `.icns`；显式验证可用 `pnpm desktop:make:pkg:icon`。
- 内置本机服务默认关闭 `webAuth`；server 数据库、日志和运行数据写入 project home。桌面自身运行状态（例如最近项目）继续写入 Electron `userData`；launcher 快捷键与系统应用图标同步偏好写入全局 `~/.oneworks/.oo.config.json` 的 `desktop` section。
- 当前打包保持 `asar: false`，因为 staging 仍依赖 `pnpm deploy` 生成的依赖布局与原生模块路径。
- macOS 正式产物按 `arm64` / `x64` 分别构建并分别发布，不做 universal 合包。
- Windows 当前 builder 目标仍是 `nsis-web`；正式安装包体验还未收口时，不要提前在外层文档里承诺 MSI / 完整离线安装器。

## 维护约定

- 改内置 server 启动参数、workspace 解析或资源路径时，至少同时检查：
  - `src/main/`
  - `electron.vite.config.ts`
  - `src/server-child.cjs`
  - `scripts/smoke-packaged-server.cjs`
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
- 改打包脚本、图标同步脚本或生成资产时，提交前跑全仓 `pnpm exec dprint check` 和 `pnpm exec eslint .`，不要只跑改动文件范围；CI 的 format / lint 就是全仓检查。
- 改图标生成资产时，同时检查 `dprint.json` 与 `.gitattributes`：生成 SVG 可按产物排除，`.icns` / `.ico` / `.png` 等二进制图标必须使用 `-text`，避免 Git EOL 规范化破坏文件。
- 改 make target 校验时，要对照 `.github/workflows/desktop-package.yml`：当前 macOS job 会用 `ONEWORKS_DESKTOP_MAKE_TARGETS=dmg,zip,pkg`，并依赖 `dmg` 产物做安装验证。
- 改 auto-update 时，要一起验证：
  - `build/app-update.yml`
  - `electron-builder.yml` 的 `publish`
  - `ONEWORKS_DESKTOP_ENABLE_AUTO_UPDATE`
  - `DESKTOP_AUTO_UPDATE`
    目标是继续保证 PR / main artifact 不会误进稳定更新通道。
- 改签名逻辑时，不要破坏“默认关闭签名”的本地与 CI 行为；当前只有显式设置 `ONEWORKS_DESKTOP_SIGN=true` 或 CI 打开 `DESKTOP_SIGN=true` 时才进入签名流程。macOS App Store 外分发使用 Developer ID Application 证书签 `.app`，Developer ID Installer 证书签 `.pkg`，并通过 Apple notarization 完成认证；当前 CI 目标包含 `pkg`，所以开启签名时两套证书 secret 都必须存在。
- 改版本号传递或 artifact 命名时，保持 `pkg/oneworks-desktop/v*` tag、`artifactName` 与 `latest*.yml` 中的 URL 一致，否则自动更新会直接失效。

## 已验证经验

- 打包链路最好分两段理解：
  - `pnpm desktop:package` 负责产出“当前平台可运行的 app”
  - `pnpm desktop:make` 负责基于 prepackaged app 生成安装 / 分发产物
    这两段混在一起排查时最容易看错问题发生层级。
- 当用户要求本地编译桌面包时，先询问是否需要自动安装验证；确认后先完成本地构建与 `pnpm -C apps/desktop smoke:package`，再用 `ditto "apps/desktop/out/One Works Dev-darwin-arm64/One Works Dev.app" "/Applications/One Works Dev.app"` 覆盖安装 Dev 版并校验 bundle metadata。默认不要卸载或覆盖正式 `/Applications/One Works.app`。
- GitHub 普通 PR / main artifact 和本地构建一样使用 `One Works Dev` 身份；只有 `pkg/oneworks-desktop/v*` release 或手动 release 输入会通过 `ONEWORKS_DESKTOP_RELEASE_BUILD=true` 切回正式 `One Works` 身份。
- 非 release 桌面包会注入 `desktop-build-source.json`，由配置页“关于 / 应用来源”展示 git hash、分支和构建时间；正式 release 包必须保持不注入，避免稳定版本出现开发来源信息。
- macOS 双架构打包依赖 `scripts/make.cjs` 在 release 目录里合并 `latest-mac.yml`；改动多架构逻辑后，要确认最终只留下一个对外使用的 `latest-mac.yml`。
- 包内 server 是否真的可启动，不要只看 Electron 能不能打开窗口；优先跑 `pnpm -C apps/desktop smoke:package`，让 packaged server 真正响应 `/api/auth/status`。
- `node-pty`、`node-notifier` 这类平台相关依赖会直接影响包体大小和运行稳定性；改 native 依赖或目标架构时，要连同 `scripts/package.cjs` 里的裁剪逻辑一起验证。
- `ELECTRON_RUN_AS_NODE`、`__ONEWORKS_PROJECT_CLIENT_DIST_PATH__`、`__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` 这些环境变量缺任何一个，都容易让 packaged server 启不来或连不上正确的前端资源。
- macOS 崩溃报告中的 `Electron` 进程可能来自旧 worktree 或其他会话。先用报告里的 PID、启动时间和本机 `ps` 结果对齐来源；如果弹窗来自非当前会话，优先关闭报告窗口，不要点“重新打开”去复活旧实例。

## 后续回归点

- 验证“GitHub 流水线产物能安装”时，必须触发 GitHub Actions、下载该 run 上传的 artifact，再用下载回来的 `.dmg` 安装验证；本地 `pnpm desktop:make` 产物只能证明本机打包链路，不等价于流水线产物。
- macOS 用户主安装路径是 `.dmg`，不要只验证 `.pkg` 或 prepackaged `.app`。`.pkg` 只能作为 Installer.app 流程的补充验证，不能替代 DMG 下载后挂载、复制到 `/Applications` 的路径。
- 普通 PR / main / workflow_dispatch artifact 必须继续使用 `One Works Dev` 与 `ai.oneworks.desktop.dev`，否则下载到开发机后会覆盖正式 `/Applications/One Works.app`。只有 `pkg/oneworks-desktop/v*` release 或手动 release 输入允许设置 `ONEWORKS_DESKTOP_RELEASE_BUILD=true`。
- `pnpm -C apps/desktop smoke:package` 只证明 prepackaged app 内的 server 能启动；它不能证明 `.dmg` 内容、安装复制路径、bundle metadata、构建来源元数据或安装后的资源路径正确。安装产物验证要跑 `pnpm -C apps/desktop verify:macos-install`，并在需要时从下载的 artifact 目录执行。
- GitHub Actions 可能提示 Node.js 20 actions deprecation。该 warning 不影响当前 macOS DMG 验证结果，但后续升级 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 或 `pnpm/action-setup` 时要重新跑 desktop-package workflow。

## 常见坑位

- 只改 `electron-builder.yml`，不改 `scripts/make.cjs` / `scripts/package.cjs`：通常会出现本地能打包、CI 产物却不对，或者反过来。
- 只验证 dev 模式，不验证 packaged 模式：很多桌面问题只会在 `out/` 或安装产物里出现。
- 让桌面自动更新读取全仓 GitHub Latest：其他 package release 可能抢占 Latest；桌面更新必须按 `pkg/oneworks-desktop/v*` tag 前缀查找 release。
- 提前开启自动更新而没有签名：即使更新元数据可用，真实分发体验通常也会被系统安全策略拦住。
