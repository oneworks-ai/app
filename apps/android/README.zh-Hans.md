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
- 无障碍命令已通过 Android `AccessibilityService` 搭好骨架；真正操作其它应用 / 页面前，用户仍需要在系统设置里手动启用该服务。
- 宿主注入了与 Electron launcher 对齐的 device shell workspace API；“打开项目”默认复用 OneWorks 内部目录列表，Android 侧只负责枚举目录和记录最近项目。系统目录选择器保留为后续授权 / 兜底能力。当前阶段只验证选择 / 状态流转，尚未在 Android 内启动 OneWorks 后端服务。

## 验证

```bash
pnpm -C apps/android validate
__ONEWORKS_PROJECT_CLIENT_MODE__=standalone __ONEWORKS_PROJECT_CLIENT_BASE__=/client/ pnpm -C apps/client exec vite build
ANDROID_HOME="$HOME/.codex/android-sdk" ANDROID_SDK_ROOT="$HOME/.codex/android-sdk" ./gradlew assembleDebug
```

构建 APK 时，在已安装 Android SDK 和 Gradle 后，用 Android Studio 打开 `apps/android`，或在该目录运行 `gradle assembleDebug`。
