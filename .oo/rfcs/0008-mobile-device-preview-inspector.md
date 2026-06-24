---
rfc: 0008
title: 移动设备与桌面应用预览与元素检查
status: draft
authors:
  - Codex
created: 2026-06-23
updated: 2026-06-23
targetVersion: vNext
---

# RFC 0008：移动设备与桌面应用预览与元素检查

返回入口：[RFC 索引](../../rfc.md)

## 背景

One Works 需要在 Electron 桌面端内调试移动设备，并在后续扩展到桌面应用调试。这里的目标不是把手机端 Web 页面用响应式视口打开，而是连接真实 Android / iOS 设备或模拟器，提供接近 Android Studio Running Devices、Android Studio Layout Inspector、Appium Inspector 和 Xcode UI 调试组合后的体验：

- 实时查看设备画面。
- 用鼠标、键盘控制设备。
- 点击或悬停屏幕元素，查看元素层级、bounds、属性和 selector。
- 对 WebView / WKWebView 切换到 Web 调试工具。
- 对用户自己开发的 App，提供更深的框架级调试能力。

已有 Electron 桌面端具备一部分 Android mobile debug 基础：`apps/desktop/src/main/mobile-debug.ts` 已经能解析 ADB、枚举设备、扫描 Android Chrome / WebView DevTools target，并做端口 forward / reverse。新的设备预览与检查能力应扩展这条链路，而不是另起一套设备管理实现。

## 目标

- 在 Electron interaction panel 或 workspace drawer 中新增移动设备预览入口。
- 支持 Android 真机和模拟器的屏幕预览、点击、滑动、键盘输入、Back/Home/App Switch 等基础控制。
- 支持 Android 通用元素树检查：不改用户 App 时，也能通过 UIAutomator / accessibility tree 查看可见元素。
- 支持用户开发 Android App 时启用 One Works debug agent，获取 View / Compose 更深层信息。
- 支持 Android WebView / Chrome target 继续走 Chrome DevTools Protocol。
- 二期支持 iOS 真机和模拟器的预览、基础控制与元素检查。
- 二期支持用户开发 iOS App 时启用 One Works debug agent，获取 UIKit / SwiftUI 更深层信息。
- iOS 之后再评估桌面应用调试：嵌入用户自己的桌面 App 窗口画面、基础控制、accessibility 元素检查、快捷键观测 / 注入，以及更重的虚拟桌面能力。
- 共用一套前端 inspector UI，平台差异下沉到 desktop main / runtime adapter。
- 明确每一级能力的边界，避免承诺系统沙箱不允许的深度检查。

## 非目标

- 不把 Android Studio Layout Inspector 私有实现逆向或嵌入 One Works。
- 不承诺脱离 Android Studio 直接使用官方 Layout Inspector；官方 standalone mode 只是 Android Studio 内部独立窗口，不是独立 CLI 或稳定 SDK。
- 不承诺对任意第三方 Android / iOS App 提供 View / Compose / SwiftUI 级别属性。
- 不绕过 Android / iOS 的签名、Developer Mode、USB debugging、UI Automation、隐私和安全限制。
- 不把设备进程、端口转发、签名、ADB / idb / WDA 生命周期放到 renderer 里管理。
- 不在第一版实现云真机设备农场。
- 不在第一版做录制回放、自动生成完整测试脚本或视觉 diff 平台。
- 不在 Android 一期或 iOS 二期内实现桌面 App 调试、虚拟桌面或 VM 调试。
- 不以原生窗口 reparent 作为桌面调试主路线；需要嵌入浏览器时优先使用 Electron 自己的 Chromium 容器，需要调试外部桌面 App 时走画面捕获、accessibility 和输入注入。

## 使用方式

### Standalone Route 标准

Standalone 页面使用资源型路径，避免把某个功能名写死成唯一入口。路径规范由 `@oneworks/types` 的 standalone route contract 维护，Electron、Web / IAB 和后续插件入口都应复用这套 builder / parser。

全局设备能力：

- `/standalone/devices`：设备管理页，展示可用 Android 设备、模拟器、网络设备和调试配置入口。
- `/standalone/devices/settings`：设备调试配置页，例如 ADB 路径、端口转发、网络目标。
- `/standalone/devices/:deviceId/debug`：指定设备的调试页，用于多设备场景下直接打开某一台设备。

Session 级独立 tab：

- `/standalone/sessions/:sessionId/panels/:area/tabs/:tabId`：从某个对话 session 的 panel 中独立打开一个 tab。
- `area` 当前取值为 `bottom` 或 `right`，避免不同 panel 里出现同名 `tabId` 时无法定位。
- `tabId` 使用 URL segment 编码，可指向 WebView、terminal、file、mobile-debug、plugin 等 session panel tab。

这套路径让三类入口保持一致：

- Electron 独立窗口：调用 `openStandaloneTabWindow(routePath)`。
- Web / IAB：直接打开同一个 standalone URL。
- 插件或对话页 action：用 builder 生成 URL，不手写路径。

