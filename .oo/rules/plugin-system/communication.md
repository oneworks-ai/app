---
alwaysApply: false
description: 插件间通信的三条通道、边界判据与当前缺口。
---

# 插件间通信

返回入口：[PLUGIN-SYSTEM.md](../PLUGIN-SYSTEM.md)

## 通道总表

| 通道                      | 方向      | 跨 scope | 有返回值 | 端              | 状态       |
| ------------------------- | --------- | -------- | -------- | --------------- | ---------- |
| extension points          | 1→N 登记  | ✅       | ❌       | client          | ✅         |
| plugin APIs               | 1→1 调用  | ✅       | ✅       | client          | ✅         |
| commands                  | 1→1 调用  | ✅       | ✅       | client → server | ⚠️ 未文档化 |
| contribution 的 `command` | 宿主中介  | ✅       | ——       | client          | ✅         |
| runtime channel           | 自己→自己 | ❌       | ✅       | server          | ✅         |
| `ctx.events`              | 1→N 派发  | ✅       | 视 mode  | 两端            | 🚧 设计中  |

## 选哪条

| 意图                                             | 用                     |
| ------------------------------------------------ | ---------------------- |
| 让别人往我这里**登记结构化贡献**，我自己读取渲染 | extension points       |
| **调用**某个特定插件拿返回值                     | plugin APIs            |
| **通知**多方 / 让多方**改写**或**收紧**          | `ctx.events`（设计中） |

一句话：extension points 是贡献登记，plugin APIs 是一对一调用，events 是一对多派发。

## Extension points

```js
ctx.extensionPoints.register({ id, title, contributionSchema })
ctx.extensionPoints.onAvailable('<scope>/<id>', point => {/* 返回 cleanup */})
ctx.extensionPoints.contribute('<scope>/<id>', contribution)
view.extensions.getContributions('<id>') // owner 在 React view 内读回
```

规则：

- 目标 id 单段视为当前 scope，两段为 `<scope>/<id>`；超过两段报诊断。
- **注册贡献必须用 `onAvailable`，不得用 `has()` 做一次性判断**——激活顺序不保证。目标已存在时 `onAvailable` 立即触发，不存在则挂起等待。
- `onAvailable` 回调返回的 cleanup 在目标扩展点卸载时由宿主执行。
- manifest 的静态 `extensionContributions` 同样经 `onAvailable` 装配，因此声明式贡献也不怕顺序。
- owner 拿到的是**数据记录**，不是可执行对象。要触发行为须经 contribution 携带的 `command`。

## Plugin APIs

```js
ctx.pluginApis.register({ id, title, inputSchema, outputSchema, handler })
await ctx.pluginApis.call('<scope>/<id>', input, { timeoutMs })
```

规则：

- handler 的 `meta` 携带 `callerScope` / `targetScope` / `apiId`，提供方据此决定是否服务。
- 目标未注册时 `call` **挂起等待**而非报错，注册时排空；支持 `timeoutMs` 与 `AbortSignal`。
- 调用方插件卸载时，其挂起的调用被 reject。
- 重复注册同一 id 报 duplicate 诊断，后者不生效。

## Commands（跨 scope 部分未文档化）

`ctx.commands.execute(commandId)` 的 scope 由宿主绑定为当前插件，但 `commandId` 接受 `<scope>/<id>` 形式：

```js
const key = commandId.includes('/') ? commandId : scopedKey(scope, commandId)
// 本地 registry 未命中 → HTTP POST /api/plugins/<targetScope>/commands/<id>
```

即**传入带 scope 的 id 即可调用其他插件的命令**。`.oo/docs/usage/plugins/ui-runtime.md:371` 只描述了同 scope 行为。

**在澄清前，新插件不应依赖这条路径**——它可能被收紧为同 scope 限定。跨插件调用请用 plugin APIs（有 schema、有超时、有 caller 身份）。

## Server 侧：当前没有跨插件通道

```
runtime.ts:3519
  invokeChannel: (channelId, invocation) =>
    this.invokeRuntimeChannel(scope, channelId, invocation)
```

scope 由宿主绑死，插件传不进去，因此 server 插件**只能调用自己的 channel**。`registerApi` 的 proxy 同样锁在 `/api/plugins/:scope/*` 下。

这是一处真实缺口：**client 能跨插件，server 不能**。RFC 0012 计划把插件代码收回常驻 runtime，届时 server 会成为主要执行端，该缺口需要一并解决。设计时应优先考虑让 `ctx.events` 覆盖 server 侧，而不是给 `invokeChannel` 开跨 scope 参数——后者会绕过 schema 与 caller 身份。

## 明确不存在的

- 插件间事件 / 广播（`ctx.events` 设计中）
- 插件间共享状态
- client `api.fetch` 跨 scope——它拒绝绝对 URL、协议相对 URL 与顶层 `/api/*`，只能访问自己 scope 下的 scoped API

## 不新增第四种原语

跨插件通信原语固定为 extension points / plugin APIs / events 三条。新需求应落到这三条之一，或走宿主中介。

`ctx.events` 不算新增——它取代 `@oneworks/hooks` 的私有中间件链，净原语数不变。论证见 RFC 0012。
