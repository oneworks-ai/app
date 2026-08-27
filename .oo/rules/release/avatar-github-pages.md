# Avatar GitHub Pages

## 所有权与触发

- `oneworks-ai/avatar` 独立拥有 Avatar Pages 的源码版本、CI 和部署生命周期。
- Avatar PR 校验不能替代 production source gate。合入后，受保护的 Avatar `main` 必须再次运行 `Avatar SDK CI`；`build-test-pack` 成功后，仓内 `deploy-avatar.yml` 通过 `workflow_run` 自动部署该次 CI 的精确 merge commit `head_sha`。
- `workflow_dispatch` 只用于从 Avatar `main` 重新执行同一仓库的部署，不接受 app commit、mutable source branch 或外部 Avatar source 输入。
- `oneworks-ai/app` 提供共享 Node / package metadata，仍是可以令构建失败的真实依赖。部署 job summary 必须记录实际 checkout 的 app SHA，并验证它来自受保护 app `main`；app 的 `assets/avatar` gitlink 不得选择、批准、回退或触发 Avatar Pages 版本。

不要恢复 app 仓库的跨仓 `deploy-avatar.yml`、`AVATAR_DEPLOY_TOKEN` 或“先更新 submodule 指针才能部署”的二次发布状态源。
不要为了减少一次 post-merge 校验而移除 `sdk-ci.yml` 的 `push: main`；否则 `Deploy Avatar` 没有可信的 merge-commit `workflow_run` 可消费，自动部署会静默失效。

## 验证

正常合入后确认 CI 与部署形成一条连续链路：

```bash
gh run list --repo oneworks-ai/avatar --branch main --limit 5
```

需要重跑当前 Avatar `main` 时：

```bash
gh workflow run deploy-avatar.yml --repo oneworks-ai/avatar --ref main
```

验收必须同时确认：

1. 触发部署的 `Avatar SDK CI` 结论为 success。
2. `Deploy Avatar` checkout 的 Avatar SHA 等于该 CI 的 `head_sha`，且仍可从 Avatar `main` 到达。
3. 共享 app source SHA 可从 app `main` 到达，但没有改变 Avatar checkout。
4. Pages deployment 成功，`https://oneworks-ai.github.io/avatar/` 返回 `200`。
