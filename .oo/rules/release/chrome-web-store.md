# Chrome Web Store 发布配置

`.github/workflows/chrome-extension-release.yml` 使用 Chrome Web Store API V2。优先采用无长期密钥的 Workload Identity Federation；不要把 OAuth client secret、refresh token 或 service-account JSON key 写进 repository secret。

## 一次性平台配置

1. 在 Google Cloud project 启用 Chrome Web Store API，创建专用 service account。
2. 在 Chrome Web Store Developer Dashboard 的 Account 设置中添加该 service account。Chrome 当前每个 publisher 只允许添加一个 service account。
3. 创建只信任 GitHub OIDC 的 Workload Identity Pool / Provider。attribute condition 至少限制 `assertion.repository == 'oneworks-ai/app'`，service-account IAM binding 只向该 repository principal 授予 `roles/iam.workloadIdentityUser`。因为 workflow 需要让 `google-github-actions/auth` 输出 OAuth access token，还要按该 action 的前置条件让 underlying service account 对自身拥有 `roles/iam.serviceAccountTokenCreator`；不要把 Token Creator 授给 GitHub principal。
4. 创建 GitHub environment `chrome-web-store`。Release Tags 仅在 main 首次创建 Chrome Driver tag 时传入 `publish_store=true`；workflow 的商店 job 必须经过该 environment，重跑已有 tag 默认不重复提交商店。
5. 首次在 Developer Dashboard 创建 item，完成 Store listing、Privacy、测试说明和可见性，并至少手动建立可由 API 更新的发布状态。打开 Package > View public key，确认它与仓库 manifest 的 `key` 相同且 Item ID 是 `eiikbhfmjohfcldcmgjikafpmpbfipbi`；若不一致，必须先用商店公钥更新仓库 canonical identity、服务端 allowlist 和相关测试，不能启用发布 workflow。API workflow 只更新已有 item。

仓库 Actions variables：

- `CHROME_WEB_STORE_WIF_PROVIDER`：完整 provider resource name，例如 `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`。
- `CHROME_WEB_STORE_SERVICE_ACCOUNT`：已加入 Developer Dashboard 的 service-account email。
- `CHROME_WEB_STORE_PUBLISHER_ID`：Developer Dashboard Publisher > Settings 中的 publisher ID。
- `CHROME_WEB_STORE_EXTENSION_ID`：正式开发者扩展的 item ID，当前必须是 `eiikbhfmjohfcldcmgjikafpmpbfipbi`；不能指向其他 item，minimal/E2E 也不能作为上传源。发布脚本会在任何网络请求前将它与 ZIP 公钥派生 ID 交叉校验，并要求包具备 audited `debugger` / `proxy` 权限。

service-account self-binding 只需配置一次（替换 project 与账号）：

```bash
gcloud iam service-accounts add-iam-policy-binding \
  chrome-web-store-publisher@<project>.iam.gserviceaccount.com \
  --project=<project> \
  --member=serviceAccount:chrome-web-store-publisher@<project>.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
```

## 正式提交与恢复

main 首次创建 `pkg/oneworks-plugin-chrome-driver/v<version>` tag 时会自动 dispatch 正式提交。只有商店 job 失败或需要恢复时，才从同一 tag 手动执行：

```bash
gh workflow run chrome-extension-release.yml \
  --repo oneworks-ai/app \
  --ref pkg/oneworks-plugin-chrome-driver/v<version> \
  -f release_tag=pkg/oneworks-plugin-chrome-driver/v<version> \
  -f publish_store=true
```

workflow 使用 `google-github-actions/auth@v3` 获取 15 分钟 access token，scope 仅为 `https://www.googleapis.com/auth/chromewebstore`。发布脚本会先重新验证 ZIP 确实是完整开发者 flavor，再执行 upload -> 异步状态轮询 -> publish；`blockOnWarnings=true`，不请求跳过 review。重跑已有 tag 时 Release Tags 会传 `publish_store=false`，需要恢复商店提交时才使用上面的显式命令。
