# RFC 0011: DSH / Cordis 结构对照

返回入口：[RFC 0011 总览](0011-plugin-extensibility.md)

对照上游: `deepseek-ai/deepseek-harness@99f6f02`、`cordiverse/cordis@f46ae95`（cordis 4.0.0-rc.8）

本章的作用是分清"我们缺的"与"我们刻意不做的"。上游行号对应上述固定 revision。

## 1. Cordis 与我们不是同一物种

`vendors/cordiverse/cordis` 此前未 checkout，本次调研拉取后阅读了 `packages/core`。

**趋同的那一层不是 Cordis 的特色。** `onAvailable` + epoch 防竞态 + 提供方消失回收消费方，是 late binding + 生命周期这一问题的通用解，OSGi ServiceTracker、Eclipse extension point、VS Code `activationEvents` + `extensionDependencies` + `extension.exports` 都是同一形状。收敛源自约束相同，非同源。

论亲缘，One Works 更接近 VS Code Extension Host，术语也来自 Eclipse/VS Code 一支：extension point、contribution、activation。

### 三条结构性差异

**(1) Cordis 是自举的，我们不是。** Cordis 的 loader、hmr、timer、logger-console 自己都是 `@cordisjs/plugin-*`，与用户插件进同一 registry、同一套 fiber 生命周期；除 `packages/core` 这个容器外没有特权核心。

我们相反：discovery、runtime、marketplace、HMR 全是宿主代码（`apps/server/src/services/plugins/`），且插件不能占用 `sessions` / `config` / `workspace` / `agent-rooms` 等内置 route key。**有特权宿主 + 只能做加法的扩展**，对 **没有中心、一切皆插件**。

**(2) ctx 是继承链 vs 固定 API 表。** Cordis 的 `Context` 是活的：`ctx.plugin(x)` 让插件在运行时动态加载另一个插件，产生子 Context，contexts 形成原型链，`ctx.isolate(name)` 造影子命名空间。

我们的 client ctx 是扁平的 16 个 key（`api` / `commands` / `extensionPoints` / `pluginApis` / `routes` / `slots` / `views` / `themes` / `launcher` / `notifications` / `runtime` / `react` / `hot` / `i18n` / `manifest` / `scope`），**没有任何一个能实例化另一个插件**。

**(3) 属性注入 vs 带 schema 的调用。** Cordis 的 `provide` 把对象挂到 context 上（`ctx.database` 即实例），靠 `ReflectService`（281 行 Proxy）追踪访问归属做自动清理，拿到的是**对象引用**。

我们是 `ctx.pluginApis.call('scope/id', input)`，带 `inputSchema` / `outputSchema`，`meta` 给提供方 `callerScope`。拿到的是**一次调用的返回值**。这不是风格差异——属性注入无法审计、无法拒绝、无法跨进程；带 schema 的调用三样都能。

## 2. DSH 暴露给插件的 55 个 ctx 服务

```
agentDefaultModel agentLoop agentPresets agents apiProxy approval attachments
clientModules codeRuntime commands compaction credentials directoryPicker e2b fs
goals invariants jobs llm lsp messageFeedback permissionPresets planMode sandbox
sandboxPolicy sessionPersistence sessionProjections sessionQuery sessions
sessionTitle settings shell shellEnv skills spillStore storage subagents
subprocess systemPrompt terminals timer tokenMeter toolResultPruner tools
typert userQuestions web webServer workflowEngine workspaceRegistry ...
```

外加 55 个事件（`agent/pre-step`、`tools/pre-execute`、`tools/post-execute`、`approval/request`、`llm/stream`、`system-prompt/assemble` 等）。

**核心机制是插件既消费又提供实现**：

```ts
export const inject = ['llm']
ctx.llm.registerAdapter(['deepseek-official'], adapter)
```

`ctx.llm` 的契约（`packages/llm/llm/src/index.ts:338`）：`registerAdapter` 返回随 fiber 销毁的 handle，重复注册抛 `DUPLICATE_ADAPTER`（全有或全无）；`registerConfigurableProviders` 声明"可由配置激活的休眠 provider 路由"；API key 走 `ctx.credentials` 凭证 seam，插件拿 ref 不拿明文。

### 信任前提不同

`packages/preset/agent-presets/src/preset.ts:5-8`：

> a `user` preset was authored locally, by a person or by an agent, and therefore **carries the same trust as shell access**.

