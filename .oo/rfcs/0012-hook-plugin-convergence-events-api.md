# RFC 0012: 通用事件 API 设计

返回入口：[RFC 0012 总览](0012-hook-plugin-convergence.md)

本章设计 `ctx.events` —— 插件系统的通用事件派发 API。设计参照 Cordis 的多 mode 事件模型（`cordiverse/cordis@f46ae95` 的 `packages/core/src/events.ts`），但在三处刻意收窄。

## 这不是新增原语，是收敛

RFC 0011 纪律 1 的配套约定是"不新增第三种跨插件通信原语"。本章不违反该约定，因为 `ctx.events` **取代**而非新增：

| 现状                                                    | 收敛后                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `@oneworks/hooks` 的私有 koa 中间件链                   | `ctx.events` 的 `transform` / `decide` mode            |
| 插件间通知（当前不存在，只能借 `pluginApis.call` 假装） | `ctx.events` 的 `notify` mode                          |
| `pluginApis.register/call`                              | **保留不动** —— 它是 1:1 有返回值的 RPC，不是事件      |
| `extensionPoints.register/contribute/getContributions`  | **保留不动** —— 它是结构化贡献 registry，不是 dispatch |

净效果是原语数量不变：hook 那套私有链被通用事件取代，`pluginApis` 与 `extensionPoints` 各司其职。

## Cordis 的五个 mode，我们取三个

Cordis `EventsService` 提供 `emit` / `parallel` / `serial` / `bail` / `waterfall`（`packages/core/src/events.ts:19-32`）。逐条评估：

| Cordis mode                    | 我们的结论                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `emit`（同步 fire-and-forget） | **不可用**。Cordis 单进程内同步派发；我们跨 client / server / 上报器三处，所有派发必须异步 |
| `parallel`（await 全部）       | **并入 `notify`**。"派发方要不要等"是调用点的事，不该是事件定义的属性                      |
| `serial`（顺序，无 `next()`）  | **并入 `notify`**，用 dispatch 选项控制 fail-fast                                          |
| `waterfall`（链式改写）        | **保留**，改名 `transform`                                                                 |
| `bail`（首个非空返回胜出）     | **不采用**，用 `decide` 取代。理由见下                                                     |

### 为什么不要 `bail`

`bail` 的语义是"第一个返回非空值的监听器胜出并短路"。在可信插件场景（Cordis / DSH 的前提是插件等同 shell 权限）这没问题；在 marketplace 分发场景下它是提权通道——**任何第三方插件都能抢占一个宿主关心的决策**，且抢占是静默的。

替代方案 `decide` 把"只能收紧"编码进 dispatch 语义本身，而不是指望每个事件的实现自觉。

## 三个 mode

### `notify` —— 通知

```ts
type NotifyListener<P> = (payload: P) => void | Promise<void>
```

监听器互相独立，任一失败不影响同侪，不影响派发结果。派发方通过选项决定是否等待全部完成。

用于：状态变更广播、审计、遥测、UI 更新。

### `transform` —— 链式改写

```ts
type TransformListener<P> = (
  payload: P,
  next: (payload: P) => Promise<P>
) => Promise<P>
```

顺序执行，**必须调 `next()`**，不调即短路整条链。每个监听器可在 `await next()` 前后改写 payload。

这就是现有 hook chain 的语义，等价于 Cordis 的 `waterfall`。

用于：system prompt 组装、上下文注入、请求改写。

### `decide` —— 单向收紧的裁决

```ts
type DecideListener<P, D> = (
  payload: P
) => D | undefined | Promise<D | undefined>
```

**不是链式。** 所有监听器并行拿到同一份 payload，各自独立给出判定，宿主按事件定义的**收紧格**（meet）合并。返回 `undefined` 表示"无意见"。

关键性质：

- **合并结果不可能比宿主基线更宽松。** 宿主判定是格的上界，插件只能向下拉。
- **超时 = 无意见。** 慢插件不会拖垮 agent，也不会静默放宽（基线仍在）。
- **顺序无关。** 合并是可交换的，因此不存在"谁先注册谁赢"的隐式依赖。

