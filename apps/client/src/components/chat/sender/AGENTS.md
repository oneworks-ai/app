# Sender Module

本目录是聊天输入区的模块边界。默认 sender、inline edit sender、launcher 输入框都会复用这里的入口和子模块。

## 入口与分层

- `Sender.tsx`：最外层装配入口，只组合 controller 和 `SenderBody`。
- `Sender.scss`：sender / inline edit 共享样式，并声明 `container: sender-history / inline-size`。
- `SenderSurface.scss`：chat sender surface 视觉层，维护 `.sender-container--chat-surface` 及其 status bar / select 密度外观；页面和插件宿主只加公共 surface class，不复制这套样式。
- `@components/`：私有视图组件和子模块，例如 toolbar、model select、effort select、account select、adapter select。
- `@core/`：toolbar bindings、content 组装和纯逻辑。
- `@hooks/`：composer 状态、overlay、快捷键、focus restore、提交等状态编排。
- `@types/`：sender 私有类型定义。
- `@utils/`：sender 私有常量和轻量工具。

## 自动化输入与编辑器状态

- sender 的真实提交状态来自 React / editor model，不等于 DOM 上看起来有文字。
- 给 Electron、Computer Use 或其他可访问性自动化暴露输入路径时，必须把值写回同一套 composer/editor state，并触发正常 submit 前置校验；只改 contenteditable / Monaco DOM 会出现“看起来有字但点发送不创建会话”。
- 涉及 IME、富文本层或隐藏 automation input 的改动，要同时验证真实键盘输入、可访问性 `set_value`、点击发送后是否创建会话，以及首条用户消息是否保持原文。

## 响应式边界

- `useResponsiveLayout` 的 `isCompactLayout` 只代表 `600px` 以下的窄屏 / 手机端布局。
- `isCompactLayout || isTouchInteraction` 才能切到移动抽屉交互；不要因为中等宽度桌面空间不足就提前改交互模式。
- select 的视觉密度使用 `sender-history` container query：
  - adapter：`820px` 以下只显示图标
  - account：`700px` 以下只显示图标
  - effort：`560px` 以下只显示图标
  - model：`430px` 以下只显示图标
- 这套阈值跟 history / sender 实际宽度绑定，用户拖拽左侧栏改变聊天区宽度时也要生效。

## Select 维护约定

- `ModelSelectControl`、`AccountSelectControl`、`AdapterSelectControl` 都有两层响应：
  - 交互模式：桌面 select / popover 或移动抽屉。
  - 视觉密度：文字按钮或图标按钮。
- `EffortSelectControl` 在桌面使用 `低 / 中 / 高 / 最高` 四档原生 range slider，并按 sender container 宽度收窄轨道；`default` 必须先按上次选择与模型 / 适配器 / general 配置解析成显式档位，触屏和 mobile layout 继续使用移动抽屉。
- 不要把这两层重新合并；否则会回到“窗口稍窄就全部变成手机端图标按钮”的问题。
- 桌面 select 图标化时仍应保持原 select 的 open、focus restore、keyboard 和 tooltip 行为。
- compact drawer 分支中的按钮使用 `.sender-responsive-select-button`；桌面 select 分支通过各自组件样式在 container query 下隐藏文案。
- account 外层 `.sender-select-shell--account` 在图标化时要同步宽度和 `flex-basis`，避免 shell 比按钮宽。

## 回归要点

- 800px 左右桌面窗口不应进入 mobile drawer 交互。
- 601px 仍是桌面交互，600px 才进入 compact/mobile 交互。
- 拖拽左侧栏或改变 history 区宽度时，select 应按 adapter、account、effort、model 顺序逐级图标化。
- model 的文本区和箭头区都能打开；effort slider 支持点击、拖动、方向键和 Home / End，按 Escape 后 focus 回到输入框。
- account / adapter 在 status bar 右侧不能出现外层 shell 空白占位。
