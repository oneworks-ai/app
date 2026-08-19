---
alwaysApply: false
description: 插件系统规范总览：统一模型、能力矩阵、实现状态与分章导航。
---

# 插件系统规范

本目录是插件系统的**规范**（这么定的），设计论证见 RFC 0011 / 0012（为什么这么定）。

## 统一模型

插件与宿主、与其他插件之间**只有三种关系**。任何插件能力都归属且只归属其中一种。

| 关系                 | 插件做什么                                 | 谁决定结果       | 权限强度 |
| -------------------- | ------------------------------------------ | ---------------- | -------- |
| **贡献** Contribute  | 交出一份数据，别人拿去渲染或使用           | 接收方           | 最弱     |
| **参与** Participate | 在别人的流程里被回调，可观察 / 改写 / 收紧 | 宿主按 mode 合并 | 中       |
| **提供** Provide     | 挂出一个具名能力，别人来调用               | 插件自己         | 最强     |

判据是**谁拥有结果**：贡献交出数据、接收方决定怎么用；参与在既定流程里插一脚、宿主决定怎么合并；提供是插件成为被依赖的一方、它自己说了算。

三者互斥且完备。**新能力必须先归类，归不进去说明模型有问题，需要先改模型而不是加第四类。**

正交的两个维度：

- **在哪儿跑**：client（浏览器/渲染进程）、server（常驻运行时）、上报器（`oneworks-call-hook` 子进程）
- **谁触发**：用户、agent、宿主、另一个插件

## 两个正交约束维度

三种关系回答"谁拥有结果"。**每条通信通道还必须声明两个正交属性**，它们共同决定哪些形态合法。

### `transport` —— 传输可达性

| 值              | 含义                                            |
| --------------- | ----------------------------------------------- |
| `in-process`    | 仅同一 runtime 内派发                           |
| `cross-process` | 需跨进程（上报器 ↔ server，或 client ↔ server） |

跨进程通道**不得使用同步派发**。理由是语义冗余而非技术限制：跨进程后同步派发的三条价值（无调度开销、同栈异常传播、无交错）全部失效，它退化成"阻塞的通知"，而那已有对应形态。

### `security` —— 安全分级

| 值              | 含义                                                                | 约束                      |
| --------------- | ------------------------------------------------------------------- | ------------------------- |
| `none`          | 不影响权限，也不影响模型可见内容                                    | 无                        |
| `advisory`      | 影响**模型可见内容**（system prompt、工具集、上下文），但不直接授权 | 必须可从 session log 重建 |
| `authoritative` | 直接产生**权限判定**                                                | 只能单向收紧，不得放宽    |

### 三种关系上的落点不同

**这是关键区分，也是此前设计里漏掉的部分。**

| 关系 | security 属性挂在哪 | 说明                                                                                                                 |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 贡献 | **通道上**          | 数据本身有 security 性质。UI 贡献是 `none`；**资产目录是 `advisory`**——skills / rules 进 system prompt，mcp 进工具集 |
| 参与 | **通道上**          | 事件定义声明。`tools/pre-execute` 是 `authoritative`，故只能用 `decide`                                              |
| 提供 | **ctx 能力面上**    | 通道本身无从分级——插件自己的代码能做什么，取决于宿主给了它什么 API，不取决于它怎么暴露                               |

因此：

- **贡献与参与**的约束可在 `define` / 注册时机械校验
- **提供**的约束只能落在 ctx 能力面的设计上，见 `trust.md`（待写）

## 能力矩阵

三种关系 × 三个运行位置。空格即缺口。

|          | client                                                                                 | server                                                           | 上报器                        |
| -------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| **贡献** | slots / views / routes / themes / `toolUsePresentations` / `extensionContributions` ✅ | assets（skills / rules / specs / entities / mcp / hooks 目录）✅ | —                             |
| **参与** | ❌ 不存在                                                                              | 🚧 `ctx.events`（设计中）                                        | ⚠️ 现状：hook 插件代码在这里跑 |
| **提供** | plugin APIs ✅ / commands ✅                                                           | channels ⚠️ 只能自调 / `registerApi` ⚠️ 只能自调                   | —                             |

矩阵读出三个结论：

1. **贡献这一行是健康的**，client 与 server 各司其职。
2. **参与这一行位置错了。** 它应当在 server（常驻、有完整 ctx、能持有状态），现在却在上报器（每事件一次子进程、ctx 只有 `logger`）。RFC 0012 做的事用这个模型说就是一句话：**把"参与"从上报器搬到 server**。
3. **提供这一行 server 侧是残的。** channels 与 `registerApi` 的 scope 由宿主绑死，server 插件只能调自己的，无法向其他插件提供能力。

## 四条不可协商的边界

1. **插件不能实例化其他插件。** 动态插件图由宿主经 overlay 注入，发生在配置解析层。
2. **插件只能收紧权限，不能放宽。** 宿主基线判定是地基，插件判定取 meet。
3. **能力不支持时必须 fail loud。** 禁止 accepted-then-ignored。
4. **`scope` 是逻辑隔离，不是安全边界。** 真正的边界见 `trust.md`（待写）。

