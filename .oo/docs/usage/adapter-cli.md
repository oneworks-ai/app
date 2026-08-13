# Adapter CLI 安装与版本

返回启动服务：[runtime.md](./runtime.md)

One Works 不把各原生 CLI 作为 adapter 包的运行时依赖。第一次使用时，adapter 会优先找显式配置的 binary、全局托管 bootstrap cache、系统 `PATH`，都不可用时再安装到全局托管 bootstrap cache：

- npm 托管：`codex`、`cline`、`droid`、`dsh`、`gemini`、`grok`、`junie`、`copilot`、`opencode`、`pi`、`qwen-code`、`claude-code.cli`、`claude-code.routerCli`
- uv 托管：`kimi.cli`
- 官方发行物托管：`cursor`、`goose`、`kiro`

默认托管版本：

| Adapter                 | 托管包                            | 默认安装版本 | 兼容范围             |
| ----------------------- | --------------------------------- | ------------ | -------------------- |
| `codex`                 | `@openai/codex`                   | `latest`     | `>=0.130.0`          |
| `dsh`                   | DeepSeek 官方 ACP 组合            | `0.1.0-rc.6` | 同默认版本           |
| `cline`                 | `cline`                           | `3.0.54`     | 仅 `3.0.54`          |
| `droid`                 | `@factory/cli`                    | `0.195.0`    | `>=0.195.0 <0.196.0` |
| `gemini`                | `@google/gemini-cli`              | `0.38.2`     | 同默认版本           |
| `grok`                  | `@xai-official/grok`              | `1.0.3`      | 同默认版本           |
| `copilot`               | `@github/copilot`                 | `1.0.36`     | 同默认版本           |
| `opencode`              | `opencode-ai`                     | `1.14.18`    | 同默认版本           |
| `pi`                    | `@earendil-works/pi-coding-agent` | `0.84.1`     | `>=0.84.1 <0.85.0`   |
| `claude-code.cli`       | `@anthropic-ai/claude-code`       | `latest`     | `>=2.1.114`          |
| `claude-code.routerCli` | `@musistudio/claude-code-router`  | `latest`     | `>=1.0.73`           |
| `kimi.cli`              | `kimi-cli`                        | `1.36.0`     | 同默认版本           |
| `cursor`                | Cursor Agent CLI 官方归档包       | `latest`     | 官方当前版本         |
| `goose`                 | Goose CLI 官方 release 归档包     | `1.46.0`     | `>=1.46.0`           |
| `kiro`                  | Kiro CLI 官方 stable manifest     | `latest`     | manifest 当前版本    |
| `junie`                 | `@jetbrains/junie`                | `2651.4.0`   | `>=26.8.10 <26.9.0`  |
| `qwen-code`             | `@qwen-code/qwen-code`            | `0.21.11`    | `0.21.11`            |

可以在项目配置里固定来源和版本：

```yaml
adapters:
  codex:
    cli:
      source: managed
      version: 0.130.0
      prepareOnInstall: true
  dsh:
    cli:
      source: managed
      version: 0.1.0-rc.6
  cline:
    cli:
      source: managed
      version: 3.0.54
  droid:
    cli:
      source: managed
      version: 0.195.0
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
  pi:
    cli:
      source: managed
      version: 0.84.1
  cursor:
    cli:
      source: managed
      version: latest
  goose:
    cli:
      source: managed
      version: 1.46.0
  kiro:
    cli:
      source: managed
      version: latest
  junie:
    cli:
      source: managed
      version: 2651.4.0
  qwen-code:
    cli:
      source: managed
      version: 0.21.11
```

`cli.source` 支持：

- `managed`：使用全局托管 bootstrap cache 中的托管 CLI；缺失时按 `autoInstall` 安装
- `system`：优先使用系统 `PATH` 中的原生命令；缺失时仍可按 `autoInstall` 安装
- `path`：只使用 `cli.path` 指向的 binary

