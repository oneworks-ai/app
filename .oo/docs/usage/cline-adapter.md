# Cline CLI 适配器

`cline` adapter 通过 Cline 公开的 ACP 入口承载持续、结构化会话。托管运行时固定为 Cline CLI `3.0.54`；
adapter 的协议、原生 session load、取消、permission 和历史 artifact 契约测试都以这个版本为准。

```yaml
adapters:
  cline:
    cli:
      source: managed
      version: 3.0.54
    authMethod: cline
    # 可选；省略时由任务 stop/kill 管理人工 OAuth 生命周期。
    authTimeoutMs: 600000
    telemetry: off
```

`authMethod` 必须是固定版本 CLI 广告的 agent-owned ACP 方法：`cline`、`cline-pass` 或 `openai-codex`；省略时会在
session 启动阶段明确让用户选择。也可以为已验证 provider 显式选择仅本进程可传入的 credential 环境变量：

```yaml
adapters:
  cline:
    provider: openai
    credentialEnv: [OPENAI_API_KEY]
```

对于 API key provider，所选源变量会映射到 Cline 已验证的进程契约 `CLINE_API_KEY`；上游 ACP readiness
门禁会直接接受这种形式，因此它不能再与 `authMethod` 组合。Bedrock 与 Vertex 不同：显式选择的 AWS/Google
原生变量只传给当前子进程，但其本身不满足 ACP readiness。每次 create 或跨进程 load 仍必须通过显式配置、
先前缓存或本次交互选择的广告 `authMethod` 完成认证。如果固定版本 CLI 没有广告可验证方法，adapter 会在
`newSession` / `loadSession` 前失败，不会把 provider 变量当作已认证。

认证方法选择和 `authenticate` 都不会使用 20 秒控制 RPC deadline：首次浏览器 OAuth 可能需要等待人工回调。
adapter 会先返回可 stop 的 session handle，并报告进行中的认证 operation；默认由任务 stop/kill 或子进程退出负责取消。只有需要明确有界
策略时才设置 `authTimeoutMs`（最少 60 秒）。取消、退出和超时只结算一次，也不会持久化 token。

## 运行与恢复边界

- 托管会话要求 ACP `protocolVersion: 1`、`agentInfo.name: cline`、原生 `loadSession` 和 CLI `3.0.54`。
  One Works 会缓存 Cline 原生 session id，并在后续 Cline 进程里加载它。
- 不满足门禁的 `system` / `path` binary 只支持 fresh-only，会使用 Cline 结构化 `--json` 模式；不会把
  `--json` 与 `--id` 组合，也不会解析终端 UI。
- 托管 binary 未通过门禁时直接报错，不会静默削弱 native resume 语义。
- 如果 Cline 返回正常 ACP `end_turn`，但没有任何 text、tool 或 result，One Works 会用通用错误终止本轮。
  Cline 3.0.54 此时没有暴露底层 provider 错误，因此 One Works 不猜测 HTTP 或 provider 原因。
- 原生 permission 只选择请求级 `allow_once` / `reject_once`；即使 One Works 保存了 session/project 决策，也不会
  选择 Cline 的持久化 `allow_always`。Cline 未提供 `allow_once` 时会明确取消该请求。
- fresh-only 的 `dontAsk` / `bypassPermissions` 使用 Cline 已验证的 `--yolo`，`plan` 保留 `--plan`；需要交互
  responder 的 `default` / `acceptEdits` 会在 fresh JSON 子进程启动前明确失败。
- ACP `usage_update.used` 表示当前 context 占用，不是累计 input tokens；当前共享 usage 契约无法准确表达它，
  因而 adapter 会省略该数值并返回非致命诊断，不伪造 token 或 cost。

## 隔离与原生资产

每个 session 使用隔离的 home 和 Cline 配置目录。原生 session data 放在稳定的项目私有目录中，保证通过
门禁的 ACP resume 能跨 One Works 进程加载 native id。`provider` 仅通过 Cline 3.0.54 官方 `--provider`
参数传入；模型选择目前只开放 Cline 原生 `Default`，不会把 One Works 外部 model service 当作 Cline model。
在 `newSession` / `loadSession` 之前，adapter 会校验固定版本 CLI 广告的认证方法；只有显式配置、之前明确选择并
缓存的方法 id，或本次交互选择才会触发 `authenticate`，不会静默选择外部登录。

`inheritNativeAuth` 仍不受支持：One Works 不检查或复制另一个 Cline store。隔离子进程默认移除 ambient provider、
Git 与内部 credential 环境变量；`credentialEnv` 仅允许显式选择与当前 provider 对应且已由 Cline 3.0.54 验证的
变量（包括显式选择的 Bedrock/Vertex credential file locator）。其值只存在于子进程，不写入 config、cache、hook
或日志；AWS/Google 原生变量不会跳过 ACP 认证步骤。

选中的 skills 会 stage 到 Cline 原生 skills 目录；One Works system prompt 以附加 native rule 注入，不支持
替换 Cline 内置 system prompt。Cline 3.0.54 虽然接受 ACP MCP 参数和 `--hooks-dir`，但隔离探针没有观察到
MCP 连接或 native hook 执行，因此选中的 MCP server 会明确返回 `skipped`；统一 hook plugin 只使用 One Works
event bridge fallback，不宣称 Cline native hook 支持。

## 原生历史

External Sessions 面板可以预览、导入 `~/.cline/data` 中的 Cline 历史。importer 只打开
`db/sessions.db` 以及 session row 显式引用的 messages artifact。SQLite 强制 read-only 与 query-only；
存在可变 WAL/SHM sidecar、symlink、路径穿越、超限文件、锁、损坏数据库或不兼容 schema 时全部 fail closed。
它不会读取 provider settings、通用 config 或 credential 文件。

messages artifact 还必须匹配已验证的 Cline 3.0.54 `version: 1` 与 `origin` 判别器；未知、缺失或混合版本
会在 preview 中给出诊断并跳过，绝不部分导入。preview 与 import 使用同一个服务端文件大小上限。

导入结果保留 native session id 与项目归属。parent 关联按 source root 与项目隔离，并且只在 parent 同批纳入或已
存在时写入，因此 subagent-only import 不会生成悬空导航。增量 parent-first/child-only 导入会解析已有 durable
parent；child-first 导入仅保存非敏感 native correlation 元数据，并在之后导入 parent 时修复关联。跨 root 的重复
native id 会 fail closed。tool result 必须
对应同一 artifact 内唯一且更早保留的 `tool_use_id`，缺失、未来、重复或不匹配都会拒绝整个 session。只有图片的
replay placeholder 会显示为 unavailable，不会伪造成工具输出；原生 source artifact 始终不被修改。

运行 `oneworks adapter prepare cline` 可以预先准备托管 CLI。来源与 binary 覆盖方式见
[Adapter CLI 安装与版本](./adapter-cli.md)。
