# 桌面本地打包 Runtime Cache 经验

本文记录桌面端本地 dev 安装包与 runtime package cache 的排查和验证规则。它是内部维护经验，不是用户使用文档。

## 适用场景

- 用户反馈本地打包并安装后，Electron 仍像旧代码。
- 打开安装后的 Dev app 后进入 `Switch Project` / 项目选择兜底页，并提示 server exited before ready。
- 第一条消息、权限弹窗、前端显示或 server 行为像之前已经修过的问题。
- 本地 dev 包需要覆盖 server / client / adapter 运行时代码，但不能清理用户账号、会话、数据库或 project home。

## 核心判断

- 安装包里的 `/Applications/.../Resources/app` 不是唯一真相。packaged workspace 启动时会先把内置 runtime package 刷新到 `~/.oneworks/bootstrap/npm/oneworks__server/<cacheVersion>` 与 `oneworks__client/<cacheVersion>`，真实运行代码通常来自这里。
- `desktop-build-source.json` 里的 `runtimePackageCacheVersion` 是本次非官方 packaged build 指纹。client、server、adapter cache 必须使用同一个 dev cacheVersion；如果任一链路回落到普通版本号，例如 `0.1.0-alpha.0`，就会出现“部分新、部分旧”的混合行为。
- “正式应用身份”和“官方不可变发布”是两套语义：本地 production 包可以使用 `One Works` / `ai.oneworks.desktop` 身份，但仍必须注入唯一的 `desktop-build-source.json`。只有官方 tag / release workflow 显式设置 `ONEWORKS_DESKTOP_OFFICIAL_RELEASE_BUILD=true` 时，才允许省略 build source 并按 package semver 信任已有缓存；不要仅凭 `ONEWORKS_DESKTOP_RELEASE_BUILD=true` 把本地包当作不可变发布。
- 源码开发态的 `dev-*` cacheVersion 只隔离不同 worktree / build，不代表同一个开发版本内的文件不会继续变化；这类 runtime、adapter 与内置插件每次 ensure 都必须核对源文件完整性并刷新变化项。非官方安装包会另外注入每次打包唯一的 `runtimePackageBuildFingerprint`；只有 manifest 同时匹配 cacheVersion、构建指纹、platform 和 arch 时才能走快速信任，避免显式固定 cacheVersion 跨构建复用旧代码或双架构安装包复用错误的原生依赖。
- `server-child.cjs` 会经 `@oneworks/cli-helper` 重拉起带 register preload 的 loader 子进程。内置包缓存只允许在父进程准备一次，并通过继承 env 把“已准备”状态和 adapter metadata 交给 loader 子进程；不要让父子进程重复扫描同一套 package closure。
- Electron shared client 和 workspace server 是两条启动链路。修 server cache 不等于前端也用了新 cache；`src/main/launcher-client-service.ts` 必须和 `src/main/workspace-service-manager.ts` 一样传入 runtime cache version。
- `Switch Project` 页面不是聊天业务 UI。它通常表示没有 workspace 或 workspace server 启动失败；先查 server-child stderr / 启动日志，不要把它当成前端路由回归。

## 常见根因

- 本地 package 只跑了 `pnpm deploy`，没有把当前 workspace package overlay 到 staging，导致安装包仍携带发布版本代码。
- server-child 刷新了 dev runtime cache，但 shared client 静态服务仍按默认版本解析 `@oneworks/client`，导致前端旧、后端新。
- runtime package closure 复制依赖时只按 `package.json.name` 匹配依赖名，漏掉 pnpm alias 依赖，例如依赖键是 `function-bind`，真实包名是 `@nolyfill/function-bind`。这种情况下 cache 目录看似存在，server 启动时才报 `Cannot find module ...`。
- runtime package closure 只遍历 `dependencies` / `optionalDependencies`，没有把非重复的 `peerDependencies` 连同 optional peer 语义纳入闭包。插件可能在 workspace 中依靠提升后的 peer 正常运行，复制进独立 cache 后才缺包；materialize 必须显式复制 peer closure。
- trusted packaged cache 的相对 symlink 如果直接按逻辑路径计算，在 macOS `/var` → `/private/var` 这类目录别名下可能指向错误层级，表现为 manifest 已写入但 package link 不存在。创建链接前必须对目标父目录和 source 都做 `realpath`，再计算相对路径；回归测试要让 cache alias 与真实目录具有不同深度，并让 source 位于 alias 之外。
- packaged launcher 首屏期间可以提前预热 workspace package cache，但预热必须在 `ELECTRON_RUN_AS_NODE` 子进程里执行，覆盖 cli / server / client runtime、内置 adapters 和内置 plugins。不要在 Electron main 进程里同步 seed 这些包；首次 3/3 或 9/13 changed 时会抢占 launcher renderer，造成首屏 ready 变慢。
- 只验证 Electron 窗口能打开，没有验证 packaged server 是否真正响应 `/api/auth/status`。

