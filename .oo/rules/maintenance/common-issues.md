# AI 常见问题索引

本文收敛 AI agent 在本仓维护时反复遇到的问题、症状关键词和标准处理方式。遇到类似症状时，优先在本文件搜索关键词，再下钻到对应规则或日志。

## 索引

- [Subagent 启动 Web 服务超过 1 分钟](#subagent-启动-web-服务超过-1-分钟)
- [开发服务 ready 后仍继续验证](#开发服务-ready-后仍继续验证)
- [开发服务启动入口混用历史脚本](#开发服务启动入口混用历史脚本)
- [Android 模拟器启动排查耗时](#android-模拟器启动排查耗时)
- [Android 设备调试页改错 worktree 或 CI 收口失败](#android-设备调试页改错-worktree-或-ci-收口失败)
- [PR 截图证据断链或来源不真实](#pr-截图证据断链或来源不真实)
- [移动端 WebView / 工作区 tabs 反复返工](#移动端-webview--工作区-tabs-反复返工)
- [Electron WebView 右键元素评论坐标偏移](#electron-webview-右键元素评论坐标偏移)

## Subagent 启动 Web 服务超过 1 分钟

症状关键词：`subagent 启动慢`、`取最新代码并启动 web 服务`、`拉取最新代码并启动一个 web 服务`、`dev-start web`、`读规则太多`、`worktree 初始化判断`。

标准处理：

- 命中“取最新代码并启动 web 服务”“拉取最新代码并启动一个 web 服务”“启动 web 服务”时，直接执行 `pnpm tools dev-start web`。
- 不要先读取 `.oo/rules/`。
- 不要先执行 `git rev-parse`、`git status`、`git log`、`git remote`、`git worktree list`。
- 不要手动检查 `node_modules`、`.oo.dev.config.json`、`.env`。
- 不要手动找端口、查进程或启动后台管理器。

原因：

`pnpm tools dev-start web` 已经封装了这些步骤：fetch、安全拉取 / 对齐、workspace install 校验、端口避让、后台进程和探活。agent 在命令前重复执行通用仓库初始化，会把 2-3 秒的热启动拖到 1 分钟以上。

完成条件：

- 命令退出码为 0。
- 输出包含 `[dev-start] ready`。
- 输出包含 `CLIENT_URL`、`SERVER_URL`、`SERVICE_PID`、`LOG_FILE`。

达到完成条件后立即回复这些值并停止。只有命令失败时，才读取输出里的 `LOG_FILE` 并继续排查。

## 开发服务 ready 后仍继续验证

症状关键词：`ready 后还 curl`、`ready 后 ps`、`读 dev-start-web.log`、`二次验证`。

标准处理：

- `dev-start` 已经在返回前完成探活；成功输出 `[dev-start] ready` 后，不要再跑 `ps`、`curl`、`git status`、`git log`、读 log 或列目录。
- 如果用户明确要求“再验证一下 URL”或命令输出不完整，才补充最小验证。

原因：

重复验证会让原本已经完成的启动任务变慢，并让 subagent 在简单启动请求里继续消耗上下文和工具调用。

## 开发服务启动入口混用历史脚本

症状关键词：`start.sh`、`screen`、`dev-start.mjs`、`手动找端口`、`历史入口`。

标准处理：

- 本仓开发服务统一入口是 `pnpm tools dev-start <target>`。
- Web：`pnpm tools dev-start web`。
- Electron launcher：`pnpm tools dev-start electron`。
- Electron 当前仓库 workspace：`pnpm tools dev-start electron-workspace`。
- PWA：`pnpm tools dev-start pwa`。
- Homepage preview：`pnpm tools dev-start homepage`。
- Docs：`pnpm tools dev-start docs`。

不要恢复根目录 `start.sh`，不要用 `screen` 管理本仓开发服务。需要查看启动器实现时，从 `scripts/cli.ts` 的 `dev-start` command 和 `scripts/dev-start.ts` 入口开始。

## Android 模拟器启动排查耗时

症状关键词：`Android 模拟器`、`AVD`、`虚拟机`、`emulator-5554`、`OneWorksApi35Visible`、`adb devices`、`sdkmanager`、`avdmanager`、`emulator command not found`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`。

标准处理：

- 用户要求启动 Android 模拟器 / AVD / 虚拟机用于调试时，先读本节，再操作。
- 不要先全盘搜索 `$HOME`，例如 `find "$HOME" -name emulator`。它很慢，还会扫到 macOS 受保护目录。
- 不要默认 Android SDK 一定在 `~/Library/Android/sdk`，也不要为了找 emulator 直接安装 Android Studio。
- 先用最小命令确认当前机器状态：
  - `adb devices -l`
  - `command -v sdkmanager && sdkmanager --list_installed`
  - `command -v avdmanager && avdmanager list avd`
  - `command -v emulator || find /opt/homebrew -path '*/emulator/emulator' -type f 2>/dev/null`
- 这台开发机的 Homebrew Android commandline tools 通常在 `/opt/homebrew/share/android-commandlinetools`，`emulator` 可能不在 `PATH`，可直接使用 `/opt/homebrew/share/android-commandlinetools/emulator/emulator`。
- 已存在可用 AVD 时优先复用，不要先创建新系统镜像。本地常用 AVD 是 `OneWorksApi35Visible`。
- 启动可见模拟器时，不要让 `exec_command` 长期占着前台。用 detached 进程启动，并把日志写入 `.logs/`：

```bash
node -e 'const fs=require("fs"); const cp=require("child_process"); fs.mkdirSync(".logs",{recursive:true}); const out=fs.openSync(".logs/android-emulator-OneWorksApi35Visible.log","a"); const sdk="/opt/homebrew/share/android-commandlinetools"; const env={...process.env,ANDROID_SDK_ROOT:sdk,ANDROID_HOME:sdk}; const child=cp.spawn(`${sdk}/emulator/emulator`,["-avd","OneWorksApi35Visible","-port","5554"],{detached:true,stdio:["ignore",out,out],env}); child.unref(); console.log(child.pid);'
```

- 如果已经用前台命令启动模拟器做诊断，完成后先 `adb -s emulator-5554 emu kill`，再按 detached 方式重启，避免工具会话一直挂住。
- 启动后做最小 ADB 验证即可：
  - `adb devices -l | rg 'emulator-5554'`
  - `adb -s emulator-5554 shell getprop sys.boot_completed`
- boot 完成后调试页是 `/ui/standalone/devices/emulator-5554/debug`；不要把设备断联误判成页面路由问题。

典型耗时原因：

- 在不知道 SDK 位置时直接全盘 `find "$HOME"`。
- `emulator` 不在 `PATH` 时继续围绕 `~/Library/Android/sdk` 猜路径。
- 直接安装新系统镜像或创建新 AVD，而不是先看 `avdmanager list avd`。
- 前台启动 emulator，日志刷屏且占住当前命令会话。
- `nohup ... &` 启动失败后不看日志路径和环境变量，继续反复尝试。

完成条件：

- `adb devices -l` 能看到目标设备状态为 `device`。
- `adb -s <serial> shell getprop sys.boot_completed` 返回 `1`。
- 模拟器进程是 detached 运行，不依赖当前工具会话保持存活。
- 能打开 `/ui/standalone/devices/<serial>/debug` 进入调试页。

## PR 截图证据断链或来源不真实

症状关键词：`PR 截图看不到`、`Screenshots 断图`、`github blob head 分支`、`删除 PR 分支后图片失效`、`截图不是实时效果`、`PR change policy screenshot`。

标准处理：

- PR body 里的截图链接不要指向计划删除的 head 分支，例如 `blob/codex/...`。如果截图作为仓库资产提交，优先在 PR 合并后改成 merge commit 固定链接，或在合并前指向不会被删除的稳定 ref。
- 如果使用 `.github/pr-screenshots/<pr>/...` 这类仓库内截图资产，合并并删除分支后必须复查 PR body 是否仍能渲染图片；断图时用 `gh pr edit` 改到 merge commit 或 `main` 上的 URL。
- 如果截图不是本次运行环境的新鲜真实截图，而是复用用户提供的截图、旧截图或示意图，但仍作为 PR 截图证据使用，必须在 PR body 的截图区域明确说明图片来源以及“不是本次新鲜运行截图”。聊天回复可以补充说明，但不能替代 PR body 里的披露。不要把复用截图说成“已用真实效果截图验证”。
- 本地缺少截图工具时，先说明限制，再选择：用 in-app browser / Chrome 自动化截图、上传 GitHub user attachment、或提交仓库内截图资产。不要静默用旧图替代真实验证。

原因：

UI PR 的 `pr-change-policy` 只检查 PR body 是否有截图证据，不会判断图片是否真实可见或是否来自当前实现。把图片链接写到会被删除的 PR 分支上，会在 merge 后变成断图；复用旧图但不说明来源，会误导 reviewer 对 UI 实际状态的判断。

## Android 设备调试页改错 worktree 或 CI 收口失败

症状关键词：`standalone devices debug`、`设备状态`、`Android Emulator`、`emulator-5554`、`IAB tab not found`、`/api/mobile-debug/environment 404`、`max-lines`、`macOS installer pending`。

标准处理：

- 先读 [Android 设备调试页维护经验](./mobile-device-debugging.md)。
- 如果设备还没启动或 ADB 不可见，先走 [Android 模拟器启动排查耗时](#android-模拟器启动排查耗时)，不要直接改调试页。
- 不要只凭当前 `cwd` 改代码。先确认 IAB 页面实际由哪个 worktree 的 dev server 提供；必要时用 `rg` 在 `.codex/worktrees` 内定位目标文件。
- 后端 mobile-debug route / service 修改后，如果 API 仍 404，先重启或复用 `pnpm tools dev-start web`，不要把旧 server 误判成前端路由问题。
- 设备状态面板要拆 Battery / Cellular / Location / Phone / Fingerprint 组件；状态型控制实时生效，事件型控制保留按钮。
- PR 收口必须补 changelog、截图、Experience Review checklist，并跑 `pr-change-check`。远端如果只剩 `macOS installer` pending，用 `gh run view <run> --json jobs` 看具体步骤，避免长时间 `gh pr checks --watch` 刷屏。

原因：

Android 设备调试页同时跨 IAB、前端 interaction panel、desktop preload、server ADB service、scrcpy 视频流和 PR policy。最常见失败不是单点代码错误，而是改错 worktree、旧 server 未重启、组件堆到 lint 超行、PR body 缺 policy 材料或误判长时间 installer 为卡死。

## 移动端 WebView / 工作区 tabs 反复返工

症状关键词：`移动端 WebView`、`workspace tabs`、`工作区抽屉`、`手机 sender`、`状态栏截断`、`IME`、`RouteChromeHeader`、`RouteChromeInput`、`截图呢`、`PR change policy`。

标准处理：

- 开始前先读 [移动端 WebView 与工作区标签页经验](./mobile-workspace-webview.md)。
- 先分层判断 native shell、shared shell contract、shared chrome、client route 和业务 tab 的职责。
- UI chrome 优先复用 `RouteChromeHeader`、`RouteChromeInput`、`RouteHeaderActionButton`，不要复制截图里的 DOM 和像素。
- sender / status bar / toolbar 的小屏密度用局部 CSS variable 覆盖，不改全局 token。
- Android IME、status bar、cutout 分开处理；不要为输入法修复改坏窗口 inset。
- 收尾必须补 changelog、PR 截图资产、PR body，并跑 `pr-change-check`。

原因：

这类任务同时跨 native WebView、前端 compact layout、共享 route chrome、真实设备验证和 CI policy。只凭单个浏览器截图或单点样式 patch 很容易修一个问题引出重复图标、padding 不一致、主题不一致、状态栏裁切、PR policy 失败等连锁问题。

## Electron WebView 右键元素评论坐标偏移

症状关键词：`webview 评论此元素`、`右键评论选错元素`、`评论到右下角`、`无法读取当前页面结构`、`context-menu params x y`、`webview annotation target`。

标准处理：

- 不要把 Electron main 进程 `context-menu` 事件里的 `ContextMenuParams.x/y` 直接传给页面脚本当作 `document.elementsFromPoint()` 坐标。不同 Electron / webview 场景下它容易和页面 viewport 坐标不一致，表现为右键左上元素却高亮右下元素。
- 右键菜单只负责发出“评论此元素”意图；目标解析应回到 client renderer，复用注释模式点击时的同一套 webview viewport 坐标换算与注入脚本。
- renderer 侧应在 webview 元素上记录最近一次 `contextmenu` / `mousedown` / `pointerdown` 的 host 坐标，并换算成 webview viewport 坐标；收到 main 进程 IPC 后，用该坐标解析元素，并用 `webContentsId` 防止多个 webview tab 串坐标。
- 如果 hover 注释正常但右键评论偏移，优先检查两条路径是否复用了同一套坐标转换和 `elementsFromPoint()` 目标选择逻辑，不要只调元素打分权重。
- desktop main / preload 改动需要重启 Electron workspace；仅前端热更新不足以验证 native context menu 行为。

原因：

webview 右键菜单发生在 Electron guest / main 边界，`ContextMenuParams` 的坐标语义不等价于 client renderer 中 webview DOM 元素换算出的页面 viewport 坐标。把目标选择拆成 main 进程一套、renderer 注释层一套，会让 hover / 点击路径正常而右键路径漂移，维护成本也会持续上升。
