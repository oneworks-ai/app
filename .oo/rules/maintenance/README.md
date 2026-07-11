---
alwaysApply: false
description: 仓库通用维护与验证细则，包含启动、lint、格式化、类型检查、测试与常见维护入口。
---

# 项目维护指南 (Maintenance)

本文件保留常用维护入口；日志消费与排查经验见：

- [AI 常见问题索引](./common-issues.md)
- [日志消费与排查](./logs.md)
- [会话终止与创建取消排查](./session-termination.md)
- [任务规划、委派与经验沉淀](./task-planning.md)
- [Medium 编码的全局影响、抽象与交付门禁](./code-delivery-quality.md)
- [新模型的持续评测、结果分析与推荐范围更新](./model-routing-evaluation.md)
- [移动端 WebView 与工作区标签页经验](./mobile-workspace-webview.md)
- [消息级操作开发经验](./message-actions.md)
- [消息级操作维护工具](./tooling.md)
- [Team / Agent Room 冒烟验证](./agent-room-team-smoke.md)
- [能力展示录屏工具](./demo-video.md)
- [Homepage Docs 维护经验](./homepage-docs.md)
- [PR 经验复盘门禁](./pr-experience-review.md)
- [桌面端浏览器数据管理经验](./browser-data-management.md)
- [桌面本地打包 Runtime Cache 经验](./desktop-packaged-runtime-cache.md)
- [移动设备调试页维护经验](./mobile-device-debugging.md)
- [Relay 托管与私有化部署](../RELAY-DEPLOYMENT.md)

## 常见问题索引

