# 插件、界面扩展与数据资产

## 两套插件体系

One Works 现在有两套并行的插件使用方式：

- 统一 One Works plugin：通过 `plugins` 配置加载 npm 包里的 `rules / skills / specs / entities / mcp / hooks`，也可以加载界面入口、前端视图、server 命令和 scoped API
- adapter 原生插件：通过 `oneworks plugin --adapter <adapter> add ...` 安装 adapter 自己的原生插件格式，再转成项目可复用的 One Works 资产

如果你要安装 Claude Code 插件、配置 marketplace，继续看 [Adapter 原生插件与 Marketplace](./native-plugins.md)。

## 安装方式

- 内置 One Works 插件会按运行时声明的版本从全局 package cache 解析；缺失时会安装到该 cache。
- 其他插件通过 npm 安装到你的项目 workspace，或使用目录路径引用；如果包解析不到，会直接报错。
- `id` 支持简写：例如配置 `logger` 时，会优先解析 `logger`，失败后再尝试 `@oneworks/plugin-logger`。

全局 package cache 默认位于 `~/.oneworks/bootstrap/npm`；如需调整根目录，可以设置 `__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__`。

示例：

```bash
pnpm add -D @oneworks/plugin-standard-dev @oneworks/plugin-logger
```

## 基本配置

默认情况下，在解析后的 workspace 根目录的 `.oo.config.json` 或 `.oo.config.yaml` 中配置 `plugins`：

```json
{
  "plugins": [
    {
      "id": "standard-dev",
      "scope": "std"
    },
    {
      "id": "logger",
      "enabled": false
    }
  ]
}
```

支持字段：

- `id`: 插件包名或简写名
- `version`: 可选。用于内置 One Works 插件的全局 package cache 版本；未配置时使用 `latest`
- `scope`: 可选。给该插件实例的资源加命名空间，避免重名
- `enabled`: 可选。默认 `true`；设为 `false` 时，该实例不会进入当前项目的有效插件图
- `watch`: 可选。开启后监听该 plugin 目录文件变更，并通过 plugin watch 通道刷新对应 runtime；`.oo/plugins.dev` 自动发现的 plugin 默认开启
- `options`: 可选。当前插件实例的配置值；插件详情页的「配置」tab 会把交互表单保存回这里
- `children`: 可选。显式启用或覆写 child plugin

## 插件实例配置

插件作者可以在 manifest 的 `config` 字段里声明配置结构。用户仍然在项目配置的
`plugins[].options` 中保存具体值；manifest 只描述这些值如何展示和编辑。

最小示例：

```json
{
  "__oneworksPluginManifest": true,
  "name": "@acme/plugin-workspace-tools",
  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "greeting": {
          "type": "string",
          "default": "Hello",
          "titleI18n": {
            "en": "Greeting",
            "zh-Hans": "问候语"
          },
          "descriptionI18n": {
            "en": "Text shown by plugin commands.",
            "zh-Hans": "插件命令展示的文本。"
          },
          "x-oneworks-ui": {
            "icon": "waving_hand",
            "placeholder": "Hello"
          }
        },
        "mode": {
          "type": "string",
          "default": "auto",
          "oneOf": [
            {
              "const": "auto",
              "titleI18n": { "en": "Auto", "zh-Hans": "自动" }
            },
            {
              "const": "manual",
              "titleI18n": { "en": "Manual", "zh-Hans": "手动" }
            }
          ]
        }
      }
    }
  }
}
```

插件详情页 `/ui/plugins/<scope>?tab=config` 会读取 `config.schema` 或 `config.jsonSchema`，
把 JSON Schema 渲染成和主配置页一致的交互表单。保存时会写回当前项目配置里的同一个
plugin 实例：

```json
{
  "plugins": [
    {
      "id": "@acme/plugin-workspace-tools",
      "scope": "tools",
      "options": {
        "greeting": "Hello",
        "mode": "auto"
      }
    }
  ]
}
```

当前交互表单支持 `string`、`number` / `integer`、`boolean`、字符串数组、`enum`、
`oneOf` / `anyOf` 中的字符串 `const` 选项，以及 JSON 兜底字段。`format: "password"`、
`writeOnly: true` 或 `x-oneworks-ui.sensitive: true` 会按敏感字段展示。
需要完全控制 UI 时，也可以在 manifest 里提供 `config.uiSchema`，直接使用配置页内部的
`ConfigUiObjectSchema` 结构。

## Scope 与资源引用

- scope 完全由用户控制，不由插件作者定义。
- 如果插件配置了 `scope`，资源标识会变成 `scope/name`，例如 `std/standard-dev-flow`、`std/dev-planner`。
- 如果没有配置 `scope`，可以直接写 `name`，但只有在该类资源全局唯一时才能成功解析。
- 当本地项目资产目录中的资源和插件资源同名时，建议给插件实例增加 `scope`，避免歧义。

## Child Plugin

插件可以声明 child plugin，你也可以在配置里显式覆写：

```json
{
  "plugins": [
    {
      "id": "bundle",
      "scope": "corp",
      "children": [
        {
          "id": "review",
          "enabled": false
        },
        {
          "id": "logger",
          "scope": "corp-logger"
        }
      ]
    }
  ]
}
```

说明：

- child plugin 可以来自父插件 manifest，也可以是任意已安装依赖
- child 未显式设置 `scope` 时，会继承父实例的 `scope`
- `children[].enabled: false` 可以关闭默认激活的 child plugin

## 可加载的资产

统一插件资产支持：

- `rules`
- `skills`
- `specs`
- `entities`
- `mcp`
- `hooks`

其中 `spec` 和 `entity` 还支持在文档前置元数据里通过 `plugins: { mode, list }` 对当前任务的插件列表做 `extend` 或 `override`。

## 界面 plugin runtime

界面 plugin 继续使用同一个 `plugins` 配置和 manifest，可以提供数据资产、界面贡献、server 命令和 scoped API。详细说明拆到下面几个短文档：

- [界面 Runtime 与前端入口](./plugins/ui-runtime.md)
- [Server 入口、插件商店与调试](./plugins/server-runtime.md)
- [资产目录与 Adapter 兼容](./plugins/assets-and-adapters.md)
