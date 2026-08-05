# Windows 安装维护

Windows 安装相关资产统一放在 `infra/windows/`：

- `scoop-bucket/`：Scoop bucket submodule，公开包构建可用后由发布自动化生成 manifest。
- `winget/`：Windows Package Manager manifest 模板。Scoop 继续使用版本锁定的 portable ZIP；winget 使用同一不可变 package Release 上的 x64、per-machine MSI。MSI 只安装现有版本锁定的 `.cmd` launchers 到 `Program Files\\OneWorks`，通过 MSI 追加并在卸载时移除 machine PATH 项，且把 Node.js LTS 声明为 winget dependency。

用户安装命令写在 homepage docs 的 `usage/install.md` 和仓库根 `README.md`。CLI 发版后的维护步骤写在 `.oo/rules/release/process.md`。

MSI 只能由 `Stable Windows MSI Release` 从受保护的 `main` 手动触发。触发时必须提供现有 `pkg/oneworks/v<version>` tag、其 peeled immutable product SHA，以及相同版本；workflow 会校验 tag/source 对应关系、生成带 product SHA 与 builder SHA 的 provenance JSON、对 MSI/校验和/provenance 建立 GitHub attestation，并且只以字节相同的方式向现有 Release 补充资产。它在 Windows runner 上执行 install → machine PATH/new-process version → uninstall smoke。成功后才可以把 `winget/` 模板更新为 MSI URL、SHA256 和 ProductCode 并更新现有 `microsoft/winget-pkgs` PR。
