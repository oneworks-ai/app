# RFC 0012: 通用事件 API 设计

返回入口：[RFC 0012 总览](0012-hook-plugin-convergence.md)

本章设计 `ctx.events` —— 插件系统的通用事件派发 API。设计参照 Cordis 的多 mode 事件模型（`cordiverse/cordis@f46ae95` 的 `packages/core/src/events.ts`），但在三处刻意收窄。

## 这不是新增原语，是收敛

RFC 0011 纪律 1 的配套约定是"不新增第三种跨插件通信原语"。本章不违反该约定，因为 `ctx.events` **取代**而非新增：

| 现状                                                    | 收敛后                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `@oneworks/hooks` 的私有 koa 中间件链                   | `ctx.events` 的 `waterfall` / `decide`                 |
| 插件间通知（当前不存在，只能借 `pluginApis.call` 假装） | `ctx.events` 的 `emit` / `parallel` / `serial`         |
| `pluginApis.register/call`                              | **保留不动** —— 它是 1:1 有返回值的 RPC，不是事件      |
| `extensionPoints.register/contribute/getContributions`  | **保留不动** —— 它是结构化贡献 registry，不是 dispatch |

净效果是原语数量不变：hook 那套私有链被通用事件取代，`pluginApis` 与 `extensionPoints` 各司其职。

## 六个 mode：Cordis 五个 + `decide`

全部保留 Cordis 的 `emit` / `parallel` / `serial` / `bail` / `waterfall`（`packages/core/src/events.ts:19-32`），命名不改，另加一个我们特有的 `decide`。

不砍 mode，改为**在事件定义上加约束**——约束可在 `define` 时机械校验，比削减词汇表更精确，也保住了与 DSH 的命名对齐。

| mode        | 语义                                | 监听器契约                      |
| ----------- | ----------------------------------- | ------------------------------- |
| `emit`      | 同步 fire-and-forget                | `(payload) => void`             |
| `parallel`  | 并发启动，await 全部                | `(payload) => Promise<void>`    |
| `serial`    | 顺序执行，后者可观察前者副作用      | `(payload) => Promise<void>`    |
| `bail`      | 首个返回非 `undefined` 者胜出并短路 | `(payload) => R \| undefined`   |
| `waterfall` | 链式改写，必须调 `next()`           | `(payload, next) => Promise<P>` |
| `decide`    | 单向收紧合并，顺序无关              | `(payload) => D \| undefined`   |

`parallel` 与 `serial` 的区别不是"派发方等不等"，而是**监听器之间能否观察到彼此的副作用**：serial 中第二个监听器跑在第一个完成之后，parallel 中两者交错。这是事件的语义属性，因此保留为独立 mode。

## 约束表

```
availability: 'in-process'   仅同一 runtime 内派发
availability: 'cross-process' 需经上报器跨进程（全部 hook 内置事件）
security: true                该事件的结果影响权限或安全边界
```

| mode        | `cross-process` | `security: true` |
| ----------- | --------------- | ---------------- |
| `emit`      | ❌ 拒绝         | ❌ 拒绝          |
| `parallel`  | ✅              | ❌ 拒绝          |
| `serial`    | ✅              | ❌ 拒绝          |
| `bail`      | ✅              | ❌ **拒绝**      |
| `waterfall` | ✅              | ❌ 拒绝          |
| `decide`    | ✅              | ✅ **唯一合法**  |

`define` 时校验，违反即失败（fail loud，纪律 4）：

- `emit` + `cross-process` → 跨进程无法同步派发
- 非 `decide` + `security: true` → 权限类事件只能用 `decide`
- `decide` 缺判定格 → 无法合并

### 为什么权限类禁用 `bail`

`bail` 是"首个返回非 `undefined` 者胜出并短路"。用于 resolver 类场景（谁能处理这个 URL、谁能解析这个文件类型）完全正当，且 `decide` 表达不了这种"首个响应者"语义。

