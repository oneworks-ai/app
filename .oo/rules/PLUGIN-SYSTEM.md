---
alwaysApply: false
description: 当任务涉及插件系统的 manifest、解析装配、生命周期、ctx 能力面、插件间通信、UI 贡献、事件、信任边界或分发时加载的插件系统入口。
---

# 插件系统入口

详细规范已下沉到 [`plugin-system/README.md`](./plugin-system/README.md)。

先按任务继续阅读：

- 总览与状态图：[`plugin-system/README.md`](./plugin-system/README.md)
- 插件包与 manifest：`plugin-system/manifest.md`（待写）
- 解析与装配：`plugin-system/resolution.md`（待写）
- 生命周期：`plugin-system/lifecycle.md`（待写）
- ctx 能力面：`plugin-system/context.md`（待写）
- 插件间通信：[`plugin-system/communication.md`](./plugin-system/communication.md)
- UI 贡献：`plugin-system/contributions.md`（待写）
- 事件系统：`plugin-system/events.md`（待写）
- 信任与安全边界：`plugin-system/trust.md`（待写）
- 分发与可见性：`plugin-system/distribution.md`（待写）

相邻主题：

- hook 事件在各 adapter 的支持矩阵与 `canBlock` 语义：[`hooks/events.md`](./hooks/events.md)
- adapter 的 mock home、原生 skills、MCP：[`ADAPTERS.md`](./ADAPTERS.md)
- 配置加载与合并：[`CONFIG.md`](./CONFIG.md)

设计论证与决策依据不在本规范内，见 RFC：

- [RFC 0011 插件扩展面盘点与边界](../../rfc.md)（含七条设计纪律）
- [RFC 0012 Hook 与插件系统收敛](../../rfc.md)
- Plugin Runtime RFC（目录结构、server、client UI、落地计划）
