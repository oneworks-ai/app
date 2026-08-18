# RFC 0012: 迁移与兼容

返回入口：[RFC 0012 总览](0012-hook-plugin-convergence.md)

## 落地顺序

分五步，每步可独立评审与回滚。前两步无行为变更。

### 第 1 步：定事件词汇表（无行为变更）

产出 `packages/types` 下的事件定义：名称、mode、availability、payload schema、判定格。仅新增类型与常量，不接线。

同时产出 `scripts/gen-plugin-api.ts` 的事件部分与 `--check` 门禁（RFC 0011 行动项 P0-2）。**先有生成器再有实现**，避免定义与实现从第一天就分叉。

### 第 2 步：`ctx.events` API（无行为变更）

在 `PluginServerContext` 上实现 `define` / `on` / `dispatch` / `availability`，语义见[通用事件 API 设计](0012-hook-plugin-convergence-events-api.md)。此时尚无内置事件被 `define`，插件可用它做插件间通信。

### 第 3 步：上报器 + endpoint 解析

`oneworks-call-hook` 改为归一化上报；桌面走 workspace server，CLI 走自身。宿主 `define` 全部内置事件。

**此步开始行为变更**，需要：

- 新旧双跑一段时间（旧链仍执行，新链只上报不生效），比对两侧判定结果
- 回归用例覆盖 `builtin-permissions` 的等价性

### 第 4 步：权限收紧语义 + builtin 迁移

`tools/pre-execute` 切到 `decide`，宿主基线判定从 hook 插件形态改为运行时内置的同步判定。第三方插件的 `allow` 返回值失效（**必须报诊断，不能静默忽略** —— 纪律 4）。

### 第 5 步：旧入口下线

`<pkg>/hooks` 导出保留一个 minor 版本做兼容（经垫片映射到新 API），随后下线。

## 现有 hook 插件的迁移

### 内置

`packages/hooks/src/builtin-permissions.ts` 是宿主自己的权限执行器。它不走"迁移"路径，而是**改写为运行时内置的同步基线判定**（见[运行时与裁决语义](0012-hook-plugin-convergence-runtime.md)）。这是第 4 步的核心工作量。

### 第三方 / 一方插件

旧形态：

```js
// <pkg>/hooks
export default {
  name: 'my-plugin',
  async PreToolUse(ctx, input, next) {
    if (isDangerous(input.toolName)) {
      return { hookSpecificOutput: { permissionDecision: 'deny', ... } }
    }
    return next()
  }
}
```

新形态：

```js
// plugin.server.entry
export function activatePlugin(ctx) {
  ctx.events.on('tools/pre-execute', (payload) => {
    if (isDangerous(payload.toolName)) {
      return { decision: 'deny', reason: '...' }
    }
    return undefined // 无意见
  })
}
```

变化点：

- 入口从 `<pkg>/hooks` 移到 `plugin.server.entry`，与 server 插件同一形态
- `decide` 不再有 `next()`，返回 `undefined` 表示无意见
- ctx 从只有 `logger` 变成完整的 `PluginServerContext`（scope / options / pluginRoot / registerChannel / 常驻状态）
- **返回 `allow` 不再生效**，会得到一条诊断

### 兼容垫片

第 5 步之前，`<pkg>/hooks` 导出由宿主的兼容层加载并映射到新 API。映射规则：

| 旧                               | 新                                   |
| -------------------------------- | ------------------------------------ |
| `PreToolUse` 返回 `deny` / `ask` | `tools/pre-execute` 的 `decide` 判定 |
| `PreToolUse` 返回 `allow`        | 丢弃 + 诊断                          |
| 其余 `waterfall` 类              | 同名新事件，`next()` 语义不变        |
| `continue: false`                | 对应事件的终止语义                   |

垫片只保证**语义等价的子集**能跑，不保证全部。不能等价映射的必须报错而非静默降级。

## DSH 插件兼容垫片

目标形态：`@oneworks/plugin-dsh-compat`，让 DSH 的**纯监听型**插件在我们这里运行。

### 可行的部分

DSH 插件的典型形态：

```ts
export const name = 'my-dsh-plugin'
export const inject = ['tools']
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next) => {/* ... */})
}
```

垫片提供一个 shim `ctx`，把 `ctx.on(name, handler)` 转发到我们的 `ctx.events.on`。因为事件名对齐，大部分监听型插件的主体逻辑可以不改。

### 不可行的部分

必须在垫片文档里写清楚，避免"看起来能跑实际半残"：

| DSH 能力                                               | 垫片状态                                        |
| ------------------------------------------------------ | ----------------------------------------------- |
| `ctx.on('<对齐的事件名>')`                             | ✅ 可映射                                       |
| `ctx.logger`                                           | ✅ 可映射                                       |
| `ctx.effect()` 生命周期                                | ⚠️ 部分——映射到我们的 dispose，但无 fiber 状态机 |
| `inject` 服务依赖                                      | ⚠️ 仅当依赖的服务我们有对应物                    |
| `ctx.llm` / `ctx.subagents` / `ctx.tools` 等注册型服务 | ❌ 我们没有注册型 seam（RFC 0011 P2）           |
| `ctx.plugin()` 动态加载子插件                          | ❌ 违反 RFC 0011 纪律 1，永不支持               |
| `tools/pre-execute` 返回 `allow`                       | ❌ 我们是 `decide` 单向收紧                     |
| payload 形状（`ToolExecution` 等）                     | ⚠️ 需逐事件适配，非自动                          |

**垫片的价值判断**：它买到的是"概念可移植 + 迁移成本可控"，不是 drop-in。是否值得实现取决于 DSH 生态里有多少纯监听型插件是我们想要的——这个应在实现前做一次抽样调查，而不是先建垫片再找用户。

### 反向：让我们的插件跑在 DSH

不在本 RFC 范围。但事件名与 mode 对齐之后，反向垫片在理论上同样可行，可作为后续选项保留。

## 风险与回滚

| 风险                                   | 缓解                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| 第 3 步引入的端到端延迟超预算          | 新旧双跑期采集实测数据；超预算则先只切无返回契约的事件，`decide` 类留在旧链           |
| `builtin-permissions` 迁移后判定不等价 | 回归用例先行；双跑期比对两侧判定，不一致即阻断                                        |
| 现有插件生态被打断                     | 兼容垫片保留一个 minor 版本；下线前在 `/plugins` 详情页对使用旧入口的插件显示迁移提示 |
| 事件定义与实现漂移                     | 第 1 步先建生成器与 CI 门禁，早于实现                                                 |

每一步都可独立回滚：第 1、2 步无行为变更；第 3 步双跑期可关闭新链；第 4 步可退回 hook 形态的 builtin；第 5 步是纯删除。
