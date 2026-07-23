# Marketplace 详细示例

这页补充用户侧更完整的 plugin marketplace 配置示例，覆盖 One Works、Claude Code 与 Codex 插件源。

插件市场页默认内置 One Works、OpenAI Plugins 与 Anthropic 官方插件源；用户可以直接浏览并选择安装到当前项目或全局。官方源可以屏蔽但不能删除，也可以继续添加自定义 Git 源。知识库「技能 -> 市场」使用的是 `skillRegistries[]`，不在本页范围内。

One Works 官方源展示当前应用版本对应的可选 `@oneworks/plugin-*` 包。安装时会把缺失包下载到共享 package cache，并立即重新加载插件运行时；移除时只删除当前项目或全局的启用声明，不删除其他项目可复用的缓存包。默认内置的 Relay 不在可安装目录中；Standard Development 由 Plugin Demo 的可选 child 提供，也不再作为独立市场条目展示。

## 示例：自定义 Codex 插件源

Codex marketplace 使用仓库内的 `.agents/plugins/marketplace.json`：

```yaml
marketplaces:
  company-codex-plugins:
    type: codex
    enabled: true
    plugins:
      reviewer:
        scope: review
    options:
      source:
        source: github
        repo: acme/codex-plugins
        ref: main
```

Codex 源支持 `github`、`git` 与 `directory`。One Works 会读取每个插件的 `.codex-plugin/plugin.json`，并转换可复用的 skills、commands、agents、MCP 与 hooks。

## 示例：接入 Superpowers Marketplace

如果你想直接使用 Superpowers 维护的 Claude marketplace，可以这样配：

```yaml
marketplaces:
  superpowers-marketplace:
    type: claude-code
    enabled: true
    syncOnRun: true
    plugins:
      superpowers:
        scope: superpowers
      superpowers-chrome:
        enabled: false
    options:
      source:
        source: github
        repo: obra/superpowers-marketplace
        ref: main
```

然后安装：

```bash
oneworks plugin --adapter claude add superpowers@superpowers-marketplace
oneworks plugin --adapter claude add superpowers-developing-for-claude-code@superpowers-marketplace
oneworks plugin --adapter claude add private-journal-mcp@superpowers-marketplace
```

如果你还想装浏览器插件，也可以继续装：

```bash
oneworks plugin --adapter claude add superpowers-chrome@superpowers-marketplace
```

前提是这个 plugin 名字已经存在于该 marketplace 的 `marketplace.json` 里。

## 示例：项目内联一个最小 Marketplace

如果你不想依赖整个外部 marketplace，也可以只在项目里声明你真正要用的几个插件：

```yaml
marketplaces:
  superpowers:
    type: claude-code
    enabled: true
    plugins:
      superpowers:
        scope: superpowers
      superpowers-chrome:
        enabled: false
    options:
      source:
        source: settings
        plugins:
          - name: superpowers
            source:
              source: github
              repo: obra/superpowers
              ref: main
          - name: superpowers-chrome
            source:
              source: github
              repo: obra/superpowers-chrome
              ref: main
          - name: private-journal-mcp
            source:
              source: github
              repo: obra/private-journal-mcp
              ref: main
```

然后安装：

```bash
oneworks plugin --adapter claude add superpowers@superpowers
oneworks plugin --adapter claude add superpowers-chrome@superpowers
oneworks plugin --adapter claude add private-journal-mcp@superpowers
```

说明：

- `source: settings` 适合把项目依赖锁到你自己指定的仓库和 ref。
- 这种内联 catalog 里的 `plugins[].source` 必须写显式对象，不能写相对路径字符串。
- 相对路径插件源只适用于目录型 marketplace，因为只有目录型 marketplace 才有本地 root 可解析。

## 自动同步行为

如果你在 `marketplaces.<name>.plugins` 里声明了插件：

- 第一次 `oneworks` 创建新会话时，One Works 会自动补装缺失插件。
- `syncOnRun: true` 时，每次创建新会话前都会按 marketplace 重新同步一次。
- `resume` 不会重新同步，避免同一会话中途漂移。

## 相关文档

- [OpenAI Plugins](https://github.com/openai/plugins)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Superpowers](https://github.com/obra/superpowers)
- [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace)
- [Superpowers Chrome](https://github.com/obra/superpowers-chrome)
