---
description: 能力展示录屏工具的使用边界、产物约定、场景维护与 CI 触发建议。
---

# Demo Video 工具约定

能力展示录屏统一使用 `pnpm tools demo-video` 和 `pnpm tools desktop-control record-batch`。纯 Web / headless 页面可以用 CDP 截帧合成；真实 Electron app / workspace 的正式验证视频必须使用 macOS 系统显示录屏作为画面来源。

Electron 正式验证 / 产品素材的标准链路是：

```bash
pnpm tools desktop-control record-batch launcher-open-workspace-ui-tour \
  --app "/Applications/One Works.app" \
  --workspace "/absolute/workspace" \
  --use-deskpad-display
```

这条链路会把 launcher 和 workspace BrowserWindow 放到专用 recording display，启动真实背景窗口显示固定批准的 Ventura Graphic Light 壁纸，然后用 macOS 系统 display capture 做连续录屏。最终交付视频必须按 workspace window bounds 加固定 padding 裁成 app 区域，不能交付整张虚拟桌面。CDP 只用于动作驱动、target discovery、DOM readiness 和等待条件；画面不得来自 `Page.captureScreenshot`。

`DeskPad Display` 只是默认 recording display provider，不是无条件可信的画面来源。正式录制前必须验证：

- 系统显示器列表能找到目标 display。
- macOS display capture 能捕获该 display。
- display capture 的帧里确实包含 Electron app window 像素，而不是只有壁纸 / 桌面层。

任一验证失败必须 fail-fast；不要降级到主桌面、固定区域、CDP 截帧、窗口录制或“只有背景”的视频。
窗口可见性验证必须做解码后的像素级判断，不要用 `cmp` 或 PNG 文件字节比较；`screencapture -l` 和 display crop 即使视觉一致，也可能因为 metadata、色彩配置或阴影裁切不同而字节不同。透明 / vibrancy / 毛玻璃窗口不能只用 RGB 相似度判断：窗口单独截图不包含 recording display 背景，而 display crop 会包含壁纸和模糊效果，必须同时接受结构边缘重合度这类特征指标。失败时要保留 display / window / crop probe 图和相似度 / 边缘指标，避免后续会话只能靠猜。
计算 DeskPad / AppKit display bounds 时要注意坐标系：`NSScreen.frame` 的 y 是 bottom-origin，Electron `BrowserWindow` bounds 和 `screencapture` crop 使用 top-origin。传给 Electron 的 y 和输出 crop y 都必须做转换，否则窗口会被 macOS 夹到虚拟屏顶部，视频里看起来不居中。

正式 Electron 录屏禁止使用这些路径作为交付证据：

- 不用 CDP 截帧或 headless renderer 视频代替真实 app。
- 不用 `system-window` / ScreenCaptureKit 窗口录制作为正式默认路径；它曾出现 traffic light 胶囊位置不稳定和圆角不自然的问题，只能保留为底层诊断。
- 不用固定 region 作为录制源伪装窗口录制；录制源必须是通过可见性验证的系统 display capture，输出必须裁到目标 app 窗口区域，让 macOS 自己合成窗口、圆角、阴影和红黄绿灯。
- 不默认读取用户当前桌面 wallpaper，不主动换背景。背景固定为 Ventura Graphic Light；只有用户明确要求换背景时才列候选并切换。

默认背景优先读取：

```text
.logs/demo-videos/display-region-prototype/ventura-graphic-light-hq/ventura-background-full-3174x2232.png
```

缺失时回退到系统候选：

```text
/System/Library/Desktop Pictures/.thumbnails/Ventura Graphic Light.heic
```

## 常用命令

- `pnpm tools demo-video list`：列出可用场景。
- `pnpm tools demo-video record url-tour --url <page-url>`：录制一个已准备好的纯 Web 页面。
- `pnpm tools demo-video batch url-tour --url <page-url>`：批量录制纯 Web 的 `light/dark x zh/en` 四个默认变体。
- `pnpm tools desktop-control record-batch launcher-open-workspace-ui-tour --workspace <path> --app <app> --use-deskpad-display`：真实 Electron launcher/workspace 批量录制入口；正式验证 / 产品素材都走这条。
- `pnpm tools desktop-control record-batch launcher-open-workspace-chat-smoke --workspace <path> --app <app> --use-deskpad-display --languages zh --color-schemes light`：录制打开 workspace、发送消息并等待回复的 smoke。

常用参数：

- `--out-dir <path>`：输出目录，默认 `.logs/demo-videos/electron/<scenario>`。
- `--name <name>`：输出文件 basename 前缀，默认 scenario id。
- `--fps <fps>`：录制帧率；Electron 正式录屏默认使用系统录屏高帧率，常用 `60`。
- `--ffmpeg-path <path>`：用于编码、裁剪、poster 和 still。录制前必须先校验 `ffmpeg -version` 能正常退出；不要自动使用会崩溃或缺少 stream 输出的第三方 app 私有 ffmpeg。
- `--duration-ms <ms>`：给通用场景控制录制时长；业务场景通常自己控制节奏。
- `--color-schemes <list> --languages <list>`：用于批量生成明暗主题和中英语言变体。
- `--use-deskpad-display`：默认 recording display provider；自动查找 `DeskPad Display`，注入 launcher / workspace 窗口 bounds，并做 display capture / app window 可见性验证；找不到或验证失败必须失败。
- `--recording-display-name <name>`：指定其他专用虚拟显示器名称；只用于替换 DeskPad 或 CI 专用 display。
- `--video-background-image <path>`：覆盖录制 display 的真实背景窗口图片；只有用户明确要求换背景时才使用。
- `--keep-frames`：保留原始帧 / segment 目录，便于检查页面是否遮挡、空白或错位。
- `--json`：输出机器可读结果，适合后续脚本消费。