### 设备控制模式

面向任意设备和任意 App。用户只需要连接设备并完成系统要求的授权。

能力：

- 实时屏幕预览。
- 鼠标点击、拖拽、滚轮、键盘输入映射到设备。
- 快捷键或按钮触发 Back、Home、App Switch、旋转、锁屏、截图、录屏。
- 获取系统暴露的 accessibility / UIAutomator / XCUITest 元素树。
- 根据元素 bounds 在屏幕上绘制 hover / selected overlay。
- 生成可复制 selector，例如 Android resource-id / text / content-desc，iOS accessibility identifier / label / predicate。

边界：

- 自绘 Canvas、游戏、OpenGL/Metal、Flutter/React Native 未暴露 accessibility 的节点，只能看到有限节点或整块容器。
- `FLAG_SECURE`、密码输入、系统隐私页面可能无法截图或无法检查。
- 第三方 App 不会提供内部组件状态、源码位置、Compose recomposition、SwiftUI state 等信息。

### 应用开发调试模式

面向用户用 One Works 开发和调试自己的移动 App。用户提供 App 信息，并允许 One Works 打开调试通道。

输入：

- Android：`packageName`、debug build、可选 Gradle plugin / debug SDK 接入状态。
- iOS：`bundleId`、debug build、Xcode signing / provisioning、可选 Swift Package debug SDK 接入状态。

能力：

- 自动启动目标 App。
- 自动配置端口转发，例如 `adb reverse` 或 iOS tunnel。
- 读取 One Works debug agent 暴露的框架级 tree。
- 展示 View / Compose / UIKit / SwiftUI 节点、layout、props、state、source hint。
- 与通用元素树和屏幕 overlay 合并展示。
- 对 WebView / WKWebView 自动切到 Web 调试。

边界：

- debug agent 只允许在 debug build 生效。
- release build 默认不启用，不允许把内部状态暴露给生产用户。
- iOS 真机需要 Apple 开发者签名、Developer Mode 和设备信任。

### 桌面应用调试模式（后续）

面向用户用 One Works 开发和调试自己的桌面 App。它不是移动设备一期或 iOS 二期目标，排在 iOS 能力之后。

输入：

- App 标识：macOS `bundleId` / app path、Windows executable path、Linux desktop file / process name。
- 目标窗口：窗口标题、进程 ID、window id 或由用户在列表中选择。
- 可选 debug build / desktop debug agent 接入状态。
- 可选虚拟桌面配置：VM 镜像、系统版本、网络、共享目录、快照策略。

能力分两层：

- 宿主机桌面 App Preview：捕获目标窗口画面，映射鼠标点击、拖拽、滚轮和键盘输入，读取系统 accessibility tree，展示 bounds、role、label、value、enabled、focused 等属性。
- 桌面应用开发调试：用户接入 One Works desktop debug agent 后，展示 App 内部组件树、状态、路由、日志、网络、source hint，并与系统 accessibility tree 对齐。
- 虚拟桌面 Lab：在 VM 中运行用户 App，提供独立桌面、独立快捷键命名空间、快照、重置、录制和更强隔离，体验更接近“虚拟机里调试一个桌面”。

边界：

- macOS 宿主机能力依赖 Screen Recording、Accessibility、Input Monitoring 等系统授权。
- 系统保留快捷键、安全输入、密码框、系统权限弹窗和受保护内容不能保证被捕获、拦截或注入。
- 只靠系统 accessibility 不能拿到任意 App 的内部组件状态；深度能力需要用户自己的 App 接入 debug agent。
- VM 方案成本明显高于宿主机窗口预览，需要单独处理镜像、授权、性能、网络和文件同步。

## 能力分级

| Level | 名称                     | Android 落点                      | iOS 落点                                      | 说明                        |
| ----- | ------------------------ | --------------------------------- | --------------------------------------------- | --------------------------- |
| L0    | Screen Preview           | scrcpy / Tango / ADB stream       | idb video-stream / simulator stream           | 实时画面、截图、录屏        |
| L1    | Device Control           | scrcpy input / ADB input / HID    | WDA / XCUITest / idb                          | tap、swipe、text、硬件键    |
| L2    | Generic Element Inspect  | UIAutomator / Appium UiAutomator2 | WDA / XCUITest                                | 通用 accessibility 元素树   |
| L3    | WebView Inspect          | Chrome DevTools Protocol          | Safari Web Inspector / ios-webkit-debug-proxy | Web DOM / CSS / Network     |
| L4    | First-Party Deep Inspect | One Works Android debug agent     | One Works iOS debug agent                     | 框架级树、状态、source hint |

桌面能力复用同一套前端概念，但平台落点不同：

