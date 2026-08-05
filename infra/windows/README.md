# Windows 安装维护

Windows 安装相关资产统一放在 `infra/windows/`：

- `scoop-bucket/`：Scoop bucket submodule，公开包构建可用后由发布自动化生成 manifest。
- `winget/`：Windows Package Manager manifest 模板。正式 npm 流水线生成版本锁定的 portable ZIP 后，同步真实 SHA256，再把 manifest 提交到 `microsoft/winget-pkgs`。

用户安装命令写在 homepage docs 的 `usage/install.md` 和仓库根 `README.md`。CLI 发版后的维护步骤写在 `.oo/rules/release/process.md`。
