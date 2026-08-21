# Main Merge Queue 运行约定

本文记录 `main` 的合入队列、required checks 与故障恢复约定。它属于仓库维护规则，不是用户使用文档。

## 合入模型

- `main` 只能通过 GitHub Merge Queue 合入，使用 squash merge。普通 PR 不因为落后于 `main` 就机械要求开发者 rebase；入队后由 GitHub 创建包含最新 base 与待合入 PR 的组合 revision。
- PR head 先通过 `lint`、`format-check`、`typecheck`、`commit-message`、`pr-change-policy`、`macOS installer` 六个 required contexts。入队后的组合 revision 必须重新创建并通过同名六个 contexts，不能复用单个 PR head 的证据。
- 队列使用 `ALLGREEN`，常态允许同时构建 2 个 entry，每次最多合入 1 个 PR，最少 1 个 entry 即可合入，不额外等待凑批；check response timeout 为 90 分钟。
- 小型 ESLint Autofix 可以在同一 PR 的后续 revision 复用符合不可变证据约束的昂贵检查；Merge Queue 仍针对最新 base 的组合 revision 重新分类。docs-only 等低风险范围继续走轻量路径，不安装 workspace，也不申请 macOS runner。

## 冲突与过期

- GitHub 能自动组成最新 base 时，由队列验证真实组合，不要求开发者先同步主干。队列中前序 PR 合入后，后续 entry 由 GitHub 重新组合并重新检查。
- 出现 Git 文件冲突时，PR 会退出队列。开发者只需要在 PR branch 解决这一次真实冲突并重新入队；不要为了“分支落后”做没有语义冲突的机械 rebase。
- 组合 revision 的 required check 失败或超时时，不得绕过队列或复用旧结果。先根据失败的 queue run 修复 PR；新 head 通过 PR checks 后再入队。
- required context 缺失时，先确认三个 required workflows 都收到 `merge_group: checks_requested`，且没有顶层 `paths` / `paths-ignore`；再检查 queue revision 上六个 context 是否都由 GitHub Actions App 创建。

## 发布隔离

- `merge_group` 只运行源码质量门禁和必要的 unsigned Desktop smoke。installer、Developer ID 签名、Apple 公证、候选提升、GitHub Release 与部署 job 必须显式跳过。
- `macOS installer` 是稳定的 aggregate required context。低风险范围可以在不启动 macOS runner 的情况下成功，但 classifier、依赖 job 或实际 smoke 的失败、取消和异常跳过都必须 fail closed。

## 仓库设置与恢复

- 仓库必须启用 `allow_auto_merge`；GitHub CLI 通过自动合入入口把满足条件的 PR 加入 Merge Queue，关闭该开关会在创建 queue entry 前直接拒绝请求。
- exact `main` branch ruleset 启用 `merge_queue`，不得配置 bypass actor。Branch protection 保留六个绑定 GitHub Actions App 的 required checks；`strict=false` 只关闭旧式“分支必须先与主干同步”要求，最新 base 验证由队列组合 revision 接管。
- 调整队列并发、合并方式或 required checks 后，必须读取 GitHub API 返回值，核对 exact branch condition、全部 queue 参数、六个 context 及其 App 绑定。不能只把写请求返回 2xx 当作完成。
- 需要停用队列时，先把 branch protection 的 `strict` 恢复为 `true`，并回读确认六个 required checks 与 App 绑定完整；只有确认成功后才能停用或删除 queue ruleset。若恢复失败，保留 active queue 并停止，避免出现保护空档。

## 真实验证

- workflow 或仓库设置变化后，用一个低风险 PR 完成 canary：先观察 PR head 的六个 required contexts，再入队并确认 `merge_group` revision 上六个 context 全部成功，最后确认 PR 由队列 squash merge。
- canary 必须检查 job / step 级证据：docs-only 不安装 workspace、不跑全量 typecheck、不申请 macOS runner；发布、签名、公证和 release jobs 全部 skipped。不要只根据 PR 最终显示绿色判断路径正确。
- canary 通过后再提高队列 build concurrency；`max_entries_to_merge` 保持 1，让 main 的推进顺序可预测。
