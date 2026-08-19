---
alwaysApply: false
description: 参与关系：插件在宿主流程里被回调，可观察、改写或收紧。
---

# 参与（Participate）

返回入口：[PLUGIN-SYSTEM.md](../PLUGIN-SYSTEM.md)

**插件在别人的流程里被回调，宿主按 mode 合并结果。** 插件能影响流程，但不拥有结果。

## 现状：位置是错的

|                | 应当                       | 现状              |
| -------------- | -------------------------- | ----------------- |
| 插件代码跑在哪 | server 常驻运行时          | 上报器子进程      |
| 插件拿到的 ctx | 完整 `PluginServerContext` | 只有 `{ logger }` |
| 能否持有状态   | 能（常驻）                 | 契约上不能        |
| 入口           | `plugin.server.entry`      | `<pkg>/hooks`     |

RFC 0012 的全部工作用统一模型说就是一句话：**把"参与"从上报器搬到 server**。上报器降级为归一化上报，不再加载任何插件代码。

本章描述**目标形态**。当前实现见 `packages/hooks/`，迁移路径见 RFC 0012。

## 六个 mode

沿用 Cordis 命名（与 DSH 对齐，便于插件迁移），另加我们特有的 `decide`。

| mode        | 语义                                | 监听器契约                      |
| ----------- | ----------------------------------- | ------------------------------- |
| `emit`      | 同步 fire-and-forget                | `(payload) => void`             |
| `parallel`  | 并发启动，await 全部                | `(payload) => Promise<void>`    |
| `serial`    | 顺序执行，后者可观察前者副作用      | `(payload) => Promise<void>`    |
| `bail`      | 首个返回非 `undefined` 者胜出并短路 | `(payload) => R \| undefined`   |
| `waterfall` | 链式改写，必须调 `next()`           | `(payload, next) => Promise<P>` |
| `decide`    | 单向收紧合并，顺序无关              | `(payload) => D \| undefined`   |

`parallel` 与 `serial` 的区别不是"派发方等不等"，而是**监听器之间能否观察到彼此的副作用**。这是事件的语义属性，因此是两个独立 mode。

## 约束表

参与关系的 security 属性挂在**通道**上（事件定义），因此可在 `define` 时机械校验，违反即失败。通用维度定义见[统一模型](./README.md#两个正交约束维度)，下表是它在事件 mode 上的特化。

| mode        | `cross-process` | `security: true` |
| ----------- | --------------- | ---------------- |
| `emit`      | ❌              | ❌               |
| `parallel`  | ✅              | ❌               |
| `serial`    | ✅              | ❌               |
| `bail`      | ✅              | ❌               |
| `waterfall` | ✅              | ❌               |
| `decide`    | ✅              | ✅ 唯一合法      |

`security: true` 一列对应通用分级的 `authoritative`；`advisory` 级事件（改写模型可见内容但不授权，如 `system-prompt/assemble`）用 `waterfall`，但必须可从 session log 重建。

`emit` 那一列是[通用 `transport` 规则](./README.md#两个正交约束维度)"跨进程不得同步派发"在事件上的实例：跨进程的 `emit` 退化成"阻塞的通知"，而那已经叫 `serial`。该论证不依赖传输方式，即便未来把上报器换成 worker_threads 使 `Atomics.wait` 可用，结论不变。

**`bail` 禁用于权限类事件**是用途约束不是 mode 约束。`bail` 用于 resolver 场景（谁能处理这个 URL）完全正当；用于权限裁决则是提权通道，任何插件都能静默抢占宿主的决策。

## `decide`：单向收紧

所有监听器并行拿到同一份 payload，各自独立判定，宿主按事件定义的**收紧格**取 meet。返回 `undefined` 表示无意见。

以工具权限为例，格为 `allow ⊐ ask ⊐ deny`：

- 宿主 allow + 插件 deny = **deny**
- 宿主 deny + 插件 allow = **仍然 deny**
- 插件超时 = 无意见 = 按已有判定走

三条性质是推论：合并结果不可能比宿主基线宽松；超时既非 fail-open（基线仍在）也非 fail-closed（慢插件不拖垮 agent）；顺序无关（合并可交换）。

**这把"能力做加法、权限做减法"从口头约定变成 dispatch 语义强制**，与[贡献](./contribute.md)里 `toolUsePresentations` 的 `origin` 设计同源。

超时**必须产生可见诊断**。反复超时的插件应在 `/plugins` 详情页可见。

## 顺序契约

| mode        | 顺序语义                                              |
| ----------- | ----------------------------------------------------- |
| `emit`      | 按 priority 升序                                      |
| `parallel`  | 顺序无关                                              |
| `serial`    | 按 priority 升序，后者可观察前者副作用                |
| `bail`      | 按 priority 升序，首个非 `undefined` 者短路           |
| `waterfall` | 按 priority 升序；同 priority 按 scope 字典序稳定排序 |
| `decide`    | 顺序无关                                              |

**宿主内置监听器占用保留的 priority 段，第三方无法插到它前面。** 这条替代当前"靠数组第一个位置"的隐式保证（`packages/hooks/src/runtime.ts:81-89`）。

不采用 Cordis 的 `prepend` 布尔——它只能表达"最前"，两个插件都传时退化成看注册顺序。

## 可用性分级

**并非所有事件在所有 adapter 下都可用。** 权威矩阵是 [`hooks/events.md`](../hooks/events.md)：逐 adapter 逐事件标注 native / bridge / 不支持，并带 `canBlock: true|false`。

- `native` —— 上游 CLI 原生 hook 透传
- `bridge` —— 由 `packages/hooks/src/bridge.ts` 从会话消息与工具事件合成
- `canBlock: false` —— 该事件在该 adapter 下**只能观察，不能阻断**

订阅一个当前 source 不支持的事件时，宿主**必须报诊断而非静默不触发**。

**不要在事件规范里另造一套粗粒度分级。** 以 `hooks/events.md` 的矩阵为准。

## 事件词汇表

事件名采用 `namespace/kebab-verb`，与 DSH 对齐以便插件迁移。现有 14 个事件的改名映射、以及与 DSH 对照后确认的四个缺口点位（`agent/request`、`agent/request-error`、`tools/execute`、`tools/result`），见 RFC 0012 的事件词汇表章节。

事件定义必须携带：`name`、`mode`、`availability`、`security`、`payload`、`result`、`summary`。这份定义应由源码 AST 生成并接入 CI 门禁（RFC 0011 行动项 P0-2），避免与实现漂移。

## 事件流的三个消费者

统一事件流同时喂：**插件**（`ctx.events.on`）、**session log**（落实 model-visible ⟺ logged）、**UI 实时流**（`apps/server/src/services/client-events.ts` 的 `publishClientEvent`）。

三者共用同一份事件定义，不各自造一套。