且 `README.md:133-135` 明确 trust 字段"exists so consumers can present that difference, **not to enforce it**"——它只影响写路径（`remove()` 拒绝非 user preset、`copy()` 落到第一个 user root），不是权限沙箱。

同样的坦率也见于 `packages/extensions/tool-cordis`（"Treat this toolset like bash access"）与 workflow（"A vm context and worker thread are not security boundaries"）。

**DSH 的插件等同于 shell 权限，所以它敢把 `agentLoop` / `tools` / `approval` / `sandboxPolicy` 全开。** 我们是 marketplace 分发 + 卸载账本 + 构建期边界校验 + CSP，不能整套照抄。

## 3. 逐项对照

### 拦截型 seam：我们基本齐平

| DSH                                       | One Works                                                  |
| ----------------------------------------- | ---------------------------------------------------------- |
| `tools/pre-execute` + `PreToolDecision`   | `PreToolUse` + `permissionDecision` ✅                     |
| `tools/post-execute` + `PostToolDecision` | `PostToolUse` + `additionalContext` ✅                     |
| `system-prompt/assemble`                  | `GenerateSystemPrompt` ✅                                  |
| `PreCompact` / `ctx.compaction`           | `PreCompact` + `replacementPrompt` ✅                      |
| `session/created` `/disposed`             | `SessionStart` / `SessionEnd` ✅                           |
| `agent/pre-step` + `PreStepDecision`      | `continue: false` ⚠️ 粒度粗                                 |
| `ctx.approval`                            | `permissionDecision: 'ask'` ⚠️ 只能触发，不能自定义审批策略 |

### 注册型 seam：我们没有

| DSH                                                | One Works                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `ctx.llm.registerAdapter`                          | ❌ `packages/model-provider-catalog/src/catalog.ts` 是硬编码内置注册表   |
| `ctx.subagents.registerProvider`                   | ❌ 适配器是编译期内置（根 `package.json` devDependencies + 静态 import） |
| `ctx.tools` 注册工具                               | ⚠️ 走 MCP，不走插件 seam                                                  |
| `skills` / `sessionTitle` / `web` / `lsp` provider | ❌                                                                       |

**这不是遗漏。** hook 传输是"每事件一次子进程往返"，对拦截型完美契合，对注册型根本不成立——LLM adapter 要维持流式连接、跨多次调用持有状态。要开注册型 seam 得走常驻 server plugin runtime。

## 4. DSH 如何调度外部 code agent

`packages/subagent/` 下有 11 个包，其中 4 个是 out-of-process backend：

| provider               | 传输                                               | 进程归属                                                                   |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `subagent-codex`       | `codex app-server --stdio`，私有 wire              | `ctx.subprocess.spawn`                                                     |
| `subagent-claude-code` | 官方 `@anthropic-ai/claude-agent-sdk` 的 `query()` | SDK 经 `spawnClaudeCodeProcess` hook 把 CLI 进程交回 `ctx.subprocess` 托管 |
| `subagent-acp`         | 通用 ACP over ndjson stdio                         | `ctx.subprocess.spawn`                                                     |
| `subagent-dsh-sdk`     | stdio JSON-RPC，子进程是第二个完整 DSH runtime     | SDK 自己                                                                   |

**抽象极简**（`packages/subagent/subagent/src/types.ts:285-324`）：3 个只读字段 + 1 个必需方法 `start()`。跨进程写进抽象里——`SubagentRun.localAgent: Agent | undefined`，`undefined` 即远程；`subagent/` 包自带 215 行 `out-of-process.ts` 放公共词汇（cwd 解析、永不 reject 的结算、幂等 dispose handle）。

**已明文记录的限制**：四个远程 provider 全部 `NO_START_CAPABILITIES`（不能指定 outputSchema / persona / toolFilter / depthLimit）、`inheritsParentContext: false`、均未实现 `prepareContinuable`（**只能 one-shot**）、跨进程只传文本、无人工审批路径、Claude Code 不流式（取消时无部分答案）、`ctx.subagents.interrupt()` 对远程子无效。

**ACP 是双向的**：`packages/acp/acp/` 是 server（`AgentSideConnection`），`subagent-acp` 是 client（`ClientSideConnection`）。按能力归属而非协议归属分包。

### Workflow 的异构粒度

