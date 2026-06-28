# Mobile Debug Service

本目录承载 server 侧移动设备调试能力，供 Web、IAB、Electron 共享。

## 边界

- `index.ts`：负责平台分发、ADB 发现、Android DevTools socket 转发、端口反向代理、截图、uiautomator 元素树、scrcpy 视频和基础输入。
- `ios-wda.ts`：负责 iOS WebDriverAgent endpoint 发现、截图、MJPEG 代理、accessibility XML 元素树和基础输入。
- Android scrcpy 视频流由 server WebSocket 维护；iOS 实时画面优先代理 WDA MJPEG，失败时由截图轮询兜底。
- iOS WDA 生命周期同时涉及 xcodebuild、WDA runner、iproxy / MJPEG 端口和 simulator target；排查连接断开或关闭服务时不要只看 server PID。
- 关闭 iOS simulator 调试时还要检查 `launchd_sim` / CoreSimulator runtime；`8200 / 9200` 端口空闲不代表 simulator 设备已经 shutdown。
- 相关维护经验见 `.oo/rules/maintenance/mobile-device-debugging.md`。
- HTTP 参数、状态码和错误暴露放在 `../../routes/mobile-debug.ts`；不要在 route 里维护 ADB 连接或转发状态。

## 入口

- Route：`apps/server/src/routes/mobile-debug.ts`
- Client API：`apps/client/src/api/mobile-debug.ts`
- UI 调用适配：`apps/client/src/components/chat/interaction-panel/mobile-debug-platform.ts`