## 修改入口

- `apps/desktop/scripts/package.cjs`
  - 本地 dev 打包 staging、workspace package overlay、内置 client runtime package 写入。
- `apps/desktop/src/builtin-adapter-cache.cjs`
  - 内置 server / client / adapter materialize 到 bootstrap npm cache。
  - 依赖闭包必须保留 alias link 名称，同时允许真实 package name 与依赖键不同。
- `apps/desktop/src/server-child.cjs`
  - packaged server-child 自举和 server package 解析。
- `apps/desktop/src/main/workspace-service-manager.ts`
  - workspace server 进程 env、cacheVersion、client dist path 和 server cache 解析。
- `apps/desktop/src/main/launcher-client-service.ts`
  - shared client 静态服务 env、cacheVersion 和 client dist 解析。
- `apps/desktop/src/main/updates.ts`
  - packaged dev 背景刷新不能绕回 registry/bootstrap install。
- `apps/desktop/src/main/runtime-cache-version.ts`
  - 桌面 dev runtime cacheVersion 的统一解析。
- `packages/types/src/adapter-package-cache.ts`
  - runtime package cache 的共享解析契约。
- `apps/android/app/build.gradle.kts` 与 Android bridge
  - Android 打包 runtime metadata 时，cacheVersion 语义应和 desktop / bootstrap 保持一致。

## 标准验证

本地修复后至少验证这些点：

```bash
pnpm dprint check <changed-files>
pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/desktop/__tests__/builtin-adapter-cache.spec.ts apps/desktop/__tests__/runtime-consumer-cli-path.spec.ts
pnpm -C apps/desktop run package
pnpm -C apps/desktop run make:from-package
pnpm -C apps/desktop verify:macos-install
```

安装后继续核对：

- 所有非官方 packaged build，无论使用 `One Works Dev` 还是本地 production `One Works` 身份，其实际安装路径的 `Contents/Resources/desktop-build-source.json` 都必须存在，并包含本次唯一的 `runtimePackageCacheVersion` 与 `runtimePackageBuildFingerprint`。
- 只有显式设置 `ONEWORKS_DESKTOP_OFFICIAL_RELEASE_BUILD=true` 的官方不可变 build 才应缺少 `desktop-build-source.json`；这条反向断言必须和非官方包的存在性检查一起验证，且 runtime cache 应使用最终应用版本。
- `~/.oneworks/bootstrap/npm/oneworks__client/<cacheVersion>/node_modules/@oneworks/client/dist` 来自本次 build。
- `~/.oneworks/bootstrap/npm/oneworks__server/<cacheVersion>/node_modules/@oneworks/server` 来自本次 build。
- 启动日志中 shared client 和 workspace server 都解析到同一个 `<cacheVersion>`。
- server-child 监听端口后，`/api/auth/status` 返回成功。

不要通过删除用户数据来“验证修复”。账号、会话、数据库、project home 和 Codex home 不属于 runtime package cache，除非用户明确要求，否则不能清理。

## PR 检查点

- PR body 说明本次改动覆盖 client / server / adapter 哪些链路，不要只写“修复打包”。
- 如果改了 dev cacheVersion 语义，同时检查 desktop、bootstrap、Android 三处是否一致。
- 如果改了依赖闭包复制，必须有 pnpm alias 依赖测试。
- 如果改了 dev manifest 信任语义，必须覆盖“同 cacheVersion、源文件变化后只刷新变化包”的回归测试。
- 如果改了 peer dependency 闭包，必须验证复制后的消费包能从自身 `node_modules` 解析 peer。
- 如果改了 packaged shared client，必须有测试证明 client dist 能按指定 runtime cache env 解析。
