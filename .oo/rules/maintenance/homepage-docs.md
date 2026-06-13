# Homepage Docs Maintenance

本页记录 homepage 文档站的稳定维护规则。遇到 `.oo/docs`、`assets/homepage`、`deploy-homepage.yml`、GitHub Pages 或文档站多 PR 收口时先读这里。

## 职责边界

- 主仓 `.oo/docs/` 是公开文档内容源，只放 Markdown 与文档图片 / 素材。
- `assets/homepage/apps/docs` 是 VitePress 壳层，负责 theme、nav、sidebar、search、llms、build scripts、站点级 public assets。
- 不要把 `package.json`、`.vitepress/`、Vue 组件、theme、构建脚本、workflow、token 说明或 README 占位文件放进 `.oo/docs/`。
- 公开文档内容改 `.oo/docs`；构建和发布规则改 homepage / `.github` / `.oo/rules`。

## Submodule 合入顺序

- `assets/homepage` 是 `oneworks-ai/oneworks-ai.github.io` submodule，不是普通目录。
- 修改 homepage 壳层、Pages workflow 或 docs build 逻辑时，先在 homepage 仓库提交、推送、开 PR、合入，并确认 homepage main 上的 Pages workflow 通过。
- homepage 仓库合入后，再回到 app 仓库更新 `assets/homepage` submodule 指针，并用单独提交 / PR 合入 app。
- app PR 合入后，本地执行 `git submodule update --init -- assets/homepage`，确认 `git submodule status -- assets/homepage` 指向已验证的 homepage commit。

## Workflow 路径规则

- homepage Pages workflow 会 checkout 两个仓库：homepage 到 `homepage/`，app 到 `app/`。
- CI 中不要依赖从包脚本 cwd 推断出来的相对 `ONEWORKS_APP_ROOT`；docs source 优先用绝对路径：

```yaml
ONEWORKS_DOCS_SOURCE_DIR: ${{ github.workspace }}/app/.oo/docs
```

- 本地验证也优先模拟 CI 的显式 source：

```bash
ONEWORKS_DOCS_SOURCE_DIR="$PWD/.oo/docs" pnpm -C assets/homepage build
```

- `ONEWORKS_APP_ROOT` 适合本地默认布局兜底；跨 repo checkout 的 workflow 优先传 `ONEWORKS_DOCS_SOURCE_DIR`。

## VitePress 配置

- `editLink.pattern` 这类会在 VitePress runtime / SSR 中调用的函数必须自包含。
- 不要让这些函数闭包引用 config 外层变量；SSR 序列化后容易在构建期出现 `is not defined`。
- 指向主仓内容源的编辑链接应生成 `https://github.com/oneworks-ai/app/edit/main/.oo/docs/<path>`。
- `src/` 是 staging 目录，生成内容不要手写提交；调试 staging 用 `pnpm -C assets/homepage prepare:docs:dry-run`。

## 验收清单

- 纯 `.oo/docs` 内容迁移或链接调整：至少检查 Markdown / 图片数量、相对链接存在性、中英文路径配对、没有旧 public 图片路径和旧 homepage docs 内容源引用。
- docs shell、VitePress config、prepare script、homepage workflow 或 submodule 指针变化：运行 `ONEWORKS_DOCS_SOURCE_DIR="$PWD/.oo/docs" pnpm -C assets/homepage build`。
- app 仓库 PR 合并前查 `lint`、`format-check`、`typecheck`、`commit-message`、`pr-change-policy`。
- homepage Pages 变更合入后查真实 workflow：`gh run list --repo oneworks-ai/oneworks-ai.github.io --workflow deploy.yml`，失败时用 `gh run view <run-id> --log-failed`。
- 最终确认线上入口：`curl -L https://oneworks-ai.github.io/docs/` 应返回 `200`，页面里应能看到当前文档站标题、语言入口或关键导航。

## Secrets 与触发链路

- app 仓库的 `.github/workflows/deploy-homepage.yml` 依赖 `HOMEPAGE_DEPLOY_TOKEN` 触发 homepage 仓库 `deploy.yml`。
- 缺少 `HOMEPAGE_DEPLOY_TOKEN` 时，app 侧触发 workflow 必须失败；不要把缺 secret 降级成 warning。
- 代码链路通过和 secret 已配置是两件事。调试时先用 `gh secret list --repo oneworks-ai/app` 确认 secret 名称是否存在，再看 workflow 日志。
- homepage 仓库自己的 Pages deploy 使用该仓库的 `GITHUB_TOKEN` 发布 Pages，不需要 app token 拥有 contents write。

## 多 PR / 多会话收口

- 拆分 docs migration 时按内容源、homepage shell、app trigger、清理 / 指针收口分层，不要让一个 PR 同时迁移内容、改壳层、改 token 和清理旧引用。
- 子线程不会可靠主动通知主线程完成；主线程要通过线程状态、branch/PR/checks 查询推进。
- 不要直接 ping 仍在运行或思考中的子线程；先只读检查线程状态和 PR / branch 变化。只有线程 failed、blocked、长时间 idle 且无任何远端变化，才发送窄范围恢复请求。
- 子线程完成并合入后，归档不再需要的线程，保留主线程作为收口记录。
