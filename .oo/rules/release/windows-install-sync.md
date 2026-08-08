# Windows 安装同步

## CLI 发布后的 Windows 安装同步

`oneworks` 正式版发布成功并能通过 `npm view oneworks@<version>` 查到后，需要同步 Windows 安装资产。`npm-publish-alpha.yml` 继续生成并证明版本锁定的 Windows portable ZIP，供 Scoop 使用。winget 只能引用由受保护 `main` 的独立 `Stable Windows MSI Release` workflow 生成的 MSI；它在同一个 `pkg/oneworks/v<version>` GitHub Release 追加 MSI、独立 checksum 和 provenance JSON，绝不覆盖 ZIP、tag 或已有不同字节的 asset：

1. 从合入 MSI builder 的受保护 `main` 手动触发 `Stable Windows MSI Release`，且只传入：

   - `version=<version>`
   - `release_tag=pkg/oneworks/v<version>`
   - `product_source_sha=<the package tag's peeled commit SHA>`

   workflow 必须在 `windows-2022` 上核验 tag/source/version，记录 product SHA 与 builder SHA，固定 per-machine MSI identity，并完成 MSI install → PATH/new-process version → uninstall smoke 与 GitHub attestation。重跑只复用同一 provenance 的完整、字节相同 asset 集；部分或不同资产必须失败。

2. MSI 成功发布并独立验证 SHA256、attestation 和 smoke 后，更新 Scoop manifest 和 winget manifest 模板：

   ```bash
   pnpm tools windows-install sync-oneworks --version <version>
   ```

3. 在 Scoop bucket submodule 内检查、提交并推送：

   ```bash
   git -C infra/windows/scoop-bucket status
   git -C infra/windows/scoop-bucket add bucket/oneworks.json
   git -C infra/windows/scoop-bucket commit -m "chore: update oneworks to <version>"
   git -C infra/windows/scoop-bucket push origin main
   ```

4. 同步命令默认读取正式 GitHub Release ZIP 并计算真实 SHA256，保持 Scoop 不变。为 winget 写入 MSI 时，必须显式传入已验证的 MSI URL 和 SHA256：

   ```bash
   pnpm tools windows-install sync-oneworks \
     --version <version> \
     --winget-installer-url <windows-msi-url> \
     --winget-installer-sha256 <windows-msi-sha256>
   ```

5. 把 `infra/windows/winget/` 下的 MSI manifest 模板复制到现有 `microsoft/winget-pkgs` fork / PR 的对应版本目录，执行 `winget validate` 后更新该 PR。也可以使用 `wingetcreate` 生成 / 更新 manifest，但需要保证 `PackageIdentifier` 仍为 `OneWorks.OneWorks`，并保留 MSI `ProductCode` 与 `OpenJS.NodeJS.LTS` dependency。不要开重复 PR、接受 Microsoft CLA 或代表用户合入 upstream。

6. 回到主仓库提交 submodule 指针、winget 模板和一键安装脚本：

   ```bash
   git add infra/windows scripts/install-windows.ps1
   ```

注意：

- Scoop 永远继续使用 GitHub Release 中的 Windows portable ZIP；Scoop bucket 初次为空时，`sync-oneworks` 会生成完整 manifest，并计算真实 ZIP `sha256`。winget 不得再引用该 ZIP：必须等 MSI asset、SHA256、ProductCode 和 attestation 已存在，再更新 manifest。
- winget 公开安装依赖 `microsoft/winget-pkgs` 接受 manifest；未接受前，用户应使用 PowerShell 一键安装脚本或 Scoop。
