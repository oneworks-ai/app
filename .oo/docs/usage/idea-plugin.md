# JetBrains IDE 插件

JetBrains IDE 插件位于 `apps/idea-plugin`，当前是一个薄壳：

- 在 IDE 内注册 `One Works` tool window。
- tool window 打开后，为当前 IDE project 启动一个本地 One Works Web runtime。
- 通过 JCEF webview 加载当前项目 server 暴露的 `/ui/`。
- server 的 workspace 是当前 IDE project 根目录。
- server 数据与日志位于 IDE system 目录下的 `oneworks/idea-plugin/<workspace-hash>/`，避免把运行态数据库和日志写入项目仓库。

## 使用前准备

要控制某个项目，需要先让该项目或系统环境里能找到 bootstrap 启动器：

```bash
pnpm add -D oneworks
```

插件会优先查找当前项目的 `node_modules/.bin`，然后查找系统 `PATH` 中的 `oneworks` / `ow` / `owo`，并执行 `web` 子命令。如果找不到本地启动器，会回退到 `npx -y oneworks web`。

## 运行模型

默认启动命令等价于：

```bash
oneworks web \
  --host 127.0.0.1 \
  --port <free-port> \
  --base /ui \
  --workspace <IDE project root> \
  --data-dir <IDE system dir>/oneworks/idea-plugin/<workspace-hash>/data \
  --log-dir <IDE system dir>/oneworks/idea-plugin/<workspace-hash>/logs
```

插件还会为进程注入这些关键环境变量：

```bash
__ONEWORKS_PROJECT_WORKSPACE_FOLDER__=<IDE project root>
__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__=<IDE project root>
__ONEWORKS_PROJECT_CLIENT_BASE__=/ui
__ONEWORKS_PROJECT_CLIENT_MODE__=static
__ONEWORKS_PROJECT_SERVER_HOST__=127.0.0.1
__ONEWORKS_PROJECT_SERVER_PORT__=<free local port>
__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__=false
```

每个 IDE project 有独立本地 server、端口、数据目录和日志目录。端口由插件动态分配；如果启动时出现端口竞态，插件会换端口重试。

## 兼容版本与 IDE 类型

插件声明 `since-build="243"`，并且只依赖 `com.intellij.modules.platform`。这意味着它面向 IntelliJ Platform 2024.3 或更新版本的 JetBrains IDE，不只限于 IntelliJ IDEA；WebStorm 2024.3+ 也属于预期兼容范围。

当前 CI 使用 IntelliJ IDEA 2024.3.6 作为构建和结构验证目标。其他 JetBrains IDE 产品还没有接入独立 verifier job；如果某个 IDE runtime 不提供 JCEF，插件会在 tool window 内提供外部浏览器入口。

## 本地开发覆盖

如果要让插件启动本地 checkout 或自定义 wrapper，可在启动 IDE 前设置：

```bash
export ONEWORKS_IDEA_BOOTSTRAP_COMMAND="pnpm exec oneworks"
```

该命令会以当前 IDE project 根目录作为工作目录执行，插件会自动追加 `web` 和必要参数。

如需完全接管启动命令，可设置：

```bash
export ONEWORKS_IDEA_SERVER_COMMAND="npx oneworks web"
```

完整覆盖命令需要自行保证 server 会监听插件注入的端口，或者显式使用 `oneworks web` 的 `--host / --port / --base / --workspace` 参数。

## 构建

```bash
cd apps/idea-plugin
gradle runIde
gradle buildPlugin
gradle verifyPluginStructure
```

本地构建默认以 IntelliJ IDEA 2024.3.x 作为 Gradle target platform，要求 Gradle 9.0+。工程已配置 Foojay toolchain resolver 与 Java 21 toolchain，本机没有 Java 21 时 Gradle 可以自动拉取对应 toolchain。
