---
alwaysApply: false
description: 修改配置加载、配置写回、配置页 source 选择或 global/project/user 合并语义时加载。
---

# 配置分层设计

本文档记录 One Works 当前配置系统的维护边界。面向用户的使用方式维护在 homepage docs，这里只描述实现与设计约束。

## Source 与路径

配置 source 分为三层：

- `global`：真实用户 Home 默认目录下的 `.oneworks/.oo.config.json`，用于跨项目个人默认配置。
- `project`：workspace 配置根目录下的 `.oo.config.*` 或 `infra/.oo.config.*`，用于可随项目提交的配置。
- `user`：workspace 配置根目录下的 `.oo.dev.config.*` 或 `infra/.oo.dev.config.*`，用于当前用户的本地覆盖；当前 worktree 没有本地 dev config 时，会回退到主 worktree。

全局配置目录由 `resolveGlobalConfigDir()` 解析，优先级是 `__ONEWORKS_PROJECT_REAL_HOME__`、`HOME`、`USERPROFILE`、`homedir()`。项目配置根目录由 workspace 与 `__ONEWORKS_PROJECT_CONFIG_DIR__` 决定。

## 读取与合并

每个 source 先独立解析自己的 `extend` 链，生成 `rawConfig`、`resolvedConfig` 与 `extendPaths`。跨 source 的运行时合并顺序是：

```text
globalSource.resolvedConfig < projectSource.resolvedConfig < userSource.resolvedConfig
```

`effectiveProjectConfig` 表示 `global < project` 后的项目有效配置。运行时读取项目默认值时使用它；需要写回项目文件时使用 `projectSource.rawConfig`，不要把 effective 配置当作原始项目配置。`projectConfig` 仍保留为兼容别名，但语义等同于 `effectiveProjectConfig`，新代码应显式使用 `effectiveProjectConfig`。

`mergedConfig` 表示最终生效配置，也就是 `effectiveProjectConfig < userConfig`。它只用于运行时消费和只读展示，不承担任何 source 文件写回语义。

## 关闭全局配置

配置字段 `disableGlobalConfig` 位于 root/general。它按 `global < project < user` 的普通优先级解析；最终值为 `true` 时，`globalSource` 仍可被读取和编辑，但 `globalConfig`、`effectiveProjectConfig` 与 `mergedConfig` 不应用全局层。

脚本或测试需要完全隔离真实用户全局配置时，使用 `__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__=1` 或 `loadConfig({ disableGlobalConfig: true })`。这会跳过读取 global source。`__ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__=1` 与 `disableDevConfig` 只关闭 workspace-local `.oo.dev.config.*`，不再隐式关闭 global source。

新增会影响 source 发现或开关行为的环境变量时，必须同步更新 config cache key，否则同进程内切换环境可能复用旧配置。

## 写回边界

写回操作只写用户选择的 source 文件：

- `global` 写入 `.oneworks/.oo.config.json`。
- `project` 写入 workspace `.oo.config.*`。
- `user` 写入 workspace 或主 worktree 的 `.oo.dev.config.*`。

CLI、Server route、配置页和自动写回逻辑都不能基于 `effectiveProjectConfig`、`mergedConfig` 或目标 source 的 `resolvedConfig` 重建 source 文件。权限、channels、skills、skills registry、adapter CLI version 等更新必须从目标 source 的 `rawConfig` section 出发，再写回同一个 source，避免把 global/default/user overlay 或 extend 继承值复制进当前文件。

`updateConfigFile()` 的 `section` 写入语义是“更新整个 section”。如果业务命令只改 `channels.<key>`、`adapters.<key>` 这类 map 的一个条目，调用前必须先读取目标 source 的原始 section，合成完整 section 后再写入，避免清掉同一 source 里的兄弟条目。只读展示可以读取 `resolvedConfig`，但保存草稿必须以 `rawConfig` 为基底。

`globalConfig` 表示“已应用到当前解析结果的全局层”。当 `disableGlobalConfig` 生效时，即使 `globalSource` 存在，`globalConfig` 也会是 `undefined`。因此编辑或展示 global source 本身时必须读取 `globalSource.rawConfig` / `globalSource.resolvedConfig`，不能读取 `globalConfig`。

