# Skills 与依赖

这页说明如何在项目里编写 One Works skill，以及如何用 `dependencies` 让一个 skill 自动带上它依赖的其他 skill。

## 基本目录

本地 skill 默认放在项目数据资产目录下：

```text
.oo/skills/<skill-name>/SKILL.md
```

最小示例：

```yaml
---
name: app-builder
description: Build the app
---

负责把需求实现成可运行的应用。
```

如果你修改过数据资产根目录，例如把 `.oo` 改成 `.oneworks`，skill 目录也会跟着变化。目录配置说明见 [数据资产目录配置](../asset-directories.md)。

## Home Skill Auto-Bridge

One Works 默认会桥接用户真实 home 下的常见 skill roots，并把它们加入统一 workspace assets。

详细的默认 roots、优先级、symlink 投影行为和 `skills.homeBridge` 配置见 [Home Skill Auto-Bridge](./skills/home-bridge.md)。

## 项目托管与 CLI

项目托管 skills、显式安装/更新、`oneworks --update-skills`、CLI 内置 skills，以及 `oneworks skills add/install/update/remove/publish` 的完整说明已经拆到单独文档：

- [项目托管与 CLI 管理](./skills/project-management.md)

## 声明依赖

在 `SKILL.md` 的 frontmatter 里写 `dependencies`：

```yaml
---
name: app-builder
description: Build the app
dependencies:
  - frontend-design
---

负责把需求实现成可运行的应用。
```

运行时选择或加载 `app-builder` 时，One Works 会把已经安装好的 `frontend-design` 一起解析出来。依赖会递归展开；如果 `frontend-design` 继续声明了自己的依赖，也会继续解析。

运行时不会自动下载缺失依赖。缺失时会报错，并提示项目维护者运行 `oneworks skills install` 或 `oneworks skills update`。

## 依赖写法

只写 skill 名称：

```yaml
dependencies:
  - frontend-design
```

这种写法会先查当前 workspace、已启用插件和已安装的项目托管依赖。本地找不到时，运行时会报错；项目维护者应在安装阶段补齐。

指定 skills source：

```yaml
dependencies:
  - anthropics/skills@frontend-design
```

也可以写成路径形式：

```yaml
dependencies:
  - anthropics/skills/frontend-design
```

多段 source 也建议优先写成 `source@skill`，例如：

```yaml
dependencies:
  - example-source/default/public@frontend-design
```

这里的 `example-source/default/public` 会在 `oneworks skills install/update` 阶段被当作完整 source path 原样传给 `skills` CLI：

```bash
skills add example-source/default/public --skill frontend-design
```

One Works 不会继续拆解 `/default/public` 的业务含义；它通常只是 skill source 里的 namespace、group、channel 或可见性路径，具体语义由 source 自己决定。

对象形式适合给单个依赖指定 source：

```yaml
dependencies:
  - name: frontend-design
    source: anthropics/skills
```

字段含义：

- `name`：依赖 skill 名称
- `source`：远程 source，格式是 `owner/repo`

## 解析与运行时行为

依赖解析顺序、runtime 不自动下载的规则、plugin 依赖安装目录、知识库里的 “Install via Skills CLI” 入口，以及父 skill 被选择后如何带出依赖，见：

- [依赖解析与运行时行为](./skills/resolution.md)

如果显式排除了某个依赖：

```json
{
  "skills": {
    "include": ["app-builder"],
    "exclude": ["frontend-design"]
  }
}
```

`frontend-design` 不会被投影到 adapter 原生 skill 目录，也不会进入 prompt skill 路由。

## Adapter 行为

依赖解析发生在统一 workspace assets 层。adapter 只消费已经展开后的 skill 列表。

常见投影位置：

- Claude Code：`<project-home>/.mock/.claude/skills`
- Codex：`<project-home>/.mock/.agents/skills` 和 `<project-home>/.mock/.codex/skills`
- Gemini：`<project-home>/.mock/.agents/skills`
- OpenCode：session 级 `OPENCODE_CONFIG_DIR/skills`

## 常见问题

如果依赖本地找不到，会报错并停止本次资产解析。项目维护者需要运行 `oneworks skills install` 或 `oneworks skills update` 补齐。

如果安装结果没有 `SKILL.md`，会报错；CLI 下载到的 skill 目录必须是一个完整 skill 快照。

如果同名 skill 同时存在于本地和插件中，本地无 scope 的唯一匹配优先；否则会提示歧义，需要改名或使用 scoped 引用。

- 同名 skill 的优先级与重复处理规则见 [Home Skill Auto-Bridge](./skills/home-bridge.md)。
