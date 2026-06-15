# 在自己项目中使用

这份目录是面向用户的 One Works 使用文档入口；如果你要把 One Works 接入自己的项目，从这里开始。

## 先看这些

- [安装与准备](./usage/install.md)
- [数据资产目录配置](./asset-directories.md)
- [启动服务](./usage/runtime.md)
- [适配器 CLI 安装与版本](./usage/adapter-cli.md)
- [桌面应用](./usage/desktop.md)
- [VS Code 扩展](./usage/vscode-extension.md)
- [Web UI 与 Terminal 视图](./usage/web.md)
- [适配器配置与多账号](./usage/adapters.md)
- [PWA 与独立部署](./usage/pwa.md)
- [Relay 托管、登录与身份模型](./usage/relay.md)
- [Channel 会话绑定](./usage/channels.md)
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
- 支持邮箱：[support@oneworks.cloud](mailto:support@oneworks.cloud)

## 接入目标

- 不需要 clone 本仓库，只需要安装相关包。
- 配置与会话基于你的项目目录，而不是 One Works 仓库本身。
- UI、CLI、MCP、hooks runtime 都可以按需单独接入。
- Web UI 的会话页支持独立 `terminal` 视图，但它和 chat 消息流是两条不同的运行链路。
