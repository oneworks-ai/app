# 安装与准备

## 安装基础包

### 下载桌面应用

如果你想直接使用桌面版 One Works，而不是先在项目里拼装 `server + client`：

- 从 [GitHub Releases](https://github.com/oneworks-ai/app/releases) 下载 `pkg/oneworks-desktop/v*` tag 对应的安装包
- macOS：Intel（`x64`）与 Apple Silicon（`arm64`）分别提供 `.dmg`、`.zip`
- Windows：正式安装包暂未提供，后续补发见 [#161](https://github.com/oneworks-ai/app/issues/161)
- Linux：`.AppImage`、`.deb`、`.tar.gz`

注意：当前桌面安装包默认不签名；第一次启动时，macOS 可能会弹出系统安全提示，需要手动确认。

### 最小入口

如果你只想快速跑起来，优先使用这两个入口：

```bash
npx oneworks "summarize the repo"
npx oneworks web
npx oneworks server
npx oneworks app
npx oneworks app cache
npx oneworks app --no-cache
```

`oneworks` 会按需懒安装对应运行时：

- `web`：转发到 `@oneworks/web`
- `server`：转发到 `@oneworks/server`
- `app`：记住上次桌面安装模式；如果没有记录，会先询问是装到用户目录还是 bootstrap cache，再以当前目录作为 workspace 启动桌面应用
- `app cache`：显式走 cache；如果 cache 里已经有对应 release，就直接从 cache 启动
- `app --no-cache`：显式回到用户目录安装模式
- 其他命令：原样转发到 `@oneworks/cli`

其中 `bootstrap app` 依赖对应平台已经公开发布桌面 release；当前 macOS、Linux 可用，Windows 仍以正式安装产物补齐为准。

通过 `oneworks web`、`@oneworks/web` 或桌面 workspace 打开的 Web UI，左下角菜单提供“模块管理”页面，可以按 Core / Adapters / Plugins 分组检查和更新。可下载安装到 bootstrap cache 的模块包括 `@oneworks/web`、`@oneworks/client`、`@oneworks/server`、内置 adapter 包和内置 plugin 包；页面支持按默认更新通道、单模块覆盖通道或分组批量更新。默认通道保存为当前 workspace `.oo.config.json` 的 `desktop.updateChannel`，模块覆盖保存为 `desktop.moduleUpdateChannels`。adapter 更新后新会话会优先使用缓存版本；web shell、client UI、server 和 plugin 更新后需要重启对应运行时才会生效。
`bootstrap app` 的项目行为：

- 当前命令所在目录会传给桌面应用作为 workspace
- 如果桌面应用已经在运行，同一目录会直接聚焦已有项目窗口，不会重复启动本机 service
- 如果桌面应用已经在运行，但当前目录是另一个项目，会在同一个 desktop 进程里为新目录启动独立 service，并打开新的项目窗口

如果你直接从安装包启动桌面应用，而不是从项目目录运行 `bootstrap app`，桌面端会先要求选择一个最近项目或手动打开目录，确保后续流程一定在某个 workspace 下继续。

如果你不想经过 bootstrap，也可以直接使用具体入口：

```bash
npx oneworks web
npx oneworks server
```

- `@oneworks/web`：单进程启动内置 Web UI，默认访问地址是 `http://127.0.0.1:8787/ui/`
- `@oneworks/server`：只启动控制面服务，供独立 PWA、静态 Web 或其他 app 连接；常用参数示例：`npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors`

### 包管理器安装

Homebrew 和 Scoop 的元数据由独立仓库承载，并在 One Works 公开包构建可用后由发布自动化生成。

- Homebrew tap：`oneworks-ai/homebrew-tap`
- Scoop bucket：`oneworks-ai/scoop-bucket`
- 支持命令：`oneworks`、`ow`、`owo`

### Windows 安装 CLI

Windows 可以用 PowerShell 一键安装最新 CLI。脚本会检查 Node.js 22+ / npm；如果缺失，会优先通过 winget 安装 Node.js LTS，其次尝试 Scoop：

```powershell
irm https://raw.githubusercontent.com/oneworks-ai/app/main/scripts/install-windows.ps1 | iex
```

如果你的 PowerShell 执行策略较严格，先下载再执行：

```powershell
iwr https://raw.githubusercontent.com/oneworks-ai/app/main/scripts/install-windows.ps1 -OutFile install-oneworks.ps1
powershell -ExecutionPolicy Bypass -File .\install-oneworks.ps1
```

安装完成后可以直接检查：

```powershell
oneworks --version
oneworks --help
```

Scoop bucket manifest 会在公开包构建可用后由发布自动化生成。

winget 的公开安装命令会在 manifest 被 `microsoft/winget-pkgs` 接受后可用：

```powershell
winget install --id OneWorks.OneWorks -e
```

在此之前，Windows 用户优先使用 npm 入口。

### 在项目中安装 npm 包

如果你希望把集成 Web UI 作为项目依赖安装：

```bash
pnpm add -D @oneworks/web
```

如果你只需要 headless server：

```bash
pnpm add -D @oneworks/server
```

更细粒度的高级场景，仍然可以单独安装 CLI、client、adapter 和插件包：

```bash
pnpm add -D @oneworks/server @oneworks/client @oneworks/cli @oneworks/adapter-claude-code
```

其中 `@oneworks/client` 更适合高级拆分部署或本仓源码开发；普通项目接入优先使用 `@oneworks/web`。

如果需要在项目里启用第三方插件，还需要把对应插件包一起安装到当前 workspace：

```bash
pnpm add -D @acme/oneworks-plugin-docs
```

内置 One Works 插件会按运行时声明的版本走全局 package cache，不需要写入项目依赖。

如果你想显式调用独立 `oneworks-mcp` 二进制：

```bash
pnpm add -D @oneworks/mcp
```

如果你想显式调用独立 `oneworks-call-hook` 二进制：

```bash
pnpm add -D @oneworks/hooks
```

不想写入依赖也可以直接用 `npx`：

```bash
npx oneworks web --help
npx oneworks --help
npx oneworks web --help
npx oneworks server --help
```

## 配置与数据目录

默认情况下，One Works 会把解析后的 workspace 根目录作为项目配置根目录，并从这里读取 `.oo.config.*` / `.oo.dev.config.*`；通过 CLI / Server / Web 入口启动时，也会从真实用户 Home 的默认目录读取全局配置 `~/.oneworks/.oo.config.json`。合并顺序是：全局配置作为个人默认值，workspace 的 `.oo.config.*` 作为项目配置覆盖它，workspace 或主 worktree 的 `.oo.dev.config.*` 继续作为本地覆盖。把 `disableGlobalConfig` 设为 `true` 后，当前解析结果会跳过全局配置层；这个开关按全局、项目、本地配置的优先级继续合并，越靠后的层级可覆盖前面的设置。
在线配置页可以分别编辑全局、项目、本地三层配置。CLI 中 `oneworks config set --source global` 写入全局 `~/.oneworks/.oo.config.json`，`--source project` 写入 workspace `.oo.config.*`，`--source user` 写入 workspace / 主 worktree 的 `.oo.dev.config.*`。Electron-only 偏好（例如启动面板快捷键、系统应用图标同步、图标主题与背景样式）只写入全局配置的 `desktop` section；最近项目列表属于桌面运行状态，仍由 Electron `userData` 保存，不进入 config system。

如果你需要调整配置目录、数据资产目录，或覆盖 `__ONEWORKS_PROJECT_BASE_DIR__` / `__ONEWORKS_PROJECT_ENTITIES_DIR__`，直接看 [数据资产目录配置](../asset-directories.md)。
