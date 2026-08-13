# Review 规则候选

本目录只保存尚未决定是否升级的当前候选，每个候选一个 Markdown 文件。创建前阅读 [规则治理](../governance.md) 和 [已采纳反馈学习](../accepted-feedback-learning.md)。

候选模板：

```md
# CANDIDATE-<DOMAIN>-NNN <标题>

状态：candidate
建议动作：new / amend
Owner：<team or role>
创建日期：YYYY-MM-DD
最近审阅：YYYY-MM-DD
最晚复查：YYYY-MM-DD
合格命中次数：1

失败模式：

候选不变量：

适用与不适用范围：

验证与失败信号：

已知例外：

证据：<与当前仓库同等可见性的 PR/thread URL、私有 tracker id 或仓库内证据>

待确认问题：
```

不要保存评论全文、完整 diff、个人身份、账号信息、凭据、临时签名 URL 或权限更高的私有来源链接。`observed-unproven` 不增加合格命中次数。候选升级、判定为 `reinforce` / `one-off` 或失效后删除对应文件。

需要在用户已授权的标准维护任务中暂存未证实观察时，使用 `状态：observed-unproven` 和 `合格命中次数：0`。普通只读 Review 只需在结果中标记 deferred，无需写文件。
