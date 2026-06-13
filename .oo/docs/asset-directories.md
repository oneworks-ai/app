# 数据资产目录配置

本文说明如何通过项目根 `.env` 调整 One Works 的项目数据资产目录，以及哪些运行态数据会被放到 home 下的 project-scoped 目录。

## 默认目录

默认情况下，项目数据资产根目录是 `./.oo/`，常见结构包括：

- `./.oo/rules`
- `./.oo/skills`
- `./.oo/specs`
- `./.oo/entities`
- `./.oo/mcp`

如果项目没有 `packages/plugins` 这类更明确的工程目录，也可以把普通本地插件放在 `./.oo/plugins/<name>`，但这只是建议放置位置；宿主不会自动扫描它，必须在 `.oo.config.json` 的 `plugins` 里显式声明。

运行态数据默认不写入工作区，而是落到 `~/.oneworks/projects/<project-key>/`：

- `logs`
- `caches`
- `.mock`
- `.local`
- `runtime`

其中 adapter-native managed plugin 的安装快照也属于运行态私有数据，会写到 project home 的 `.local/plugins/<adapter>/<slug>/install`；插件自己的运行时数据目录会写到 `.local/plugins/<adapter>/<slug>/data`。转换资产里的 `${CLAUDE_PLUGIN_*}` 占位符会在显式声明为 runtime plugin 后按当前 workspace 解析，不会把本机 home 绝对路径写进项目快照。

## Skill 依赖

完整使用说明见 [Skills 与依赖](./usage/skills.md)。

`./.oo/skills/<name>/SKILL.md` 的 frontmatter 可以声明 `dependencies`：

```yaml
---
name: app-builder
description: Build the app
dependencies:
  - frontend-design
  - anthropics/skills@frontend-design
---
```

解析规则：

- 先在当前 workspace 和已启用插件的 skills 中按名称解析。
- plugin skill 引入的远端依赖会从 `.oo/skills/.plugins` 解析。
- 默认还会桥接用户真实 home 下的常见 skill roots：`~/.agents/skills`、`~/.claude/skills`、`~/.config/opencode/skills`、`~/.gemini/skills`。
- bridge 进来的 home skill 会进入统一 workspace assets，并像项目 skill 一样参与默认选择。
- 项目 skill、插件 skill 和已安装的 dependency 都优先于同名 home skill。
- 本地找不到时，运行时会报错，不会自动下载或写 cache。
- 项目维护者可以运行 `oneworks skills install` 或 `oneworks skills update`，把项目声明和 metadata dependencies 固化到 `.oo/skills` 与 `.oo/skills.lock.yaml`。
- 如果某个 dependency 需要指定安装来源，直接把 registry 写进 skill spec：

```yaml
skills:
  - https://registry.example.com@example-source/default/public@design-review@1.0.3
```

adapter 启动时会把最终解析出的 skill 列表投影到对应原生目录。

默认运行态目录已经不在工作区内；仓库 `.gitignore` 仍保留旧版 `.oo/.mock`、`.oo/.local`、`.oo/caches` 等忽略项，用于兼容迁移期和手工调试残留。

如果要关闭 home bridge 或覆盖默认扫描根目录，可以配置：

```yaml
skills:
  homeBridge:
    enabled: false
```

```yaml
skills:
  homeBridge:
    roots:
      - ~/.agents/skills
      - /opt/team-skills
```

`roots` 只支持绝对路径或以 `~` 开头的路径；不存在的目录会被跳过。

如果你想声明一组由项目统一维护的远端 skills，可以在 `.oo.config.*` 里配置：

```yaml
skills:
  - frontend-design
  - name: design-review
    source: example-source/default/public
    rename: internal-review
```

这组 skills 会直接安装到项目 `./.oo/skills/`：

- 项目维护者运行 `oneworks skills install` 时安装缺失项
- 项目维护者运行 `oneworks skills update` 时刷新已安装项
- 普通 `oneworks` 和 server session 默认不会下载或更新
- 启动时显式传 `oneworks --update-skills` 或 API `updateSkills: true` 时，强制刷新已安装项
- `rename` 会决定本地目录名和本地 `SKILL.md` 里的 `name`

## 环境变量

可以在项目根 `.env` 中覆盖：

