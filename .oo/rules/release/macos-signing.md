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

本仓库默认不签名。所有 secret 配好后，还必须设置仓库 variable：

```bash
gh variable set DESKTOP_SIGN --repo oneworks-ai/app --body true
```

当前 `desktop-package.yml` 会同时生成 `.dmg`、`.zip` 和 `.pkg`；因此开启 `DESKTOP_SIGN=true` 时，Application 和 Installer 两套证书都必须存在。缺任何一个，workflow 会在 `Validate desktop signing credentials` 失败，不允许继续生成半加签产物。

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

验证发布链路：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=true \
  -f release_tag=pkg/oneworks-desktop/v0.1.0-alpha.0
```

如果只是验证签名包 artifact，不想创建 GitHub Release，可以把 `create_release=false`，下载 workflow artifact 后在 macOS 上验证：

```bash
codesign --verify --deep --strict "/Applications/One Works.app"
spctl --assess --type execute --verbose "/Applications/One Works.app"
pkgutil --check-signature oneworks-*-mac-*.pkg
```
