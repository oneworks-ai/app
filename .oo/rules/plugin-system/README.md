---
alwaysApply: false
description: 插件系统规范总览：核心模型、分章导航与各能力的实现状态。
---

# 插件系统规范

本目录是插件系统的**规范**（这么定的），设计论证见 RFC 0011 / 0012（为什么这么定）。

## 核心模型

One Works 是**有特权宿主 + 只能做加法的扩展**，不是"一切皆插件"。

- 宿主拥有：discovery、runtime、marketplace、HMR、权限判定、进程与生命周期
- 插件只能：往宿主开放的点位上挂东西、向其他插件贡献或调用
- 插件**不能**：创造插件、注册顶层路由、直接访问文件系统（前端）、放宽权限

四条不可协商的边界：

1. 插件不能实例化其他插件。动态插件图由宿主经 overlay 注入，发生在配置解析层。
2. 插件只能收紧权限，不能放宽。
3. 能力不支持时必须 fail loud，禁止 accepted-then-ignored。
4. `scope` 是逻辑隔离（防命名冲突），**不是安全边界**。真正的边界见 `trust.md`（待写）。

## 分章

| 章节                                     | 覆盖                                              |
| ---------------------------------------- | ------------------------------------------------- |
| `manifest.md`（待写）                    | 插件包结构、manifest 字段、入口导出约定           |
| `resolution.md`（待写）                  | 发现来源、children、scope 分配、overlay、冲突处理 |
| `lifecycle.md`（待写）                   | activate / dispose / reload / watch、失败态       |
| `context.md`（待写）                     | client / server / view 三端 ctx 的完整能力面      |
| [`communication.md`](./communication.md) | 插件间通信的三条通道及其边界                      |
| `contributions.md`（待写）               | slots、views、routes、themes、声明式渲染          |
| `events.md`（待写）                      | 事件 mode、约束、可用性分级                       |
| `trust.md`（待写）                       | 信任模型、安全边界、什么不是保证                  |
| `distribution.md`（待写）                | marketplace、安装卸载、版本、可见性与诊断         |

## 实现状态

规范同时标注**当前实现状态**。未实现的内容以 `设计中` / `缺失` 标注，不得按"已有"编写插件或引用。

| 能力                                                 | 状态               | 位置                                               |
| ---------------------------------------------------- | ------------------ | -------------------------------------------------- |
| manifest / 包结构 / 双入口                           | ✅ 已实现          | `packages/types/src/plugin.ts`                     |
| 解析、children、scope、环检测                        | ✅ 已实现          | `packages/utils/src/plugin-resolver.ts`            |
| 任务级 overlay                                       | ✅ 已实现          | `PluginOverlayConfig` + `overlaySource`            |
| client 生命周期 / watch reload                       | ✅ 已实现          | `apps/client/src/plugins/PluginProvider.tsx`       |
| extension points（含等待语义、epoch）                | ✅ 已实现          | `apps/client/src/plugins/plugin-registry.ts`       |
| plugin APIs（含挂起队列、timeout）                   | ✅ 已实现          | 同上                                               |
| 跨 scope command 调用                                | ⚠️ 已实现但未文档化 | `plugin-registry.ts:405`                           |
| UI slots / views / routes / themes                   | ✅ 已实现          | `plugin-runtime.ts`                                |
| 声明式渲染（`toolUsePresentations`）                 | ✅ 已实现          | `apps/client/src/plugins/plugin-tool-use.ts`       |
| hook 事件（14 个，跨 adapter 统一）                  | ✅ 已实现          | `packages/hooks/`                                  |
| marketplace 安装 / 卸载 / 账本                       | ✅ 已实现          | `apps/server/src/services/plugins/marketplace*.ts` |
| **`ctx.events` 通用事件 API**                        | 🚧 设计中          | RFC 0012                                           |
| **server 侧跨插件通信**                              | ❌ 缺失            | 见 [`communication.md`](./communication.md)        |
| **注册型 seam（model provider / adapter provider）** | ❌ 缺失            | RFC 0011 行动项 P2                                 |
| **视图槽（组件级贡献）**                             | ❌ 缺失，且不优先  | RFC 0011 纪律 2                                    |
| **ErrorBoundary**                                    | ❌ 缺失            | RFC 0011 行动项 P0-3                               |
| **生成式能力目录**                                   | ❌ 缺失            | RFC 0011 行动项 P0-2                               |

## 已知不一致

规范化过程中发现、尚未消解的实现与文档分歧。每条都应有对应 issue 或 RFC 待办：

1. **跨 scope command 调用未文档化。** `executeCommand` 接受 `<scope>/<id>` 形式并会 HTTP 打到目标 scope；`.oo/docs/usage/plugins/ui-runtime.md:371` 只描述了同 scope 行为。需确认是正式通道还是实现顺带，然后补文档或加限制。
2. **client 能跨插件，server 不能。** `invokeChannel` 的 scope 由宿主绑死（`runtime.ts:3519`），server 插件只能调自己的 channel。这与 RFC 0012 把插件代码收回常驻 runtime 的方向存在张力。
3. **可用性分级粒度不足。** RFC 0012 用 `both | bridge | native:<adapter>` 三级，而 [`hooks/events.md`](../hooks/events.md) 的真实矩阵是逐 adapter 逐事件，且带 `canBlock` 维度。事件规范应以该矩阵为准。
4. **同 scope 内 command id 撞名的处理未核实。** `runtime.ts:2802` 的冲突检查针对内置 route key，同 scope 内的撞名路径待查。

## 编写规范时的约定

- 每章标注状态，不把设计当现状
- 每条限制写清楚**为什么**，或链到 RFC 的对应论证
- 矩阵类内容以代码或已有 rules 文档为准，不凭记忆写
- 与 [`hooks/events.md`](../hooks/events.md) 等既有 rules 重叠时，引用而非复制
