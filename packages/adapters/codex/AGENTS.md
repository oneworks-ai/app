# Codex Adapter

One Works adapter for [OpenAI Codex CLI](https://developers.openai.com/codex).

The adapter drives Codex in two modes:

- **`stream`** (default) — spawns `codex app-server` and communicates over JSON-RPC 2.0 / JSONL.
- **`direct`** — spawns the interactive `codex` (or `codex resume`) CLI with `stdio: 'inherit'`, handing the terminal directly to the user.

---

## Official documentation

| Topic         | URL                                                  |
| ------------- | ---------------------------------------------------- |
| CLI reference | https://developers.openai.com/codex/cli/reference.md |
| Hooks         | https://developers.openai.com/codex/hooks            |
| Config basics | https://developers.openai.com/codex/config-basic     |
| Sample config | https://developers.openai.com/codex/config-sample    |
| MCP servers   | https://developers.openai.com/codex/mcp              |

---

## Hooks maintenance

Cross-reference these docs first when touching hooks:

- `.oo/rules/ADAPTERS.md` — adapter 统一设计、原生资产自动适配、运行时配置和真实 CLI 验证入口
- `.oo/rules/HOOKS.md` — user-facing behavior, event matrix, project mock-home asset layout
- `.oo/rules/HOOKS-REFERENCE.md` — real CLI smoke commands, lessons learned, shared runtime entrypoints
- `apps/cli/src/AGENTS.md` — CLI hook bridge entry and `call-hook.js` routing

Primary implementation entrypoints for Codex hooks:

- `src/runtime/native-hooks.ts`
  - writes the managed `<project-home>/.mock/.codex/hooks.json`
- `src/runtime/init.ts`
  - installs mock-home assets during adapter init
  - keeps hooks/config in `<project-home>/.mock/.codex/`, maps workspace skills into `<project-home>/.mock/.agents/skills`, and mirrors each skill into `<project-home>/.mock/.codex/skills/<name>`
  - writes a managed `<project-home>/.mock/.codex/config.toml` that trusts the current workspace and suppresses startup update checks unless `configOverrides` restores them
- `src/runtime/accounts.ts`
  - reads Codex accounts from `adapters.codex.accounts`; `codex login` writes base64 encoded `auth.json` into global `~/.oneworks/.oo.config.json`
  - treats the current `~/.codex/auth.json` as a read-only fallback account source and does not migrate it into project-local storage
  - prepares per-session HOME roots under `<project-home>/caches/<ctxId>/<sessionId>/adapter-codex-home`
  - does not bridge the whole shared `.codex` tree into a session HOME; only auth, config, hooks, skills, and sessions are intentionally linked so global plugin caches and app state cannot slow `codex app-server` startup
  - normalizes the imported Codex config before using that HOME with the CLI, so unsupported values from a user's real config do not break One Works sessions.
  - queries Codex account info and rate-limit/quota snapshots through `codex app-server`
  - reads the ChatGPT profile avatar after account refresh, persists only trusted-host HTTPS image URLs, and keeps an explicitly configured `avatarUrl` authoritative
  - exposes standard adapter account management actions: add via `codex login`, detail lookup, refresh, and remove from global config
- `src/models.ts`
  - exposes Codex model selector metadata to One Works
  - prefers Codex's `model_catalog_json` config file or `models_cache.json` under `CODEX_HOME` / `~/.codex`
  - falls back to packaged model metadata only when no Codex catalog/cache is readable
- `src/runtime/model-provider-import.ts`
  - implements the shared `model-provider-import` discovery capability used by the explicit Model Services import row; adapter init never imports automatically
  - reads user-level Codex `model_providers` for global imports and workspace layers for project imports
  - returns mapped `modelServices` without writing One Works config; the server owns additions-only target-source persistence
  - never materializes a global/user overlay into project discovery output
  - keeps Codex-only authentication, AWS, header, query, and retry settings under `modelServices.<key>.extra.codex`
- `src/runtime/model-provider-project-config-read.ts`
  - discovers active project `.codex/config.toml` layers through app-server `config/read`
  - skips layers with `disabledReason`, then parses ignored provider keys through an isolated temporary user layer
  - merges root-to-cwd project layers with the closest layer winning
- `src/runtime/worktree-environment-import.ts`
  - implements the optional `worktree-environment-import` capability for explicit Environment-page imports
  - discovers bounded, regular `*.toml` files under the canonical `workspace/.codex/environments` directory with no-follow reads; both generated numbered files and named environment files are supported
  - treats a missing native schema version as version 1, rejects unsupported versions, treats an empty lifecycle script as absent, and fails the whole candidate closed when any non-empty declared lifecycle script is invalid or oversized
  - maps Codex `setup` scripts to One Works `create` scripts and `cleanup` scripts to `destroy`; platform scripts override the base script, while Codex actions are reported as skipped and never become `start`
  - returns discovery candidates only; the server owns validation, additions-only persistence, and source conflict handling
- `src/runtime/session-common.ts`
  - enables `hooks`, injects runtime config, model/provider settings, and session env
- `src/hook-bridge.ts`
  - translates Codex native payloads into One Works hook input/output
- `src/runtime/stream.ts`
  - maps app-server `item/started -> contextCompaction` into observational `PreCompact`
- `src/runtime/transcript-hooks.ts`
  - bridges transcript JSONL tool observations for non-Bash events
- `packages/hooks/call-hook.js`
- `packages/hooks/src/entry.ts`
- `packages/hooks/src/native.ts`
- `packages/hooks/src/bridge.ts`
- `packages/task/src/run.ts`

Keep the ownership split clean:

- adapter layer: writes Codex-native config, passes runtime env, and owns Codex protocol translation
- CLI bridge: only dispatches into the adapter-owned bridge/runtime entry
- hooks runtime: loads workspace plugins; task runtime applies native/bridge dedupe

### Real CLI smoke

Do not stop at unit tests. Run a real Codex CLI turn:

Quick path from repo root:

```bash
pnpm test:e2e:adapters
pnpm tools adapter-e2e run codex
pnpm tools adapter-e2e test codex-read-once --update
```

This command starts the local mock LLM server and drives Codex through the `hook-smoke-mock` model service defined in the repo-root `.oo.config.json`. The shared adapter E2E harness lives under `scripts/adapter-e2e/`, and the scripts CLI entry is `scripts/cli.ts`.
The case definition, spec, and expected snapshot live together under `scripts/__tests__/adapter-e2e/`.

```bash
__ONEWORKS_PROJECT_CTX_ID__='hooks-smoke-codex' \
node apps/cli/cli.js \
  --adapter codex \
  --model hook-smoke-mock,codex-hooks \
  --print \
  --no-inject-default-system-prompt \
  --session-id '<uuid>' \
  "Use the Read tool exactly once on README.md, then reply with exactly E2E_CODEX and nothing else."
```

Validation checklist:

- terminal output is exactly `E2E_CODEX`
- `<project-home>/logs/<ctxId>/<sessionId>.log.md` contains `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`
- `<project-home>/.mock/.codex/hooks.json` still points to the managed One Works bridge
- `<project-home>/.mock/.codex/config.toml` marks the current workspace `[projects."<cwd>"]` as `trusted`

Codex maintenance notes:

- native hooks should stay entirely inside mock home; do not write to the real Codex home
- session HOME preparation may copy user Codex config, but runtime-facing config must remain compatible with the Codex CLI version One Works starts; normalize or comment unsupported scalar values rather than letting the session fail at config parse time
- Codex 官方文档里的用户级 skills 入口仍是 `<project-home>/.mock/.agents/skills`
- 但当前真实 runtime 会在 `<project-home>/.mock/.codex/skills/.system` 下维护系统技能，所以 workspace skills 也要镜像进 `<project-home>/.mock/.codex/skills/<name>`
- Codex 2026-03-27 official hooks docs say `~/.codex/hooks.json` and `<repo>/.codex/hooks.json` are both loaded, so project-level managed hooks must be deduped before writing mock-home hooks
- `SessionEnd` is still framework-owned and should not be reintroduced in Codex-native config
- when native hooks are active, bridge duplicates must stay disabled in `packages/task/src/run.ts`
- Codex native `PreToolUse` / `PostToolUse` should be treated as Bash-first until official coverage expands; transcript JSONL can supplement non-Bash analytics, but it cannot block or rewrite the live session
- Codex stream app-server now surfaces `contextCompaction`; we map that to unified `PreCompact` as a bridge-only observation with `canBlock: false`
- Codex app-server may spend tens of seconds in first-turn startup, remote plugin / MCP setup, or ChatGPT connection retry before any assistant text arrives. Do not leave this only in Codex private sqlite logs: stream mode should emit safe adapter `operation` events for user-visible phases, while raw Codex logs remain debug-only because they can include local paths or account/request details.

Relevant official docs:

- [Codex Skills](https://developers.openai.com/codex/skills)
- [Codex AGENTS.md](https://developers.openai.com/codex/agents-md)
- [Codex Config basics](https://developers.openai.com/codex/config-basic)

---

## Adapter configuration

Adapter-specific options live under `adapters.codex` in your oneworks config.

```ts
// .oo.config.ts / .oo.dev.config.ts
import { defineConfig } from '@oneworks/config'

export default defineConfig({
  adapters: {
    codex: {
      sandboxPolicy: { type: 'workspaceWrite' },
      experimentalApi: false,
      defaultAccount: 'work',
      accounts: {
        work: {
          title: 'Work'
        },
        personal: {
          title: 'Personal'
        }
      },
      effort: 'medium',
      maxOutputTokens: 4096,
      clientInfo: { name: 'oneworks', title: 'One Works', version: '0.1.0' },
      configOverrides: {
        check_for_update_on_startup: false
      },
      features: {
        shell_snapshot: true,
        unified_exec: false
      }
    }
  }
})
```

### `defaultAccount` / `accounts`

Codex 多账号切换走 adapter 通用 `account` 能力：

- `defaultAccount`：没有显式选择账号时使用的账号 key
- `accounts.<key>.title` / `description`：前端显示信息
- `accounts.<key>.auth`：Codex 登录态，形如 `{ type: 'codex-auth-json', encoding: 'base64', token: '<base64>' }`
- `accounts.<key>.authFile`：可选，高级显式来源；指定某个账号的 `auth.json` 路径时会优先使用这个文件
- `accounts.<key>` 里的 `email / planType / quota / authDigest / updatedAt` 是账号详情和 quota 的缓存元信息
- `ow accounts add codex [accountName]` 和 Web 侧新增账号都写入 global `~/.oneworks/.oo.config.json`，不要写回 project-local account snapshot
- 旧的 `<project-home>/.local/adapters/codex/accounts/<key>/auth.json` / `meta.json` 不再参与账号发现，也不做自动迁移

如果本机存在 `~/.codex/auth.json`，adapter 会把它作为只读 fallback account 展示和使用；这条 fallback 不会写入 One Works config。要让 Codex 登录态通过 Relay 同步到其他设备，必须通过 `ow accounts add codex [accountName]` 或 Web 登录入口把它保存到 global config。

session 级 HOME 仍然完全隔离：如果账号来自 global config，adapter 会把 base64 auth materialize 成当前 session 的 `.codex/auth.json`；如果账号来自 `authFile` 或 real home fallback，则会 symlink 到对应文件。

现在还支持两类额外入口：

- `ow accounts add codex [accountName]`
  - 在隔离 HOME 下执行 `codex login`
  - 登录完成后读取生成的 `auth.json`
  - 把 `auth.json` base64 写入 global `~/.oneworks/.oo.config.json` 的 `adapters.codex.accounts.<key>.auth.token`
- Web 配置页 `Adapters -> Codex -> Accounts`
  - adapter 详情页会先展示 `defaultAccount` 选择，再展示 `账号` 入口
  - 账号根页可直接触发 `Connect account`
  - 三级详情页可查看来源、rate-limit / quota 摘要，并编辑 `title / description / authFile`
  - `description` 在前端按 multiline 字段编辑
  - `authFile` 留空时默认使用 global config 里的 inline auth

额度探测补充：

- Codex quota 现在通过 `codex app-server` 的 `account/rateLimits/read` 读取
- 配置页默认读 global config 里的 quota 快照
- 当前快照 TTL 是 5 分钟；CLI `ow accounts show codex <account>` 会强制刷新
- 如果 Codex 只返回套餐信息而没有 credits / rate limits，前端只展示真实返回的套餐或窗口限额，不伪造额度余额

账号头像探测补充：

- `account/read` 不提供头像；`src/runtime/account-profile.ts` 只在服务端于账号刷新后读取当前 auth 的 access token，并向固定 ChatGPT profile 端点请求 `profile_picture_url`。不要把 token、profile response 或这次请求下放到浏览器。
- 头像请求必须短超时、静默失败，并只接受 OpenAI / ChatGPT 受信域名下的 HTTPS URL；profile 端点变化不能让账号列表或 quota 探测失败。
- 显式配置的 `avatarUrl` 始终优先。global account 可缓存自动探测到的受信头像 URL，real-home fallback 只在当前响应中使用；前端在 URL 缺失或图片失败时继续使用确定性本地头像。
- 改 profile enrichment 时至少运行 `packages/adapters/codex/__tests__/account-profile.spec.ts`，验证 token 提取、profile endpoint fallback、受信 HTTPS host 拒绝和缺失 token 行为。另需检查调用点只在 refresh probe 中启用、请求失败不影响账号/quota、手动配置优先及 global metadata 持久化；再用真实账号确认返回 URL 能被前端加载，但不要在日志或测试快照中记录 token、完整 profile response 或个人头像 URL。

Docker / Linux sync smoke:

```bash
node scripts/verify-codex-global-config-sync.mjs
```

这个脚本是 Codex global account 经 Relay 同步到 Linux 远端 daemon 的真实链路验收，不是单元测试替代品。脚本会先把当前 workspace 需要的 One Works package 打成 tarball，在 Linux Node 容器中用这些 tarball 安装一个真实的 `/opt/oneworks-daemon` 运行时，然后通过 `npx oneworks daemon` 启动 daemon。不要把 repo 源码复制进容器当运行时，也不要通过手工改 relay store / auth snapshot / 数据库来伪造设备、账号或 workspace。

完整验收要覆盖这些点：

- Docker build context 只包含脚本需要的 Dockerfile / smoke 入口，不把整个 repo 当镜像上下文。
- 容器内 daemon 由安装产物启动；`docker top` 里可能显示为 `npm exec oneworks daemon ...`，这是 `npx oneworks daemon` 的正常进程形态。
- 容器通过 Relay 连接当前本机 server，并以独立 Linux HOME / config dir 注册成真实远端设备。
- Launcher 发现远端 device / workspace 后，`workspaces/directories`、`workspaces/open`、`workspaces/create` 都要通过 relay plugin API 触发目标 daemon，而不是创建本地假 session。
- 远程 workspace session 的 `/api/config` 能读到 `~/.oneworks/.oo.config.json` 中 base64 保存的 Codex auth，并在 session HOME materialize 成 `.codex/auth.json`。
- 设置 `ONEWORKS_RELAY_DOCKER_VERIFY_AGENT=1` 时，脚本要通过真实远程 workspace session 发送消息并等待 agent 回复；这一步不能用容器内直接跑 `codex exec` 替代。

推荐的完整命令：

```bash
ONEWORKS_RELAY_DOCKER_VERIFY_AGENT=1 \
ONEWORKS_RELAY_DOCKER_AGENT_MODEL=gpt-5.5 \
node scripts/verify-codex-global-config-sync.mjs
```

脚本成功时重点看最终 JSON：`config.authAccountCount > 0`、`remote.workspaceUrl` / `remote.createdWorkspaceUrl` 存在，开启 agent 验证时 `agent.status === "ok"`。如果 Codex CLI 安装过程长时间没有退出，但 `codex.js --version` 已经可用，脚本会继续后续 smoke；不要因为 npm 子进程仍在下载缓存就误判 daemon 没启动。ChatGPT Codex 账号的可用模型会变，默认模型是 `gpt-5.5`，需要时用 `ONEWORKS_RELAY_DOCKER_AGENT_MODEL` 覆盖，不要把一次调试中不可用的模型写死。

改动该链路后至少跑：

```bash
node --check scripts/verify-codex-global-config-sync.mjs
pnpm exec eslint scripts/verify-codex-global-config-sync.mjs
pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/bootstrap/__tests__/package-launcher.spec.ts
```

如果改动影响 packaged CLI / server resolution，再跑一次上面的 Docker smoke。脚本不依赖宿主机已有 `node_modules`；如果本机没有 Docker / Colima / OrbStack，会直接提示缺少 Docker runtime。

### `sandboxPolicy`

Maps to the codex `sandbox_mode` / `--sandbox` CLI flag.

| oneworks type              | codex value          |
| -------------------------- | -------------------- |
| `workspaceWrite` (default) | `workspace-write`    |
| `readOnly`                 | `read-only`          |
| `dangerFullAccess`         | `danger-full-access` |

Optional fields on the sandbox policy object:

```ts
const sandboxPolicy = {
  type: 'workspaceWrite',
  writableRoots: ['/tmp/extra'], // extra writable roots
  networkAccess: true // allow outbound network inside sandbox
}
```

### `features`

Maps to `--enable <name>` / `--disable <name>` flags.\
Keys must be valid codex feature names (run `codex features list` to see all).

Notable flags:

| Name                 | Default | Description                                                              |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| `shell_snapshot`     | false   | Snapshot shell environment for faster repeated commands                  |
| `unified_exec`       | false   | Use PTY-backed exec tool                                                 |
| `shell_tool`         | true    | Enable default shell tool                                                |
| `undo`               | true    | Per-turn git ghost snapshots                                             |
| `web_search_request` | true    | Live web search                                                          |
| `remote_models`      | false   | Refresh remote model list at startup                                     |
| `hooks`              | false   | Native `SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop` hooks |

### `configOverrides`

Raw Codex `-c key=value` overrides forwarded to every Codex spawn.

The adapter also mirrors `check_for_update_on_startup` into the managed mock-home
`config.toml`, defaulting it to `false` so managed Codex sessions do not surface
startup version-update prompts. Set
`adapters.codex.configOverrides.check_for_update_on_startup = true` if you need
to restore Codex's built-in startup update check.

During init, the adapter also writes:

```toml
[projects."/absolute/path/to/workspace"]
trust_level = "trusted"
```

so Codex does not stop on first-run workspace trust prompts inside the isolated
mock home.

### Native model provider import

When the real user-level `CODEX_HOME/config.toml` or `~/.codex/config.toml`
contains `model_provider`, `model_providers`, or `openai_base_url`, the Model Services
config page exposes Codex in its explicit adapter import row. Global discovery reads
the real user config; project imports read trusted workspace `.codex/config.toml` layers.
Adapter init must stay read/write-free for this feature.
Codex itself ignores provider and authentication keys in project config; the adapter therefore
uses app-server only to discover active/trusted layers, then parses each original project TOML
as an isolated temporary user layer. Do not replace this with a partial TOML parser.

The capability never changes the native Codex file and only returns discovered model services.
The server performs the idempotent, additions-only write and never overwrites an existing One
Works service in the same source. Project discovery only merges project raw values, so global/user
provider values and secrets are not expanded into a committable project file. The action imports
`modelServices` only; it does not silently change adapter defaults.

Imported services use `extra.codex.nativeProvider` so session routing restores
Codex-native provider fields directly instead of sending them through the
One Works proxy. Keep command auth, AWS options, `env_key`, environment-backed
headers, retry settings, and `requires_openai_auth` on this direct path.

### Native worktree environment import

The Environment config page exposes Codex through the adapter package's optional
`worktree-environment-import` export. Discovery is explicit and read-only: adapter init must
not import environments or write One Works files. Read only regular, non-symlinked native
environment TOML files within the canonical workspace `.codex/environments` directory.
Discovery accepts generated default/numbered files and named `*.toml` environments, uses bounded
no-follow file handles, and treats an omitted schema version as version 1.

Codex `setup` scripts map to One Works `create` variants and `cleanup` scripts map to
`destroy` variants for base, Darwin, Linux, and Windows; a matching platform script overrides
the base script. Treat empty base scripts as absent so a valid platform-only override remains
importable, and avoid emitting suggested IDs ending in the reserved `.local` suffix. Native `actions` have a different
interaction model, so report them as skipped and never map them to `start`. The adapter returns
script candidates in memory; the server validates every candidate before writing and creates
only missing Project or User environments without merging or overwriting an existing directory.

### Native hooks

When workspace hook plugins are configured, the adapter now installs a managed `hooks.json`
into the isolated mock Codex home and auto-enables the `hooks` feature flag for that
session. This lets Codex run native:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

Those native events are bridged back into the same One Works hook runtime used by Claude Code
and OpenCode. `SessionEnd` still comes from the framework bridge.

Codex limitation:

- today the reliable native `PreToolUse` / `PostToolUse` control surface is still `Bash`
- official Codex hooks docs still do not expose a native `PreCompact`; current `PreCompact` support comes from app-server `contextCompaction` in stream mode only
- if we add transcript JSONL watching for non-Bash tools, treat it as a stats-only side channel
- bridge observation does not carry hook return semantics, so it must not be documented or implemented as a blocking substitute for native hooks

### `effort`

Reasoning effort for supported models: `'low' | 'medium' | 'high'`.\
Passed to `turn/start` RPC calls in `stream` mode.

### `maxOutputTokens`

Maximum completion tokens per turn in `stream` mode.\
Passed to `turn/start` as `maxOutputTokens`.

### `experimentalApi`

Passed as `capabilities.experimentalApi` during the `initialize` handshake in `stream` mode.\
Enable this to expose gated app-server fields and methods.

---

## Model selection

Model is set via `AdapterQueryOptions.model` (not in adapter config).

### Plain model name

```
model: "gpt-5.4"
```

Passed directly as `--model gpt-5.4` (direct) or `model: "gpt-5.4"` in RPC calls (stream).

### Model service routing — `"service,model"` format

When the model string contains a comma, the adapter resolves it against `modelServices` and injects the provider configuration via `-c` overrides. Routed services are sent through a per-process local proxy so oneworks can translate service-level settings that Codex does not expose natively.

```
model: "myProvider,gpt-4o-mini"
```

This emits (in order):

```sh
-c 'model_provider="myProvider"'
-c 'model_providers.myProvider.name="My Provider"'
-c 'model_providers.myProvider.base_url="http://127.0.0.1:<random-port>"'
-c 'model_providers.myProvider.experimental_bearer_token="sk-..."'
-c 'model_providers.myProvider.wire_api="responses"'
-c 'model_providers.myProvider.http_headers={X-OneWorks-Proxy-Meta = "<base64url-json>"}'
```

`wire_api` defaults to `"responses"`. Override per service via `service.extra.codex.wireApi`.
Static provider headers, query params, upstream base URL, and `maxOutputTokens` are encoded into the proxy metadata header and restored by the local proxy before the request is forwarded upstream.

The local proxy is started automatically by the adapter. Users do not need to run it manually. The proxy listens on a random loopback port and is reused across repeated routed Codex sessions in the same process.

`modelServices.<service>.maxOutputTokens` does not rely on a native Codex provider field. Instead, the adapter encodes it into the proxy metadata, and the proxy writes it into the outgoing Responses API JSON body as `max_output_tokens` when the upstream request does not already define that field.

Corresponding oneworks config:

```ts
const modelServices = {
  myProvider: {
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-...',
    title: 'My Provider',
    extra: {
      codex: {
        wireApi: 'responses',
        headers: { 'X-Tenant': 'tenant-1' },
        queryParams: { 'api-version': '2025-04-01-preview' }
      }
    }
  }
}
```

> `experimental_bearer_token` is a dev-only per-provider API key field in codex config.
> See the [sample config](https://developers.openai.com/codex/config-sample) under `[model_providers]`.

### Proxy logs

When routed model services use the local proxy, adapter-specific proxy logs are written to:

```text
<project-home>/logs/<ctxId>/<sessionId>/adapter-codex/proxy.log.md
```

This mirrors the adapter-scoped logging layout used by the Claude Code Router transformers. Proxy logs are separate from the main task/session log file and include structured request/response diagnostics without dumping sensitive query parameter values or credentials.

Each proxied request now logs:

- the full incoming request headers/body that Codex sent to the local proxy
- the final upstream URL, headers, and body after oneworks mutations such as `max_output_tokens` injection
- adapter-side routing context encoded in proxy metadata, including routed service, requested/resolved model, runtime, permission policy, and effort
- response headers plus full non-stream error bodies when the upstream provider returns a failure status

---

## Permission / approval policy

Set via `AdapterQueryOptions.permissionMode`. Mapped to codex values:

| oneworks `permissionMode`          | codex mapping                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `bypassPermissions`                | `--dangerously-bypass-approvals-and-sandbox` (`--yolo`) + `danger-full-access` |
| `dontAsk`                          | `approval_policy = never` / `--ask-for-approval never`                         |
| `plan`                             | `approval_policy = on-request` / `--ask-for-approval on-request`               |
| `default`, `acceptEdits`, or unset | `approval_policy = untrusted` / `--ask-for-approval untrusted`                 |

---

## System prompt

`AdapterQueryOptions.systemPrompt` is injected via:

```sh
-c 'developer_instructions="<prompt>"'
```

Maps to [`developer_instructions`](https://developers.openai.com/codex/config-sample) in `config.toml`.

---

## MCP servers

MCP server configuration is read from `config.mcpServers` and `userConfig.mcpServers`, merged in that order. Servers with `enabled: false` are filtered out. Include/exclude rules from `options.mcpServers` (or `defaultIncludeMcpServers` / `defaultExcludeMcpServers` in config) are applied before injection.

Each surviving server is injected as `-c mcp_servers.<name>.*` overrides.

Codex parses `-c` keys as config paths, not as a TOML document, and its runtime MCP manager only starts
server IDs that are safe tool-namespace segments. Workspace plugin MCP assets use scoped
`<plugin>/<asset>` names, so the adapter keeps the scoped name for selection and permission resolution,
then maps it to a deterministic `oneworks-<base64url>` server ID when building Codex overrides. Do not
pass `/` through or quote the segment: raw `/` is not started, while quoting makes the quote characters
part of the server name.

### STDIO transport

Detected by the presence of a `command` key.

```toml
# config.toml equivalent
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env = { API_KEY = "value" }
```

Emitted as:

```sh
-c 'mcp_servers.context7.command="npx"'
-c 'mcp_servers.context7.args=["-y","@upstash/context7-mcp"]'
-c 'mcp_servers.context7.env={API_KEY = "value"}'
```

### Streamable HTTP transport

Detected by the presence of a `url` key (`type: 'sse' | 'http'` in oneworks config).\
oneworks `headers` maps to codex `http_headers`.

```toml
# config.toml equivalent
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

Emitted as:

```sh
-c 'mcp_servers.figma.url="https://mcp.figma.com/mcp"'
-c 'mcp_servers.figma.http_headers={"X-Figma-Region" = "us-east-1"}'
```

The adapter also projects `startup_timeout_sec` and `tool_timeout_sec` for MCP assets whose startup or
individual calls need longer than Codex defaults. See the [MCP docs](https://developers.openai.com/codex/mcp)
for additional fields (`enabled_tools`, `disabled_tools`, `bearer_token_env_var`, etc.); fields not listed
above still need to be set in `~/.codex/config.toml` directly.

---

## Modes

### `stream` mode (default)

```
codex app-server [-c ...overrides] [--enable/--disable ...]
```

- Full JSON-RPC 2.0 lifecycle: `initialize` → `thread/start` (or `thread/resume`) → `turn/start`
- Supports mid-turn `turn/steer` and `turn/interrupt` via `emit()`
- Session thread IDs are cached in `adapter.codex.threads` for future resume

### `direct` mode

```
codex [-c ...overrides] [--model ...] [--sandbox ...] [--ask-for-approval ...] [--enable/--disable ...] [prompt?]
```

- `stdio: 'inherit'` — the terminal is given directly to the user
- `emit()` is a no-op in this mode
- `extraOptions` are appended before the prompt positional argument

#### Resume in `direct` mode

When `options.type === 'resume'`, the adapter looks up the cached codex thread ID and calls:

```
codex resume [--model ...] [--sandbox ...] [...] <threadId | --last> [prompt?]
```

If no cached thread ID is found it falls back to `--last` (most recent session in cwd).

---

## CLI reference highlights

The full reference is at https://developers.openai.com/codex/cli/reference.md.\
Key flags used by this adapter:

| Flag                   | Description                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `-c key=value`         | Override any config.toml key for this invocation. Values parse as JSON if possible, otherwise as a literal string. |
| `--model`              | Override the active model.                                                                                         |
| `--sandbox`            | `read-only \| workspace-write \| danger-full-access`                                                               |
| `--ask-for-approval`   | `untrusted \| on-request \| never`                                                                                 |
| `--enable / --disable` | Toggle feature flags for this run.                                                                                 |
| `--mcp-config`         | **(app-server only)** Path to a JSON MCP config file — not used by this adapter; MCP is injected via `-c`.         |

### Configuration precedence (codex)

1. CLI flags and `-c` overrides ← **this adapter operates here**
2. Profile values (`--profile`)
3. Project `.codex/config.toml`
4. User `~/.codex/config.toml`
5. System `/etc/codex/config.toml`
6. Built-in defaults
