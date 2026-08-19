---
alwaysApply: false
description: 当任务涉及插件系统的统一模型（贡献/参与/提供）、manifest、解析装配、生命周期、事件、信任边界或分发时加载的插件系统入口。
---

# 插件系统入口

详细规范已下沉到 [`plugin-system/README.md`](./plugin-system/README.md)。

先按任务继续阅读：

- 总览与状态图：[`plugin-system/README.md`](./plugin-system/README.md)
- 插件包与 manifest：`plugin-system/manifest.md`（待写）
- 解析与装配：`plugin-system/resolution.md`（待写）
- 生命周期：`plugin-system/lifecycle.md`（待写）
- 贡献（UI、声明式渲染、extension points、资产）：[`plugin-system/contribute.md`](./plugin-system/contribute.md)
- 参与（事件、mode、裁决）：[`plugin-system/participate.md`](./plugin-system/participate.md)
- 提供（plugin APIs、commands、channels、注册型 seam）：[`plugin-system/provide.md`](./plugin-system/provide.md)
- 信任与安全边界：[`plugin-system/trust.md`](./plugin-system/trust.md)
- 分发与可见性：`plugin-system/distribution.md`（待写）

相邻主题：

- hook 事件在各 adapter 的支持矩阵与 `canBlock` 语义：[`hooks/events.md`](./hooks/events.md)
- adapter 的 mock home、原生 skills、MCP：[`ADAPTERS.md`](./ADAPTERS.md)
- 配置加载与合并：[`CONFIG.md`](./CONFIG.md)

设计论证与决策依据不在本规范内，见 RFC：

- [RFC 0011 插件扩展面盘点与边界](../../rfc.md)（含七条设计纪律）
- [RFC 0012 Hook 与插件系统收敛](../../rfc.md)
- Plugin Runtime RFC（目录结构、server、client UI、落地计划）
