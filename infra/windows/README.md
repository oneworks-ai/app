# Windows 安装维护

Windows 安装相关资产统一放在 `infra/windows/`：

- `scoop-bucket/`：Scoop bucket submodule，公开包构建可用后由发布自动化生成 manifest。
- `winget/`：Windows Package Manager manifest 模板。正式对外可用前，需要先发布 Windows portable zip，并把 manifest 提交到 `microsoft/winget-pkgs`。

用户安装命令写在 homepage docs 的 `usage/install.md` 和仓库根 `README.md`。CLI 发版后的维护步骤写在 `.oo/rules/release/process.md`。
