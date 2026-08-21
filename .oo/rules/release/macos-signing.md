# macOS Developer ID 签名

App Store 外分发不走 Mac App Store 证书，使用 Apple Developer Program 的 Developer ID 证书和 notarization。

GitHub Actions 把 `Developer ID Application` 导入临时 keychain 后，必须先把该 keychain 加入当前 user domain 的 search list，再用同一个精确 identity 和 `--keychain` 对一次性 executable 做真实 `codesign` / strict verify。`security find-identity` 只能证明 identity 可枚举，不能单独证明 `codesign` 能解析并使用对应私钥；探针失败时必须在打包前 fail closed，且不得输出 identity、证书或密码，临时 P12、探针和 keychain 必须由 always cleanup 收口。

Apple 公证可能把新 team / 新 app 放入持续一两天的深入分析。workflow 不得用一个覆盖签名、上传和等待的 `submit --wait` 长进程承载恢复边界：app、DMG、PKG 都必须先用 `--no-wait` 取得 submission ID，把精确待公证字节、大小、SHA-256、source / builder SHA、build branch / time 和 ID 写入 recovery artifact，再做 20 分钟有界轮询。仍为 `In Progress` 时本轮明确停止；后续通过原 run id 和 `app` / `installer` stage 下载并校验同一 artifact，且必须用 GitHub API 核对原 run 的 repository、workflow path、attempt、head SHA 与失败终态，只查询既有 ID、staple 和完成剩余构建。若 submit 返回前连接中断，先保存 attempted marker，再以团队 history 的文件名和有限时间窗唯一对账；只能提交从未尝试过的剩余 target，每次恢复都绑定当前 run 并重新上传更新后的状态。无法唯一归因、混入 product rebuild 输入，或历史 source 仍使用同步公证 / 未启用 osx-sign 串行补丁 / DMG update info 时都必须在打包前 fail closed，不得重新签名或重复 submit。团队历史只读检查使用 `notarization_history_only=true`，不能与任何构建、版本或恢复输入混用。

每个 fresh signed build 与 `app` stage recovery 都必须在 signature-only 验证后、任何 Apple app prepare / reconcile / submit / wait 前，使用当前受审 builder 的 `diagnose-packaged-authority.cjs` 通过待提交 App executable 加载包内 `@oneworks/fs-authority-native`，并在隔离临时目录执行 broker / peer / open / claim / publish / release / cleanup 诊断。诊断只允许输出固定 phase / error code，必须有界捕获 stderr，不得泄露路径、原始消息或 secret；unsigned 与 installer-only recovery 跳过。该诊断不修改 App、不重试资产请求，也不替代最终签名 / staple 验证后的不可变 product source packaged-server smoke；任一步失败都必须在 Apple 提交前停止。

Developer ID 签名会改变 native Mach-O 的字节。`@oneworks/fs-authority-native` 的双架构 size / SHA-256 manifest 必须在 `osx-sign` 已按 deepest-first 顺序签完嵌套 binary 后、签 root App 前，从包内两个已签名 regular file 原子刷新；随后 root App 签名把新 manifest 一并封装。该刷新只允许 signed macOS 的精确 outer App callback 执行，unsigned、helper App、symlink / 缺失 / 非闭合 manifest 或 artifact 都必须 fail closed；runtime loader 继续按原始字节做 exact size / SHA-256 校验，不能增加签名后白名单或跳过完整性检查。

## Secret 与 variable

- `DESKTOP_CSC_LINK`：Developer ID Application `.p12`，base64 后写入 secret，用于签 `.app`。
- `DESKTOP_CSC_KEY_PASSWORD`：上面 `.p12` 的导出密码。
- `DESKTOP_CSC_INSTALLER_LINK`：Developer ID Installer `.p12`，base64 后写入 secret，用于签 `.pkg`。
- `DESKTOP_CSC_INSTALLER_KEY_PASSWORD`：installer `.p12` 的导出密码。
- `APPLE_ID`：Apple Developer 账号邮箱。
- `APPLE_ID_PASSWORD`：Apple app-specific password，不是 Apple ID 登录密码。
- `APPLE_TEAM_ID`：Apple Developer Team ID。
- `DESKTOP_SIGN=true`：仓库 variable，只表示签名凭据 / 能力可用；具体版本是否签名由不可变发布策略决定。

