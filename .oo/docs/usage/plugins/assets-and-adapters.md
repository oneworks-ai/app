# 插件资产目录与 Adapter 兼容

## 资产细节

- [实体目录默认文件](./entity-default-files.md)
- [实体继承](./entity-inheritance.md)
- [本地私有规则](./local-rules.md)

## 本地数据资产目录

项目内置资产默认从 `./.oo/` 读取：

- `rules`
- `skills`
- `specs`
- `entities`
- `mcp`

如果你的项目不想使用默认的 `.oo` 目录，可以在项目根 `.env` 中覆盖：

```dotenv
__ONEWORKS_PROJECT_BASE_DIR__=.oneworks
```

这样本地资产会改为从 `./.oneworks/` 下读取。

如果只想改实体目录名，可以继续配置：

```dotenv
__ONEWORKS_PROJECT_ENTITIES_DIR__=agents
```

此时实体会从 `./.oneworks/agents/` 读取。`__ONEWORKS_PROJECT_ENTITIES_DIR__` 也支持嵌套路径，例如：

```dotenv
__ONEWORKS_PROJECT_ENTITIES_DIR__=knowledge/entities
```

此时实体会从 `./.oneworks/knowledge/entities/` 读取。

边界说明：

- 这里修改的是项目数据资产目录，不是配置文件位置
- `.oo.config.json` / `.oo.dev.config.*` 默认仍然放在解析后的 workspace 根目录或 `./infra/`，全局配置仍然放在 `~/.oneworks/.oo.config.json`
- 如果显式设置了 `__ONEWORKS_PROJECT_CONFIG_DIR__`，插件配置会改为从该目录读取
- 修改 `.env` 后需要重启相关进程

## 插件内资产路径

插件资产中的字符串可以使用 `${ONEWORKS_PLUGIN_ROOT}` 引用当前已解析插件的绝对根目录，使用
`${ONEWORKS_NODE_EXECUTABLE}` 引用 OneWorks 当前可靠的 Node runtime。MCP 资产应使用这些变量
定位随包发布的 Node server 入口，避免依赖会话工作目录、用户 PATH 或 workspace 的
`node_modules/.bin`：

```json
{
  "command": "${ONEWORKS_NODE_EXECUTABLE}",
  "args": ["${ONEWORKS_PLUGIN_ROOT}/bin/server.cjs"]
}
```

MCP 资产还可以显式使用 `${ONEWORKS_REAL_HOME}`。它只适用于必须与用户级 daemon、Unix socket
或原生权限责任域共享真实 HOME 的本地集成；普通 MCP 应继续使用 OneWorks 默认注入的隔离 HOME。
如果必须使用，应同时覆盖 `HOME` 与 `USERPROFILE`，避免 server 与 daemon 解析到不同目录：

```json
{
  "env": {
    "HOME": "${ONEWORKS_REAL_HOME}",
    "USERPROFILE": "${ONEWORKS_REAL_HOME}"
  }
}
```

插件资产需要读取实例配置时，应通过 `${ONEWORKS_PLUGIN_OPTION:path.to.value}` 显式声明单个值。
基础类型会转为字符串，缺失值会变为空字符串；未被资产声明的插件配置不会自动进入进程环境：

```json
{
  "env": {
    "POINTER_COLOR": "${ONEWORKS_PLUGIN_OPTION:pointer.color}"
  }
}
```

## Adapter 兼容范围

三种 adapter 都支持统一插件资产层：

- `claude-code`: 支持 prompt 资产、MCP、hooks
- `codex`: 支持 prompt 资产、MCP、hooks
- `opencode`: 支持 prompt 资产、MCP、hooks

只有 `opencode` 额外支持 native plugin overlay：

- `opencode/agents`
- `opencode/commands`
- `opencode/modes`
- `opencode/plugins`

另外，当前已支持两条 adapter-native 插件安装链路：

- `claude-code`: 支持 Claude 原生插件安装与 marketplace 解析，One Works 会自动处理 adapter 原生运行时的兼容接入
- `codex`: 支持 Codex plugin format 与 marketplace catalog；可复用的 skills、commands、agents、MCP 和 hooks 会转换到统一资产层
- 两者都支持在 `marketplaces.<name>.plugins` 里声明项目默认插件，`oneworks` 创建新会话时会自动补装或同步

当前还未接入 OpenCode 原生 plugin marketplace 安装链路。Codex 插件里的 `.app.json` 仍属于 Codex app 专属能力，不会转换成 One Works 资产。

通过 `marketplaces` 安装的 Claude Code / Codex 插件会自动进入 One Works runtime plugin 发现，不需要再把生成的 `oneworks/` 目录手工写进顶层 `plugins`。直接从路径或包安装的插件仍按顶层 `plugins` 配置显式接入。

## 示例：标准开发流插件

`@oneworks/plugin-standard-dev` 提供一组常用研发实体和统一调度 skill：

```json
{
  "plugins": [
    {
      "id": "standard-dev",
      "scope": "std"
    }
  ]
}
```

常用资源：

- `std/standard-dev-flow`
- `std/dev-planner`
- `std/dev-implementer`
- `std/dev-reviewer`
- `std/dev-verifier`