但用于权限裁决时它是提权通道：任何第三方插件都能抢占宿主关心的决策，且抢占静默。这是**用途问题不是 mode 问题**，所以约束打在 `security: true` 这个维度上，而不是砍掉 `bail`。

## `decide` —— 我们相对 Cordis 新增的一个

```ts
type DecideListener<P, D> = (
  payload: P
) => D | undefined | Promise<D | undefined>
```

**不是链式。** 所有监听器并行拿到同一份 payload，各自独立给出判定，宿主按事件定义的**收紧格**（meet）合并。返回 `undefined` 表示"无意见"。

关键性质：

- **合并结果不可能比宿主基线更宽松。** 宿主判定是格的上界，插件只能向下拉。
- **超时 = 无意见。** 慢插件不会拖垮 agent，也不会静默放宽（基线仍在）。
- **顺序无关。** 合并可交换，不存在"谁先注册谁赢"的隐式依赖。

事件定义必须声明判定格。以工具权限为例：

```
allow ⊐ ask ⊐ deny
```

宿主给 `allow`、插件 A 给 `ask`、插件 B 无意见 → 结果 `ask`。宿主给 `deny`、插件给 `allow` → 结果仍是 `deny`。

用于：权限裁决、内容策略、合规拦截。

**这是本设计相对 Cordis 的唯一新增**，它让"能力做加法、权限做减法"从口头约定变成 dispatch 语义强制。DSH 把 `tools/pre-execute` 标为 `waterfall`（其插件等同 shell 权限，无妨），我们标为 `decide`——这是与 DSH 唯一的 mode 分歧。

## API 形状

mode 声明在**事件定义**上，不在派发调用点。理由：定义方知道该事件如何派发，调用方不该能改；订阅方从定义即可知道自己的契约（要不要 `next`、能不能否决）；且定义可被生成进能力目录。

```ts
// 定义（宿主或插件，事件 id 为 <scope>/<name>）
ctx.events.define({
  name: 'before-save',
  mode: 'waterfall',
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
- **`waterfall` 监听器不调 `next()` 即短路** —— 这是刻意保留 Cordis 的语义，但必须在文档中明写，且短路事件要进诊断（避免"某插件悄悄吃掉了整条链"）。
- **顺序契约用显式 priority**，不用 Cordis 的 `prepend` 布尔——它只能表达"最前"，无法表达多个插件之间的相对顺序。逐 mode 的顺序语义见[运行时与裁决语义](0012-hook-plugin-convergence-runtime.md)。宿主内置监听器占用保留的 priority 段，第三方无法插到它前面。

## 与现有原语的边界

新人最容易混淆的是"什么时候用 events，什么时候用 pluginApis"。判据：

| 场景                                 | 用什么                                    |
| ------------------------------------ | ----------------------------------------- |
| 我要**通知**别人发生了什么           | `events` + `emit` / `parallel` / `serial` |
| 我要让别人**改写**我的数据           | `events` + `waterfall`                    |
| 我要让别人**收紧**我的判定           | `events` + `decide`                       |
| 我要**调用**某个特定插件拿返回值     | `pluginApis.call`                         |
| 我要让别人**注册结构化贡献**供我读取 | `extensionPoints`                         |

一句话：events 是一对多的派发，`pluginApis` 是一对一的调用，`extensionPoints` 是贡献登记。

## Hook 事件是内置事件集

收敛后，[事件词汇表](0012-hook-plugin-convergence-events.md)里的全部事件都是 `ctx.events` 的内置定义（由宿主 `define`，可用性按 source 分级）。插件订阅它们和订阅其他插件的事件走同一套 API，不存在"hook 插件"这个独立形态。

因为 mode 词汇与 DSH 一致，[事件词汇表](0012-hook-plugin-convergence-events.md)中的 mode 可直接对照 DSH 的 `@mode` 标注，唯一分歧是 `tools/pre-execute`（我们 `decide`，DSH `waterfall`）——该事件 `security: true`，按约束表只能用 `decide`。兼容垫片需显式处理这一处（见[迁移与兼容](0012-hook-plugin-convergence-migration.md)）。
