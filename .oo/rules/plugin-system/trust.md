---
alwaysApply: false
description: 信任模型：真实的安全边界在哪、什么不是边界、新增 ctx 能力的评审要求。
---

# 信任（Trust）

返回入口：[PLUGIN-SYSTEM.md](../PLUGIN-SYSTEM.md)

**插件代码与宿主同 realm、同进程运行。唯一真实的能力边界是宿主给不给 ctx 能力。**

这一章托底另外三章：[README](./README.md#两个正交约束维度) 说"提供关系的约束只能落在 ctx 能力面上"，[provide.md](./provide.md#security-边界不在通道上) 说"宿主不给的能力，插件无论如何暴露都拿不到"——两句话的依据都在这里。

## 前提：没有沙箱

| 位置   | 加载方式                                                 | 插件能拿到什么                 |
| ------ | -------------------------------------------------------- | ------------------------------ |
| client | `await import(entryUrl)`（`plugin-runtime.ts:713`）      | 渲染进程完整 realm             |
| server | `await import(pathToFileURL(entry))`（`runtime.ts:482`） | Node 进程完整能力              |
| 上报器 | `oneworks-call-hook` 子进程                              | Node 完整能力，ctx 只有 logger |

三处都是宿主自己的模块图里的一次动态 import，**没有 realm 隔离、没有 VM、没有权限降级**。因此：

- client 插件可直接摸 `window` / `document` / `fetch`，绕过 ctx 调任何宿主没打算给它的东西
- server 插件可直接 `import('node:fs')`，绕过 `resolveScopedPath` 读任意文件

**规范里所有"插件不能 X"的表述，含义是"不该 X，宿主不提供 X 的通道，越界即视为破坏契约"，不是"宿主能阻止 X"。** 写规范和评审时不要把它当强制隔离引用。

## `scope` 不是安全边界

`scope` 解决的是**命名与归属**：注册表 key、路由前缀 `/plugins/<scope>/<id>`、资产投影目录、诊断归因、caller 身份（`meta.callerScope`）。

它让"谁注册的、出错该找谁"可判定，但拦不住恶意插件——同 realm 下 scope 只是个字符串。**跨插件调用的 `callerScope` 是给提供方做业务判断的信息，不是认证。**

## 真实存在的四道边界

这四道是宿主代码里可指认的、越过去需要另外的手段，不是靠约定。

### 1. ctx 能力面（最重要的一道）

`createServerContext`（`runtime.ts:3494`）按条件决定往 ctx 上挂什么。首方能力需要**三个条件同时成立**：

```
hasFirstPartyPluginCapability(instance, manifest, capability)
  === instance.sourceGroup === 'builtIn'
   && manifest.plugin.server.capabilities.includes(capability)
&& runtimeEndpoint.role === 'workspace'
```

- `sourceGroup === 'builtIn'` —— 由宿主在发现期赋值，插件无法自称（见下节）
- manifest 显式声明 —— 内置插件也要写出来，避免默认全给
- `role === 'workspace'` —— manager 端不给

当前受此门限制的能力：`oneworksChannel`、`roomTunnel`（`PluginServerCapability`）。

**这是"提供关系的 security 落在 ctx 能力面上"的具体形态：不是给通道打标记，而是控制 ctx 上有没有那个字段。**

### 2. 源分组（`PluginRuntimeSourceGroup`）

`builtIn | global | project | localDev`，在 `discovery.ts:184-201` 由**路径与包名**决定，不读 manifest：

| 值         | 判据                                                                |
| ---------- | ------------------------------------------------------------------- |
| `localDev` | 位于 `.oo/plugins.dev` 下                                           |
| `global`   | 位于全局 assets 的 `plugins` 下                                     |
| `builtIn`  | packageId 命中 `bundledImmutableTrustPluginPackageIds` 或官方内置集 |
| `project`  | 其余                                                                |

`bundledImmutableTrustPluginPackageIds` 是**硬编码的白名单**（`discovery.ts:31`），随构建产物固定，配置改不动。这是首方能力门能成立的根据。

**新增首方能力时，能力门必须复用这套判据，不得引入第二套"可信"定义。**

### 3. 路径边界

`resolveScopedPath`（`runtime.ts:3464`）：拒绝 `\0` 与绝对路径 → `path.resolve` → **两端都 `realpath`** → 比较相对路径是否逃逸。先 realpath 再比较是关键，否则符号链接可绕。

`proxyToLoopbackTarget` 同样拒绝含 `.` / `..` 段的路径。

这道边界约束的是**通道**，不是插件进程本身——server 插件直接用 `node:fs` 不受此限（见"没有沙箱"）。它的意义在于：**宿主提供的通道不会成为逃逸的便利路径**。

### 4. 网络出口边界

`registerApi` 的 `proxy.target` 必须是 loopback（`isLoopbackProxyTarget`：http/https + 回环 host），`devServer`、`serverBaseUrl` 同样校验。

转发时 `normalizeHeaders`（`proxy.ts:29`）剥掉 `authorization` / `cookie` / `proxy-authorization` 等——**宿主的凭证不会顺着插件代理流出去**。

## 另外两道：构建期与信息面

不是运行时能力边界，但同属信任模型的一部分。

- **client 源码边界**（`client-source-boundary.ts`）：构建期 rollup 插件，限制 `new URL(..., import.meta.url)` 只能引静态、未转义、在 sourceRoot 内的资源，CSS 另有校验。防的是构建产物越界引用，不防运行时行为。
- **诊断脱敏**：`privateRoots` 收集本地绝对路径，`native-host.ts` 在把诊断与插件信息转成 public 视图时按它做替换。防的是**信息泄露**，与能力无关。

CSP（`apps/client/index.html:6`）`script-src 'self' 'unsafe-inline'` **不构成插件边界**——插件产物由宿主同源提供，天然满足 `'self'`。它挡的是外部注入，不是已加载的插件。

## 三种关系上的信任落点

| 关系 | 边界在哪                                     | 可机械校验      |
| ---- | -------------------------------------------- | --------------- |
| 贡献 | 通道的数据 schema + `security` 分级          | ✅ 注册时       |
| 参与 | 事件定义的 `mode` × `transport` × `security` | ✅ `define` 时  |
| 提供 | **ctx 能力面**（有没有那个字段）             | ❌ 只能在评审时 |

前两者能在代码里卡住；**提供关系只能靠评审卡在"要不要往 ctx 上加这个字段"这一步**。所以下面这条清单是硬性的。

## 新增 ctx 能力的评审清单

新增一个 ctx 字段等于**抬高所有插件的能力上界**，比新增一个通道严重得多。逐条回答：

1. **能不能降级成贡献？** 插件交数据、宿主执行，通常能覆盖需求且不扩能力面。
2. **该不该进首方能力门？** 涉及跨会话数据、外部网络、凭证、进程控制的，默认走 `PluginServerCapability` + `builtIn` 门，而不是无条件挂在 ctx 上。
3. **凭证怎么给？** 插件**拿 ref 不拿明文**。凡是让插件直接接触 API key / token 的设计一律打回——这是 model provider seam 至今没开的主因（见 [provide.md](./provide.md#注册型-seam--缺失)）。
4. **失败怎么表现？** 不支持必须 fail loud，禁止 accepted-then-ignored。
5. **卸载怎么回收？** 能力持有的连接、订阅、子进程必须挂进 `record.disposables`。
6. **有没有绕过既有边界？** 尤其是路径边界与 loopback 限制——新能力不能成为它们的旁路。

## 什么不是保证

写规范、写文档、答疑时都不要给出以下承诺：

- ❌ 插件之间互相隔离 —— 同 realm，只是命名不同
- ❌ 恶意插件跑不了任意代码 —— 装上就等于授予了宿主进程的全部能力
- ❌ `scope` 能防越权 —— 它是归属信息，不是认证
- ❌ 超时/沙箱能兜住恶意行为 —— 超时只兜"慢"，不兜"坏"
- ❌ 权限判定不可被绕过 —— `decide` 的单向收紧保证的是**遵守契约的插件**不会放宽权限（见 [participate.md](./participate.md#decide单向收紧)），不是不守契约的插件也绕不过

**真正的信任决策发生在安装那一刻。** 因此可见性是本模型的一部分：`/plugins` 必须能看出每个插件的 `sourceGroup`、声明的 capabilities、注册了哪些通道。这属于 `distribution.md`（待写）。

## 已知缺口

1. **安装期完整性校验未确认。** `services/plugins/marketplace*.ts` 中未见 checksum 或签名校验。需在写 `distribution.md` 前核实下载与解包路径，确认是缺失还是在别处。
2. **首方能力门只覆盖 server。** client ctx 无对应分级，`sourceGroup` 在 client 侧未参与任何能力判定。
3. **ErrorBoundary 缺失。** 不是安全边界但同源——插件抛错会掀掉宿主视图（RFC 0011 行动项 P0-3）。
4. **上报器的 ctx 只有 `logger` 却有完整 Node 能力**，是"能力面收紧但没有实际约束力"的典型例证。RFC 0012 把参与关系收回 server 后这一层消失。
