# 发布 tag 与经验

返回入口：[RELEASE.md](../RELEASE.md)

## tag 约定

- 所有带发布产物的 workspace package 统一使用 `pkg/<normalized-package-name>/v<version>`，包括 npm 包、桌面应用和 VS Code 扩展。
- `normalized-package-name` 规则：去掉包名中的 `@`，并将 `/` 替换为 `-`
- 例如 `@oneworks/desktop@4.0.0-alpha` 使用 `pkg/oneworks-desktop/v4.0.0-alpha`。
- Release PR 合入默认分支后，可以通过比较 package manifest 判断发布目标：已有包的 `version` 变化、新增包带有 `name` 与 `version`，都进入候选；没有 `version` 的示例 / demo package 不发布。
- `private: true` package 也使用同一 tag 规范，但发布动作由 package 自己的发布类型决定，例如桌面安装包或 VS Code VSIX，不走 npm publish。
- 裸 `v<version>` 不再作为具体产物发布入口；只有明确需要聚合版本标记时才使用，且不能触发桌面 / VS Code / npm 产物发布。

## 自动 tag

- `Release Tags` workflow 只在 `main` push 后创建 tag；PR 阶段只做 dry-run 计划。
- 自动 tag 使用 `pnpm tools release-tags plan <base> <head>` 生成候选。
- 候选范围只看 workspace package manifest，不包含根目录 `package.json`。
- 当仓库是单提交快照、force push 后旧 base 不可达，或 workflow 手动触发时没有可比较 base，`Release Tags` 会按当前 ref 生成 initial tag plan：把 `apps/**/package.json` 与 `packages/**/package.json` 中带 `name` / `version` 的 workspace package 当作新包创建初始 tag。
- 已存在的 tag 会跳过，不重复创建。
- force push `main` 不会移动已存在的远端 tag；如果目标是让公开仓库只暴露最新快照，必须单独删除或重建 release tags 和 GitHub Releases。
- 自动 tag 使用内置 `GITHUB_TOKEN` 创建，不需要个人全仓库 PAT。因为 `GITHUB_TOKEN` 创建的 tag 不会触发普通 tag workflow，`Release Tags` workflow 会按发布面显式调度 Desktop 与 Chrome 等自动化；VS Code stable tag 只创建不自动 dispatch，等待人工发布。
- VS Code alpha / beta / rc manifest version 不进入 tag plan；只有 stable semver source version 才创建 `pkg/oneworks-vscode-extension/v<stable>`。

## 发布身份冻结与并发归因

- 第一次 tag、publish、workflow dispatch、商店提交或部署前，先冻结完整 release source SHA、预期 annotated tag 集合、npm identity 集合（含 alias closure）、明确排除的发布面，以及每个发布面允许的 workflow / ref。后续恢复和审计都以这份矩阵为准，不能根据执行中途看到的远端状态临时扩大范围。
- tag 证据必须同时证明 ref 指向 tag object、annotated tag 内容正确且 peeled commit 等于冻结 source；只有名字或版本相同不足以证明属于本次发布。
- 审计中出现额外 tag、run、Release 或 deployment 时，先按 peeled / head source SHA、触发 ref、workflow、关联 PR / merge ancestry 和冻结矩阵归因。确认是并发变更或矩阵外发布面后，只记录其来源并从本次结论中排除；不得因为“多出来”就移动 / 删除 tag、覆盖 Release、重跑 workflow 或补发 package。
- 只有冻结矩阵中的目标确实缺失、失败或指向错误来源，且恢复动作仍在原授权范围内时，才允许定向修复。已经对外发布的不可变版本和 tag 永远不能靠移动 ref 或重建同名 identity 纠正。

## 发布后经验沉淀

- 新的稳定经验或踩坑结论，发布完成后要回写文档
- 包内实现或维护经验，优先写到对应包的 `AGENTS.md`
- 跨包、跨工具的通用发布规则，只写在 [RELEASE.md](../RELEASE.md) 及其子页
