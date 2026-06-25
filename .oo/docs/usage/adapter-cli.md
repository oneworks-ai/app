# Adapter CLI 安装与版本

返回启动服务：[runtime.md](./runtime.md)

One Works 不把各原生 CLI 作为 adapter 包的运行时依赖。第一次使用时，adapter 会优先找显式配置的 binary、项目共享 cache、系统 `PATH`，都不可用时再安装到项目级共享 cache：

- npm 托管：`codex`、`gemini`、`copilot`、`opencode`、`claude-code.cli`、`claude-code.routerCli`
- uv 托管：`kimi.cli`

默认托管版本：

| Adapter                 | 托管包                           | 默认安装版本 | 兼容范围    |
| ----------------------- | -------------------------------- | ------------ | ----------- |
| `codex`                 | `@openai/codex`                  | `latest`     | `>=0.130.0` |
| `gemini`                | `@google/gemini-cli`             | `0.38.2`     | 同默认版本  |
| `copilot`               | `@github/copilot`                | `1.0.36`     | 同默认版本  |
| `opencode`              | `opencode-ai`                    | `1.14.18`    | 同默认版本  |
| `claude-code.cli`       | `@anthropic-ai/claude-code`      | `latest`     | `>=2.1.114` |
| `claude-code.routerCli` | `@musistudio/claude-code-router` | `latest`     | `>=1.0.73`  |
| `kimi.cli`              | `kimi-cli`                       | `1.36.0`     | 同默认版本  |

可以在项目配置里固定来源和版本：

```yaml
adapters:
  codex:
    cli:
      source: managed
      version: 0.130.0
      prepareOnInstall: true
  claude-code:
    cli:
      version: 2.1.114
    routerCli:
      version: 1.0.73
  kimi:
    cli:
      package: kimi-cli
      version: 1.36.0
      python: "3.13"
```

`cli.source` 支持：

- `managed`：使用项目共享 cache 中的托管 CLI；缺失时按 `autoInstall` 安装
- `system`：优先使用系统 `PATH` 中的原生命令；缺失时仍可按 `autoInstall` 安装
- `path`：只使用 `cli.path` 指向的 binary

Codex adapter 还会把用户登录 shell 里可解析到的 `codex` 作为系统 CLI 候选；在 macOS 上，还会追加 `/Applications/Codex.app/Contents/Resources/codex` 和 `~/Applications/Codex.app/Contents/Resources/codex`。Claude Code adapter 也会把用户登录 shell 里可解析到的 `claude` / `ccr` 作为系统 CLI 候选。这些 fallback 候选都必须满足兼容范围，不能运行太旧的 CLI。

把 `autoInstall` 设为 `false` 可以关闭首次使用时的自动安装。npm 托管 adapter 还支持 `cli.package`、`cli.npmPath`；Kimi 支持 `cli.package`、`cli.python`、`cli.uvPath`。

如果希望提前把托管 CLI 下载到项目共享 cache，可以显式运行：

```bash
oneworks adapter prepare codex claude-code gemini
oneworks adapter prepare claude-code.routerCli
oneworks adapter prepare --all
```

不传 target 时，`oneworks adapter prepare` 只准备配置中声明了 `prepareOnInstall: true` 的 CLI：

```json
{
  "adapters": {
    "codex": {
      "cli": {
        "source": "managed",
        "version": "0.130.0",
        "prepareOnInstall": true
      }
    },
    "claude-code": {
      "routerCli": {
        "version": "1.0.73",
        "prepareOnInstall": true
      }
    }
  }
}
```

启动时也可以直接用 `-A <adapter>@<version>` 指定托管 CLI 版本。这个写法会更新本地 dev 配置里的 `adapters.<adapter>.cli.version`，因此下次不带版本启动也会继续使用同一个版本：

```bash
oneworks -A codex@0.130.0 "读取 README 并总结"
oneworks -A codex "继续使用项目里记录的 Codex CLI 版本"
```

`@oneworks/cli` 的 package `postinstall` 也会读取项目根的 `.oo.config.json` 或 `infra/.oo.config.json`。只有发现上述 `prepareOnInstall: true` 时才会调用 `oneworks adapter prepare --from-postinstall`，否则不做网络下载。postinstall 默认跳过 `CI=true`；如需在 CI 里预热，设置 `ONEWORKS_POSTINSTALL_PREPARE=1`。如需跳过，设置 `ONEWORKS_SKIP_ADAPTER_PREPARE=1` 或 `ONEWORKS_SKIP_POSTINSTALL=1`。

同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`GEMINI`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：

```bash
export __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_CODEX_INSTALL_VERSION__=0.130.0
export __ONEWORKS_PROJECT_ADAPTER_CODEX_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__=/absolute/path/to/codex

export __ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_VERSION__=1.36.0
export __ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PYTHON__=3.13
export __ONEWORKS_PROJECT_ADAPTER_KIMI_UV_PATH__=/absolute/path/to/uv
```
