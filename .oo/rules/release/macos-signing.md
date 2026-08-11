# macOS Developer ID 签名

App Store 外分发不走 Mac App Store 证书，使用 Apple Developer Program 的 Developer ID 证书和 notarization。

GitHub Actions 把 `Developer ID Application` 导入临时 keychain 后，必须先把该 keychain 加入当前 user domain 的 search list，再用同一个精确 identity 和 `--keychain` 对一次性 executable 做真实 `codesign` / strict verify。`security find-identity` 只能证明 identity 可枚举，不能单独证明 `codesign` 能解析并使用对应私钥；探针失败时必须在打包前 fail closed，且不得输出 identity、证书或密码，临时 P12、探针和 keychain 必须由 always cleanup 收口。

## Secret 与 variable

- `DESKTOP_CSC_LINK`：Developer ID Application `.p12`，base64 后写入 secret，用于签 `.app`。
- `DESKTOP_CSC_KEY_PASSWORD`：上面 `.p12` 的导出密码。
- `DESKTOP_CSC_INSTALLER_LINK`：Developer ID Installer `.p12`，base64 后写入 secret，用于签 `.pkg`。
- `DESKTOP_CSC_INSTALLER_KEY_PASSWORD`：installer `.p12` 的导出密码。
- `APPLE_ID`：Apple Developer 账号邮箱。
- `APPLE_ID_PASSWORD`：Apple app-specific password，不是 Apple ID 登录密码。
- `APPLE_TEAM_ID`：Apple Developer Team ID。
- `DESKTOP_SIGN=true`：仓库 variable，显式打开桌面签名。

桌面 workflow 对纯文档 PR 只运行不构建产物的轻量兼容门禁；非文档或 mixed PR 构建 unsigned
arm64+x64 app bundle 并执行 native authority smoke，但不生成安装包，也不读取签名 secret。每日 nightly 使用 unsigned
arm64 DMG 跑 package / smoke / install verify。真正的双架构安装包
只由 `pkg/oneworks-desktop/v*` tag 或手动 dispatch 触发。手动 artifact 按仓库 variable
决定是否签名；tag 和手动 release 同样遵循 `DESKTOP_SIGN`。未启用时仍不具备 Apple
信任，但必须对 prepackaged `.app` 做完整 ad-hoc resource sealing，并让六个 arm64 / x64
DMG、PKG、ZIP 逐一通过 `codesign --verify --deep --strict`；不允许发布只有 linker signature
的半签名 bundle。sealing 前还必须把 workspace 绝对 symlink 重写到 app 内已打包的相对目标，并
拒绝任何绝对或断裂 symlink；否则换一台机器后会被 Gatekeeper 判为损坏。GitHub Release
会明确标记为 unsigned；启用时要求完整签名与 notarization。
所有 secret 配好后，还必须设置仓库 variable：

```bash
gh variable set DESKTOP_SIGN --repo oneworks-ai/app --body true
```

当前 `desktop-package.yml` 的 tag / 手动构建会同时生成 `.dmg`、`.zip` 和 `.pkg`；因此开启 `DESKTOP_SIGN=true` 时，Application 和 Installer 两套证书都必须存在。缺任何一个，workflow 会在 `Validate desktop signing credentials` 失败，不允许继续生成半加签产物。纯文档 PR 只运行轻量门禁；其他普通 PR 只构建 unsigned app bundle 并验证 authority，不进入安装包 job，也不会读取签名 secrets。

手动 `create_release=true` 或 `pkg/oneworks-desktop/v*` tag 构建没有启用签名时会继续生成并发布 unsigned 安装包。候选 manifest 必须记录 `adHocSealed=true`，并区分不可变 product source SHA 与用于重建的 builder SHA。macOS Gatekeeper 仍可能要求用户手动批准；下载页和 Release notes 不得把这类产物描述为 Developer ID 已签名或已公证。

已发布 tag 的同版本紧急修复只允许在用户明确授权覆盖资产后使用 `product_source_sha`：输入必须是完整 SHA，且必须精确等于 release tag peeled commit。workflow 从该提交构建产品代码、用当前受审 workflow 工具完成 sealing，并在候选里同时记录 product / builder SHA；tag 不得移动。覆盖前必须在本地归档旧 Release 全部资产与摘要，候选六个安装包和 quarantine 边界全部通过后才能提升。

同版本覆盖还必须显式传入 protected `main` 的 reviewed builder SHA，并开启
`replace_existing_release`。workflow 会再次校验运行 ref / SHA，下载并保留旧资产 90 天，
要求旧新资产名称集合完全一致；上传失败会恢复旧资产，上传成功后逐个核对远端大小和
SHA-256，最后才更新 Release notes：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=true \
  -f replace_existing_release=true \
  -f release_tag=pkg/oneworks-desktop/v0.1.0 \
  -f product_source_sha=<peeled-product-tag-sha> \
  -f builder_source_sha=<reviewed-origin-main-sha>
```

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

## 官方安装 smoke 的用户数据隔离

- 从正式 Release 下载并安装后的启动 smoke 必须显式提供隔离的 Electron `userData`、real / global-config home、project home、package / runtime cache home 和所有会继承的 `HOME` 类输入；`__ONEWORKS_PROJECT_REAL_HOME__` 是强制输入，必须指向本次验证的临时隔离 project home，不能因其他目录已隔离而省略。
- 启动前对真实用户 surface 做可复核 fingerprint，至少覆盖路径集合、文件类型、大小、mtime 与现有文件内容摘要；正常退出并确认没有残留进程后重复采集，要求新增、删除、内容变化和目录 / 文件 mtime 变化均为零。只有隔离 profile / 临时 home 内的写入可以计入 smoke 自身。
- 任一隔离输入缺失、指向真实目录或 pre / post fingerprint 出现变化，都应把本次启动判为 validation-runbook defect，而不是产物通过。立即停止继续操作，记录能够证明的已知变化；不得隐藏偏差，也不得猜测原内容后覆盖或用破坏性回滚处理用户数据。修正全部隔离输入后，从干净的临时 profile 重新执行 smoke，并证明没有新增真实用户写入。
- 安装验证工具应对上述输入 fail closed，并自动生成 pre / post fingerprint 证据；在工具尚未具备该能力时，执行者仍需显式完成同等检查，不能用人工观察到窗口打开代替零写入证明。