桌面 workflow 先在 Ubuntu 用 validation-scope v2 分类；普通 client、adapter、品牌资产和文档改动只运行不构建产物的轻量兼容门禁。只有桌面风险路径（桌面源码、native authority、打包工具、根 manifest / lockfile、正式包内 runtime closure 或未知路径）才构建 unsigned
arm64+x64 app bundle 并执行 native authority smoke，但不生成安装包，也不读取签名 secret。每日 nightly 使用 unsigned
arm64 DMG 跑 package / smoke / install verify。真正的双架构安装包
只由 `pkg/oneworks-desktop/v*` tag 或手动 dispatch 触发。`apps/desktop/package.json` 的私有
`oneworks.release.macosSigningPolicy` 把具体版本锁为 `auto` / `signed` / `unsigned`：`auto`
下 alpha / beta 默认 unsigned，rc 默认 signed，stable 必须 signed；具体 rc 可以显式锁为
unsigned，stable 无论 manifest 或 dispatch 输入都禁止 unsigned。`workflow_dispatch` 保留
`auto` / `signed` / `unsigned` 选择用于候选与恢复，但官方 tag 发布必须与 manifest 一致。
`DESKTOP_SIGN` 只作为 signed 所需能力和凭据总开关，不能把要求 signed 的版本降级成 unsigned。
effective policy 为 unsigned 时仍不具备 Apple
信任，但必须对 prepackaged `.app` 做完整 ad-hoc resource sealing，并让六个 arm64 / x64
DMG、PKG、ZIP 逐一通过 `codesign --verify --deep --strict`；不允许发布只有 linker signature
的半签名 bundle。sealing 前还必须把 workspace 绝对 symlink 重写到 app 内已打包的相对目标，并
拒绝任何绝对或断裂 symlink；否则换一台机器后会被 Gatekeeper 判为损坏。GitHub Release
会明确标记为 unsigned；启用时要求完整签名与 notarization。
所有 secret 配好后，还必须设置仓库 variable：

```bash
gh variable set DESKTOP_SIGN --repo oneworks-ai/app --body true
```

当前 `desktop-package.yml` 的 tag / 手动构建会同时生成 `.dmg`、`.zip` 和 `.pkg`；因此 effective policy 为 signed 且 `DESKTOP_SIGN=true` 时，Application 和 Installer 两套证书都必须存在。缺任何一个，workflow 会在 `Validate desktop signing credentials` 失败，不允许继续生成半加签产物。普通 client、adapter、品牌资产和文档 PR 只运行轻量门禁；只有分类器判定的桌面风险 PR 才构建 unsigned app bundle 并验证 authority，且不进入安装包 job，也不会读取签名 secrets。

手动 `create_release=true` 或 `pkg/oneworks-desktop/v*` tag 的 effective policy 为 unsigned 时会继续生成并发布 unsigned 安装包。候选 manifest 必须记录 `effectiveSigningPolicy=unsigned`、`adHocSealed=true`，并区分不可变 product source SHA 与用于重建的 builder SHA；同 tag 候选提升和恢复不得改变 effective policy。macOS Gatekeeper 仍可能要求用户手动批准；下载页和 Release notes 必须明确未提交 Apple notarization，且不得把这类产物描述为 Developer ID 已签名或已公证。

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

如果 Apple 超过有界等待时间，保留失败 run，不要重跑完整构建。按失败步骤选择恢复 stage：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f create_release=false \
  -f notarization_run_id=<failed-run-id> \
  -f notarization_stage=app
```

只读查看当前 team 的 submission ID 与状态时使用：

```bash
gh workflow run desktop-package.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f notarization_history_only=true
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