## 分章

章节按统一模型组织：三种关系各一章，其余是横切关注点。

| 章节                                 | 覆盖                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| [`contribute.md`](./contribute.md)   | 贡献：UI slots、views、routes、themes、声明式渲染、extension points、资产目录 |
| [`participate.md`](./participate.md) | 参与：事件 mode、约束表、可用性分级、裁决语义                                 |
| [`provide.md`](./provide.md)         | 提供：plugin APIs、commands、channels、注册型 seam                            |
| `manifest.md`（待写）                | 插件包结构、manifest 字段、入口导出约定                                       |
| `resolution.md`（待写）              | 发现来源、children、scope 分配、overlay、冲突处理                             |
| `lifecycle.md`（待写）               | activate / dispose / reload / watch、失败态                                   |
| `trust.md`（待写）                   | 信任模型、安全边界、什么不是保证                                              |
| `distribution.md`（待写）            | marketplace、安装卸载、版本、可见性与诊断                                     |

## 实现状态

规范同时标注**当前实现状态**。未实现的内容以 `设计中` / `缺失` 标注，**不得按"已有"编写插件或引用**。

| 能力                                    | 关系 | 状态                 | 位置                                               |
| --------------------------------------- | ---- | -------------------- | -------------------------------------------------- |
| manifest / 包结构 / 双入口              | ——   | ✅                   | `packages/types/src/plugin.ts`                     |
| 解析、children、scope、环检测           | ——   | ✅                   | `packages/utils/src/plugin-resolver.ts`            |
| 任务级 overlay                          | ——   | ✅                   | `PluginOverlayConfig` + `overlaySource`            |
| client 生命周期 / watch reload          | ——   | ✅                   | `apps/client/src/plugins/PluginProvider.tsx`       |
| UI slots / views / routes / themes      | 贡献 | ✅                   | `apps/client/src/plugins/plugin-runtime.ts`        |
| 声明式渲染 `toolUsePresentations`       | 贡献 | ✅                   | `apps/client/src/plugins/plugin-tool-use.ts`       |
| extension points（等待语义、epoch）     | 贡献 | ✅                   | `apps/client/src/plugins/plugin-registry.ts`       |
| 资产目录投影                            | 贡献 | ✅                   | `packages/workspace-assets/`                       |
| hook 事件（14 个，跨 adapter 统一）     | 参与 | ⚠️ 位置错（在上报器） | `packages/hooks/`                                  |
| `ctx.events` 通用事件 API               | 参与 | 🚧 设计中            | RFC 0012                                           |
| plugin APIs（挂起队列、timeout）        | 提供 | ✅                   | `apps/client/src/plugins/plugin-registry.ts`       |
| 跨 scope command 调用                   | 提供 | ⚠️ 已实现但未文档化   | `plugin-registry.ts:405`                           |
| server channels / `registerApi`         | 提供 | ⚠️ 只能自调           | `apps/server/src/services/plugins/runtime.ts:3519` |
| 注册型 seam（model / adapter provider） | 提供 | ❌ 缺失              | RFC 0011 行动项 P2                                 |
| marketplace 安装 / 卸载 / 账本          | ——   | ✅                   | `apps/server/src/services/plugins/marketplace*.ts` |
| ErrorBoundary                           | ——   | ❌ 缺失              | RFC 0011 行动项 P0-3                               |
| 生成式能力目录                          | ——   | ❌ 缺失              | RFC 0011 行动项 P0-2                               |

## 已知不一致

规范化过程中发现、尚未消解的实现与文档分歧：

1. **跨 scope command 调用未文档化。** `executeCommand` 接受 `<scope>/<id>` 并会 HTTP 打到目标 scope；`.oo/docs/usage/plugins/ui-runtime.md:371` 只描述了同 scope 行为。需确认是正式通道还是实现顺带。
2. **"提供"关系在 server 侧不完整。** `invokeChannel` 的 scope 由宿主绑死（`runtime.ts:3519`）。RFC 0012 把"参与"收回 server 后，server 会成为主要执行端，该缺口必须一并解决。
3. **可用性分级粒度不足。** RFC 0012 用 `both | bridge | native:<adapter>` 三级，而 [`hooks/events.md`](../hooks/events.md) 的真实矩阵是逐 adapter 逐事件、且带 `canBlock` 维度。事件规范应以该矩阵为准。
4. **同 scope 内 command id 撞名的处理未核实。** `runtime.ts:2802` 的冲突检查针对内置 route key。

## 编写规范时的约定

- 新能力先归类到三种关系之一，归不进去先改模型
- 每章标注状态，不把设计当现状
- 每条限制写清楚**为什么**，或链到 RFC 的对应论证
- 矩阵类内容以代码或既有 rules 文档为准，不凭记忆写
- 与 [`hooks/events.md`](../hooks/events.md) 等既有 rules 重叠时引用而非复制
