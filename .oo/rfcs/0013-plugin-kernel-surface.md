# RFC 0013: 内核接口

返回：[RFC 0013 插件内核](0013-plugin-kernel.md)

内核的全部公开面是 **3 个定义函数 ＋ 6 个取用方法**。除此之外插件拿不到任何通信手段。

`Schema<T>` 的具体形式未定（见主文未决问题 1），下文按 Standard Schema 书写。

## 参与者

宿主与插件是同一个类型。

```ts
export type ParticipantTier = 'host' | 'builtIn' | 'standard'

export interface Participant {
  scope: string
  tier: ParticipantTier
}
```

`tier` 只在两处生效：`reserved` 优先级段准入（`host`），以及 ctx 构造时的首方能力门（`builtIn`）。它**不参与**任何集合的读写判定——那些由定义者归属决定。

## 集合定义

```ts
export type Transport = 'in-process' | 'cross-process'
export type Security = 'none' | 'advisory' | 'authoritative'
export type PriorityBand = readonly [min: number, max: number]

export interface CollectionDef {
  readonly key: string
  readonly definer: string
  readonly transport: Transport
  readonly security: Security
  readonly inspectable?: boolean
}

export interface RegistryDef<E> extends CollectionDef {
  readonly kind: 'registry'
  readonly entry: Schema<E>
  readonly order?: 'priority' | 'scope'
}

export interface EventDef<P, R> extends CollectionDef {
  readonly kind: 'event'
  readonly mode: DispatchMode
  readonly payload: Schema<P>
  readonly result?: Schema<R>
  readonly reserved?: PriorityBand
  readonly availability?: AvailabilityMatrix
}

export interface ApiDef<I, O> extends CollectionDef {
  readonly kind: 'api'
  readonly cardinality: 'one' | 'keyed'
  readonly input: Schema<I>
  readonly output: Schema<O>
}
```

`key` 由内核补成 `<definer>/<局部 id>`；`definer` 由内核填入调用方 scope，参与者传不进去。

`mode` 是六个派发 mode，`transport` × `mode` × `security` 的合法组合在 `define` 时机械校验，见 [`participate.md`](../rules/plugin-system/participate.md)。`availability` 引用 [`hooks/events.md`](../rules/hooks/events.md) 的逐 adapter 矩阵，不另造分级。

## 参与者接口

```ts
export interface WriteOptions {
  readonly priority?: number
}

export interface InvokeOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface KernelCtx {
  readonly self: Participant

  // 定义：调用者占单端
  defineRegistry<E>(spec: DefineRegistry<E>): RegistryDef<E>
  defineEvent<P, R>(spec: DefineEvent<P, R>): EventDef<P, R>
  defineApi<I, O>(spec: DefineApi<I, O>): ApiDef<I, O>

  // 多端写入：任何参与者
  contribute<E>(def: RegistryDef<E>, entry: E, opts?: WriteOptions): Disposable
  on<P, R>(
    def: EventDef<P, R>,
    listener: Listener<P, R>,
    opts?: WriteOptions
  ): Disposable

  // 单端：仅定义者
  read<E>(def: RegistryDef<E>): readonly Entry<E>[]
  emit<P, R>(def: EventDef<P, R>, payload: P): Promise<R>
  provide<I, O>(def: ApiDef<I, O>, handler: Handler<I, O>): Disposable

  // 多端调用：任何参与者
  invoke<I, O>(def: ApiDef<I, O>, input: I, opts?: InvokeOptions): Promise<O>
}
```

三对方法一一对应定律的两端。**违反归属时抛诊断，不静默忽略**——非定义者调用 `read` / `emit` 是错误，不是空结果。

`cardinality: 'keyed'` 时 `provide` 与 `invoke` 各多一个 `name: string` 参数，并附带 `listNames(def): readonly string[]`；此时 `provide` 从定义者独占放开为任何参与者。

## 条目与三个横切设施

设施**不在 `KernelCtx` 上**——这是整个设计的要点。它们是集合的性质，不是通道的功能。

```ts
export interface Entry<V> {
  readonly value: V
  readonly owner: Participant
  readonly priority: number
  readonly epoch: number
}
```

### 归属与回收

每个条目携带 `owner`。内核提供唯一入口：

```ts
export interface KernelInternals {
  disposeScope(scope: string): void
}
```

一次调用扫过所有集合，替掉现有的 9 份 filter。`epoch` 单调递增，reload 后陈旧回调按 epoch 丢弃——即现有扩展点 `listener.version` 的语义，提升为全集合通用。

### 等待与排空

**统一规则：写入或调用一个尚未就绪的目标时挂起，就绪时排空。**

| 场景                         | 现在                                      | 内核     |
| ---------------------------- | ----------------------------------------- | -------- |
| `contribute` 到未定义的集合  | 需手写 `onAvailable`，写错就丢贡献        | 自动挂起 |
| `invoke` 未 `provide` 的 api | `drainPendingPluginApiCalls` 单独一套实现 | 同一份   |
| `on` 未定义的事件            | 现无此语义                                | 同一份   |

`onAvailable` 因此从公开面消失。挂起受 `timeoutMs` / `signal` 约束；参与者被 dispose 时其挂起项一并 reject。

### 契约校验

三个时机，一份实现：

1. **`define` 时**校验定义自身——`transport` × `mode` × `security` 的约束表
2. **`contribute` / `provide` 时**校验条目 schema
3. **`emit` / `invoke` 时**校验 payload / input，返回时校验 result / output

handler 的 `meta` 一律携带 `callerScope` / `definer` / `key`，提供方据此决定是否服务。

## 宿主如何注册

宿主没有特殊入口，它只是第一个拿到 ctx 的参与者。

```ts
declare const kernel: Kernel
declare const hostCtx: KernelCtx

export interface HostEvents {
  readonly toolsPreExecute: EventDef<ToolCall, PermissionDecision>
}

declare const Events: HostEvents
declare function builtinPermissionDecision(
  payload: ToolCall
): PermissionDecision | undefined
```

宿主用 `hostCtx.on(Events.toolsPreExecute, builtinPermissionDecision, { priority: -1000 })` 注册基线，落在该事件 `reserved: [-1000, -1]` 段内；第三方传同样的 priority 会被内核拒绝并报诊断。

`[builtinPermissionPlugin, ...await resolvePlugins()]`（`packages/hooks/src/runtime.ts:80`）这个隐式顺序保证随之删除。

## 不属于内核的

`createContext` 是 runtime-only，签名不在 `KernelCtx` 上：

```ts
export interface Kernel {
  createContext(
    participant: Participant,
    capabilities: CapabilityGrant
  ): KernelCtx
  disposeScope(scope: string): void
}
```

`CapabilityGrant` 决定 ctx 上除通信之外还挂什么（`sessions` / `oneworksChannel` / `roomTunnel` …），由首方能力门产出。**内核不参与这个判定，也不应该参与**——通信是通信，能力是能力，见主文"内核之外的两件事"。
