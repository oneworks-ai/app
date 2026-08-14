# Adapter CLI Installation and Versions

Back to services: [runtime.md](./runtime.md)

One Works does not package every native CLI as a runtime dependency of its adapter packages. On first use, adapters try these sources in order:

1. an explicitly configured binary
2. the global managed bootstrap cache
3. the system `PATH`
4. managed installation into the global managed bootstrap cache

Managed packages:

- npm managed: `codex`, `cline`, `droid`, `dsh`, `gemini`, `grok`, `junie`, `copilot`, `opencode`, `pi`, `qwen-code`, `claude-code.cli`, `claude-code.routerCli`
- uv managed: `kimi.cli`
- official release managed: `cursor`, `goose`, `kiro`

Default managed versions:

| Adapter                 | Managed package                    | Default install version | Compatible range     |
| ----------------------- | ---------------------------------- | ----------------------- | -------------------- |
| `codex`                 | `@openai/codex`                    | `latest`                | `>=0.130.0`          |
| `dsh`                   | official DeepSeek ACP composition  | `0.1.0-rc.6`            | default version      |
| `cline`                 | `cline`                            | `3.0.54`                | exact `3.0.54`       |
| `droid`                 | `@factory/cli`                     | `0.195.0`               | `>=0.195.0 <0.196.0` |
| `gemini`                | `@google/gemini-cli`               | `0.38.2`                | default version      |
| `grok`                  | `@xai-official/grok`               | `1.0.3`                 | default version      |
| `copilot`               | `@github/copilot`                  | `1.0.36`                | default version      |
| `opencode`              | `opencode-ai`                      | `1.14.18`               | default version      |
| `pi`                    | `@earendil-works/pi-coding-agent`  | `0.84.1`                | `>=0.84.1 <0.85.0`   |
| `claude-code.cli`       | `@anthropic-ai/claude-code`        | `latest`                | `>=2.1.114`          |
| `claude-code.routerCli` | `@musistudio/claude-code-router`   | `latest`                | `>=1.0.73`           |
| `kimi.cli`              | `kimi-cli`                         | `1.36.0`                | default version      |
| `cursor`                | official Cursor Agent CLI archive  | `latest`                | current version      |
| `goose`                 | official Goose CLI release archive | `1.46.0`                | `>=1.46.0`           |
| `kiro`                  | official Kiro stable manifest      | `latest`                | manifest release     |
| `junie`                 | `@jetbrains/junie`                 | `2651.4.0`              | `>=26.8.10 <26.9.0`  |
| `qwen-code`             | `@qwen-code/qwen-code`             | `0.21.11`               | `0.21.11`            |

Pin source and version in project config:

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

`cli.source` supports:

- `managed`: use the managed CLI in the global managed bootstrap cache and install it when missing if `autoInstall` allows it
- `system`: prefer the system `PATH`, still allowing install when missing if `autoInstall` allows it
- `path`: use only the binary pointed to by `cli.path`

The Codex adapter also treats the `codex` binary resolved by the user's login shell as a system CLI candidate. On macOS, it also adds `/Applications/Codex.app/Contents/Resources/codex` and `~/Applications/Codex.app/Contents/Resources/codex`. The Claude Code adapter also treats the `claude` and `ccr` binaries resolved by the user's login shell as system CLI candidates. Cline checks the `cline` binary and enables native resume only after its ACP identity, protocol, load capability, and exact verified version pass. Cursor's `system` source checks `agent` and then `cursor-agent`. Every fallback candidate must launch successfully.
The Codex adapter also treats the `codex` binary resolved by the user's login shell as a system CLI candidate. On macOS, it also adds `/Applications/Codex.app/Contents/Resources/codex` and `~/Applications/Codex.app/Contents/Resources/codex`. The Claude Code adapter also treats the `claude` and `ccr` binaries resolved by the user's login shell as system CLI candidates. Cursor's `system` source checks `agent` and then `cursor-agent`. Kiro checks `kiro-cli` first; `q` is a migration alias only when its version identifies Kiro and it supports `acp`. Every fallback candidate must launch successfully.

Set `autoInstall: false` to disable first-use installation. npm-managed adapters also support `cli.package` and `cli.npmPath`. Kimi supports `cli.package`, `cli.python`, and `cli.uvPath`. Pi requires Node.js 22.19.0 or newer; its managed installation always uses `--ignore-scripts`, matching the upstream recommendation. Goose requires an exact official release asset and a valid SHA-256 digest in release metadata; installation fails closed when the digest is missing.

Prepare managed CLIs ahead of time:

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

Without an explicit target, `oneworks adapter prepare` only prepares CLIs that declare `prepareOnInstall: true`.

You can also specify a managed CLI version directly during startup:

```bash
oneworks -A codex@0.130.0 "read README and summarize it"
oneworks -A codex "keep using the Codex CLI version recorded in this project"
```

The `-A <adapter>@<version>` form writes `adapters.<adapter>.cli.version` into local dev config, so later starts keep using the same version.

`@oneworks/cli` postinstall reads `.oo.config.json` or `infra/.oo.config.json` at the project root. It only calls `oneworks adapter prepare --from-postinstall` when it finds `prepareOnInstall: true`. It skips by default when `CI=true`. Use `ONEWORKS_POSTINSTALL_PREPARE=1` to warm caches in CI, or `ONEWORKS_SKIP_ADAPTER_PREPARE=1` / `ONEWORKS_SKIP_POSTINSTALL=1` to skip.

Temporary environment overrides use upper-case adapter names such as `CODEX`, `CURSOR`, `DSH`, `GEMINI`, `GROK`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:
Temporary environment overrides use upper-case adapter names such as `CODEX`, `CURSOR`, `GEMINI`, `GOOSE`, `GROK`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:
Temporary environment overrides use upper-case adapter names such as `CODEX`, `CLINE`, `CURSOR`, `GEMINI`, `GROK`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:
Temporary environment overrides use upper-case adapter names such as `CODEX`, `CURSOR`, `GEMINI`, `GROK`, `KIRO`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:
Temporary environment overrides use upper-case adapter names such as `CODEX`, `CURSOR`, `GEMINI`, `GROK`, `JUNIE`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:
Temporary environment overrides use upper-case adapter names such as `CODEX`, `CURSOR`, `GEMINI`, `GROK`, `QWEN_CODE`, `CLAUDE_CODE`, and `CLAUDE_CODE_ROUTER`:

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
