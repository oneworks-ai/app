# Goose CLI 适配器

`goose` 通过官方 Goose CLI 的 ACP stdio server 运行。One Works 负责 session 编排边界，Goose 负责 coding-agent 会话与工具执行；默认托管版本为 `1.46.0`。

## 配置示例

```yaml
adapters:
  goose:
    cli:
      source: managed
      version: 1.46.0
      variant: standard
      prepareOnInstall: true
    provider: anthropic
    mode: approve
    inheritNativeAuth: true
```

`cli.source` 支持 `managed`、`system` 与 `path`，显式路径必须是绝对路径。托管安装只接受安全的单段版本号，严格选择官方平台/架构资产，强制校验 release metadata 发布的 SHA-256 digest，拒绝 archive 路径穿越与 symlink；只有最终 `goose --version` 通过后才会原子替换版本目录。托管 prerelease 必须完整匹配 prerelease 标识；配置的 release 版本不接受 build metadata，但二进制输出的 build metadata 不改变 semver 身份。

## 运行时与会话归属

- One Works 启动 `goose acp`。首个进程创建原生 session 并缓存 Goose session id；后续 One Works resume 进程必须用 `session/load` 加载同一个 id。原生 id 缺失或不可加载时直接失败，不会静默创建新会话。
- ACP 的文本、usage、工具调用、工具结果、权限请求、取消与退出事件会投影到 One Works runtime。权限选项先归一化为 One Works 语义，再映射回 Goose 的精确原生 option id。`session/load` 期间的 replay notification 会先被抑制，随后才接收 live update；启动和关闭 RPC 都有 deadline，超时后会强制清理子进程。
- 每个 session 使用隔离的 `GOOSE_PATH_ROOT`，并隔离 XDG config/data/state/cache。selected skills 链接到该 root 的 `.agents/skills`；stdio 与 HTTP MCP 通过 ACP 传入。由于 Goose ACP 不支持 SSE，正常资产规划会先跳过 SSE MCP 并给出 Goose diagnostic；直接注入不支持的输入仍会 fail closed。
- stdio MCP 的裸命令只用 tombstone-aware 的最小环境进行发现，其中仅包含 path、shell、home、locale、proxy、certificate、平台与临时目录基础变量。启动 `goose acp` 前，One Works 会移除宿主的 `NODE_OPTIONS`、`NODE_PATH` 以及当前或旧版 One Works loader 状态；显式 MCP 环境也应用同一边界。MCP server 所需的 Node module path 必须来自所选命令或正常 package 配置，不能依赖 One Works 宿主 runtime。
- 原生 Goose provider 凭据只通过现有 `secrets.yaml` 的 symlink 继承，不复制凭据；子进程只保留当前 provider 所需的已知认证环境变量。One Works routed model service 只注入一个 session 私有 API-key 变量，key 不会写入 Goose provider JSON。最终 Goose 事件、错误、stderr、权限提示、退出 payload、task hook 输入与持久化 runtime cache artifact 会统一脱敏所选凭据及其编码变体；用户可见 payload 还会脱敏私有隔离 root。
- OpenAI Chat Completions 与 Anthropic Messages model service 会映射为 session-scoped declarative Goose provider；其他协议不会出现在兼容模型列表中，误配时也会被拒绝。
- system prompt 优先使用 Goose 的 system-prompt ACP extension；该扩展不可用时，才降级为带边界标记的首轮 prompt 内容。

Goose recipes 与 extensions 不会被隐式加载。selected skills、hooks 与 MCP 始终由 One Works 单一编排。Goose ACP 没有稳定的原生 hook 契约，因此 hook plugins 继续走 One Works normalized hook bridge；recipe execution 与 subagent history import 会明确标记为不支持，不伪造兼容能力。

## 只读历史导入

“外部会话”只通过下面两个公开命令读取 Goose 历史：

```bash
goose session list --format json
goose session export --session-id <native-id> --format json
```

调用具有单命令超时、请求级总 deadline 与独立的进程输出上限，会校验 JSON、原生 session id 与绝对项目路径，并在命令失败时 fail closed。每个请求只解析一次 CLI，先用 list 元数据完成项目/时间筛选、排序、去重与分页，再执行 export。预览只 export 当前有界候选页，并按原始 Buffer 字节计数，不依赖换行或 Unicode 边界。生产 export 使用流式读取：只在内容仍处于当前序列化尺寸策略内时保留解析数据；超限后继续计数并报告当前候选，不会中断后续候选。有界 buffer fallback 会在策略值之上保留 1 MiB JSON framing headroom；所有路径均受 128 MiB 绝对安全上限约束。由于公开 export 包含消息与工具内容，Goose 面板会在预览/导入前明确披露这一行为；内容只在内存中解析，用户选择“导入”之前不会写入历史。

配置的尺寸限制用于预览和自动导入，默认为 50 MiB；adapter override 继承全局值，显式 `null` 会关闭该策略限制。精确等于边界的 export 可以通过；超限候选会被报告并跳过，不会中止其他候选。用户执行手动“导入”时可以明确覆盖自动策略限制，但仍受绝对进程输出安全上限约束。history service 只读发现配置的 managed、system 或绝对 path 二进制，绝不触发安装，也绝不读取 Goose SQLite 状态。current-project、all-projects 与指定 project paths 都会保留原生 id 和工具结果，重复预览/导入按原生会话去重；recipe 与 subagent 条目会产生脱敏的 unsupported-kind diagnostic。显式选择 Goose 的“子任务”范围时，预览和导入都会返回 unsupported-scope diagnostic，不会伪装成普通的无历史结果。

全局 `nativeHistoryImport.autoImport: true` 表示 best-effort 扫描：可选 Goose CLI 不可用时会报告并跳过，其他 adapter 继续导入。显式 Goose-only 选择（包括 adapter-specific auto-import 配置）在 CLI 不可用时仍会给出可操作失败；显式 mixed selection 会保留已成功导入的会话，并返回 Goose 不可用的 error diagnostic。

## 登录与预安装

One Works 当前不提供 Goose 多账号或登录流程。请在隔离 session 外使用官方 Goose CLI 完成配置，再保留 `inheritNativeAuth: true`，以 symlink 方式桥接现有 secrets 文件。`oneworks adapter prepare goose` 可在不登录真实账号的情况下提前准备固定版本。

通用 CLI 配置见 [Adapter CLI 安装与版本](./adapter-cli.md)。
