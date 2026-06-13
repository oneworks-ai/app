# VS Code 扩展

VS Code 扩展位于 `apps/vscode-extension`，当前是一个薄壳：

- 通过右侧 Secondary Side Bar 的 One Works 入口打开完整 client。
- 通过 `One Works: Open Workspace` 切换当前右侧边栏控制的 workspace。
- 每个 workspace folder 会启动并复用一个本机 One Works UI server。
- 多个 workspace folder 可以同时保留各自的 server；右侧边栏显示当前选中的 workspace。
- Webview 内打开该 server 托管的 `/ui/`，界面复用 `oneworks web` 启动的集成 Web UI。
- Server 通过用户环境里的 `oneworks` / `ow` / `owo` 启动 `web` 子命令，业务逻辑不在扩展中重复实现。

扩展不内置、不自动安装 One Works runtime 包。它只嗅探用户环境里的 bootstrap 启动器，并在找不到时提示安装或配置。

## 效果预览

<img alt="VS Code 右侧边栏中的 One Works 扩展" src="../images/vscode-extension-sidebar.png">

用户在右侧 Secondary Side Bar 选择 One Works 后，右侧边栏会直接承载完整 client。当前选中的 workspace 会对应一个本机 UI server，侧边栏顶部命令可用于切换 workspace、刷新视图、重启当前项目 server 或在浏览器中打开同一界面。

## 使用前准备

要控制某个项目，需要先让该项目或系统环境里能找到 bootstrap 启动器：

```bash
pnpm add -D oneworks
```

Homebrew 启动器会在公开包发布后由 release automation 生成。

## 运行模型

扩展默认按 workspace folder 隔离 server：

- bootstrap 查找顺序：`oneworks.bootstrapCommand`、`ONEWORKS_VSCODE_BOOTSTRAP_COMMAND`、当前 workspace 的 `node_modules/.bin`、系统 `PATH`。
- 扩展找到 `oneworks` / `ow` / `owo` 后，会执行 `web` 子命令，并传入当前 workspace、随机端口和 `/ui` base。
- server 监听 `127.0.0.1` 的随机端口。
- `webAuth` 默认关闭。
- 数据库、日志和运行数据写入当前 workspace 的 project home，不写入 VS Code extension global storage，也不污染工作区。
- 右侧边栏 webview 使用 iframe 打开本机 server 的 `/ui/`。

多根 workspace 下，右侧边栏默认优先使用当前编辑器所在的 workspace folder；无法判断时使用第一个 workspace folder。执行 `One Works: Open Workspace` 可以手动切换。

再次执行 `One Works: Open Workspace` 时，扩展会切换右侧边栏当前 workspace；已启动过的其他 workspace server 会继续保留，直到执行停止命令或扩展停用。

## 配置项

- `oneworks.bootstrapCommand`：可选的 `oneworks` 可执行文件、命令名或 wrapper command。

如果项目未把 `oneworks` 安装到本地依赖，也可以把 `oneworks.bootstrapCommand` 指向系统安装的 `oneworks`、`oneworks` 或其他兼容 wrapper。

## 当前边界

- 当前扩展只提供 webview 壳和 per-project server 生命周期管理。
- 完整 client 当前直接嵌入 VS Code 右侧边栏；宽度由用户拖拽右侧边栏控制。
- 扩展不会为用户自动安装 `oneworks`。
