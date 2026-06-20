---
description: 能力展示录屏工具的使用边界、产物约定、场景维护与 CI 触发建议。
---

# Demo Video 工具约定

能力展示录屏统一使用 `pnpm tools demo-video`。它会冷启动独立 headless Chrome profile，通过 Chrome DevTools Protocol 执行场景动作、定帧截图，再用 `ffmpeg` 合成 MP4，避免依赖用户日常浏览器状态。

## 常用命令

- `pnpm tools demo-video list`：列出可用场景。
- `pnpm tools demo-video record url-tour --url <page-url>`：录制一个已准备好的页面。
- `pnpm tools demo-video record keyboard-input-tour --url <page-url>`：录制输入控件里的鼠标点击、文本输入和 Enter 按键展示。
- `pnpm tools demo-video record relay-team-config-tabs --url <relay-admin-or-relay-base-url>`：录制 Relay 团队详情 tabs 展示路径。

常用参数：

- `--out-dir <path>`：输出目录，默认 `.logs/demo-videos/<scenario>`。
- `--name <name>`：输出文件 basename，默认 scenario id。
- `--width <px> --height <px> --fps <fps>`：覆盖场景默认 viewport 与帧率。
- `--duration-ms <ms>`：给通用场景控制录制时长；业务场景通常自己控制节奏。
- `--color-scheme light|dark|system`：默认 `light`，避免本机主题影响展示。
- `--keep-frames`：保留原始 PNG 帧，便于检查页面是否遮挡、空白或错位。
- `--json`：输出机器可读结果，适合后续脚本消费。

输出固定包含：

- `<name>.mp4`：最终展示视频。
- `<name>-poster.png`：首帧 poster。
- `frames/`：仅在传 `--keep-frames` 时保留。

## 场景维护

新增展示路径时，优先在 `scripts/demo-video/scenarios.ts` 注册 scenario。场景只描述用户行为路径，例如进入页面、等待关键文字、点击 tab 或按钮、录制停留时长；不要把服务部署、数据库 seed、账号初始化等准备工作硬编码进录制引擎。

录制 context 会自动给动作叠加展示信息：

- `clickText` / `clickSelector`：显示鼠标光标和点击按下态。
- `typeText`：显示 `Type` 按键 HUD，并把文本写入当前聚焦控件。
- `pressKey`：显示按键 HUD，支持 `Enter`、`Tab`、方向键、`Backspace`、`Escape`、`Space`，以及 `Meta+K` / `Ctrl+Enter` 这类组合键。

需要复杂准备时，把准备逻辑做成独立 smoke / setup 工具，先产出可访问 URL，再把 URL 传给 `demo-video record`。这样同一录制框架可以复用于 Relay、PWA、Electron webview、插件能力页和以后更多产品展示。

## CI 触发建议

默认不要在普通 CI 中录完整 MP4，避免拉高运行时间和系统依赖。更适合的层次是：

- PR 本地验证：开发者或 Codex 在本地录制 MP4，并把视频或 poster 作为 review 证据。
- 轻量 CI：只在相关前端 / scenario / 录制工具变更时跑列表、类型、lint 和必要的截图 smoke。
- 手动 workflow：需要发布展示素材时再手动触发完整录制，或在专门的可视化环境中运行。
