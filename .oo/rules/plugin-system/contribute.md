---
alwaysApply: false
description: 贡献关系：插件交出数据、由接收方渲染或使用的全部能力。
---

# 贡献（Contribute）

返回入口：[PLUGIN-SYSTEM.md](../PLUGIN-SYSTEM.md)

**插件交出一份数据，接收方决定怎么用。** 单向，无返回值。

接收方可能是宿主（UI slots、资产目录）或另一个插件（extension points）。无论哪种，**插件都不控制最终呈现**。

## 安全分级不是一律 `none`

按[统一模型的两个正交维度](./README.md#两个正交约束维度)，贡献的 security 属性挂在**通道**上，且并非一律最弱：

| 通道                                                            | `transport`            | `security`     |
| --------------------------------------------------------------- | ---------------------- | -------------- |
| UI slots / views / routes / themes                              | `in-process`（client） | `none`         |
| 声明式渲染 `toolUsePresentations`                               | `in-process`（client） | `none`         |
| extension points                                                | `in-process`（client） | `none`         |
| **资产目录**（skills / rules / specs / entities / mcp / hooks） | 构建期投影             | **`advisory`** |

**资产是例外，必须单独对待。** `skills` / `rules` / `specs` / `entities` 进 system prompt，`mcp` 进工具集，`hooks` 进适配器的原生 hook 配置——它们直接决定模型看到什么、能调什么。

因此资产贡献受 `advisory` 约束：**必须可从 session log 重建**（model-visible ⟺ logged）。新增资产类型时，同时要有对应的 session event，否则无法复现"agent 当时为什么这么做"。

## 为什么贡献是首选形态

同一个需求若能用贡献表达，就不该用参与或提供：

- 接收方完全掌控渲染与使用，插件出错不影响宿主结构
- 数据可被 schema 校验、可被 i18n / 主题自动处理、可进能力目录
- 不需要信任插件的执行行为

`toolUsePresentations` 是这条原则的样板：**看似"必须自定义渲染"的需求，多数实际是"宿主的声明式格式不够用"**。遇到"插件要塞组件"的诉求，先问缺哪个 format。

## 向宿主贡献

### UI 贡献点

| 类型   | API                                          | 说明                                                                                                |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| slots  | `ctx.slots.register(slot, contribution)`     | `nav.items`、`nav.moreMenu`、`chat.header.actions`、`workbench.tabs`、`launcher.searchProviders` 等 |
| views  | `ctx.views.register(viewId, { renderNode })` | React view；DOM view 为兼容路径                                                                     |
| routes | `ctx.routes.register({ id, title, viewId })` | 落在 `/plugins/<scope>/<id>`                                                                        |
| themes | `ctx.themes.*`                               | 主题 token                                                                                          |

规则：

- 复用宿主 UI 必须走 `view.ui.*` 声明式组件，不得复制宿主组件 DOM
- 必须复用宿主 React 单例，不得 bundle 第二份 React
- 所有 DOM 事件、style、timer、subscription 必须在返回的 `dispose()` 里清理

### 声明式渲染描述

`toolUsePresentations` 让插件提交**结构化渲染指令**，宿主据此渲染任意工具调用（`apps/client/src/plugins/plugin-tool-use.ts`）：

```json
{
  "path": "steps",
  "title": "Steps",
  "format": "records",
  "item": {
    "titlePath": "node_id",
    "subtitlePath": "op",
    "metaPath": "context"
  }
}
```

- 输入格式封闭：`inline | text | code | list | chips | records | json`
- 结果格式：`auto | text | code | json | markdown`，另有 `mode: auto | declared | hidden` 做渐进披露
- **不允许可执行模板、任意 HTML 或插件私有 React renderer**

权限设计值得复用：`origin` 默认只能接管**自己 scope 下**的工具（经 base64 编码的 `oneworks-<scope>` 命名空间反解校验）；接管别家工具须显式 `origin: 'any'`，且匹配优先级更低（20/10 vs 40/30）。**表达力做加法，权限做减法。**

### 资产目录

manifest 的 `assets` 声明目录，宿主投影进工作区：`apps` / `rules` / `skills` / `specs` / `entities` / `mcp` / `hooks`。

插件还可依赖外部 skill 文档，经 lockfile 的 `pluginSkills` 挂到插件实例名下，标记 `plugin-skill-dependency-lock`。

## 向其他插件贡献：extension points

owner 开点、contributor 贡献、owner 自行读取渲染。

```js
// owner
ctx.extensionPoints.register({ id, title, contributionSchema })
view.extensions.getContributions('<id>') // React view 内读回

// contributor
ctx.extensionPoints.onAvailable('<scope>/<id>', point => {/* 返回 cleanup */})
ctx.extensionPoints.contribute('<scope>/<id>', contribution)
```

规则：

- 目标 id 单段视为当前 scope，两段为 `<scope>/<id>`，超过两段报诊断
- **注册贡献必须用 `onAvailable`，不得用 `has()` 做一次性判断** —— 激活顺序不保证。目标已存在时立即触发，不存在则挂起等待
- `onAvailable` 回调返回的 cleanup 在目标扩展点卸载时由宿主执行
- manifest 的静态 `extensionContributions` 同样经 `onAvailable` 装配，声明式贡献也不怕顺序
- **owner 拿到的是数据记录，不是可执行对象**。要触发行为须经 contribution 携带的 `command`（那属于[提供](./provide.md)）

## 不存在：组件级贡献

**无法把 React 组件贡献进别人的视图。** `view.extensions.getContributions()` 返回数据记录。

这是刻意的。若要开视图槽，四个前置条件（论证见 RFC 0011 纪律 2）：

1. **ErrorBoundary 先行** —— 现状 `apps/client/src/plugins/` 与 `components/plugins/` 下零个 `ErrorBoundary`，`PluginHost.tsx:275` 裸渲染。此项与视图槽无关，应独立先做
2. **挂载权归宿主** —— owner 拿到的必须是宿主包好的不透明节点，否则 contributor 代码会跑在 owner 的 viewContext 里，`view.options.update()` 会写到 owner 头上
3. **扩展点须显式声明接受视图**并携带布局约束，默认保持数据模式
4. **顺序稳定可预期** —— 按 `order` 或 `pluginScope` 字典序，不能是 Map 插入顺序

**决策顺序永远是：先扩格式词汇表 → 再把声明式渲染推广到其他槽 → 视图槽只留给真正无法声明化的场景**（自由画布、图编辑器、地图）。
