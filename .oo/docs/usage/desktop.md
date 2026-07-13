# 桌面应用

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../images/desktop-chat-dark.png">
  <img alt="桌面应用会话页" src="../images/desktop-chat-light.png">
</picture>

## 获取安装包

如果不从源码启动，而是直接安装桌面应用：

- 从 [GitHub Releases](https://github.com/oneworks-ai/app/releases) 下载 `pkg/oneworks-desktop/v*` tag 对应的产物
- macOS：Intel（`x64`）与 Apple Silicon（`arm64`）分别提供 `.dmg`、`.zip`
- Windows：正式安装包暂未提供，后续补发见 [#161](https://github.com/oneworks-ai/app/issues/161)
- Linux：`.AppImage`、`.deb`、`.tar.gz`

如果你希望由 launcher 自动处理下载和首次启动，也可以直接运行：

```bash
npx oneworks app
npx oneworks app cache
npx oneworks app --no-cache
```

`bootstrap app` 会记住上次选择的桌面安装位置；如果之前没有记录，会先询问是安装到用户目录还是 bootstrap cache，再把当前 shell 所在目录作为 workspace 传给桌面应用。`bootstrap app cache` 显式走 cache，cache 里已有对应 release 时会直接启动；`bootstrap app --no-cache` 显式回到用户目录安装模式。

如果桌面应用尚未运行，`bootstrap app` 会直接打开当前项目；如果桌面应用已经运行，同一个目录只会复用已有本机 service 并聚焦现有项目窗口，新目录会通知已运行的桌面进程为该目录启动新的本机 service，并打开对应项目窗口。

当前桌面安装包默认不签名，首次运行时系统可能会提示安全确认。

## 项目选择与多窗口

桌面应用会把最近使用过的项目保存到本地状态里，并在项目选择页与菜单中统一展示；项目名使用目录名，项目说明使用完整文件路径，项目选择页会同时展示 `Running Projects` 和 `Recent Projects`。

窗口与 service 行为：

- 同一个规范化目录最多只会启动一个本机 service
- 已经打开的目录再次启动时，不会重复起 service，而是直接聚焦已有窗口
- 不同目录会各自启动独立的本机 service，并可以同时保留多个项目窗口
- 项目窗口标题固定使用 `目录名 - One Works`
- macOS 会话列表右键菜单支持把当前会话打开到新的项目窗口；新窗口复用同一隐藏 titlebar 风格，并默认折叠左侧栏

菜单入口：

- 空项目启动页 `Start -> New Project Folder`：创建一个本地文件夹，并作为新项目启动
- `File -> Open Launcher`：聚焦已有空项目启动页，或打开一个新的启动面板
- `File -> New Window`：打开一个不绑定 workspace 的空项目启动页
- `File -> New Window with Profile -> Default Profile`：用默认 profile 打开空项目启动页
- `File -> Open...` / `File -> Open Folder...`：直接选择一个目录并打开对应项目窗口
- `File -> Open Recent`：从最近项目列表直接打开
- `File -> Open Workspace...`：直接选择一个目录并打开对应项目窗口
- `File -> Switch Project...`：打开项目选择页，可以在运行中的项目和最近项目之间切换
- `File -> Running Projects`：在已经运行的项目窗口之间快速切换
- `View`：提供侧栏、终端、文件树、浏览器页、窗口重载、会话切换、前进后退与缩放快捷操作
- `One Works -> Check for Updates...`（macOS）或 `Help -> Check for Updates...`（Windows / Linux）：手动检测桌面更新；正式安装包也会在启动后自动检测，有可用更新时前进 / 后退按钮右侧会显示更新按钮。配置页和 launcher 设置页可以开启 / 关闭自动更新，并选择 Stable / RC / Beta / Alpha 默认更新通道，保存到当前 workspace 的 `.oo.config.json`。
- 左下角菜单里的“检查更新”：进入独立页面，按 Core / Adapters / Plugins 分组检测并更新 web shell、client UI、server、内置 adapter 包和内置 plugin 包，更新文件写入 bootstrap cache。模块默认继承 `desktop.updateChannel`，也可以在页面里为单个模块选择 Stable / RC / Beta / Alpha 覆盖通道，覆盖值保存到当前 workspace `.oo.config.json` 的 `desktop.moduleUpdateChannels`。页面支持按分组批量更新；adapter 更新后新会话生效，web shell、client UI、server 和 plugin 更新后需要重启对应运行时。
- `Developer -> Open One Works DevTools`：打开当前桌面窗口的 DevTools

macOS Dock 图标右键菜单也会展示最近项目、当前打开窗口、`Open Launcher`、`New Window`、`Open...`、`Open Folder...` 和 `Open Recent`。

配置页里的 `外观 / Appearance` 分组维护跨项目生效的 app 级个人偏好，包括界面主题色、主题模式和会话历史时间线展示模式，统一写入 global `appearance` section。桌面应用内的 `桌面端 / Desktop` 分组负责全局桌面偏好，包括启动面板快捷键、应用 icon 主题、背景样式（透明、纯色、纹理）和同步系统应用图标；macOS 下对应 Dock 图标，Windows 下对应任务栏应用图标。快捷键设置为空会停用全局快捷键。这些 Electron-only 偏好统一写入全局 `~/.oneworks/.oo.config.json` 的 `desktop` section，不随项目切换；如果全局配置通过 `extend` 继承桌面偏好，界面会读取继承后的有效值，但保存时只写入本次变更的全局 `desktop` 字段。更新配置 `desktop.autoUpdate` / `desktop.updateChannel` / `desktop.moduleUpdateChannels` 例外，读取和写入当前 workspace 的 project `.oo.config.json`，未配置时默认自动更新开启且使用 Stable；模块级覆盖未配置时继承默认更新通道。最近项目列表是运行状态，继续保存在 Electron `userData/desktop-state.json`。

View 快捷键：

- `Command+Space` / `Ctrl+Space`：默认打开或聚焦空项目启动面板。macOS 如果系统 Spotlight 占用了 `Command+Space`，需要先在系统设置中释放该快捷键，或在桌面端配置页换成其他快捷键。
- `Command+B` / `Ctrl+B`：展开或折叠左侧栏
- `Command+J` / `Ctrl+J`：展开或关闭下方终端面板
- `Shift+Command+E` / `Shift+Ctrl+E`：展开或关闭文件树
- `Command+T` / `Ctrl+T`：打开浏览器页签
- `Command+R` / `Ctrl+R`：刷新当前浏览器页签
- `Shift+Command+R` / `Shift+Ctrl+R`：重载当前桌面窗口；页面完全无法加载时也可以通过 `View -> Reload Window` 使用
- `Option+Command+B` / `Alt+Ctrl+B`：展开或关闭侧边面板
- `Command+F` / `Ctrl+F`：聚焦会话搜索
- `Shift+Command+[` / `Shift+Ctrl+[`：切换到上一个会话
- `Shift+Command+]` / `Shift+Ctrl+]`：切换到下一个会话
- `Command+[` / `Ctrl+[`：后退
- `Command+]` / `Ctrl+]`：前进
- `Command++` / `Ctrl++`：放大
- `Command+-` / `Ctrl+-`：缩小
- `Command+0` / `Ctrl+0`：恢复实际大小

DevTools 快捷键：

- macOS：`Option+Command+I`，也兼容 `Command+Shift+I`
- Windows / Linux：`Ctrl+Shift+I`
- 全平台：`F12`

每个项目自己的本机 service 数据会写到 project home，避免污染工作区：

- `<project-home>/.local/server/db.sqlite`
- `<project-home>/server/data/`
- `<project-home>/logs/server/`

桌面自身状态，例如最近项目、窗口偏好和快捷键设置，仍写在 Electron `userData`。

## 连接模式

桌面应用默认会启动一个本机服务，并把 Web UI 直接连到这个本机服务；这个服务由 Electron 自动启动，不需要额外执行 `npx oneworks server`，默认关闭 `webAuth`，会话、数据库和日志默认写入 project home。

桌面端同时支持切换到其他 One Works 服务端，适合这些场景：

- 本机 Electron 只作为控制台，实际执行放在远端机器
- 一台 Electron 管理多台不同环境的执行服务器
- 本机服务和远端服务之间来回切换

切换入口包括侧边栏账号菜单里的“切换后端服务”和登录失败页里的“切换后端服务”。

切到远端服务后，前端会复用 PWA/独立部署那套连接逻辑：

- 按服务地址保存连接历史
- 按服务地址分别保存 bearer token
- 首次连接会检查前后端版本兼容
- 远端服务如对公网或跨设备开放，仍建议开启 `webAuth`

桌面应用切到远端服务时，本机内置服务仍会继续在后台运行；`File -> Open Workspace...`、`File -> Switch Project...` 和项目选择页改动的是本机内置 service 列表，不会修改远端服务的 workspace。

## 运行边界

桌面壳复用现有 `@oneworks/server`，业务逻辑不在 Electron main 进程中重复实现；server 数据默认按 workspace 写入 project home，桌面壳自己的设置继续写入 Electron `userData`。
