# 在自己项目中使用

这份目录是面向用户的 One Works 使用文档入口；如果你要把 One Works 接入自己的项目，从这里开始。

## 产品演示

下面的 21 秒演示使用真实桌面窗口，展示从 Launcher 打开工作空间并选择 AI 适配器的完整流程。视频会跟随文档站的亮暗外观选择对应主题；需要静态预览时，也可以查看[桌面应用页的主题自适应图片](./usage/desktop.md)。

<OneWorksThemeMedia>
  <template #light>
    <video aria-label="One Works 亮色中文产品演示" class="oneworks-doc-promo-video" controls muted loop playsinline preload="none" poster="./images/adapter-promo/posters/oneworks-adapter-promo-light-zh-poster.jpg">
      <source src="./videos/adapter-promo/oneworks-adapter-promo-light-zh.mp4" type="video/mp4">
      <img alt="One Works 亮色中文产品演示 GIF" loading="lazy" src="./images/adapter-promo/oneworks-adapter-promo-light-zh.gif">
    </video>
  </template>
  <template #dark>
    <video aria-label="One Works 暗色中文产品演示" class="oneworks-doc-promo-video" controls muted loop playsinline preload="none" poster="./images/adapter-promo/posters/oneworks-adapter-promo-dark-zh-poster.jpg">
      <source src="./videos/adapter-promo/oneworks-adapter-promo-dark-zh.mp4" type="video/mp4">
      <img alt="One Works 暗色中文产品演示 GIF" loading="lazy" src="./images/adapter-promo/oneworks-adapter-promo-dark-zh.gif">
    </video>
  </template>
</OneWorksThemeMedia>

## 先看这些

- [安装与准备](./usage/install.md)
- [Avatar 编辑器与开发者接入](./usage/avatar.md)
- [数据资产目录配置](./asset-directories.md)
- [启动服务](./usage/runtime.md)
- [适配器 CLI 安装与版本](./usage/adapter-cli.md)
- [桌面应用](./usage/desktop.md)
- [VS Code 扩展](./usage/vscode-extension.md)
- [Web UI 与 Terminal 视图](./usage/web.md)
- [适配器配置与多账号](./usage/adapters.md)
- [DeepSeek Harness（DSH）适配器](./usage/dsh-adapter.md)
- [Cline CLI 适配器](./usage/cline-adapter.md)
- [Factory Droid CLI 适配器](./usage/droid-adapter.md)
- [Pi coding-agent 适配器](./usage/pi-adapter.md)
- [Grok Build CLI 适配器](./usage/grok-adapter.md)
- [Goose CLI 适配器](./usage/goose-adapter.md)
- [Kiro CLI 适配器](./usage/kiro-adapter.md)
- [JetBrains Junie CLI 适配器](./usage/junie-adapter.md)
- [Qwen Code CLI 适配器](./usage/qwen-code-adapter.md)
- [Token 用量统计](./usage/token-usage.md)
- [PWA 与独立部署](./usage/pwa.md)
- [Relay 托管、登录与身份模型](./usage/relay.md)
- [诊断、遥测与支持包](./usage/diagnostics.md)
- [Channel 会话绑定](./usage/channels.md)
- [Channel 平台接入](./usage/channel-platforms.md)
- [CLI 与示例](./usage/cli.md)
- [示例目录](./usage/examples.md)
- [Skills 与依赖](./usage/skills.md)
- [Workspace 调度](./usage/workspaces.md)
- [插件、界面扩展与数据资产](./usage/plugins.md)
- [适配器原生插件与 Marketplace](./usage/native-plugins.md)

## 官方入口

- 官网：[oneworks.cloud](https://oneworks.cloud/)
- 文档站：[oneworks.cloud/docs](https://oneworks.cloud/docs/)
- GitHub：[oneworks-ai/app](https://github.com/oneworks-ai/app)
- 隐私政策：[OneWorks 隐私政策](./privacy.md)
- 支持邮箱：[support@oneworks.cloud](mailto:support@oneworks.cloud)

## 接入目标

- 不需要 clone 本仓库，只需要安装相关包。
- 配置与会话基于你的项目目录，而不是 One Works 仓库本身。
- UI、CLI、MCP、hooks runtime 都可以按需单独接入。
- Web UI 的会话页支持独立 `terminal` 视图，但它和 chat 消息流是两条不同的运行链路。
