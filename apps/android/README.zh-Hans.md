[English](./README.md)

# OneWorks Android

这里是 Android WebView 壳原型。应用主体由打包后的 OneWorks 前端宿主 WebView 渲染，宿主页可以通过原生 JSON 桥创建和操作其它真实目标 WebView。

## 原型范围

- 宿主 WebView 在存在 `apps/client/dist` 时加载打包后的 `https://oneworks.local/client/launcher`。`app/src/main/assets/host/index.html` 只作为没有 client dist 时的本地 fallback/demo 页。
- 目标页面是原生代码管理的真实 `android.webkit.WebView`。
- 宿主页可以创建目标页、注入 JavaScript、查询 / 点击 / 设置目标 DOM 元素，并接收目标页 DOM 事件。
- Android 状态栏、导航栏和安全区背景会通过注入的 bridge helper 跟随打包前端的亮 / 暗色主题。
- 如果 `apps/client/dist` 存在，Gradle 会把它打进 APK 的 `client/` assets；Android 宿主 WebView 会把这个 bundle 作为主应用打开。
- Gradle 会把 `apps/server` 的快照打进 APK 的 `server/source/` assets；如果后续存在 `apps/server/dist`，也会打进 `server/dist/`。真正让当前 Node/Koa 后端在 Android 里运行，还需要嵌入 Node runtime 或改造成原生本地服务。
- Gradle 会把打包运行时元数据写入 APK assets 的 `runtime/package-cache.json`。Debug 构建默认使用 `dev-<worktree path hash>` cacheVersion；也可以通过 `ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION` 或 `-PoneworksRuntimePackageCacheVersion=...` 固定本地 build 指纹。
- 无障碍命令已通过 Android `AccessibilityService` 搭好骨架；真正操作其它应用 / 页面前，用户仍需要在系统设置里手动启用该服务。
- 宿主注入了与 Electron launcher 对齐的 device shell workspace API；“新建项目”和“打开项目”默认复用 OneWorks 内部目录列表，Android 侧负责枚举目录、创建项目目录和记录最近项目。系统目录选择器保留为后续授权 / 兜底能力。当前阶段只验证选择 / 状态流转，尚未在 Android 内启动 OneWorks 后端服务。

## 验证

```bash
pnpm -C apps/android validate
__ONEWORKS_PROJECT_CLIENT_MODE__=standalone __ONEWORKS_PROJECT_CLIENT_BASE__=/client/ pnpm -C apps/client exec vite build
ANDROID_HOME="$HOME/.codex/android-sdk" ANDROID_SDK_ROOT="$HOME/.codex/android-sdk" ./gradlew assembleDebug
ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION=dev-local ANDROID_HOME="$HOME/.codex/android-sdk" ANDROID_SDK_ROOT="$HOME/.codex/android-sdk" ./gradlew assembleDebug
```

构建 APK 时，在已安装 Android SDK 和 Gradle 后，用 Android Studio 打开 `apps/android`，或在该目录运行 `gradle assembleDebug`。

## macOS 可见模拟器

当 agent 或非交互 shell 需要保留一个桌面可见的 Android Emulator 窗口时，使用机器级统一服务：

```bash
pnpm --silent tools dev-service ensure android-emulator --json
```

该命令通过机器级状态、租约、PID 指纹和 ADB serial 契约复用或启动配置的 AVD。内部 `emulator:visible` 只能用于在前台发起的聚焦 launcher 诊断：launcher 在 ready 后退出，但模拟器子进程仍以 detached 方式运行。直接启动的 emulator registry 会标记为 `uncoordinated` 且没有 owner worktree；直接复用由 dev-service 管理的 emulator 时会保留其协调 owner，直接 `--restart` 会被拒绝，不能把私有入口当成共享长期 owner。安装 APK 和启动应用应在统一状态返回 `ready: true` 后继续。
