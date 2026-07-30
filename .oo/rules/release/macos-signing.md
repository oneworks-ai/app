# macOS Developer ID 签名

App Store 外分发不走 Mac App Store 证书，使用 Apple Developer Program 的 Developer ID 证书和 notarization。

## Secret 与 variable

- `DESKTOP_CSC_LINK`：Developer ID Application `.p12`，base64 后写入 secret，用于签 `.app`。
- `DESKTOP_CSC_KEY_PASSWORD`：上面 `.p12` 的导出密码。
- `DESKTOP_CSC_INSTALLER_LINK`：Developer ID Installer `.p12`，base64 后写入 secret，用于签 `.pkg`。
- `DESKTOP_CSC_INSTALLER_KEY_PASSWORD`：installer `.p12` 的导出密码。
- `APPLE_ID`：Apple Developer 账号邮箱。
- `APPLE_ID_PASSWORD`：Apple app-specific password，不是 Apple ID 登录密码。
- `APPLE_TEAM_ID`：Apple Developer Team ID。
- `DESKTOP_SIGN=true`：仓库 variable，显式打开桌面签名。

桌面 workflow 在 PR 上只运行不构建产物的轻量兼容门禁；每日 nightly 使用 unsigned
arm64 DMG 跑 package / smoke / install verify，不读取签名 secret。真正的双架构安装包
只由 `pkg/oneworks-desktop/v*` tag 或手动 dispatch 触发。手动 artifact 按仓库 variable
决定是否签名；tag 和手动 release 同样遵循 `DESKTOP_SIGN`。未启用时允许发布未签名
安装包，GitHub Release 会明确标记为 unsigned；启用时要求完整签名与 notarization。
所有 secret 配好后，还必须设置仓库 variable：

```bash
gh variable set DESKTOP_SIGN --repo oneworks-ai/app --body true
```

当前 `desktop-package.yml` 的 tag / 手动构建会同时生成 `.dmg`、`.zip` 和 `.pkg`；因此开启 `DESKTOP_SIGN=true` 时，Application 和 Installer 两套证书都必须存在。缺任何一个，workflow 会在 `Validate desktop signing credentials` 失败，不允许继续生成半加签产物。普通 PR 只运行轻量门禁，不进入安装包 job，也不会读取签名 secrets。

手动 `create_release=true` 或 `pkg/oneworks-desktop/v*` tag 构建没有启用签名时会继续生成并发布 unsigned 安装包。macOS Gatekeeper 可能要求用户手动批准；下载页和 Release notes 不得把这类产物描述为已签名或已公证。

## 创建证书

证书创建路径：

1. Apple Developer Account -> Certificates, Identifiers & Profiles -> Certificates。
2. 分别创建 `Developer ID Application` 和 `Developer ID Installer`。
3. 下载证书并在 Keychain Access 中导入。
4. 从 Keychain Access 分别导出 `.p12`，设置强密码。
5. 按下面命令写入 GitHub secrets。

本地生成 base64 secret 的建议命令：

```bash
base64 -i "Developer ID Application.p12" | gh secret set DESKTOP_CSC_LINK --repo oneworks-ai/app
base64 -i "Developer ID Installer.p12" | gh secret set DESKTOP_CSC_INSTALLER_LINK --repo oneworks-ai/app
gh secret set DESKTOP_CSC_KEY_PASSWORD --repo oneworks-ai/app
gh secret set DESKTOP_CSC_INSTALLER_KEY_PASSWORD --repo oneworks-ai/app
gh secret set APPLE_ID --repo oneworks-ai/app
gh secret set APPLE_ID_PASSWORD --repo oneworks-ai/app
gh secret set APPLE_TEAM_ID --repo oneworks-ai/app
```

## 验证

发版前验证普通双架构包、但不创建或修改 GitHub Release：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=false
```

需要构建可直接提升的正式身份候选时，同时传入目标 tag。候选 artifact 会携带源 SHA
和文件摘要清单：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=false \
  -f release_tag=pkg/oneworks-desktop/v0.1.0-beta.11
```

下载 workflow artifact 后在 macOS 上验证：

```bash
codesign --verify --deep --strict "/Applications/One Works.app"
spctl --assess --type execute --verbose "/Applications/One Works.app"
pkgutil --check-signature oneworks-*-mac-*.pkg
spctl --assess --type install --verbose oneworks-*-mac-*.pkg
xcrun stapler validate oneworks-*-mac-*.dmg
xcrun stapler validate oneworks-*-mac-*.pkg
```

只有明确要创建或更新 GitHub Release 时才使用
`create_release=true` 并传入实际 release tag；该操作会写入远端 Release 与资产：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=true \
  -f release_tag=pkg/oneworks-desktop/v0.1.0-alpha.0
```

如果候选构建已经成功，不要重新打包；用候选 run id 提升同一份 artifact：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=true \
  -f release_tag=pkg/oneworks-desktop/v0.1.0-beta.11 \
  -f candidate_run_id=<successful-desktop-package-run-id>
```
