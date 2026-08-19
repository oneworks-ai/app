---
alwaysApply: false
description: 提供关系：插件挂出具名能力供他方调用，含当前 server 侧缺口。
---

# 提供（Provide）

返回入口：[PLUGIN-SYSTEM.md](../PLUGIN-SYSTEM.md)

**插件挂出一个具名能力，别人来调用，插件自己决定结果。** 三种关系里权限最强的一种——插件成为被依赖的一方。

因此提供类能力必须满足：调用方身份可见、契约可校验、超时可控、销毁可回收。

## security 边界不在通道上

按[统一模型的两个正交维度](./README.md#两个正交约束维度)，提供关系与另外两种关系有个本质差别：

**通道本身无从分级。** plugin API 与 command 的 handler 是插件自己的代码，它能做什么完全取决于**宿主给了它什么 ctx 能力**，与它把这个能力怎么暴露出去无关。给通道打 `security` 标记既不可校验也无意义——插件可以声明 `none` 然后在 handler 里做任何 ctx 允许的事。

推论：

- **提供型通道不设 `security` 字段**，`define` 时也无从校验
- 真正的约束落在 **ctx 能力面的设计**上：宿主不给的能力，插件无论如何暴露都拿不到
- 因此新增 ctx 能力比新增提供型通道更需要评审——前者扩大了所有插件的能力上界

`transport` 维度仍然适用：plugin APIs 是 `in-process`（client），commands 是 `cross-process`（client → server），channels 是 `in-process`（server）。

## Plugin APIs（client，✅）

一对一、带 schema 的调用，是**跨插件调用的首选**。

```js
ctx.pluginApis.register({ id, title, inputSchema, outputSchema, handler })
await ctx.pluginApis.call('<scope>/<id>', input, { timeoutMs })
```

规则：

- handler 的 `meta` 携带 `callerScope` / `targetScope` / `apiId`，**提供方据此决定是否服务**
- 目标未注册时 `call` **挂起等待**而非报错，注册时排空（`drainPendingPluginApiCalls`）
- 支持 `timeoutMs` 与 `AbortSignal`；调用方插件卸载时其挂起的调用被 reject
- 重复注册同一 id 报 duplicate 诊断，后者不生效

四条性质（caller 身份、schema、超时、卸载回收）正是"提供"关系该有的护栏，新增提供型能力应对齐这套。

## Commands（client → server，⚠️ 跨 scope 未文档化）

`ctx.commands.execute(commandId)` 的 scope 由宿主绑定，但 `commandId` 接受 `<scope>/<id>`：

```
plugin-registry.ts:405
  const key = commandId.includes('/') ? commandId : scopedKey(scope, commandId)
  // 本地 registry 未命中 → HTTP POST /api/plugins/<targetScope>/commands/<id>
```

即**传入带 scope 的 id 即可调用其他插件的命令**。`.oo/docs/usage/plugins/ui-runtime.md:371` 只描述了同 scope 行为。

**澄清前新插件不应依赖这条路径**——它可能被收紧为同 scope 限定。跨插件调用请用 plugin APIs：有 schema、有超时、有 caller 身份，commands 三样都没有。

command 的正当用途是**被贡献引用**：contribution 携带 `command: '<scope>/<id>'`，owner 渲染、用户点击时由宿主调用 contributor 的命令。那是宿主中介，不是插件直接互调。

## Server channels（⚠️ 只能自调）

```
runtime.ts:3519
  invokeChannel: (channelId, invocation) =>
    this.invokeRuntimeChannel(scope, channelId, invocation)
```

scope 由宿主绑死，插件传不进去，因此 **server 插件只能调用自己的 channel**。`registerApi` 的 proxy 同样锁在 `/api/plugins/:scope/*` 下。

### 这是真实缺口

**"提供"关系在 server 侧不完整：client 能跨插件，server 不能。**

RFC 0012 把"参与"收回 server 之后，server 会成为主要执行端——届时"server 插件无法向其他插件提供能力"会从边角问题变成主要障碍。

**修法不是给 `invokeChannel` 开跨 scope 参数**——那会绕过 schema 与 caller 身份，把 channel 变成没有护栏的 RPC。正确方向是把 plugin APIs 那套契约（caller 身份、schema、超时、卸载回收）平移到 server 侧。

## 注册型 seam（❌ 缺失）

插件提供一个**实现**并成为运行时的一部分，典型是 model provider、adapter provider。

当前完全没有：`packages/model-provider-catalog/src/catalog.ts` 是硬编码内置注册表，适配器是编译期内置（根 `package.json` devDependencies + 静态 import）。第三方要加只能改仓库。

**这不是遗漏，是传输形态决定的。** hook 是"每事件一次子进程往返"，对拦截型契合、对注册型不成立——LLM adapter 要维持流式连接、跨多次调用持有状态。要开注册型 seam 必须落在常驻 runtime，不是扩事件表。

上游 DSH 提供了可行形态：`SubagentProvider` 的 `start()` 只负责"怎么起、怎么说话"，真正的长连接与进程生命周期由宿主的 `ctx.subprocess` 托管。**插件提供协议适配，宿主拥有进程和生命周期。**

若要开，最该先开的是 model provider（数据面而非控制面），且必须带凭证 seam——**插件拿 ref 不拿明文 key**。属于 RFC 0011 行动项 P2，需要产品决策。

## 不新增第四种原语

提供型通道固定为 plugin APIs / commands / channels，加上未来可能的注册型 seam。新需求应落到已有通道，或改走[贡献](./contribute.md)与[参与](./participate.md)。

`ctx.events` 不算新增——它取代 `@oneworks/hooks` 的私有中间件链，净原语数不变。
