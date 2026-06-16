# One Works JetBrains IDE 插件

[en-US](./README.md) | zh-Hans

这个包是 One Works Web UI 的轻量 IntelliJ Platform 外壳。

## 行为

- 注册 `One Works` tool window。
- 为每个打开的 IDE project 启动一个 One Works Web runtime。
- 通过 JCEF webview 加载当前项目本机 server 暴露的 One Works client。
- server 数据与日志写入 IDE system 目录，并按 IDE project 路径 hash 隔离。

插件不会内置 One Works runtime 包。它会依次查找当前项目 `node_modules/.bin` 和系统 `PATH` 中的 `oneworks` / `ow` / `owo`，再执行 `web` 子命令。如果找不到 bootstrap 启动器，会回退执行：

```bash
npx -y oneworks web --host 127.0.0.1 --port <free-port> --base /ui --workspace <project-root> --data-dir <ide-system-dir> --log-dir <ide-system-dir>
```

在需要控制的项目中安装 bootstrap launcher：

```bash
pnpm add -D oneworks
```

## 兼容性

插件声明 `since-build="243"`，并且只依赖 `com.intellij.modules.platform`，因此目标是基于 IntelliJ Platform 2024.3 或更新版本的 JetBrains IDE，包括 IntelliJ IDEA 和 WebStorm。

当前 CI 使用 IntelliJ IDEA 2024.3.6 构建并验证插件结构。其他 JetBrains IDE 产品属于预期兼容目标，但还没有接入产品级 verifier job。如果 IDE runtime 不提供 JCEF，tool window 会显示外部浏览器打开入口。

## 本地开发覆盖

- `ONEWORKS_IDEA_BOOTSTRAP_COMMAND`：可选的 `oneworks` 可执行文件、命令名或 wrapper command。插件会追加 `web` 以及 host、port、base、workspace、data、log 参数。
- `ONEWORKS_IDEA_SERVER_COMMAND`：完整 shell command 覆盖，只建议本地调试使用。该命令需要自行读取插件注入的 `__ONEWORKS_PROJECT_*` 环境变量，或显式提供兼容的 `oneworks web` 参数。

## 边界

插件只负责 IDE 集成、从当前 project 获取 workspace、server 进程生命周期和 JCEF 外壳。Client、server、adapter、plugin 与 runtime 行为来自标准 One Works runtime。

## 开发

工程使用 IntelliJ Platform Gradle Plugin 2.x。

```bash
cd apps/idea-plugin
gradle runIde
gradle buildPlugin
gradle verifyPluginStructure
```

要求 Gradle 9.0+。工程已配置 Foojay toolchain resolver，本机没有 Java 21 时 Gradle 可以自动拉取对应 toolchain。
