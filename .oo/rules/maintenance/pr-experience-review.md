# PR 经验复盘门禁

本文记录 PR 经验复盘机制的稳定维护入口。它是内部协作规则，不是用户使用文档。

## 机制目标

- 每个 PR 创建、编辑或同步时会尝试收到一条 PR review summary 软提醒，提示确认是否需要沉淀经验。
- PR body 必须包含并勾选 `## Experience Review` checklist；缺失或未勾选时，PR policy check 失败。
- 需要沉淀经验的任务必须先运行 `$post-task-experience-review`，并在独立 reviewer 的 `Experience Review Result` 返回 `PASS` 后再进入 merge；没有可沉淀反馈时允许 `NOT APPLICABLE`。
- `$post-task-experience-review` 同时负责主动分析指定 PR、复审最新 head，以及按 [PR Review 标准](../REVIEW.md) 提炼已采纳反馈；只有产品意图、架构取舍或验收口径不明确且会改变代码结论时必须向用户确认。纯学习不确定性在普通只读 Review 中可以标记为不推广，不要求扩大写入授权。

## 已采纳反馈

- Review 意见被相关代码或测试修改采纳、由 reviewer 确认且没有在后续 commit 中撤回时，必须进入经验候选分析。
- 候选按 `reinforce`、`amend`、`new`、`one-off` 或 `conflict` 分类；不是每条评论都要新增规则。
- 详细证据、去重、升级和冲突处理见 [已采纳 Review 反馈学习](../review/accepted-feedback-learning.md)。
- 普通只读 Review 不修改 contributor branch；用户已经授权维护项目标准时，高置信候选写入最窄的 Review profile，并在独立 reviewer PASS 后生效。

`Experience Review Result` 与代码结论分开：

- `PASS`：反馈已盘点和分类；正式规则 diff 已独立审阅、未决经验已登记，或只读 Review 已明确标记不推广/deferred。
- `NEEDS WORK`：经验盘点或分类有漏项，规则 diff 存在无证据归因、规则冲突/重复或敏感信息，或用户已授权维护标准但必需候选尚未保存。
- `NOT APPLICABLE`：没有需要分析的已采纳反馈。

纯 Learning Question 不否定已经成立的代码 approve；普通只读 Review 明确标记不推广/deferred 后可以 PASS，不要求先获得候选写入授权。只有它同时暴露出现行政策冲突或未解决代码风险时才阻止合入。

## 维护入口

- 项目级 PR Review skill：`.oo/skills/post-task-experience-review/SKILL.md`
  - 这是本仓库资产，通过 `.oo/skills` 被 workspace runtime 和各 adapter 发现；所属边界是项目 skill，不属于 plugin package。
- 软提醒 workflow：`.github/workflows/pr-experience-review.yml`
  - 监听 `pull_request_target` 的 `opened`、`edited`、`synchronize`。
  - 不 checkout PR 代码，只通过 Pull Requests API upsert 带 marker 的 `COMMENT` review summary。
  - 不使用 issue comments API；仓库关闭 Issues 时，普通 PR conversation comment 可能因 `issues/*/comments` 返回 integration 403。
  - 提醒失败只输出 warning，避免软提醒误伤合并门禁；硬门禁仍由 `quality.yml` 的 `pr-change-policy` 执行。
  - 如需调整提醒文案，保持 marker `<!-- oneworks:experience-review-reminder -->` 不变，避免重复 review。
- PR body 默认模板：`.github/pull_request_template.md`
  - `Experience Review` checklist 默认未勾选，创建 PR 后由作者按实际情况确认。
- 硬门禁：`scripts/pr-change-check.ts`
  - `quality.yml` 的 `pr-change-policy` job 调用 `pnpm tools pr-change-check <base> <head> --body-file <path>`。
  - workflow 监听 `opened`、`reopened`、`synchronize`、`edited` 和 `ready_for_review`；正文编辑时 lint、format、typecheck 和 commit-message jobs 会跳过，只重跑这条窄门禁。
  - 新增或调整 checklist 文案时，同步更新 `scripts/__tests__/pr-change-check.spec.ts`。

## Checklist 判定

CI 要求 PR body 中存在二级标题 `## Experience Review`，并在该 section 内包含这些已勾选项：

```md
- [x] 已判断是否需要沉淀经验
- [x] 如需要，已运行 `$post-task-experience-review`
- [x] reviewer `PASS` / `NOT APPLICABLE` 后才进入 merge
```

判定只关注本 section，遇到下一个 `##` 标题即停止。允许使用 `- [X]`，但不要改掉关键短语，否则会导致 `pr-change-policy` 失败。这里的 `PASS` / `NOT APPLICABLE` 指 `Experience Review Result`，不是 Code Review Verdict。

## 本地验证

- `pnpm exec vitest run scripts/__tests__/pr-change-check.spec.ts`
- 创建 PR 前先从 `.github/pull_request_template.md` 准备已忽略的 `.logs/pr-body.md`，再运行 `pnpm tools pr-preflight origin/main HEAD --body-file .logs/pr-body.md`。
- `pnpm tools pr-change-check <base> <head> --body-file <path>`
- `pnpm dprint check .github/workflows .github/pull_request_template.md .oo/rules/maintenance/pr-experience-review.md scripts/pr-change-policy.ts scripts/pr-change-check.ts scripts/pr-preflight.ts scripts/__tests__/pr-change-check.spec.ts`
