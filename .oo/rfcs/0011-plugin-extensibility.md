# RFC 0011: 插件扩展面盘点与边界

返回入口：[RFC 索引](../../rfc.md)

Status: 调研完成，待决策\
对照上游: `deepseek-ai/deepseek-harness@99f6f02`（release/dsh-0.1.0-rc.7）、`cordiverse/cordis@f46ae95`（cordis 4.0.0-rc.8）\
Reviewed: 2026-08-18

## 背景

One Works 的插件扩展面是分多轮长出来的：`plugins` 配置与 manifest、client/server 双运行时、extension point 与 plugin API、`@oneworks/hooks` 中间件链、marketplace 分发。每一层都有实现，但**没有单一事实源**描述"插件到底能做什么"。

这带来两个具体后果：

1. 内部评审时对现有能力的判断会出错。本 RFC 的调研过程中，对自身扩展面出现过三次错误判断（详见 [现有扩展面盘点](0011-plugin-extensibility-current-surface.md) 的"已知误判记录"），而调研是拿着完整代码库做的。插件作者只会更容易出错。
2. 新增扩展点时缺少可引用的边界依据，每次都要重新论证。

同时，DeepSeek Harness（DSH，基于 Cordis）作为同类系统提供了有价值的对照：它把几乎全部运行时能力做成了命名 seam，并配套了生成式能力目录。它的社区在数月内长出了与 One Works 产品面高度重叠的插件。

## 目标

- 盘点 One Works 插件系统**当前实际具备**的扩展能力，建立可引用的基线。
- 与 DSH/Cordis 做结构性对照，分清"我们缺的"与"我们刻意不做的"。
- 把已达成的边界判断写成可引用的纪律，避免重复论证。
- 给出按优先级排序的行动项，区分"技术决策"与"需要产品决策"。

## 非目标

- 本 RFC 不新增任何扩展点，也不修改任何运行时行为。
- 不对"扩展面开放到什么程度"给出结论——该判断涉及商业路径与维护成本，属于产品决策。

## 章节

- [现有扩展面盘点](0011-plugin-extensibility-current-surface.md)
- [DSH / Cordis 结构对照](0011-plugin-extensibility-dsh-comparison.md)
- [边界与设计纪律](0011-plugin-extensibility-boundaries.md)
- [行动项与优先级](0011-plugin-extensibility-actions.md)

## 结论摘要

**我们的扩展面比内部认知的更完整。** 依赖装配（extension point 的 `onAvailable` 等待语义、`pluginApis.call` 的挂起队列）、视图侧声明式渲染（`toolUsePresentations`）、agent loop 拦截（`@oneworks/hooks` 的 15 个事件，含 `PreToolUse` 否决权）都已存在并在生产使用。

**真正缺失的是"注册型 seam"。** 现有 seam 全部是拦截型：宿主流程跑到某个点回调插件，插件可否决或增补，但不提供实现。缺的是"插件提供一个实现并成为运行时一部分"——典型是 model provider。这不是遗漏，而是 hook 的跨进程传输形态（每事件一次子进程往返）天然只能承载拦截型。要开注册型 seam 需走常驻 server plugin runtime，不是扩展 hook 事件表。

**结构性差异只有一条：seam vs 编译期内置。** 我们的 16 个适配器在深度上显著超过 DSH 的 3 个 out-of-process provider（统一 hook 协议、账号池、历史导入、权限镜像），但它们是编译期内置；DSH 的是 `SubagentProvider` seam，第三方发 npm 包、用户配置加一行即可接入。

**最高优先级的行动项不涉及任何信任决策：** 抽通用 ACP 适配器层（当前 cline/dsh/goose 各实现一遍），以及建立生成式能力目录 + CI 门禁。详见[行动项](0011-plugin-extensibility-actions.md)。

## 调研方法

本 RFC 的事实基础来自：

- 直接阅读 One Works 仓库源码（路径与行号在各章节内标注）。
- 拉取 `vendors/cordiverse/cordis` submodule（此前未 checkout）并阅读 `packages/core` 源码。
- 克隆 `deepseek-ai/deepseek-harness` 并由四个并行子任务分别调研：subagent provider 体系、ACP 与外部 agent 集成、workflow 与 preset 编排、插件生态与官方文档。

所有结论均标注了来源位置。上游行号对应上述固定 revision，升级上游后需重新核对。