```dotenv
__ONEWORKS_PROJECT_BASE_DIR__=.oneworks
__ONEWORKS_PROJECT_ENTITIES_DIR__=agents
```

含义：

- `__ONEWORKS_PROJECT_BASE_DIR__`：覆盖整个项目数据资产根目录
- `__ONEWORKS_PROJECT_ENTITIES_DIR__`：只覆盖实体子目录，基于 AI 基目录继续解析

两者都支持：

- 相对项目根的目录
- 相对项目根的嵌套目录
- 绝对路径

例如：

```dotenv
__ONEWORKS_PROJECT_BASE_DIR__=.oo
__ONEWORKS_PROJECT_ENTITIES_DIR__=knowledge/entities
```

此时：

- AI 基目录会解析为 `./.oo`
- 实体目录会解析为 `./.oo/knowledge/entities`

## 影响范围

这些环境变量会影响项目数据资产的主要消费链路：

- workspace assets：`rules`、`skills`、`specs`、`entities`、`mcp`
- 项目资产目录：`rules`、`skills`、`specs`、`entities`、`mcp`、`plugins`
- home project 运行态目录：`logs`、`caches`、`.mock`、`.local`、`runtime`
- mock HOME 与 adapter 派生目录：Codex、Claude Code、OpenCode
- CLI 维护命令：`oneworks clear`、`oneworks report`
- 启动入口：CLI、server、client、hook loader、desktop、VS Code extension
- benchmark 运行时目录

其中：

- `__ONEWORKS_PROJECT_BASE_DIR__` 会影响整棵项目数据资产树
- `__ONEWORKS_PROJECT_ENTITIES_DIR__` 只影响 `entities` 的扫描与加载位置

`<project-home>/.local` 用于当前项目的私有本地数据，不应提交到 Git。

未显式设置 `DB_PATH` 时，Server 会把会话数据库放在 `~/.oneworks/projects/<project-key>/.local/server/db.sqlite`。这样同一 Git 项目的多个 worktree 共享会话与 Agent Room 状态，而不同项目不会串数据，也不会把数据库写到工作区。

当前主要用途包括：

- server 会话数据库
- adapter 多账号凭据快照
- adapter 账号的来源、auth digest 与额度快照元数据
- 只应保存在本机的认证状态或临时元数据

例如 `codex` 当前会在：

- `<project-home>/.local/server/db.sqlite`
- `<project-home>/.local/adapters/codex/accounts/<accountKey>/auth.json`
- `<project-home>/.local/adapters/codex/accounts/<accountKey>/meta.json`

保存账号快照与账号元数据。`meta.json` 里可能包含：

- 账号来源说明
- auth 摘要
- 最近一次 quota / rate-limit 快照
- quota 快照更新时间

如果当前目录是 Git worktree，adapter 账号目录会共享到主 worktree：

- 写入和导入优先落到主 worktree 对应的 `<project-home>/.local`
- 启动或账号命令会先把旧 `.oo/.local` 复制到 project home
- 读取只使用 project home 下的共享目录，不再兼容读取旧工作区目录

## 不受影响的内容

当前不会跟随这些环境变量一起变化的内容：

- `.oo.config.json` / `.oo.config.yaml` / `.oo.config.yml`
- `.oo.dev.config.*`
- `~/.oneworks/.oo.config.json`
- workspace 配置默认位于解析后的 workspace 根目录或 `./infra/` 的规则

也就是说，`__ONEWORKS_PROJECT_BASE_DIR__` / `__ONEWORKS_PROJECT_ENTITIES_DIR__` 只配置“数据资产目录”，不配置“配置文件文件名与位置”。

如果你需要改配置文件目录，应单独使用 `__ONEWORKS_PROJECT_CONFIG_DIR__`；否则配置读写会默认跟随解析后的 workspace 根目录。

## 使用建议

- 如果只是想把 `.oo` 改成别的名字，优先只配 `__ONEWORKS_PROJECT_BASE_DIR__`
- 如果只是想把 `entities` 改名，优先只配 `__ONEWORKS_PROJECT_ENTITIES_DIR__`
- 如果同时配置两者，实体目录会基于新的 AI 基目录继续拼接
- 修改 `.env` 后需要重启相关进程；只刷新前端页面不会让已有子进程重新加载目录配置
