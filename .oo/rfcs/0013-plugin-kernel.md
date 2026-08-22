# RFC 0013: 插件内核

返回入口：[RFC 索引](../../rfc.md)

Status: 设计草案，待评审\
前置: [RFC 0011 插件扩展面盘点与边界](0011-plugin-extensibility.md)、[RFC 0012 Hook 与插件系统收敛](0012-hook-plugin-convergence.md)\
Reviewed: 2026-08-20

分章：[内核接口](0013-plugin-kernel-surface.md) · [迁移路径](0013-plugin-kernel-migration.md)

## 问题

RFC 0011 盘点了扩展面，RFC 0012 收敛了 hook，`.oo/rules/plugin-system/` 把结果写成了规范。三者都是**描述**——它们说清楚了有哪些能力、归属哪种关系、边界在哪，但没有一行代码因此变少。

实际状态是：每条通道各造了一套机制，横切能力被抄了十二遍。

在 `apps/client/src/plugins/plugin-registry.ts` 里可以逐行数出来：

| 横切能力 | 实现份数    | 位置                                                                                      |
| -------- | ----------- | ----------------------------------------------------------------------------------------- |
| 归属回收 | **9**       | 第 279–297 行，九个几乎相同的 filter，键名还不统一（`value.scope` / `value.pluginScope`） |
| 等待排空 | **2**，缺 2 | `extensionPointListeners`（epoch 版本号）、`pendingPluginApiCalls`（timer + AbortSignal） |
| 契约校验 | **1**       | 只有 plugin API 有 schema / 超时 / caller 身份                                            |

新增一条通道就要再抄一遍这三样，而且大概率漏掉其中一两样——`commands` 和 `slots` 类就是这么各缺两样的。

## 内核定律

**每个具名集合有一个「单端」和一个「多端」。定义者永远占单端。**

| 集合类型   | 单端（定义者独占） | 多端（任何参与者） | 推导出的关系 |
| ---------- | ------------------ | ------------------ | ------------ |
| `registry` | `read` 读取        | `contribute` 写入  | 贡献         |
| `event`    | `emit` 触发        | `on` 监听          | 参与         |
| `api`      | `provide` 提供     | `invoke` 调用      | 提供         |

三种关系不再是规范里规定的分类，而是**从"谁定义了这个集合"推导出来的结果**。这条定律同时给出了此前几个悬空判断的依据：

- 为什么 owner 拿到的是数据记录不是可执行对象 —— owner 在 registry 上占的是读端
- 为什么插件不能伪造 `tools/pre-execute` —— `emit` 是定义者独占，该事件由宿主定义
- 为什么 `demo` 能读 `quick-actions` 而 `demo-extension` 不能 —— 集合由 `demo` 定义

## 宿主就是定义得最多的那个参与者

宿主和插件是**同一个类型**（`Participant`），走同一组 API。宿主之所以看起来特殊，只是因为它定义了绝大多数集合，因而在绝大多数集合上占单端。

反过来也成立：`demo` 定义了 `quick-actions`，它对那个集合就是宿主。

这不是修辞。`packages/hooks/src/builtin-permissions.ts` 里宿主的权限基线已经是一个用 `definePlugin` 写的插件，走同一条链，只靠 `[builtinPermissionPlugin, ...await resolvePlugins()]` 这个数组顺序保证优先。内核把它变成一等概念：

- 宿主以 `tier: 'host'` 的普通参与者身份 `on()` 注册
- 事件定义声明 `reserved` 优先级段，内核**拒绝**非 host 参与者注册进去

数组顺序 hack 消失，"宿主基线是地基"从注释变成内核强制。

## 内核之外的两件事

六条宿主↔插件的边里，内核吸收四条（事件链、scope 命名空间、注册、权限判定），剩下两条**故意留在外面**：

1. **`ctx` 的构造。** `createContext(participant)` 是 runtime-only；插件手里的 ctx 是宿主给的，插件造不出 ctx。首方能力门（`tier === 'builtIn'` ＋ manifest 声明 ＋ `role === 'workspace'`）挂在这里，见 [`trust.md`](../rules/plugin-system/trust.md)。
2. **参与者的实例化。** 内核接收一个已解析的参与者列表，没有 `ctx.plugin()`。动态插件图仍由 overlay 在配置解析层注入。

**这两条进内核就是 Cordis。** 能力面对称 ＋ 可自举实例化 = 插件能给自己发权限，"宿主基线是地基、插件只能收紧"这条不可协商的边界就没了。我们要的是 Cordis 的**原语数量**，不是它的对称性。

## 注册型 seam 不需要新原语

model provider / adapter provider 是 `api` 的 `cardinality: 'keyed'` 形态：宿主定义、插件按名字提供、宿主按名字调用。

```ts
// 宿主定义
declare const ModelProvider: ApiDef<ModelRequest, ModelResponse>
// 插件提供其中一个名字
declare function provideAnthropic(ctx: KernelCtx): Disposable
// 宿主按名字调用
declare function callProvider(
  ctx: KernelCtx,
  name: string,
  req: ModelRequest
): Promise<ModelResponse>
```

`keyed` 时 `provide` 从"定义者独占"放开为"每个提供者占一个名字"，这是定律的自然延伸，不是例外。因此本 RFC **不包含** model provider seam 的落地（那需要凭证 seam 与产品决策，见 RFC 0011 行动项 P2），但内核不必为它改设计。

## 收益：四个已知缺口自然消失

不是"被修复"，是在新形状下不成立：

| 现有缺口                             | 在内核里                                                        |
| ------------------------------------ | --------------------------------------------------------------- |
| 跨 scope command 调用语义未定        | `command` 类型不存在，收敛进 `api`，跨 scope 是 `invoke` 的常态 |
| server channel 的 scope 被宿主绑死   | `provide` / `invoke` 与运行位置无关                             |
| `onAvailable` 必须手写、写错就丢贡献 | 等待进内核，`contribute` 到未定义的集合天然挂起安全             |
| 归属回收九份实现、键名不统一         | 一份 `disposeScope`                                             |

## 未决问题

1. **Schema 表达形式。** 现有 plugin API 用 JSON Schema，server 侧用 zod。内核需要统一形式，倾向 Standard Schema（两边都能适配）。**待定，影响接口签名。**
2. **`read` 的定义者独占是否太紧。** `/plugins` 详情页需要展示所有集合内容。倾向在定义时声明 `inspectable: true` 而不是给 host tier 开后门。
3. **`keyed` 的名字冲突。** 两个插件都 provide `'anthropic'` 时报 duplicate 诊断，语义同现有重复注册。
4. **性能。** 所有集合走一份实现后 dispatch 多一层间接。client 每帧读 slots 的路径需要 benchmark 后再决定是否加读缓存。