Codex adapter 还会把用户登录 shell 里可解析到的 `codex` 作为系统 CLI 候选；在 macOS 上，还会追加 `/Applications/Codex.app/Contents/Resources/codex` 和 `~/Applications/Codex.app/Contents/Resources/codex`。Claude Code adapter 也会把用户登录 shell 里可解析到的 `claude` / `ccr` 作为系统 CLI 候选。Cline 会检查 `cline` binary，且只有 ACP identity、protocol、load capability 和精确验证版本都通过时才启用 native resume。Cursor 的 `system` 来源会依次探测 `agent` 与 `cursor-agent`。这些 fallback 候选都必须能正常启动。
Codex adapter 还会把用户登录 shell 里可解析到的 `codex` 作为系统 CLI 候选；在 macOS 上，还会追加 `/Applications/Codex.app/Contents/Resources/codex` 和 `~/Applications/Codex.app/Contents/Resources/codex`。Claude Code adapter 也会把用户登录 shell 里可解析到的 `claude` / `ccr` 作为系统 CLI 候选。Cursor 的 `system` 来源会依次探测 `agent` 与 `cursor-agent`。Kiro 会先探测 `kiro-cli`；`q` 只有在版本输出确认是 Kiro 且支持 `acp` 时才作为迁移别名。这些 fallback 候选都必须能正常启动。

把 `autoInstall` 设为 `false` 可以关闭首次使用时的自动安装。npm 托管 adapter 还支持 `cli.package`、`cli.npmPath`；Kimi 支持 `cli.package`、`cli.python`、`cli.uvPath`。Pi 需要 Node.js 22.19.0 或更高版本；其托管安装始终使用 `--ignore-scripts`，与上游推荐安装方式保持一致。Goose 只安装精确匹配的官方 release asset，并要求 release metadata 带有效 SHA-256 digest；digest 缺失时直接 fail closed。

如果希望提前把托管 CLI 下载到全局托管 bootstrap cache，可以显式运行：

```bash
oneworks adapter prepare codex claude-code cursor dsh gemini grok pi
oneworks adapter prepare codex claude-code cursor gemini goose grok pi
oneworks adapter prepare codex claude-code cline cursor gemini grok pi
oneworks adapter prepare codex claude-code cursor gemini grok kiro pi
oneworks adapter prepare codex claude-code cursor gemini grok junie pi
oneworks adapter prepare codex claude-code cursor gemini grok pi qwen-code
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

同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CURSOR`、`DSH`、`GEMINI`、`GROK`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：
同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CURSOR`、`GEMINI`、`GOOSE`、`GROK`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：
同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CLINE`、`CURSOR`、`GEMINI`、`GROK`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：
同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CURSOR`、`GEMINI`、`GROK`、`KIRO`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：
同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CURSOR`、`GEMINI`、`GROK`、`JUNIE`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：
同样可以用环境变量临时覆盖，`<ADAPTER>` 使用大写下划线，例如 `CODEX`、`CURSOR`、`GEMINI`、`GROK`、`QWEN_CODE`、`CLAUDE_CODE`、`CLAUDE_CODE_ROUTER`：

```bash
export __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_CODEX_INSTALL_VERSION__=0.130.0
export __ONEWORKS_PROJECT_ADAPTER_CODEX_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__=/absolute/path/to/codex

export __ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_CLINE_INSTALL_VERSION__=3.0.54
export __ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__=/absolute/path/to/cline

export __ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_SOURCE__=system
export __ONEWORKS_PROJECT_ADAPTER_CURSOR_INSTALL_VERSION__=latest
export __ONEWORKS_PROJECT_ADAPTER_CURSOR_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__=/absolute/path/to/agent

export __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_DSH_INSTALL_VERSION__=0.1.0-rc.6
export __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__=/absolute/path/to/dsh-acp-demo

export __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_GOOSE_INSTALL_VERSION__=1.46.0
export __ONEWORKS_PROJECT_ADAPTER_GOOSE_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__=/absolute/path/to/goose

export __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_SOURCE__=system
export __ONEWORKS_PROJECT_ADAPTER_KIRO_INSTALL_VERSION__=latest
export __ONEWORKS_PROJECT_ADAPTER_KIRO_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__=/absolute/path/to/kiro-cli

export __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_SOURCE__=managed
export __ONEWORKS_PROJECT_ADAPTER_JUNIE_INSTALL_VERSION__=2651.4.0
export __ONEWORKS_PROJECT_ADAPTER_JUNIE_AUTO_INSTALL__=false
export __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__=/absolute/path/to/junie

export __ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_VERSION__=1.36.0
export __ONEWORKS_PROJECT_ADAPTER_KIMI_INSTALL_PYTHON__=3.13
export __ONEWORKS_PROJECT_ADAPTER_KIMI_UV_PATH__=/absolute/path/to/uv

export __ONEWORKS_PROJECT_ADAPTER_PI_INSTALL_VERSION__=0.84.1
export __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__=/absolute/path/to/pi

export __ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_INSTALL_VERSION__=0.21.11
export __ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__=/absolute/path/to/qwen
```
