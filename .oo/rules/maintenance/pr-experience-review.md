# PR 经验复盘门禁

本文记录 PR 经验复盘机制的稳定维护入口。它是内部协作规则，不是用户使用文档。

## 机制目标

- 每个 PR 创建、编辑或同步时会尝试收到一条 PR review summary 软提醒，提示确认是否需要沉淀经验。
- PR body 必须包含并勾选 `## Experience Review` checklist；缺失或未勾选时，PR policy check 失败。
- 需要沉淀经验的任务必须先运行 `$post-task-experience-review`，并在独立 reviewer 返回 PASS 后再进入 merge。

## 维护入口

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
  - 新增或调整 checklist 文案时，同步更新 `scripts/__tests__/pr-change-check.spec.ts`。

## Checklist 判定

CI 要求 PR body 中存在二级标题 `## Experience Review`，并在该 section 内包含这些已勾选项：

```md
- [x] 已判断是否需要沉淀经验
- [x] 如需要，已运行 `$post-task-experience-review`
- [x] reviewer PASS 后才进入 merge
```

判定只关注本 section，遇到下一个 `##` 标题即停止。允许使用 `- [X]`，但不要改掉关键短语，否则会导致 `pr-change-policy` 失败。

## 本地验证

- `pnpm exec vitest run scripts/__tests__/pr-change-check.spec.ts`
- `pnpm tools pr-change-check <base> <head> --body-file <path>`
- `pnpm exec dprint check .github/workflows .github/pull_request_template.md .oo/rules/maintenance/pr-experience-review.md scripts/pr-change-check.ts scripts/__tests__/pr-change-check.spec.ts`
