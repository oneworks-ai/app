# Avatar GitHub Pages

`AVATAR_DEPLOY_TOKEN` 只用于 `.github/workflows/deploy-avatar.yml`，让 app 仓库触发 Avatar 仓库的 GitHub Pages 部署并等待下游运行结果：

```bash
gh workflow run deploy-avatar.yml \
  --repo oneworks-ai/avatar \
  --ref main \
  -f source_ref=main \
  -f source_sha=<app commit sha>
```

推荐 token 配置：

- Token name: `oneworks-app-trigger-avatar`
- Resource owner: `oneworks-ai`
- Repository access: only `oneworks-ai/avatar`
- Permissions: `Actions` read/write, `Metadata` read-only

轮换方式：

1. GitHub user settings -> Developer settings -> Personal access tokens -> Fine-grained tokens。
2. Generate new token。
3. Resource owner 选 `oneworks-ai`。
4. Repository access 只选 `oneworks-ai/avatar`。
5. Repository permissions 只开 `Actions: read and write` 与 `Metadata: read-only`。
6. 生成后立即复制 token。
7. 写入 app 仓库 secret：`gh secret set AVATAR_DEPLOY_TOKEN --repo oneworks-ai/app`

验证触发链路：

```bash
gh workflow run deploy-avatar.yml --repo oneworks-ai/app --ref main
```

确认 `oneworks-ai/app` 的 Trigger Avatar Deploy 成功、`oneworks-ai/avatar` 的 Deploy Avatar 被触发并成功、`https://oneworks-ai.github.io/avatar/` 返回 `200`。如果 `AVATAR_DEPLOY_TOKEN` 缺失，app 仓库 workflow 必须失败，不能 warning 后成功退出。

## 部署边界

`assets/avatar` 是 `oneworks-ai/avatar` 的 submodule，但不属于 app 仓库根 `pnpm-workspace.yaml`。Avatar Pages workflow 应独立安装和构建自己的站点：checkout app 仓库指定 commit 到 `app-source`，安装 Avatar 仓库自己的依赖，然后用 `ONEWORKS_APP_SOURCE_DIR=app-source` alias 读取 `packages/avatar` 源码与 `packages/route-layout` CSS。

不要在 Avatar Pages workflow 里 checkout app 仓库后执行根目录 `pnpm install --frozen-lockfile`。这会把 submodule 的 `package.json` 纳入 app workspace 校验，容易因为 app 根锁文件没有记录 asset site importer 而导致部署失败。