当前不对普通配置字段做严格的 source 限制，用户可以自行决定把配置放在 global、project 或 user。App 级界面样式固定写入 global `appearance` section；Electron-only 桌面偏好由 UI 固定写入 global `desktop` section，因为这类偏好不随项目切换；最近项目列表属于运行状态，继续保存在 Electron `userData`。桌面偏好读取时可以使用 global source 的 resolved 值以支持 `extend`，保存时必须只把本次变更 patch 合并进 global raw `desktop` section。`desktop.autoUpdate`、`desktop.updateChannel` 与 `desktop.moduleUpdateChannels` 是更新配置例外，由桌面配置页、launcher 设置页或模块管理页面写入当前 workspace 的 project `.oo.config.json`；`updateChannel` 是默认更新通道，`moduleUpdateChannels` 是按模块 id 或 package name 的覆盖通道。

界面语言属于 app 级个人偏好。launcher 菜单、launcher 设置页和主配置页如果提供语言切换，都必须写入 global `general.interfaceLanguage`，不要只调用前端 i18n 临时切换当前页面状态。重置语言时应 unset global source 中的 `interfaceLanguage`，让默认语言或其它 source 语义自然生效。

## 配置页语义

`/api/config` 返回：

- `sources`：各 source 的 raw section，用于编辑。
- `resolvedSources`：各 source 展开 `extend` 后的 section，用于展示继承效果。
- `sources.merged`：最终生效 section，只读展示。

配置页的 source switch 必须影响当前 section 的读取和写回。`appearance` 作为 app 级界面样式只编辑 global source；`desktop` 面板的启动面板快捷键和图标偏好只编辑 global 桌面偏好，更新开关 `desktop.autoUpdate`、默认更新通道 `desktop.updateChannel` 与模块覆盖通道 `desktop.moduleUpdateChannels` 只编辑当前 workspace 的 project source。

`appearance` 只承载 app 级界面样式字段，例如主题色 `primaryColor`、浅色 / 深色 / 系统主题模式 `themeMode`、组件样式包 `themePack`、主题包专属配置 `themePacks` 和会话历史时间线展示模式 `historyTimelineMode`，运行时应读取 global source 的 resolved 值，不要让 project / user source 把不同 workspace 染成不同界面。主题插件可以通过客户端注册声明内置主题色；启用时该值覆盖运行时 primary color，但不能覆盖或删除已保存的 `appearance.primaryColor`，切回没有内置主题色的主题后恢复使用。每个主题的专属设置必须收敛到 `themePacks.<theme-id>`，不要继续向 `appearance` 根层追加主题私有开关。应用图标外观、图标背景、图标主题和同步系统应用图标都属于 Electron-only 桌面偏好，维护在 global `desktop` section。更新配置从当前 workspace 的 project `desktop.autoUpdate` / `desktop.updateChannel` / `desktop.moduleUpdateChannels` 读取；当前 workspace 未配置时默认自动更新开启且使用 Stable，模块更新默认继承 `desktop.updateChannel`。

主题设置 UI 由每个主题插件的 `ctx.themes.register(...)` 注册内容声明可见 tabs；tabs 只是配置能力的展示分组，不改变写回边界。默认主题是只读概览，可配置主题的颜色、布局和组件覆盖仍写入自己的 `appearance.themePacks.<theme-id>`，数值型覆盖使用 `enabled + value` 同时持久化启用状态和具体数值；主题预设值在 UI 只读，开关只控制是否应用。缺省值由该主题的运行时 normalizer 决定，不能因为 UI 没显示某个 tab 就删除同主题的其它私有字段。主题插件未安装或被禁用时保留保存值，界面按默认主题渲染；插件重新启用后恢复原设置。

重置操作按 section 维度处理。配置页或 launcher 设置页提供 reset 时，应只清理当前 section 在目标 source 中的字段或还原当前 section 的桌面偏好；不要把“重置当前 section”扩大成全局配置重置，也不要从 `mergedConfig` 反推写回内容。

`oneworks skills install/update` 没有显式传 skill 参数时，会安装已启用配置层中的声明：global 未被 `disableGlobalConfig` 关闭时包含 global source，随后包含 project 与 user source。每个 source 的 `extend` 链 skills 安装到 `.oo/skills/.extends/<source>/` 下，当前 source 的 raw skills 安装到 `.oo/skills/` 下。

## 验证要求

改动配置分层、schema、section path 或写回逻辑时，至少覆盖：

- `packages/config/__tests__/load.spec.ts`
- `packages/config/__tests__/schema.spec.ts`
- `packages/config/__tests__/sections.spec.ts`

涉及 Server/CLI 写回时，还要跑权限、channels、adapter route 或对应 CLI 测试，确认没有把 effective/merged 配置写回 source 文件。
