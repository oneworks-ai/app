---
alwaysApply: false
description: 当任务涉及 PR review、复审、合入判断、Review 意见采纳后的经验沉淀或维护 Review 规则时加载的统一入口。
---

# PR Review 标准入口

本文件只保留所有 PR Review 都必须遵守的约束。完整流程与规则目录见 [Review 标准](./review/README.md)。

## 核心约束

- 先核对目标、base/head、最新提交和适用规则，再审实现；最终结论不得基于过期 diff。
- Finding 必须有可定位的代码证据、可触发的影响场景和明确优先级；猜测、设计偏好和待确认意图单列为 Question。
- 仓库、代码、测试或 PR 记录能够回答的问题继续查证；只有产品意图、架构取舍或验收口径无法从证据确定时才向用户确认。
- 未确认事项会影响正确性或合入结论时，暂停对应结论但继续其他独立审阅；不得把不确定性包装成缺陷，也不得带着潜在 P0/P1 直接 approve。
- Review 意见被代码修改采纳并由 reviewer 确认后，必须执行 [已采纳反馈学习](./review/accepted-feedback-learning.md)，从通用角度判断是否强化、修订或新增项目规则。
- 只有确定性、低误报的规则进入 CI；需要上下文判断的规则保留为人工或 agent Review 标准。

## 继续阅读

- [项目级 PR Review Skill](../skills/post-task-experience-review/SKILL.md)
- [完整 Review 流程、优先级和输出契约](./review/README.md)
- [已采纳 Review 反馈的学习与规则演进](./review/accepted-feedback-learning.md)
- [规则治理、冲突、例外与清理](./review/governance.md)
- [跨领域核心规则](./review/core-rules.md)
- [Desktop 与双运行路径规则](./review/profiles/desktop-runtime.md)
