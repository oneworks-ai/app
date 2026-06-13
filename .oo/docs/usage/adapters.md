# 适配器配置与多账号

本文说明 Web 配置页里的适配器配置结构，以及适配器通用多账号能力的使用方式。

## 配置入口

- Web 配置页路径：`/ui/config?tab=adapters&source=project`
- 适配器详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>`
- 账号列表页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- 账号详情页路径：`/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` 也可以切到 `global` 或 `user`，用于编辑跨项目默认值或本地适配器覆盖。

## 前端选择器

聊天输入框的适配器选择器默认展示当前应用内置支持的原生适配器：

- `claude-code`
- `codex`
- `copilot`
- `gemini`
- `kimi`
- `opencode`

这些内置适配器不需要先写入 `.oo.config.json` 才能出现在选择器里。用户选择某个适配器发起会话后，运行时会沿用适配器自己的 CLI 准备逻辑，把托管 CLI 安装到项目共享 cache；首次启动某个适配器时可能会稍慢。

没有配置 `general.defaultAdapter` 时，选择器默认选中 `codex`；用户手动切换后的本地选择仍会被保留。

如果用户在 `adapters` 配置里添加自定义适配器 key，前端会把它展示在内置适配器的下方。内置适配器的隐藏/恢复是浏览器本地偏好，只影响前端选择器，不会写入项目或用户配置文件。

## 适配器配置分组

适配器详情页默认按前端语义拆成几组，而不是把所有字段平铺在一层：

- `基础配置`
- `模型配置`
- `高阶配置`
- `账号`

其中：

- `defaultAccount` 会展示在 `基础配置` 中，并通过下拉框选择当前已发现或已配置的账号 key。
- `账号` 是独立入口，不和普通字段混在一起。
- 复杂字段会继续留在 `高阶配置` 或其子分组中，而不是堆在基础配置里。

## 通用多账号能力

适配器可以实现统一的账号目录、账号详情和账号管理动作。

当前约定的 project home 私有目录是：

```text
<project-home>/.local/adapters/<adapter>/accounts/<accountKey>/
```

常见文件包括：

- `auth.json`
  - 适配器对应账号的凭据快照
- `meta.json`
  - 账号来源、账号摘要、额度快照等本地元数据

这些文件属于当前项目的本地私有数据，不应该提交到 Git。

在 Git worktree 场景下，账号快照会共享到主 worktree：

- 新增账号、登录导入和 artifact 落盘优先写入主 worktree 对应的 `<project-home>/.local/adapters/<adapter>/accounts/`
- 读取时也优先读 project home 下的共享目录
- 如果共享目录里没有对应账号，才回退读取当前 worktree 下的旧目录

这样可以避免每新建一个 worktree 都重复登录，同时兼容历史上已经写在各个 worktree 里的本地账号快照。

## Web 配置页里的账号管理

在 `Adapters -> <adapter> -> 账号` 中：

- 根页会展示账号列表、默认账号摘要和搜索框
- 可以直接触发适配器提供的 `接入账号` 动作
- 可以在列表里把某个账号设为默认账号
- 可以删除当前 workspace 保存的账号快照
- 点进单个账号后，可以查看来源、额度摘要和账号配置字段

账号详情页里的可编辑字段来自适配器自己的 `accounts.<key>` schema。\
当前 `codex` 已经支持：

- `title`
- `description`
- `authFile`

其中：

- `description` 会用多行输入框编辑
- `authFile` 留空时，会优先读取主 worktree 对应的 `<project-home>/.local/adapters/codex/accounts/<accountKey>/auth.json`

## CLI 管理账号

当前通用入口是：

```bash
npx oneworks accounts add <adapter> [accountName]
npx oneworks accounts show <adapter> <accountName>
npx oneworks accounts remove <adapter> <accountName>
```

说明：

- `add`
  - 调用适配器暴露的接入能力
  - 如果适配器返回 `auth.json` / `meta.json` 这类 artifact，上层会自动落到 workspace 私有目录
- `show`
  - 读取适配器账号详情
  - 当前 CLI 会强制刷新一次账号详情和额度摘要
- `remove`
  - 删除当前 workspace 下保存的账号快照

## Codex 示例

`codex` 已经接入这套通用多账号能力。配置示例：

```yaml
adapters:
  codex:
    defaultAccount: work
    accounts:
      work:
        title: Work
        description: 公司账号
      personal:
        title: Personal
        authFile: /absolute/path/to/personal-auth.json
```

行为说明：

- 空项目没有 `adapters` 配置时，运行时默认使用 `codex`，不会为了启动会话主动写入 `.oo.config.json`
- 如果本机存在 `~/.codex/auth.json`，Codex 适配器会把当前登录态导入到 project home 私有目录
- 每个 Codex session 会切到隔离 HOME 运行，并在该 HOME 下挂载所选账号的 `auth.json`
- Web 模型选择器优先复用 Codex 本地模型目录：`CODEX_HOME` / `~/.codex/config.toml` 里的 `model_catalog_json`，其次是 `models_cache.json`；没有可读目录时才回退内置模型列表
- Web 配置页默认展示缓存后的额度快照；当前 Codex quota 快照默认缓存 5 分钟
- CLI `oneworks accounts show codex <account>` 会主动刷新一次最新额度信息

## Copilot 示例

`copilot` 使用官方 GitHub Copilot CLI。One Works 会把运行时配置写入 project home 的 `.mock/copilot/settings.json`，并把 CLI auth/keychain 交给官方 CLI 自己处理。

```yaml
adapters:
  copilot:
    cli:
      source: managed
      version: 1.0.36
    remote: false
    stream: true
    agent: reviewer
    agentDirs:
      - /absolute/path/to/copilot-agents
    pluginDirs:
      - /absolute/path/to/copilot-plugin
    mode: autopilot
    allowTools:
      - shell(git:*)
    denyTools:
      - shell(git push)
    allowUrls:
      - https://docs.github.com/copilot/*
    additionalDirs:
      - /absolute/path/to/shared-context
    configContent:
      askUser: false
```

行为说明：

- selected skills 会 stage 到 session 目录，并通过 `COPILOT_SKILLS_DIRS` 注入 Copilot CLI
- 任务 system prompt 会写成 session 级 custom instructions，并通过 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` 注入
- selected MCP servers 会翻译成 `--additional-mcp-config`
- `modelServices.extra.copilot` 可以配置 BYOK/provider 细节，适配器会映射为 `COPILOT_PROVIDER_*`
- hook plugins 会接入 Copilot native `PreToolUse` / `PostToolUse` / `Stop`，对应通用 bridge 事件会自动去重
- effective project / user 两层 Copilot 适配器配置会对 `cli` 与 `configContent` 做深合并，避免 user config 覆盖整块 native settings
- `mode` 会直接映射 `--mode`，并优先于 `autopilot` / plan permission；需要 autopilot 时推荐配置 `mode: autopilot` 或 `autopilot: true` 二选一

当前不实现 Copilot 多账号 API；需要登录、切换或排查账号时，使用官方 CLI 的 `/login`、`/logout`、`/user` 流程。

## 什么时候更新文档

如果你修改了下面这些行为，记得同步更新本文以及 CLI / Web 使用文档：

- 适配器配置页的分组和入口位置
- `defaultAccount` / `accounts` 的配置语义
- 账号目录结构
- CLI 子命令行为
- quota / rate-limit 的刷新和缓存策略
