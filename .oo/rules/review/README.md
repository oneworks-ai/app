# Review 标准

本目录是项目内部 PR Review 决策的唯一事实源。一级入口只提供路由；通用流程、已生效规则和领域 profile 在本目录维护。模块 `AGENTS.md` 继续维护模块地图、具体命令和验证入口，并链接适用 profile；profile 不复制这些实现细节。多人贡献、规则例外和清理方式见 [规则治理](./governance.md)。

## Review 工作流

1. **锁定审阅对象**：确认 repository、PR number、base SHA、head SHA、是否为 draft，以及用户要的是首次 Review、复审还是合入判断。
2. **理解变更目标**：阅读 PR body、关联 issue、commit、变更文件、既有 review threads 和 checks，提炼承诺行为、非目标与兼容边界。
3. **选择规则**：始终加载 [核心规则](./core-rules.md)，再根据改动路径加载相关领域规则和最近的 `AGENTS.md`。
4. **检查实现**：阅读 patch 及其调用方、数据流、异常路径和测试；不能只按文件逐段复述 diff。
5. **验证证据**：区分已经运行的验证、Reviewer 可复现的验证和仍缺失的验证。UI、打包产物、权限或迁移等风险不能仅以类型检查代替。
6. **处理不明确项**：按下表决定继续查证、向用户确认或形成 Finding。
7. **复审最新代码**：用户要求“再 review”“推动合入”时，重新获取 head SHA，检查上次审阅以来的 delta、thread 状态和 checks，再给结论。
8. **学习已采纳反馈**：出现已采纳意见时，按 [学习流程](./accepted-feedback-learning.md) 去重和提炼规则候选。

## 不明确事项决策表

| 情况 | 动作 |
| --- | --- |
| 可从代码、测试、文档、issue 或 PR 记录确定 | 继续查证，不询问用户 |
| PR、仓库或审阅范围不唯一 | 先向用户确认准确目标 |
| 产品意图、架构取舍或兼容承诺存在多种合理解释 | 简述现有证据、选项和对结论的影响，向用户确认 |
| 规范已经明确要求证据，但 PR 没有提供 | 形成 Finding 或验证缺口，不把缺证据改写成意图问题 |
| 只有理论可能性，无法给出触发路径 | 不形成 Finding；必要时列入 Question 或剩余风险 |
| 答案只影响部分文件 | 暂停该部分结论，继续其他独立审阅 |

向用户确认时只问会改变 Review 结论的问题，优先一次提出 1–3 个短问题。说明当前理解、为什么证据不足，以及不同答案分别会导致继续修改、补验证或允许当前设计。用户的回答是设计证据，但不能代替代码和验证证据。

## Finding 优先级

| 级别 | 含义 | 默认处理 |
| --- | --- | --- |
| P0 | 可导致安全事故、不可恢复数据损失、大面积生产故障或发布阻断 | 必须阻止合入并立即处理 |
| P1 | 可复现的核心行为错误、兼容性破坏、权限绕过或主要路径回归 | 修复并复审后才能合入 |
| P2 | 有限场景的功能错误、可靠性缺口或会显著放大后续缺陷的设计问题 | 原则上当前 PR 修复；延期需明确 owner 和 follow-up |
| P3 | 不影响正确性的局部改进、可读性或低风险补强 | 非阻塞建议 |

Finding 使用 `[P1][RULE-ID] 简短标题`。正文必须包含：紧凑位置、触发条件、可观察影响、证据和建议修正方向。规则 ID 不存在时可以先使用 `[UNSPECIFIED]`，并在反馈被采纳后判断是否需要新增规则。

## 输出契约

按以下顺序交付，空 section 可以省略，但不能用笼统 `LGTM` 代替结论：

1. **Findings**：按 P0 → P3 排序。
2. **Code Questions**：只列必须由用户确认且会改变代码结论的不明确意图，并说明答案如何影响结论。
3. **Code Review Verdict**：`request changes`、`waiting for confirmation` 或 `approve`。
4. **Accepted Feedback Learning**：列出 `reinforce`、`amend`、`new`、`one-off` 或 `conflict` 候选；纯规则推广问题作为 Learning Question，不改变已经成立的代码结论。
5. **Experience Review Result**：`PASS`、`NEEDS WORK` 或 `NOT APPLICABLE`。
6. **Validation and residual risk**：已检查证据、缺失验证和剩余风险。

没有 Finding 时要明确说没有发现阻塞问题，同时说明覆盖范围和仍未验证的风险。Review 默认只授权读取并在当前对话中汇报；发布 GitHub Review/评论、修改代码、提交、推送或合并需要用户明确要求，或属于其已授权的推进合入流程。

## 合入条件

- 最新 head 已复审，早先 Finding 没有在后续提交中重新出现。
- 所有 P0/P1 已解决；P2 延期有明确记录和 owner。
- 会改变代码结论的 Code Questions 已得到确认。
- 风险相称的 tests、checks 和人工验证已有可信证据。
- 已采纳 Review 意见完成经验提炼并得到 `PASS` / `NOT APPLICABLE`；未决经验已登记为候选，或只读 Review 已明确标记不推广/deferred；规则冲突已经显式处理。

## PR 作者应提供的信息

PR body 的 `Review Scope` 应声明风险等级、适用 profile、验证证据和规则例外。作者的声明用于缩短 Review 定位时间，不替代 Reviewer 对路径、风险和证据的独立判断。字段暂不作为语义 CI 门禁；只有能够确定性检测且误报可控时才升级自动检查。