| Level | 名称                     | 桌面落点                                                      | 说明                                                  |
| ----- | ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| D0    | Window Preview           | ScreenCaptureKit / Windows Graphics Capture / PipeWire portal | 捕获目标 App 窗口或虚拟桌面画面                       |
| D1    | Desktop Control          | CGEvent / AX action / SendInput / xdotool-like backend        | 点击、拖拽、滚轮、文本输入、快捷键注入                |
| D2    | Desktop Element Inspect  | AXUIElement / UI Automation / AT-SPI                          | 系统 accessibility 元素树、bounds、role、label、value |
| D3    | Browser Inspect          | Electron WebContents / Chrome DevTools Protocol               | 嵌入浏览器或外部 Chrome 的 DOM / CSS / Network 调试   |
| D4    | First-Party Deep Inspect | One Works desktop debug agent                                 | 框架级组件树、状态、路由、source hint                 |
| D5    | Virtual Desktop Lab      | Apple Virtualization.framework / Hyper-V / KVM                | 独立桌面、快捷键命名空间、快照、重置、隔离运行        |

## Android 技术选型

### 屏幕预览与控制：scrcpy 协议优先

选择 scrcpy 作为 Android 画面和基础控制的主底座。

原因：

- 成熟、低延迟、跨平台。
- 支持 USB 和 TCP/IP。
- 不需要 root。
- 不需要在设备上长期安装 App。
- 支持键鼠控制、音频、录制、虚拟 display、摄像头镜像等扩展能力。
- 与 Android Studio Running Devices 的“看屏幕并控制设备”目标接近。

落地策略：

- 一期交付必须把视频流和控制协议嵌入 One Works 的 Electron 或 Web UI，不打开外部 scrcpy 窗口作为主体验。
- Electron 形态由 main process 管理 ADB / scrcpy 进程与端口，renderer 只消费视频流、元素树和控制 API。
- Web 形态只能走浏览器可用的 transport，例如 Tango / WebUSB，或连接 One Works 远程 device host；普通 Web 页面不能 shell out 本机二进制。
- 优先评估 Tango / ya-webadb 的 TypeScript ADB / scrcpy 包，因为它明确支持 Chromium browser、Node.js 和 Electron。
- 如果 Tango 的性能或协议覆盖不足，再做自有 scrcpy protocol adapter。

不选项：

- 不以 Android Emulator 原生窗口 reparent 到 Electron 作为主路线。模拟器必须支持，但应像真机一样走 ADB / scrcpy / Tango 的视频流和控制链路；窗口 reparent 跨平台脆弱，且不能复用真机能力。
- 不以 `adb shell screenrecord` 做实时预览主链路。它更适合录制文件，不适合低延迟交互。
- 不以 minicap / minitouch 作为默认主链路。它们适合 STF 类设备农场架构，但 Android 新版本兼容和维护成本高于 scrcpy。

参考：

