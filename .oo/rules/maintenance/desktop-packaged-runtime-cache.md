# 桌面本地打包 Runtime Cache 经验

本文记录桌面端本地 dev 安装包与 runtime package cache 的排查和验证规则。它是内部维护经验，不是用户使用文档。

## 适用场景

- 用户反馈本地打包并安装后，Electron 仍像旧代码。
- 打开安装后的 Dev app 后进入 `Switch Project` / 项目选择兜底页，并提示 server exited before ready。
- 第一条消息、权限弹窗、前端显示或 server 行为像之前已经修过的问题。
- 本地 dev 包需要覆盖 server / client / adapter 运行时代码，但不能清理用户账号、会话、数据库或 project home。

## 核心判断

- 安装包里的 `/Applications/.../Resources/app` 不是唯一真相。packaged workspace 启动时会先把内置 runtime package 刷新到 `~/.oneworks/bootstrap/npm/oneworks__server/<cacheVersion>` 与 `oneworks__client/<cacheVersion>`，真实运行代码通常来自这里。
- `desktop-build-source.json` 里的 `runtimePackageCacheVersion` 是本次 dev build 指纹。client、server、adapter cache 必须使用同一个 dev cacheVersion；如果任一链路回落到普通版本号，例如 `0.1.0-alpha.0`，就会出现“部分新、部分旧”的混合行为。
- Electron shared client 和 workspace server 是两条启动链路。修 server cache 不等于前端也用了新 cache；`src/main/launcher-client-service.ts` 必须和 `src/main/workspace-service-manager.ts` 一样传入 runtime cache version。
- `Switch Project` 页面不是聊天业务 UI。它通常表示没有 workspace 或 workspace server 启动失败；先查 server-child stderr / 启动日志，不要把它当成前端路由回归。

## 常见根因

- 本地 package 只跑了 `pnpm deploy`，没有把当前 workspace package overlay 到 staging，导致安装包仍携带发布版本代码。
- server-child 刷新了 dev runtime cache，但 shared client 静态服务仍按默认版本解析 `@oneworks/client`，导致前端旧、后端新。
- runtime package closure 复制依赖时只按 `package.json.name` 匹配依赖名，漏掉 pnpm alias 依赖，例如依赖键是 `function-bind`，真实包名是 `@nolyfill/function-bind`。这种情况下 cache 目录看似存在，server 启动时才报 `Cannot find module ...`。
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
pnpm exec dprint check <changed-files>
pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/desktop/__tests__/builtin-adapter-cache.spec.ts apps/desktop/__tests__/runtime-consumer-cli-path.spec.ts
pnpm -C apps/desktop run package
pnpm -C apps/desktop run make:from-package
pnpm -C apps/desktop verify:macos-install
```

安装后继续核对：

- `/Applications/One Works Dev.app/Contents/Resources/desktop-build-source.json` 包含新的 `runtimePackageCacheVersion`。
- `~/.oneworks/bootstrap/npm/oneworks__client/<cacheVersion>/node_modules/@oneworks/client/dist` 来自本次 build。
- `~/.oneworks/bootstrap/npm/oneworks__server/<cacheVersion>/node_modules/@oneworks/server` 来自本次 build。
- 启动日志中 shared client 和 workspace server 都解析到同一个 `<cacheVersion>`。
- server-child 监听端口后，`/api/auth/status` 返回成功。

不要通过删除用户数据来“验证修复”。账号、会话、数据库、project home 和 Codex home 不属于 runtime package cache，除非用户明确要求，否则不能清理。

## PR 检查点

- PR body 说明本次改动覆盖 client / server / adapter 哪些链路，不要只写“修复打包”。
- 如果改了 dev cacheVersion 语义，同时检查 desktop、bootstrap、Android 三处是否一致。
- 如果改了依赖闭包复制，必须有 pnpm alias 依赖测试。
- 如果改了 packaged shared client，必须有测试证明 client dist 能按指定 runtime cache env 解析。
