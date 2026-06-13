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

另外，当前已支持一条 adapter-native 插件安装链路：

- `claude-code`: 支持 Claude 原生插件安装与 marketplace 解析，One Works 会自动处理 adapter 原生运行时的兼容接入
- `claude-code`: 还支持在 `marketplaces.<name>.plugins` 里声明项目默认插件，`oneworks` 创建新会话时会自动补装或同步

当前还未接入：

- Codex 原生 plugin format 安装链路
- OpenCode 原生 plugin marketplace 安装链路

也就是说，同一个 One Works 插件可以同时服务 `claude-code`、`codex`、`opencode`；如果你安装的是 Claude 原生插件，One Works 会在 Claude adapter 下自动接入原生能力。需要把转换后的 `oneworks/` 目录作为 One Works runtime plugin 加载时，应在 `plugins` 里显式声明对应目录。

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