`--capture-source`、`--system-window-capture-backend`、`--video-background-color` 不属于 `desktop-control record-batch` 的正式接口。底层 `demo-video record` 仍可保留这些诊断选项，但不要在 Electron 正式验证、发布验证或产品素材里使用。

输出固定包含：

- `<name>.mp4`：最终展示视频。
- `<name>-poster.png`：首帧 poster。
- `<name>-stills.json`：按秒切图 manifest，供 agent 逐秒读取关键帧。
- `stills/second_0000.png`、`stills/second_0001.png` 等：按秒抽取的 PNG 关键帧。
- `frames/` / `segments/`：仅在传 `--keep-frames` 时保留。

交付 Electron / workspace 录屏时，必须同时给出加载耗时分析，不能只贴视频。分析至少包含：

- 录制器启动耗时，说明空白画面是否由录制链路引入。
- app spawn 到 launcher / 首个窗口可见的耗时。
- launcher 操作开始、workspace server ready、workspace renderer/chat ready 的时间点。
- 是否命中 runtime package cache；如未命中，说明首次 seed / cache prepare 对耗时的影响。
- 视频是否真正录到 `项目正在就位` 消失后的对话界面，并引用按秒 still 或抽帧作为证据。

## 场景维护

新增展示路径时，优先在 `scripts/demo-video/scenarios.ts` 注册 scenario。场景只描述用户行为路径，例如进入页面、等待关键文字、点击 tab 或按钮、录制停留时长；不要把服务部署、数据库 seed、账号初始化等准备工作硬编码进录制引擎。

录制 context 会自动给动作叠加展示信息：

- `clickText` / `clickSelector`：显示操作光标和点击按下态。
- `typeText`：显示 `Type` 按键 HUD，并把文本写入当前聚焦控件。
- `pressKey`：显示按键 HUD，支持 `Enter`、`Tab`、方向键、`Backspace`、`Escape`、`Space`，以及 `Meta+K` / `Ctrl+Enter` 这类组合键。

需要复杂准备时，把准备逻辑做成独立 smoke / setup 工具，先产出可访问 URL 或可启动 app，再把 URL / app / workspace 交给录制入口。这样同一录制框架可以复用于 Relay、PWA、Electron webview、插件能力页和以后更多产品展示。

系统 display capture 下的 `recordDuring(durationMs, action)` 里，`durationMs` 只能表示最小录制时长，不能当成硬截止。只要 `action` 仍在点击、等待或切换窗口，recorder 就必须继续录到 action settle；否则 action 结束后的 cursor 事件会落在已关闭的录屏 segment 之后，被压缩到同一时间点，最终视频里会出现鼠标瞬跳。改动这段逻辑时必须保留单测覆盖，并用 10fps 以上抽帧或 cursor 坐标检测检查 launcher -> workspace 切换附近是否连续。

发布纯 Web 展示素材时优先使用 `demo-video batch`。真实 Electron launcher 打开 workspace 的素材不要用 `demo-video batch url-tour --url .../ui/launcher`，必须使用 `desktop-control record-batch launcher-open-workspace-ui-tour`，这样每个 variant 都有真实 Electron pid、真实 BrowserWindow 和真实系统显示合成。

如果需要录 launcher 打开 workspace 的完整过渡，创建 Electron control session 时不要传 `workspace`。需要证明真实 UI 操作时使用 `launcher-open-workspace-ui-tour`，它会点击“打开项目”并在目录浏览器里逐级选择目标 workspace；需要发送消息并等待回复时使用 `launcher-open-workspace-chat-smoke`。

录制已有 Electron target 时必须保留目标窗口环境：不要对 renderer 强制 `Emulation.setDeviceMetricsOverride` 或 `prefers-color-scheme`，否则会把真实窗口尺寸 / 主题覆盖成 demo-video 默认值，导致录屏样式和用户看到的 Electron 界面不一致。

Electron 对话页录屏应同时传 `waitForText` 和 `waitForTextAbsent`，例如等待 `输入消息` 出现且 `项目正在就位` 消失，让 recorder 在第一帧前确认页面真正进入可交互态。不要在 workspace 仍显示启动 overlay 时生成“成功”录屏。

## CI 触发建议

默认不要在普通 CI 中录完整 MP4，避免拉高运行时间和系统依赖。更适合的层次是：

- PR 本地验证：开发者或 Codex 在本地录制 MP4，并把视频或 poster 作为 review 证据。
- 轻量 CI：只在相关前端 / scenario / 录制工具变更时跑列表、类型、lint 和必要的截图 smoke。
- 手动 workflow：需要发布展示素材时再手动触发完整录制，或在专门的可视化环境中运行。