- Subagent 执行“取最新代码并启动 web 服务”超过 1 分钟：见 [Subagent 启动 Web 服务超过 1 分钟](./common-issues.md#subagent-启动-web-服务超过-1-分钟)。
- `dev-service ensure` 返回 `ready: true` 后仍继续 `ps` / `curl` / 读 log：见 [开发服务 ready 后仍继续验证](./common-issues.md#开发服务-ready-后仍继续验证)。
- 启动入口混用 `start.sh`、`screen` 或旧脚本：见 [开发服务启动入口混用历史脚本](./common-issues.md#开发服务启动入口混用历史脚本)。
- Android 模拟器 / AVD / 虚拟机启动耗时、`emulator` 不在 PATH、SDK 路径猜错或命令会话被长期占用：见 [Android 模拟器启动排查耗时](./common-issues.md#android-模拟器启动排查耗时)。
- PR 截图证据断链、引用已删除分支或截图来源不真实：见 [PR 截图证据断链或来源不真实](./common-issues.md#pr-截图证据断链或来源不真实)。
- 复杂任务需要拆 PR、开子线程、监控或沉淀经验：见 [任务规划、委派与经验沉淀](./task-planning.md)。
- PR body 缺少经验复盘确认或需要维护提醒评论：见 [PR 经验复盘门禁](./pr-experience-review.md)。
- 桌面端浏览器数据同步、密码管理、历史记录、下载内容或项目 / 会话范围过滤：见 [桌面端浏览器数据管理经验](./browser-data-management.md)。
- 桌面本地 dev 安装包仍像旧代码、`Switch Project` 兜底页或 packaged runtime cache 排查：见 [桌面本地打包 Runtime Cache 经验](./desktop-packaged-runtime-cache.md)。
- Electron WebView 右键“评论此元素”选错元素、坐标偏移或 hover / 右键路径不一致：见 [Electron WebView 右键元素评论坐标偏移](./common-issues.md#electron-webview-右键元素评论坐标偏移)。
- 移动端 WebView、工作区 tabs overview、sender compact 样式或相关 PR 收口：见 [移动端 WebView 与工作区标签页经验](./mobile-workspace-webview.md)。
- Android / iOS 设备 standalone 调试页、设备状态面板、ADB / scrcpy / WDA 预览或相关 PR 收口：见 [移动设备调试页维护经验](./mobile-device-debugging.md)。

## 开发环境启动

仓库内需要跨会话复用的长期开发服务统一在根目录运行：

```bash
pnpm --silent tools dev-service ensure <target> --json
```

target、状态查询、操作租约和 handoff 见 [开发服务跨会话协作协议](./dev-service-coordination.md)。不要用 package 私有 `dev` 命令建立第二个长期 owner；只有明确的内部前台诊断才可直接运行 target 私有入口。排查时先用 `status` / `events`，失败证据再用有限且已脱敏的 `logs`。无论服务是否健康，`stop` / `restart` 都必须先取得用户对该 target 的显式授权。

## 常见维护任务

### 0. 代码质量检查与格式化 (Tooling)

在进行任何提交或重大修改前，应运行以下指令确保代码质量：

- **Lint 检查**: `pnpm exec eslint .`
  - 场景：检查代码风格、潜在错误和类型安全（如 `strict-boolean-expressions`）。
  - 注意：项目使用 `@antfu/eslint-config`，对 `Promise` 处理、`any` 使用和显式空值检查有严格要求。
- **格式检查**: `pnpm exec dprint check`
  - 场景：在 CI 或提交前校验格式是否已按 `dprint.json` 对齐。
- **代码格式化**: `pnpm exec dprint fmt`
  - 场景：统一代码格式。
- **类型检查**: `pnpm typecheck`
  - 场景：在重构或修改共享包 (`packages/core`) 后，确保全量类型安全。
- **提交信息检查**: `pnpm tools commitmsg-check <base> <head>`
  - 场景：在 CI 中校验一个 commit range 内的提交标题是否符合 Conventional Commit 约定；GitHub merge commit 例外。
- **PR 合并检查**: `gh pr view <pr> --repo oneworks-ai/app --json statusCheckRollup`
  - 场景：PR 合并前后确认远端 Quality Checks 状态，尤其是 `lint` / `format-check` / `typecheck` / `commit-message`。
  - 注意：先用 `statusCheckRollup` 确认 required checks 结束。仓库允许 auto-merge 时再使用 `--auto`；如果返回 `Auto merge is not allowed for this repository`，等待 checks 全绿后执行 direct merge，例如 `gh pr merge <pr> --repo oneworks-ai/app --squash --delete-branch`。
  - 注意：多 worktree 下 `gh pr merge` 可能在远端已经合并后，因为本地 `main` 已在其他 worktree checkout 而报错；这时先查 `gh pr view <pr> --repo oneworks-ai/app --json state,mergedAt,mergeCommit`，确认已合并后只需要单独清理远端分支。
  - 注意：如果仓库允许 checks 结束前合并，merge 后仍要确认远端结果；失败时补 follow-up PR，不要只凭本地检查判断已经完成。
- **消息级操作回归**: `pnpm tools message-actions verify`
  - 场景：修改消息级 `编辑 / 撤回 / 分叉 / 复制原文` 后，固定跑一遍质量检查与回归测试组合，并拿到真实 Chrome 回归清单。
- **单元测试**: `pnpm -C apps/client test` / `pnpm -C apps/cli test` / `npx vitest run <path>`
  - 场景：修改核心逻辑或 API 适配器后验证功能正确性。
  - 注意：运行单个用例或目录时需使用 `vitest run <path>`，不要直接执行 `vitest <path>`。
  - 说明：`vitest run` 支持文件路径与 glob，例如 `npx vitest run apps/cli/__tests__/*.spec.ts`。
  - Vitest 配置：仓库根使用 `vitest.workspace.ts` 作为 workspace 配置文件（不再使用 `vitest.config.ts`）。
  - workspace 划分：`node` / `bundler` / `bundler.web` 三个 project 的 include 规则来自 `packages/tsconfigs` 下对应的 `*.test.json`：
    - `node`: `tsconfig.node.test.json`
    - `bundler`: `tsconfig.bundler.test.json`
    - `bundler.web`: `tsconfig.bundler.web.test.json`
  - 维护方式：新增/移动测试文件时，优先调整对应 `tsconfig.*.test.json` 的 `include`，避免在 Vitest 配置里手写路径。

### 1. 修改后端 API

- 路由定义位于 `apps/server/src/routes/`。
- 如果涉及数据模型变更，请同步更新 `apps/server/src/db/schema.ts` 的表结构与迁移逻辑，并在对应的 Repo 中调整读写逻辑。
- 自动化相关的数据结构与读写逻辑位于 `apps/server/src/automation/db/`。

### 2. 修改前端样式

- 样式文件采用 `.scss`，与组件同名（PascalCase）放置在 `src/components/` 下。
- 全局样式位于 `src/styles/global.scss`。

### 3. 环境参数配置

- 环境变量通过 `.env` 文件或 shell 传入。
- 后端参数参考 `apps/server/src/env.ts`，如 `DB_PATH` 可用于指定数据库存储位置。
- 前端参数以 `VITE_` 开头，参考 `apps/client/src/vite-env.d.ts`。

### 4. 更新国际化文本

- 中文文本修改：编辑 `apps/client/src/resources/locales/zh.json`。
- 英文文本修改：编辑 `apps/client/src/resources/locales/en.json`。
- 如果添加了新的 Key，请确保在两个文件中都进行添加，以保证多语言支持的完整性。

### 5. 公开文档内容源维护

- 主仓 `.oo/docs/` 是 homepage docs 文档站的公开内容源，只提交 Markdown 与文档图片 / 素材。
- 中文 root locale 入口是 `.oo/docs/index.md`，中文使用页在 `.oo/docs/usage/`；英文入口是 `.oo/docs/en/index.md`，英文使用页在 `.oo/docs/en/usage/`。
- VitePress 配置、主题、Vue 组件、构建脚本、部署 workflow、token 与 dev-start docs 等壳层或发布信息留在 homepage / docs app 侧维护，不写入 `.oo/docs/`，也不要用 `.oo/docs/README.md` 或 `.oo/docs/README.zh-Hans.md` 做占位说明。
- 内容源迁移或链接调整至少做文件 / 链接层检查，例如统计 Markdown 与图片数量、检查中英文路径配对、确认 `.oo/docs` 没有引用旧 homepage docs app 目录或旧 public 图片路径。不要求为纯内容源迁移启动本地 docs 服务。
- 维护 homepage docs 壳层、submodule 指针、Pages workflow 或跨仓触发时，继续阅读 [Homepage Docs 维护经验](./homepage-docs.md)。

### 6. PWA 独立部署维护

- PWA 静态站点由 `oneworks-ai/pwa` 仓库维护，发布分支是该仓库的 `gh-pages`。
- 本仓库的 `.github/workflows/deploy-pwa.yml` 负责在 `main` 的 client 相关输入变化时触发 `oneworks-ai/pwa` 的 `deploy-pwa.yml` workflow，并等待下游 workflow 成功；不再直接写本仓库的 `gh-pages`。
- 本仓库需要配置 Actions secret `PWA_DEPLOY_TOKEN`，用于跨仓库触发 `oneworks-ai/pwa` workflow。推荐使用只授予 `oneworks-ai/pwa` Actions 写权限的 fine-grained token。
- PWA 仓库部署时会 checkout 本仓库 `main` 的指定 commit，使用 `__ONEWORKS_PROJECT_CLIENT_MODE__=standalone` 和 `__ONEWORKS_PROJECT_CLIENT_BASE__=/pwa/` 构建 `apps/client`，然后把 `apps/client/dist/` 发布到 `oneworks-ai/pwa` 的 `gh-pages`。
- `__ONEWORKS_PROJECT_CLIENT_BASE__=/pwa/` 的官方独立构建会在编译期启用官网首页预览运行时；普通独立部署默认不包含这部分模拟数据和 hook 代码。自定义构建可以用 `__ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__=1` 强制启用，或用 `__ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__=0` 强制关闭。
- 本仓库自己的 `gh-pages` 不再承载 PWA，后续主要用于项目文档站；维护文档站构建或部署时，不要把 PWA 发布逻辑重新写回本仓库。

### 7. Avatar 独立部署维护

- Avatar 预览站点由 `oneworks-ai/avatar` 仓库维护，并作为本仓库 `assets/avatar` submodule 挂载。
- Avatar 的运行时来源是本仓库 `packages/avatar`，client 通过 `@oneworks/avatar` 使用同一套 SVG rect 渲染器。
- 本仓库的 `.github/workflows/deploy-avatar.yml` 只在 `assets/avatar/**`、`packages/avatar/**` 或 workflow 自身变化时触发，避免其它 package / client 改动误触发 avatar Pages 更新。
- 本仓库需要配置 Actions secret `AVATAR_DEPLOY_TOKEN`，用于跨仓库触发 `oneworks-ai/avatar` 的 `deploy-avatar.yml` workflow。推荐使用只授予 `oneworks-ai/avatar` Actions 写权限的 fine-grained token。
- Avatar 仓库部署时会 checkout 本仓库 `main` 的指定 commit，并初始化 submodules；构建命令是 `ONEWORKS_AVATAR_BASE=/avatar/ pnpm -C assets/avatar build`，最终发布 `assets/avatar/dist/` 到 GitHub Pages。

### 8. Homepage 文档站部署维护

- Homepage 文档站由 `oneworks-ai/oneworks-ai.github.io` 仓库维护，并通过 GitHub Pages 发布到 canonical URL `https://oneworks.cloud/docs/`。
- 本仓库的 `.github/workflows/deploy-homepage.yml` 只在 `.oo/docs/**` 或 workflow 自身变化时触发，避免非文档改动误触发 homepage Pages 更新。
- 本仓库需要配置 Actions secret `HOMEPAGE_DEPLOY_TOKEN`，用于跨仓库触发 `oneworks-ai/oneworks-ai.github.io` 的 `deploy.yml` workflow。推荐使用只授予 `oneworks-ai/oneworks-ai.github.io` Actions 写权限的 fine-grained token 或 GitHub App installation token。
- Homepage 仓库部署时应 checkout 本仓库 `main` 的指定 commit，并用 `source_ref=main`、`source_sha=<app commit sha>` 读取 `.oo/docs` 内容。

## 注意事项

- **持久化**: 直接启动 server 时，数据库文件默认存储在 home 下的 project-scoped 目录（默认 `~/.oneworks/projects/<project-key>/.local/server/db.sqlite`），同一 Git 项目的多个 worktree 共享；不同项目互不共享。运行产物（`logs`、`caches`、`.mock`、`runtime`）同样默认落在该 project home 下，避免写入用户本地仓库。`.oo/` 只承载可提交的项目资产与配置入口。
- **SQLite 运行时**: Server 侧数据库已切换为 Node.js 内置的 `node:sqlite`，运行环境需使用支持该模块的 Node.js 22.5+。
- **类型安全**: 共享类型建议在各自目录的 `types.ts` 中定义，保持前后端接口定义一致。
