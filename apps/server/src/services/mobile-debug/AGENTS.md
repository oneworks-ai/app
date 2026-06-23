# Mobile Debug Service

本目录承载 server 侧 Android 调试能力，供 Web、IAB、Electron 共享。

## 边界

- `index.ts`：负责 ADB 发现、Android DevTools socket 转发、端口反向代理、截图、uiautomator 元素树和基础输入。
- 低延迟 scrcpy 视频流目前仍由 Electron main 维护，因为它依赖窗口级 IPC 推帧和窗口生命周期。
- HTTP 参数、状态码和错误暴露放在 `../../routes/mobile-debug.ts`；不要在 route 里维护 ADB 连接或转发状态。

## 入口

- Route：`apps/server/src/routes/mobile-debug.ts`
- Client API：`apps/client/src/api/mobile-debug.ts`
- UI 调用适配：`apps/client/src/components/chat/interaction-panel/mobile-debug-platform.ts`
