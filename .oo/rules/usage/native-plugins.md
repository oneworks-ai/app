# Adapter 原生插件架构

返回入口：[USAGE.md](../USAGE.md)

这页只讲 adapter-native 插件在 One Works 里的角色、边界和运行方式；具体安装与配置方式见 [使用说明](../../docs/usage/native-plugins.md)。

## 定位

adapter-native 插件不是顶层 `plugins` 里的统一 One Works 插件。

它的目标是：

- 接住 adapter 自己的原生插件格式
- 把可复用能力转进项目统一资产层
- 在运行时把原生资产放到 adapter 能识别的位置并启用

## 分层

这套能力分成三层：

1. `adapter installer`
   负责理解某个 adapter 的原生插件格式、安装源和 marketplace 语义。
2. `managed plugins`
   负责把安装结果物化到 project home 私有目录，并记录托管元数据。
3. `adapter runtime`
   负责在任务启动前把项目里的原生资产同步到 adapter 运行环境，例如 mock home 或 session cache。

## 生命周期

### 1. 安装

执行 `ow plugin --adapter <adapter> add ...` 时：

- 先由 adapter installer 解析 source
- 再把原生插件快照安装到 project home 的 `.local/plugins/<adapter>/<slug>/install/native`
- 把可转换的能力转到 `.local/plugins/<adapter>/<slug>/install/oneworks`
- 插件运行时数据目录落到 `.local/plugins/<adapter>/<slug>/data`
- 转换后的资产保留 `${CLAUDE_PLUGIN_*}` 占位符；当该 `oneworks` 目录被显式声明为 runtime plugin 时，由 workspace asset 投影和 hook runtime 在运行时解析，避免把本机 home 绝对路径固化到项目资产
- 写入 `.oneworks-plugin.json`，作为后续同步和运行时加载的记录

### 2. 声明式同步

项目可以在 `marketplaces.<name>.plugins` 里声明希望默认存在的 marketplace 插件。

在 `ow run` 创建新会话时：

- 会先同步缺失或需要更新的已声明插件
- 然后再解析 workspace assets
- `resume` 不会重新同步，避免同一会话中途漂移

### 3. 运行时启用

adapter 启动任务时会读取 project home 中对应 adapter 的 managed install，并把原生插件放到 adapter 自己的生效目录中。

对 Claude 来说，目前会：

- 把项目 skills 同步到 mock home 下的 Claude skills 目录
- 把已安装的 Claude 原生插件 stage 到 session cache
- 通过 Claude 的原生启动参数启用这些插件

## 当前支持范围

- 当前完整支持的 adapter-native 插件安装链路只有 `claude-code`
- `marketplaces.<name>.plugins` 的声明式同步也只对 `claude-code` 生效
- `codex`、`opencode` 后续应复用同一套 managed plugin 规范，再各自实现 installer 和 runtime 适配

## 设计边界

- `.oo/rules` 负责说明现有架构、边界和维护约束
- `.oo/docs` 负责面向用户的具体用法、配置示例和安装说明
- 用户不需要理解原生插件的内部目录，只需要知道 One Works 会在项目侧抹平这层差异

## 继续阅读

- [使用说明](../../docs/usage/native-plugins.md)
- [Marketplace 详细示例](../../docs/usage/native-plugins/marketplaces.md)
- [插件与数据资产](../../docs/usage/plugins.md)
