# Homepage GitHub Pages

`HOMEPAGE_DEPLOY_TOKEN` 只用于 `.github/workflows/deploy-homepage.yml`，让 app 仓库在 `.oo/docs` 内容变化时触发 homepage 仓库部署并等待下游运行结果：

```bash
gh workflow run deploy.yml \
  --repo oneworks-ai/oneworks-ai.github.io \
  --ref main \
  -f source_ref=main \
  -f source_sha=<app commit sha>
```

推荐凭据来源：

- Fine-grained PAT，或短期 GitHub App installation token。
- Target repository: `oneworks-ai/oneworks-ai.github.io`。
- Minimum repository permission: `Actions: read and write`。
- `Metadata: read-only` 会随 fine-grained PAT 自动授予。
- 不需要 `Contents: write`；homepage 仓库 workflow 使用自己的 `GITHUB_TOKEN` 发布 Pages。

创建或轮换 fine-grained PAT：

1. GitHub user settings -> Developer settings -> Personal access tokens -> Fine-grained tokens。
2. Generate new token。
3. Resource owner 选 `oneworks-ai`。
4. Repository access 只选 `oneworks-ai/oneworks-ai.github.io`。
5. Repository permissions 只开 `Actions: read and write` 与自动附带的 `Metadata: read-only`。
6. 生成后立即复制 token。
7. 写入 app 仓库 secret：`gh secret set HOMEPAGE_DEPLOY_TOKEN --repo oneworks-ai/app`

验证触发链路：

```bash
gh workflow run deploy-homepage.yml --repo oneworks-ai/app --ref main
```

确认 `oneworks-ai/app` 的 Trigger Homepage Deploy 成功、`oneworks-ai/oneworks-ai.github.io` 的 Deploy Pages 被触发并成功、`https://oneworks-ai.github.io/docs/` 返回 `200`。如果 `HOMEPAGE_DEPLOY_TOKEN` 缺失，app 仓库 workflow 必须失败，不能 warning 后成功退出。