workflow 脚本是模型现写的普通 JS，realm 注入 5 个全局：`agent()` / `parallel()`（有 barrier）/ `pipeline()`（无 barrier）/ `phase()`（纯进度分组）/ `log()`。脚本内**无 fs / network / timer / Node API**。

**一次 run 只绑一个 subagent provider**（`workflow-worker-thread/src/host.ts:139`），`ChildStartRequest` 没有"选 provider"字段，文档明说脚本 "cannot observe or replace either policy"。

- ❌ "第一步 DSH、第二步 Claude Code" —— workflow 层做不到
- ✅ "整个 workflow 全跑 Claude Code CLI" —— 改 `provider` 即可
- ✅ 逐轮异构 —— 在**工具层**：`standard` preset 把同一个 `dsh-tool-subagent` 挂 4 次绑不同 provider，暴露成 `subagent` / `subagent_fork` / `subagent_codex` / `subagent_claude_code`，父 agent 在自己回合里逐个调用

易混点：`agent(prompt, { provider, model })` 的 `provider` 是 **LLM 路由**，与 subagent 传输后端是两个命名空间。

## 5. 深度对比：我们更深，形态它更开

DSH 的 3 个 product provider 是薄的（one-shot、不继承上下文、纯文本、无审批）。我们 16 个适配器有统一 hook 协议、账号池、历史导入、权限镜像、原生历史自动导入，不是一个量级。

但形态差异带来的后果已经显现。DSH 的 `CONTRIBUTING.md` 明确不收外部 PR，把人推向 `dsh-plugin` topic，并声明：

> You may consider this repository an idea, an official showcase, and a source of inspiration, **but not a mandate from us**.

其社区已产出与 One Works 产品面高度重叠的插件：跨 14+ agent 的历史导入、跨 agent SKILL.md 移植、Cursor/Gemini/Copilot workspace instruction 加载、可视化插件市场、开放侧边栏底座、内联 GenUI 渲染、多个 TUI/VS Code/桌面前端，以及第三方版的 Codex/Claude Code/ACP subagent provider（带两层权限模型与"子 agent 不能派生权限更高的后代"约束）。

注意：`dsh-plugin` topic 下约 7,466 个仓库，噪音极高（含大量无关项目蹭 tag），**该数字不能作为插件数量的可信指标**；上述条目经逐条核对描述。

## 6. 文档体系对照

DSH 是三层：

1. **概念地图**（手写）—— `docs/architecture.md`，"Events are the extension points" + "Where new behavior goes" 目标→机制表
2. **生成式目录**（机器生成 + CI 门禁）—— `docs/capability-seams.md`（逐行列 ~55 个 `ctx.*` 的 role / owner / 实现 / 消费者）、`docs/event-producer-consumer.md`（每事件的 dispatch mode、声明位置带文件:行号、生产者、消费者）、`docs/tool-catalog.md`（真实 boot 后读 `ctx.tools.schemas()`）、`docs/config-catalog.md`
3. **feature → mechanism 对照** —— `docs/cookbook/extension-cookbook.md`

生成器 `scripts/gen-cordis-api.ts` + `verify-cordis-api --check` 挂在 doc-sync 门禁；且 `docs/user/develop/framework/service.md` 明文拒绝维护第二份手工清单。产出还通过 `cordis_inspect` 工具喂给模型。

**诚实的限定**：即便如此仍有轻微漂移（`docs/subsystems/workflow.md` 引 `index.ts:157`，实测 168），事件部分的行号则全部正确。生成 + 门禁不是银弹，但显著优于纯手工。

我们当前是手写 `.oo/docs/usage/plugins/ui-runtime.md`（400+ 行）+ `create-plugin/SKILL.md`，无生成、无门禁。

## 7. 分发模型对照

DSH 是 bundle（npm 包，`package.json` 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`）+ profile（`$DSH_HOME/profiles/<name>` 目录，声明有序 bundle 列表）。层序覆盖，**patch 是整体替换 row 的 `config`，不是深合并**（我们的 `mergeOptions` 是浅合并，两种都可行但须写进文档）。

最小插件骨架：

```ts
export const name = 'hello-plugin'
export function apply(ctx: Context) {/* ... */}
```

对比我们需要 `plugin.json` manifest + client/server 双 entry + vite 构建。

从 GitHub 安装需用户开 `allowBuilds`，其文档直白提醒这等于"允许该包在你机器上、在 agent sandbox 之外执行代码"。