- [scrcpy](https://github.com/Genymobile/scrcpy)
- [Tango / ya-webadb](https://github.com/yume-chan/ya-webadb)
- [ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy)
- [STF](https://github.com/openstf/stf)
- [minicap](https://github.com/openstf/minicap)
- [minitouch](https://github.com/openstf/minitouch)

### ADB 与设备生命周期：复用现有 desktop mobile debug

当前仓库已有 `apps/desktop/src/main/mobile-debug.ts`：

- 解析 ADB 路径。
- 枚举 `adb devices -l`。
- 扫描 Android Chrome / WebView DevTools socket。
- 建立 local abstract socket forward。
- 建立本地 WebSocket proxy。
- 管理 reverse port forwarding。

新增设备预览能力应在这层继续扩展：

- `listMobileDevices`
- `startMobileDevicePreview`
- `stopMobileDevicePreview`
- `sendMobileInput`
- `captureMobileScreenshot`
- `dumpMobileElementTree`
- `startMobileDebugAgent`

这些 IPC 由 desktop preload 暴露给 client，但进程、socket、ADB 命令、清理逻辑都留在 main process。

### 通用元素检查：UIAutomator + Appium 兼容模型

选择 UIAutomator 作为 Android 通用元素树基础。

原因：

- 官方支持跨用户 App 和系统 App 的 UI 自动化。
- 能从 App 进程外部读取 accessibility window nodes。
- 能找到元素、等待元素、点击、截图，适合不改 App 的场景。
- Appium UiAutomator2 已经证明这条路线能覆盖 native、hybrid 和 mobile web 自动化。

实现方式：

- 第一版可直接使用 `adb shell uiautomator dump` 获取 XML，并解析 bounds / text / resource-id / class / content-desc / clickable / enabled 等属性。
- 后续可接入轻量设备端 helper 或 Appium UiAutomator2 server，提高稳定性、增量刷新和 action 能力。
- 前端元素模型兼容 Appium Inspector 语义，方便用户复制 selector 或迁移到测试脚本。

边界：

- UIAutomator 看到的是 accessibility 层，不是 App 内部 View 对象。
- 如果 App 没有设置 accessibility label / resource id，selector 质量会下降。
- Compose、Flutter、React Native、自绘控件是否可见取决于它们暴露给 accessibility 的程度。

参考：

- [UIAutomator](https://developer.android.com/training/testing/other-components/ui-automator)
- [Appium UiAutomator2 Driver](https://github.com/appium/appium-uiautomator2-driver)

### WebView 检查：继续使用 Chrome DevTools Protocol

Android WebView 和 Chrome 页面继续走已有 mobile debug 路线：

- 通过 `/proc/net/unix` 找 `chrome_devtools_remote` / `webview_devtools_remote` socket。
- 用 `adb forward` 转成本地 DevTools endpoint。
- 通过 DevTools inspect URL 或自有 DevTools iframe 打开。

要求：

- Chrome 页面天然支持。
- App 内 WebView 需要开发者调用 `WebView.setWebContentsDebuggingEnabled(true)`。
- 生产 App 默认不应开启 WebView debugging。

参考：

- [Remote debugging WebViews](https://developer.chrome.com/docs/devtools/remote-debugging/webviews)

### 深度检查：One Works Android Debug Agent

Android Studio Layout Inspector 是深度布局检查标杆，但它不是可单独嵌入的公开组件。它的 standalone mode 只是 Android Studio 内部窗口模式，不是稳定 CLI / SDK。

要获得接近 Layout Inspector 的能力，需要 One Works 自己提供 debug agent：

- Gradle plugin 自动在 debug variant 注入依赖。
- Debug SDK 在 App 内注册 inspector service。
- 通过 `adb reverse` 或 local abstract socket 与 Electron main 建立连接。
- 暴露 View hierarchy、Compose tree、bounds、layout params、state snapshot、source hint。
- 支持用户授权后打开 / 关闭 agent。

第一版建议能力：

- View tree。
- Compose semantics tree。
- 节点 bounds。
- 节点类型、id、testTag、contentDescription。
- 当前 Activity / Fragment / window 信息。
- source hint 只做 best-effort，不承诺所有节点可跳源码。

后续能力：

- Compose recomposition 计数。
- Layout pass / measure pass 信息。
- 网络请求、日志、crash、performance marker 关联。
- 生成最小复现步骤。

参考：

- [Android Layout Inspector](https://developer.android.com/studio/debug/layout-inspector)

## iOS 技术选型

### 屏幕预览：idb video-stream 优先

二期选择 Meta idb 作为 iOS 画面流首选。

原因：

- idb 支持 iOS Simulator 和真机自动化。
- idb 文档提供 video recording 和 live video stream。
- 可以输出 h264、mjpeg、raw 等格式，适合接入 Electron 解码展示。
- 比 QuickTime / iPhone Mirroring 更适合自动化集成。
- idb video-stream 只负责画面；点击、滑动和输入由 WDA / XCUITest 执行。二期需要把画面坐标映射到 WDA tap / drag / type action，才能实现可点击的内嵌 iOS 设备预览。

边界：

- iOS 真机支持依赖 macOS、Xcode、设备信任、Developer Mode。
- idb 自身使用 Apple 私有框架能力，版本兼容需要持续跟进。
- iOS 不进入一期；二期先按 macOS-only 收口，后续再评估 Windows / Linux。

参考：

- [idb](https://github.com/facebook/idb)
- [idb video](https://fbidb.io/docs/video/)

### 通用元素检查与控制：XCUITest / WebDriverAgent

选择 XCUITest / WebDriverAgent 作为 iOS 通用元素检查和控制底座。

原因：

- iOS 没有 Android ADB + UIAutomator 等价的通用低门槛接口。
- Appium XCUITest 是当前移动自动化生态主线。
- WebDriverAgent 可提供元素树、tap、scroll、text input、launch / kill app 等能力。

要求：

- Host 需要 macOS 和 Xcode。
- 真机需要 Trust This Computer。
- iOS / iPadOS 16+ 需要启用 Developer Mode。
- 需要启用 UI Automation。
- WebDriverAgentRunner 需要可安装到设备的签名和 provisioning profile。

边界：

- 任意第三方 App 只能拿到 accessibility/XCUITest 层级。
- 不能获得 SwiftUI state、UIKit 私有对象或源码位置。
- WDA 启动和签名失败是常见问题，需要 One Works 提供诊断 UI。

参考：

- [Appium XCUITest Driver](https://github.com/appium/appium-xcuitest-driver)
- [Appium XCUITest Device Setup](https://appium.github.io/appium-xcuitest-driver/11.11/getting-started/device-setup/)
- [WebDriverAgent](https://github.com/facebookarchive/WebDriverAgent)

### iOS 设备 plumbing：libimobiledevice / pymobiledevice3 / go-ios

这类工具适合补齐设备管理能力：

- 设备发现。
- 安装 / 卸载 App。
- 读取 syslog / crash reports。
- 截图。
- 端口转发。
- 设备信息和诊断。

它们不应作为 iOS 实时控制和元素检查主链路。

参考：

- [libimobiledevice](https://github.com/libimobiledevice/libimobiledevice)
- [pymobiledevice3](https://github.com/doronz88/pymobiledevice3)
- [go-ios](https://github.com/danielpaulus/go-ios)

### iOS Web 检查：Safari Web Inspector

Safari / WKWebView 调试走 WebKit Remote Inspector：

- 用户在设备上启用 Web Inspector。
- macOS Safari 或代理工具发现 iOS 页面 / WKWebView。
- One Works 可通过 `ios-webkit-debug-proxy` 类工具桥接到 DevTools-like UI。

边界：

- 只覆盖 Web 内容。
- 不覆盖 UIKit / SwiftUI 原生界面。
- WKWebView 是否可见取决于 App 调试开关和系统限制。

参考：

- [Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)
- [ios-webkit-debug-proxy](https://github.com/google/ios-webkit-debug-proxy)

### 深度检查：One Works iOS Debug Agent

对用户自己的 iOS App，提供 Swift Package 或 CocoaPods debug SDK：

- Debug build 注册 inspector endpoint。
- 暴露 UIKit / SwiftUI hierarchy。
- 暴露 accessibility 信息、bounds、view controller、state、source hint。
- 可通过 idb / WDA / tunnel 连接。
- 只在 debug build 生效。

边界：

- 受 Apple sandbox、签名、Developer Mode 限制。
- SwiftUI 内部结构不稳定，source hint 和 state snapshot 只能 best-effort。
- 不替代 Xcode View Debugger，只提供 One Works 内可用的调试视图。

## 桌面应用调试技术选型（iOS 之后）

桌面应用调试排在 iOS 之后，不进入 Android 一期或 iOS 二期。它应复用移动设备预览的 inspector UI 和 session 生命周期，但底层从“设备连接”换成“桌面窗口 / VM 连接”。

### 宿主机窗口预览：系统级画面捕获优先

macOS 首选 ScreenCaptureKit 捕获目标 App 窗口或 display region，并在 One Works Electron / Web UI 中渲染。

原因：

- 它是 Apple 提供的现代屏幕和窗口捕获框架。
- 可以按窗口、display、应用过滤内容，比截全屏再裁切更适合嵌入式调试。
- 适合把目标 App 画面作为视频流接入现有 `DeviceCanvas` / overlay UI。

边界：

- 需要用户授予 Screen Recording 权限。
- 受保护内容、系统隐私页面和安全输入场景可能不可见或被系统遮蔽。
- 捕获只是画面，不等于拿到元素树或 App 内部状态。

Windows 和 Linux 后续分别评估 Windows Graphics Capture 与 PipeWire portal，但第一版桌面调试建议先按 macOS-only 收口，避免三套系统权限和窗口模型同时展开。

参考：

- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/)

### 元素检查：Accessibility API 作为通用底座

macOS 选择 AXUIElement / Accessibility API 读取目标窗口的系统 accessibility tree。

能力：

- 读取 role、title、description、value、enabled、focused、selected、bounds 等系统暴露属性。
- 找到当前 focused element 或鼠标坐标下的 element。
- 对部分元素执行 press、set value、focus 等 accessibility action。
- 与画面坐标对齐后，在 One Works 中显示 hover / selected overlay。

边界：

- 需要用户授予 Accessibility 权限。
- 只能看到目标 App 暴露给 accessibility 的内容。
- 自绘 Canvas、WebGL、游戏引擎、无障碍信息不足的 Electron / Flutter / Qt 控件，可能只能看到容器或有限节点。
- 不能替代 App 内部框架 inspector；深度组件树仍需要 One Works desktop debug agent。

参考：

- [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h)

### 输入与快捷键：CGEvent / Accessibility action

宿主机窗口预览模式下，控制能力分三类：

- 坐标输入：把 One Works 画布坐标映射回目标窗口坐标，通过系统输入事件发送点击、拖拽、滚轮。
- 文本输入：优先通过 accessibility set value / insert text，无法使用时降级到键盘事件。
- 快捷键：对用户 App 发送组合键；必要时在调试模式记录 key down / key up，用于生成复现步骤。

边界：

- macOS 需要 Accessibility / Input Monitoring 等权限。
- 系统保留快捷键、Mission Control、Spotlight、输入法切换、安全输入、密码框和系统级权限弹窗不能保证被捕获或拦截。
- 如果用户目标是“完全独立快捷键命名空间”，应进入虚拟桌面 Lab，而不是宿主机窗口预览。

参考：

- [CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent)

### 嵌入浏览器：优先使用 Electron 自身 Chromium

如果目标是调试一个 Web / Electron 页面，不应尝试把外部 Chrome 原生窗口塞进 One Works。推荐路线：

- One Works 内部打开：用 Electron `WebContentsView` / `BrowserView` / `<webview>` 承载页面，并直接接入 DevTools / CDP。
- 外部 Chrome 调试：通过 `--remote-debugging-port` 或已存在 CDP endpoint 连接，One Works 展示 DOM / Network / Console，但画面仍可选择走标签页截图或系统窗口捕获。
- 桌面 App 画面嵌入：走 ScreenCaptureKit / Windows Graphics Capture / PipeWire，不做原生窗口 reparent。

原因：

- Electron 本身已经内置 Chromium，嵌入自己管理的 WebContents 是稳定路线。
- 外部 Chrome 窗口 reparent 在 macOS 没有稳定公开 API，焦点、输入法、菜单、全屏、权限和窗口生命周期都不可控。
- CDP 能拿到 Web 调试能力，窗口捕获只补画面。

### 虚拟桌面 Lab：隔离能力后置

当用户要“像虚拟机一样”调试桌面应用，尤其需要独立快捷键、快照、重置、干净系统环境或危险操作隔离时，使用虚拟桌面 Lab。

macOS 后续优先评估 Apple Virtualization.framework：

- 运行 macOS 或 Linux guest。
- 为 guest 提供独立 display、keyboard、mouse、network 和共享目录。
- 支持快照 / 恢复策略需要进一步验证，可能要结合磁盘镜像复制或外层状态管理实现。

边界：

- macOS guest 授权、镜像准备、系统版本、Apple Silicon / Intel 差异都需要单独设计。
- VM 内部的元素检查仍需要 guest 内 agent 或远程 accessibility / automation bridge。
- 性能、存储和权限成本高，不适合作为第一种桌面调试能力。

参考：

- [Virtualization](https://developer.apple.com/documentation/virtualization)

## 统一架构

```text
apps/desktop main
  mobile-device-manager
    android-adb
    android-scrcpy
    android-uiautomator
    android-debug-agent
    ios-idb
    ios-wda
    ios-debug-agent
    webview-devtools
  desktop-app-manager
    macos-screen-capture
    macos-accessibility
    macos-input
    desktop-debug-agent
    virtual-desktop-lab

apps/desktop preload
  window.oneworksDesktop.mobile.*
  window.oneworksDesktop.desktopApp.*

apps/client
  interaction-panel/mobile-device-preview
    DeviceCanvas
    DeviceToolbar
    ElementOverlay
    ElementTree
    ElementAttributes
    SelectorBuilder
    SetupDiagnostics
  interaction-panel/desktop-app-preview
    DesktopCanvas
    DesktopToolbar
    ElementOverlay
    ElementTree
    ElementAttributes
    ShortcutRecorder
    VmControls
```

Desktop main 负责：

- 设备发现。
- 桌面 App / 窗口发现。
- ADB / idb / WDA / scrcpy 进程生命周期。
- ScreenCaptureKit / Accessibility / 输入注入 / VM 生命周期。
- 端口 forward / reverse。
- 视频流解码入口或转发。
- 输入事件发送。
- 元素树抓取。
- debug agent 握手。
- 设备授权、签名、安装、诊断。
- macOS Screen Recording / Accessibility / Input Monitoring 权限诊断。
- 窗口关闭和 tab 关闭时清理资源。

Client renderer 负责：

- 设备 / 桌面 App 画面展示。
- 高亮 overlay。
- 元素树和属性面板。
- selector 和测试步骤生成。
- 用户确认和设置 UI。
- 错误诊断展示。

## 共享协议草案

```ts
export interface MobileDevice {
  id: string
  platform: 'android' | 'ios'
  label: string
  transport: 'usb' | 'tcp' | 'simulator'
  state: 'ready' | 'unauthorized' | 'offline' | 'setup-required'
  model?: string
  osVersion?: string
}

export interface MobilePreviewSession {
  deviceId: string
  id: string
  platform: MobileDevice['platform']
  streamUrl?: string
  videoCodec?: 'h264' | 'mjpeg' | 'raw'
  width: number
  height: number
  scale: number
}

export interface MobileElementNode {
  id: string
  source: 'uiautomator' | 'xcuitest' | 'webview' | 'oneworks-agent'
  type: string
  label?: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  attributes: Record<string, string | number | boolean | null>
  children: MobileElementNode[]
}

export interface MobileInputEvent {
  kind: 'tap' | 'longPress' | 'swipe' | 'text' | 'key'
  x?: number
  y?: number
  endX?: number
  endY?: number
  text?: string
  key?: 'back' | 'home' | 'app-switch' | 'enter' | 'delete'
  durationMs?: number
}

export interface DesktopAppTarget {
  id: string
  platform: 'macos' | 'windows' | 'linux' | 'vm'
  label: string
  appId?: string
  processId?: number
  windowId?: string
  state: 'ready' | 'permission-required' | 'offline' | 'setup-required'
}

export interface DesktopPreviewSession {
  id: string
  targetId: string
  platform: DesktopAppTarget['platform']
  streamUrl?: string
  videoCodec?: 'h264' | 'mjpeg' | 'raw'
  width: number
  height: number
  scale: number
  captureSource: 'window' | 'display' | 'vm'
}

export interface DesktopElementNode {
  id: string
  source: 'accessibility' | 'browser-cdp' | 'oneworks-agent'
  role: string
  label?: string
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  attributes: Record<string, string | number | boolean | null>
  children: DesktopElementNode[]
}

export interface DesktopInputEvent {
  kind:
    | 'click'
    | 'doubleClick'
    | 'drag'
    | 'scroll'
    | 'text'
    | 'key'
    | 'shortcut'
  x?: number
  y?: number
  endX?: number
  endY?: number
  deltaX?: number
  deltaY?: number
  text?: string
  key?: string
  modifiers?: Array<'cmd' | 'ctrl' | 'alt' | 'shift'>
  durationMs?: number
}
```

## UI 设计

移动设备预览 tab 应包含：

- 顶部工具栏：设备选择、刷新、旋转、截图、录屏、Home、Back、App Switch、Inspect 开关。
- 中间画面区：真实设备比例，支持缩放、fit、actual size。
- Overlay 层：hover 和 selected bounds，不改变底层视频尺寸。
- 右侧检查区：元素树、属性、selector、actions。
- 底部诊断区：ADB / idb / WDA / debug agent 状态，只在有问题时展开。

Inspect 开关行为：

- 关闭：鼠标直接控制设备。
- 开启：鼠标 hover / click 选择元素，不发送真实 tap。
- 右键或快捷键允许在 Inspect 模式下执行真实 tap。

桌面 App 预览 tab 复用相同布局，但工具栏替换为：

- App / window 选择。
- 权限状态：Screen Recording、Accessibility、Input Monitoring。
- 捕获模式：window、display region、VM display。
- 控制模式：直接控制、Inspect、快捷键录制。
- VM 控制：启动、暂停、重置、快照、共享目录。

桌面 Inspect 行为：

- 关闭：鼠标和键盘事件发送到目标 App 或 VM。
- 开启：鼠标 hover / click 选择 accessibility 节点，不发送真实 click。
- 快捷键录制开启时，只记录用户操作并生成复现步骤，是否同时发送给目标 App 由用户显式选择。

## 分阶段落地

### Phase 1：Android 内嵌设备预览、控制与检查

- 复用现有 ADB resolver 和 device list。
- 接入嵌入式 scrcpy / Tango 画面流，不打开外部 scrcpy 窗口。
- 同时支持 Android 真机和 Android Emulator；模拟器不走原生窗口嵌入，而是走同一套 ADB / scrcpy / Tango 链路。
- 支持 tap、swipe、text、Back、Home。
- 支持截图。
- 支持 `uiautomator dump` 元素树。
- 支持 bounds overlay、元素树、属性面板。
- 支持打开当前 workspace Web URL 到手机浏览器，并自动配置 `adb reverse`。
- 初版 One Works Android debug agent 协议和 SDK 骨架，至少能证明自家 debug build 可建立 agent 连接。

验收：

- 连接一台 Android 真机后，One Works 内可以看到实时画面。
- 启动一个 Android Emulator 后，One Works 内可以看到实时画面。
- 点击画面能操作设备。
- 打开 Inspect 后，点击元素能在右侧显示节点和属性。
- WebView target 能继续打开 DevTools。
- 接入 Android debug SDK 的样例 App 能被 One Works 识别为开发调试模式。

### Phase 1.x：Android 应用开发调试增强

- 定义 One Works Android debug agent 协议。
- 提供 Gradle plugin / debug SDK 的可用版本。
- 支持指定 packageName 启动目标 App。
- 自动建立 debug channel。
- 展示 View / Compose tree 和 source hint。
- 与 UIAutomator tree 合并或并列展示。

验收：

- 用户接入 debug SDK 后，无需 Android Studio 就能在 One Works 中看到 App 内部调试树。
- 未接入 SDK 时自动降级到 UIAutomator tree。

### Phase 2：iOS 预览与通用检查

- macOS-only。
- 集成 idb device / simulator discovery。
- 接入 idb video-stream。
- 集成 WDA / Appium XCUITest 基础能力。
- 提供 Xcode、Developer Mode、UI Automation、signing 诊断。
- 支持 iOS 元素树、tap、swipe、text。
- 将 iOS 画面坐标映射到 WDA / XCUITest action，支持在 One Works 内点击和滑动设备。

验收：

- 连接 iOS Simulator 后可预览和操作。
- 连接真机并完成签名配置后可预览和操作。
- 能显示 XCUITest 元素树和 bounds overlay。

### Phase 2.x：iOS 应用开发调试增强

- 提供 Swift Package debug SDK。
- 支持 bundleId 绑定。
- 暴露 UIKit / SwiftUI tree、bounds、state、source hint。
- 支持 WKWebView handoff 到 Web Inspector。

验收：

- 用户接入 debug SDK 后能在 One Works 内查看 iOS App 深层节点。
- 未接入 SDK 时自动降级到 XCUITest tree。

### Phase 3：桌面应用预览与调试（iOS 之后）

- macOS-only 起步。
- 集成 ScreenCaptureKit window / display capture。
- 集成 AXUIElement accessibility tree。
- 支持点击、拖拽、滚轮、文本输入和常用快捷键注入。
- 支持 Screen Recording、Accessibility、Input Monitoring 权限诊断。
- 支持把 Electron / Chrome 页面作为 Web 调试 target，用 CDP 展示 DOM / Network / Console。
- 提供 One Works desktop debug agent 协议草案，服务于用户自己的桌面 App。
- 不在本阶段强制实现 VM；只保留虚拟桌面 Lab 的接口边界和调研入口。

验收：

- 用户选择一个 macOS App 窗口后，One Works 内可以看到实时画面。
- 点击画面能操作目标窗口。
- 打开 Inspect 后，点击元素能显示 accessibility 节点、bounds 和属性。
- 常用 App 快捷键可以发送到目标窗口；系统保留快捷键和安全输入场景有明确降级提示。
- 用户自己的 Electron / Web 桌面 App 可以通过 CDP 进入 Web 调试视图。

### Phase 3.x：虚拟桌面 Lab（更后）

- 基于 Apple Virtualization.framework 评估 macOS / Linux guest。
- 支持独立 display、keyboard、mouse、network、共享目录。
- 支持快照、重置、录制和复现步骤。
- 在 guest 内接入 desktop debug agent 或自动化 bridge。
- 后续再评估 Windows Hyper-V / Linux KVM 能力。

验收：

- 可以在 VM 中启动一个样例桌面 App，并在 One Works 内看到画面。
- VM 内快捷键不影响宿主机主桌面。
- 可以重置到预设状态并复现一次用户操作。

### Phase 4：设备池与自动化扩展

- 支持远程 Android device host。
- 支持设备占用、释放和状态页。
- 支持生成 Appium / Maestro / Playwright mobile-like 步骤草稿。
- 支持录制用户操作并生成复现步骤。

## 安全与隐私

- 第一次连接设备时必须展示权限说明。
- 不自动启用 debug agent；必须由用户明确授权或项目配置开启。
- 不把截图、视频流、元素树上传到远端，除非用户显式添加到对话。
- `FLAG_SECURE` 或系统禁止截图时必须尊重设备限制。
- 密码框、隐私页面、支付页面只显示系统允许的信息。
- debug SDK 只在 debug build 中启用，release build 默认关闭。
- Electron main 负责清理端口转发和设备端临时进程。

## 风险

- Android 设备厂商对输入注入限制不同，部分设备需要额外打开 USB debugging security settings。
- scrcpy protocol 版本变化需要跟进。
- UIAutomator dump 有性能和完整性限制，复杂页面可能需要增量或 server 化实现。
- iOS WDA 签名和 provisioning 是高摩擦点。
- idb 对新 iOS 版本的兼容性需要持续验证。
- Flutter、游戏、自绘 UI 的 inspect 深度有限。
- One Works debug agent 会引入移动端 SDK 维护成本。
- 桌面 App 调试需要用户授予屏幕录制、辅助功能和输入监听权限，首次配置摩擦较高。
- 桌面快捷键捕获和注入受系统保留快捷键、安全输入、权限弹窗限制，不能承诺像 VM 一样完全接管。
- VM 方案涉及镜像、授权、性能、快照和 guest agent，成本高于移动设备预览。

## 开放问题

- Android 正式实现使用 Tango/ya-webadb，还是直接维护自有 scrcpy adapter？
- 视频解码放在 desktop main、renderer WebCodecs，还是走本地 HTTP/WebSocket 流？
- One Works debug agent 的协议是否复用现有 runtime-protocol，还是单独建 `mobile-inspector-protocol`？
- UIAutomator tree 和 debug agent tree 在 UI 上是合并展示还是多 source 切换？
- iOS Phase 2 是否直接引入 Appium，还是只管理 WDA endpoint？
- 桌面 debug agent 是否与移动 debug agent 共用协议，还是单独抽象成 `app-inspector-protocol`？
- 桌面 Phase 3 是否只支持 macOS，还是同步预留 Windows Graphics Capture / UI Automation 的实现口？
- 虚拟桌面 Lab 是否优先支持 macOS guest、Linux guest，还是只作为企业版 / 远程 host 能力？
- 是否需要把设备预览作为 interaction panel tab、workspace drawer tab 和独立窗口三种形态都支持？

## 推荐决策

- 第一优先级做 Android Phase 1：内嵌到 One Works Electron / Web UI，支持真机和模拟器的预览、控制与通用检查。
- Android screen/control 选 scrcpy 协议，嵌入实现优先评估 Tango/ya-webadb，不把外部 scrcpy 窗口作为一期交付。
- Android 通用 inspect 选 UIAutomator，数据模型兼容 Appium。
- 不依赖 Android Studio Layout Inspector；深度能力由 One Works Android debug agent 提供。
- iOS 放到 Phase 2，先按 macOS-only 收口；screen 选 idb video-stream，点击和输入由 WDA/XCUITest 执行。
- 桌面应用调试放在 iOS 后面：Phase 3 先做 macOS 宿主机窗口预览、Accessibility inspect、输入和快捷键；虚拟桌面 Lab 再放到 Phase 3.x。
- One Works debug agent 协议从第一天按 Android / iOS / desktop 共用 UI 设计，避免多套平台 UI 分叉。
