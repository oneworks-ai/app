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
- 自动 tag 使用内置 `GITHUB_TOKEN` 创建，不需要个人全仓库 PAT。因为 `GITHUB_TOKEN` 创建的 tag 不会触发普通 tag workflow，`Release Tags` workflow 会在创建 tag 后显式 `workflow_dispatch` 桌面或 VS Code 等对应发布 workflow。

## 发布后经验沉淀

- 新的稳定经验或踩坑结论，发布完成后要回写文档
- 包内实现或维护经验，优先写到对应包的 `AGENTS.md`
- 跨包、跨工具的通用发布规则，只写在 [RELEASE.md](../RELEASE.md) 及其子页
