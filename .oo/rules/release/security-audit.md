# 生产依赖安全门禁

正式发布候选和 npm 发布前必须执行：

```bash
pnpm security:audit:production
```

门禁读取 `pnpm audit --prod --json`，默认拒绝所有 critical / high advisory。普通 `pnpm audit` 的退出码不能直接作为最终门禁，因为仓库只允许下面这一项有明确不可达证据的窄范围豁免：

- `GHSA-qwww-vcr4-c8h2`：只允许路径为 `apps__relay-admin>react-router-dom>react-router`。Relay Admin 是纯客户端 SPA，不启用 React Router RSC actions，因此该 RSC Mode CSRF 路径不可达。

脚本会同时核对 advisory id、包名和完整依赖路径；同一 advisory 如果出现在其它 runtime 路径会重新阻断。Relay Admin 引入 RSC、React Router 8 与项目 React 版本兼容，或 advisory 的影响条件变化时，必须删除豁免并升级依赖。

依赖安全修复必须保留锁文件 supply-chain policy 校验；不要把 `pnpm audit --fix` 自动生成的所有中间版本批量加入 `minimumReleaseAgeExclude`。
