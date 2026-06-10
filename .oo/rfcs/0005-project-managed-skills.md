---
rfc: 0005
title: 项目托管 Skills
status: draft
authors:
  - Codex
created: 2026-05-13
updated: 2026-05-13
targetVersion: vNext
---

# RFC 0005: 项目托管 Skills

## Summary

OneWorks 支持由项目配置声明一组推荐或可选 remote skills，再由维护者或用户显式安装到项目目录。runtime 只消费已经安装的本地内容，不在启动时自动下载或更新。

核心结论：

- `skills` 继续是顶层数组，支持 string 和 object 写法。
- `./.oo/skills` 是默认 project skill 根目录，不需要声明。
- `skillsMeta.registries/sources` 只承载前端选择器元数据，不影响 runtime 解析。
- 默认不自动更新，安装和更新由 `oneworks skills install/update` 显式触发。
- 安装写入 `.oo/skills.lock.yaml`，记录安装路径和目录 hash。
- 更新前发现本地目录 hash 与 lockfile 不一致时终止，避免覆盖用户修改。
- plugin skill 引入的 remote dependencies 放入 `.oo/skills/.plugins`，不混入普通 project skills。
- `extend` 链路里的 `skills` 追加合并，冲突时报错。

目标是让维护者统一声明、安装和更新 remote skills，让用户可以按需安装，并用 lockfile 固化 metadata dependencies。本 RFC 不设计具体私有 source 认证流程，不在 runtime 自动下载，不把 UI 元数据当作安装规则，也不实现同一 scope 多版本隔离。

## Config Model

```yaml
skills:
  - vendor/cli-skills
  - vendor/cli-skills@1.0.27
  - source: vendor/productivity-skills
    include:
      - docs
      - sheets
    version: 2.0.0
  - source: git.example.com/team/internal-cli-skills
    registry: https://npm.internal.example.com
    include:
      - name: internal-cli
        rename: internal-cli

skillsMeta:
  registries:
    - https://npm.internal.example.com
  sources:
    - https://skills.example.com
    - git.example.com/team/internal-cli-skills
```

字段语义：

- `skills`: 项目声明的推荐或可选 remote skills。
- `source`: skill 来源，由 source adapter 解析。
- `version`: source 或 package 版本。
- `registry`: 仅作用于当前 skill 声明；未配置时使用默认 npm 行为。
- `include`: collection 中要安装的 skills；`"*"` 表示全部。
- `rename`: 安装后的本地目录名，也是 runtime 暴露的本地 skill 名。
- `skillsMeta.registries`: 前端候选 npm registry。
- `skillsMeta.sources`: 前端候选 skill source。

`skills` 是声明清单，不是 runtime 加载清单。只有已经安装到 `.oo/skills` 的 skill 才会被 runtime 加载。

## Extend Semantics

`extend` 中的 `skills` 追加合并：

```yaml
# base
skills:
  - vendor/base-skills@base-review
```

```yaml
# project
extend: ./base.yaml
skills:
  - vendor/project-skills@project-review
```

最终等价于：

```yaml
skills:
  - vendor/base-skills@base-review
  - vendor/project-skills@project-review
```

重复声明处理：

- 完全相同的声明视为幂等，静默去重。
- 同一本地 skill name 指向同一 source/registry 且版本兼容时，只安装一份。
- 同一本地 skill name 指向不同 source/registry 时终止安装。
- 同一本地 skill name 的版本约束不兼容时终止安装。

来自 extend 的声明安装到 `.oo/skills/.extends/<extend-id>/...`，runtime 再按本地 skill name 聚合到 adapter 可见目录，避免项目根目录被继承配置的 collection 展平污染。

## CLI Flow

常用命令：

```bash
oneworks skills install
oneworks skills install docs
oneworks skills update
```

安装行为：

- 读取合并后的项目配置。
- 下载声明的 project skills。
- 解析已安装或刚下载 skill 的 `SKILL.md` metadata dependencies。
- 递归安装 dependency closure。
- 普通 project scope 写入 `.oo/skills/<name>` 或 `.oo/skills/.extends/<extend-id>/...`。
- plugin dependency scope 写入 `.oo/skills/.plugins/<plugin-instance>/<name>`。
- 写入 `.oo/skills.lock.yaml`。
- 清理当前 plugin graph 不再引用的 `.plugins` 托管条目。
- 不更新未被配置或依赖链引用的本地 skills。

runtime 发现声明但未安装的 skill 时，只给非阻塞提示：

```text
Declared skills are not installed: docs, sheets.
Install all declared skills: oneworks skills install
Install one skill: oneworks skills install docs
```

## Dependencies

`SKILL.md` 可以通过 metadata 声明 dependencies。install/update 会递归解析依赖 closure，但不会把传递依赖回写到项目配置。

同一 scope 内多个 dependency 指向同一本地 skill name 时：

- source 相同且 semver 兼容，合并为一份安装。
- source 不同或 semver 不兼容，终止安装并提示冲突来源。
- 循环依赖按已解析节点去重。
- 暂不做同一 scope 多版本隔离。

不同 plugin instance 是不同 scope，可以各自安装自己的依赖。

## Lockfile And Hash

`.oo/skills.lock.yaml` 记录 root skills、dependencies、plugin dependencies、安装路径和 hash。关键结构：

```yaml
version: 1
skills:
  feature-skill:
    requested: true
    installPath: .oo/skills/feature-skill
    source: vendor/feature-skills
    hash: sha256:...

pluginSkills:
  demo/shared-runtime:
    name: shared-runtime
    requested: false
    pluginInstance: demo
    installPath: .oo/skills/.plugins/demo/shared-runtime
    source: vendor/shared-skills
    hash: sha256:...
```

更新前 CLI 会按 `installPath` 重新计算目录 hash：

- hash 一致时允许覆盖更新，并写入新 hash。
- hash 不一致时终止安装或更新，提示本地 skill 已被修改。

## Frontend Boundary

前端可以使用 `skillsMeta.registries/sources` 做搜索入口、候选源提示和安装声明生成。前端不能把这些元数据自动套用到所有 skills，也不能因为 metadata 存在就自动下载。

前端可展示“声明但未安装”的状态，并提供安装命令或按钮；提示必须是非阻塞的。

## Compatibility

这是 breaking change。新配置只支持顶层 `skills` 数组，不兼容 `skills.install` 等旧格式。CLI 发现旧格式应报错并提示迁移。

当前 CLI 使用 `rename` 字段，不新增 `alias`。UI 可以把 `rename` 展示成“别名”。

## Open Questions

- string 模式是否继续沿用现有 `source@name@version` 解析。
- `oneworks skills diff` 是否需要保存远端原始包内容。
- lockfile 是否需要记录 source adapter 名称。
