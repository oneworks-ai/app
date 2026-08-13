# 跨领域核心 Review 规则

## REVIEW-001 证据优先于推断

Owner：project maintainers。

适用条件：所有 PR Review。

必须：Finding 指向具体代码、可触发路径和可观察影响；先检查调用方、测试、文档和 PR 记录。

禁止：把未经验证的猜测、个人风格偏好或“可能有问题”写成阻塞意见。

验证：另一名 Reviewer 能仅根据 Finding 描述复现风险或定位缺失证据。

默认级别：取决于实际影响；缺少触发路径时不构成 Finding。

## REVIEW-002 不明确意图必须确认

Owner：project maintainers。

适用条件：存在多种合理的产品意图、架构取舍、兼容承诺或验收口径，且仓库证据不能唯一确定。

必须：继续完成可独立查证的 Review，并向用户说明当前理解、需要确认的问题及答案对结论的影响。

禁止：替用户发明需求，或为了避免询问而把不确定设计直接判定为正确/错误。

验证：用户回答后能明确转化为修改要求、验证要求或允许当前设计。

默认级别：`waiting for confirmation`；潜在 P0/P1 未澄清前不得 approve。

## REVIEW-003 结论绑定最新 head

Owner：project maintainers。

适用条件：复审、作者更新代码、准备 approve 或推动合入。

必须：记录并重新获取最新 head，检查相对上次审阅的 delta、thread 状态和 checks。

禁止：仅凭旧 diff、作者摘要或 thread resolved 状态判断问题已经修复。

验证：Review 结论中能够说明本次覆盖的最新提交和剩余验证空白。

默认级别：无法确认最新 head 时不得给出 approve 结论。

## REVIEW-004 已采纳反馈必须进入学习分析

Owner：project maintainers。

适用条件：Review 意见触发代码或测试修改，并得到 reviewer 确认。

必须：按 `reinforce`、`amend`、`new`、`one-off` 或 `conflict` 分类，检查是否需要更新项目规则。

禁止：直接复制评论原话成为规则，或因为只有一次实例就忽略高影响、可泛化经验。

验证：Review 收口包含 Accepted Feedback Learning 结论；需要升级时已有规则 diff 和独立审阅证据。

默认级别：合入流程要求完成经验判断，但不要求每条反馈都新增规则。