事件定义必须声明判定格。以工具权限为例：

```
allow ⊐ ask ⊐ deny
```

宿主给 `allow`、插件 A 给 `ask`、插件 B 无意见 → 结果 `ask`。宿主给 `deny`、插件给 `allow` → 结果仍是 `deny`（`allow` 在格中不低于 `deny`，取 meet 后不变）。

用于：权限裁决、内容策略、合规拦截。

**`decide` 是本设计相对 Cordis 的主要改进**，它让"能力做加法、权限做减法"从口头约定变成 dispatch 语义强制。

## API 形状

mode 声明在**事件定义**上，不在派发调用点。理由：定义方知道该事件如何派发，调用方不该能改；订阅方从定义即可知道自己的契约（要不要 `next`、能不能否决）；且定义可被生成进能力目录。

```ts
// 定义（宿主或插件，事件 id 为 <scope>/<name>）
ctx.events.define({
  name: 'before-save',
  mode: 'transform',
  payload: payloadSchema,
  result: resultSchema,
  summary: '保存前改写文档内容'
})

// 订阅（任意插件）
const off = ctx.events.on('demo/before-save', async (payload, next) => {
  const result = await next({ ...payload, content: rewrite(payload.content) })
  return result
})

// 派发（仅定义方 scope 可派发）
const output = await ctx.events.dispatch('demo/before-save', payload)

// 能力查询
ctx.events.availability('agent/request') // 'both' | 'bridge' | 'native:<adapter>'
```

### 约束

- **派发权归定义方。** 只有定义该事件的 scope 能 `dispatch`，否则第三方可以伪造宿主事件。
- **`decide` 事件的定义必须带判定格**，否则 `define` 失败（fail loud，纪律 4）。
- **订阅不支持的事件必须报诊断**，不得静默不触发。可用性经 `availability()` 查询。
- **`transform` 监听器不调 `next()` 即短路** —— 这是刻意保留 Cordis 的语义，但必须在文档中明写，且短路事件要进诊断（避免"某插件悄悄吃掉了整条链"）。
- **顺序契约用显式 priority**，不用 Cordis 的 `prepend` 布尔。`notify` 顺序无关；`transform` 按 priority 升序；`decide` 顺序无关（合并可交换）。宿主内置监听器占用保留的 priority 段，第三方无法插到它前面。

## 与现有原语的边界

新人最容易混淆的是"什么时候用 events，什么时候用 pluginApis"。判据：

| 场景                                 | 用什么                 |
| ------------------------------------ | ---------------------- |
| 我要**通知**别人发生了什么           | `events` + `notify`    |
| 我要让别人**改写**我的数据           | `events` + `transform` |
| 我要让别人**收紧**我的判定           | `events` + `decide`    |
| 我要**调用**某个特定插件拿返回值     | `pluginApis.call`      |
| 我要让别人**注册结构化贡献**供我读取 | `extensionPoints`      |

一句话：events 是一对多的派发，`pluginApis` 是一对一的调用，`extensionPoints` 是贡献登记。

## Hook 事件是内置事件集

收敛后，[事件词汇表](0012-hook-plugin-convergence-events.md)里的全部事件都是 `ctx.events` 的内置定义（由宿主 `define`，可用性按 source 分级）。插件订阅它们和订阅其他插件的事件走同一套 API，不存在"hook 插件"这个独立形态。

原 mode 词汇的映射：

| 事件词汇表中的 mode | 本章 mode                              |
| ------------------- | -------------------------------------- |
| `waterfall`         | `transform`                            |
| `emit`              | `notify`                               |
| `serial`            | `notify`（dispatch 时 fail-fast）      |
| `parallel`          | `notify`（dispatch 时 await all）      |
| ——                  | `decide`（权限类事件专用，DSH 无对应） |

据此，词汇表中 `tools/pre-execute` 标为 **`decide`** 而非 DSH 的 `waterfall`——它在我们这里是权限裁决而非数据改写。这是与 DSH 唯一的 mode 分歧，源于信任模型不同，兼容垫片需显式处理（见[迁移与兼容](0012-hook-plugin-convergence-migration.md)）。
