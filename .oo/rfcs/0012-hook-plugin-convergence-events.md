# RFC 0012: 事件词汇表

返回入口：[RFC 0012 总览](0012-hook-plugin-convergence.md)

本章定义收敛后的内部事件标准。事件名对齐 DSH（`deepseek-ai/deepseek-harness@99f6f02`），差异处显式标注。

## Mode 词汇

派发语义与 API 形状见[通用事件 API 设计](0012-hook-plugin-convergence-events-api.md)。本章使用收窄后的三个 mode：

| mode        | 语义                      | 对应 Cordis / DSH              |
| ----------- | ------------------------- | ------------------------------ |
| `notify`    | 通知，监听器互相独立      | `emit` / `parallel` / `serial` |
| `transform` | 链式改写，必须调 `next()` | `waterfall`                    |
| `decide`    | 单向收紧的裁决，顺序无关  | 无对应（我们特有）             |

Mode 是事件定义的一等字段，插件作者不需要从名字推断，宿主据此决定如何派发与合并。

**与 DSH 的一处刻意分歧**：DSH 把 `tools/pre-execute` 标为 `waterfall`，我们标为 `decide`。原因是它在我们这里是权限裁决而非数据改写——DSH 的插件等同 shell 权限所以 waterfall 无妨，我们是 marketplace 分发，必须保证插件只能收紧。

## 可用性分级

`native` 源的事件由上游适配器 CLI 的 hook 协议决定；`bridge` 源由我们自己合成（`packages/hooks/src/bridge.ts`）。**并非所有事件在所有 source 下都可用。**

| 级别               | 含义                                      |
| ------------------ | ----------------------------------------- |
| `both`             | native 与 bridge 均可用                   |
| `bridge`           | 仅 bridge 源可用（上游 CLI 不暴露该点位） |
| `native:<adapter>` | 仅特定适配器可用                          |

插件订阅一个当前 source 不支持的事件时，宿主**必须报出诊断而非静默不触发**（RFC 0011 纪律 4：禁止 accepted-then-ignored）。能力查询走 `ctx.events.availability(name)`。

## 迁移映射：现有 14 个事件

| 现有名                 | 新名                     | mode       | 可用性 | 备注                                                                                                  |
| ---------------------- | ------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `PreToolUse`           | `tools/pre-execute`      | **decide** | both   | 名称对齐；**mode 刻意分歧**（DSH 为 waterfall），见上                                                 |
| `PostToolUse`          | `tools/post-execute`     | transform  | both   | 与 DSH 完全对齐                                                                                       |
| `GenerateSystemPrompt` | `system-prompt/assemble` | transform  | both   | 与 DSH 完全对齐                                                                                       |
| `Stop`                 | `agent/turn-stopping`    | notify     | both   | 名称对齐；DSH 为 `serial`，我们用 `notify` + fail-fast 派发                                           |
| `StopFailure`          | `agent/error`            | notify     | both   | 对齐                                                                                                  |
| `SubagentStop`         | `subagent/end`           | notify     | both   | 对齐                                                                                                  |
| `SessionStart`         | `agent/session-start`    | notify     | both   | 对齐                                                                                                  |
| `SessionEnd`           | `session/disposed`       | notify     | both   | 对齐                                                                                                  |
| `UserPromptSubmit`     | `agent/prompt-submit`    | transform  | both   | **无 1:1 对应**。DSH 最近的 `agent/pre-step` 语义更宽（每步触发）。用自有名字但守同一风格，不假装对齐 |
| `PreCompact`           | `compaction/pre`         | transform  | both   | **DSH 无此事件**（它走 `ctx.compaction` 服务）。我们粒度更细，保留                                    |
| `Notification`         | `agent/notification`     | notify     | both   | 我们自有                                                                                              |
| `TaskStart`            | `task/started`           | notify     | both   | 我们自有（适配器概念）                                                                                |
| `TaskStop`             | `task/stopped`           | notify     | both   | 我们自有                                                                                              |
| `StartTasks`           | `task/batch-start`       | notify     | both   | 我们自有                                                                                              |

## 新增：建议补的四个点位

这四个是与 DSH 对照后确认的高价值缺口。共同特征是它们都在**模型请求那一层**或**工具执行的环绕层**，我们当前完全没有对应物。

### `agent/request` — transform — 可用性 `bridge`

DSH 描述："Replace the frozen call configuration."

出站模型请求的最后一道关。插件可改写 system、tools、参数，也可完整审计请求内容。

**这是 RFC 0011 纪律 6「model-visible ⟺ logged」的天然落点**——凡进入模型请求的内容都从这里过，可复现性与审计天然成立。

可用性受限的原因：我们不自己发模型请求，`native` 源下这一层在适配器 CLI 的进程里，除非上游暴露该点位。**这一条必须诚实标注，不能假装 both。**

### `agent/request-error` — transform — 可用性 `bridge`

DSH 描述："Handle one failed model-request attempt before the loop retries or closes its step."

单次模型请求失败后、重试前的处理。DSH 的 `llm-retry` 就是纯靠这一个事件实现的插件。我们当前的重试逻辑散在各适配器里，无法统一策略或让用户覆盖。

### `tools/execute` — transform — 可用性 `bridge`

DSH 描述："Around-dispatch waterfall for timeout, retry, or metrics."

环绕整个 dispatch。超时、重试、metrics 用一个事件解决，不必用 pre + post 手工拼状态机。

### `tools/result` — notify — 可用性 `both`

DSH 描述："Observe the frozen, lossless-JSON final outcome."

与 `tools/post-execute` 分开的价值：post-execute 可改写结果，result 是**冻结只读**的。审计类消费者拿不到修改权，不会误伤。

## 中等价值缺口（本期不做，记录待评估）

| DSH 事件                                                                      | mode   | 价值                                                                                                    |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `fs/write-intent` / `fs/edit-intent`                                          | decide | 比工具粒度更细的单次文件写入决策。我们有 `packages/fs-authority-native`，需先查清是否已有等价机制未暴露 |
| `approval/request`                                                            | decide | 让插件参与审批**应答**，而非只能返回 `'ask'` 把球踢给用户                                               |
| `tools/change` / `skills/change` / `commands/change` / `system-prompt/change` | notify | 能力面变更通知，插件可感知工具集变化                                                                    |

## 明确不跟的

`cordis/*`（自指运行时反射）、`workflow/*`、`goal/*`、`domain/changed`、`typert*`、`spill*`、`session/flush`、`agent/inbox/*` —— 对应子系统我们没有或形态不同。

## 事件定义的形式要求

每个事件的定义必须携带：

- `name` —— `namespace/kebab-verb`
- `mode` —— `notify | transform | decide`
- `availability` —— `both | bridge | native:<adapter>`
- `payload` —— 结构化 schema
- `result` —— `transform` 的返回契约 / `decide` 的判定格；`notify` 事件此字段为空
- `summary` —— 一句话语义

这份定义是[RFC 0011 行动项 P0-2「生成式能力目录」](0011-plugin-extensibility-actions.md)的输入之一：事件表应由源码 AST 生成，`--check` 模式接入 CI，避免与实现漂移。DSH 的做法可参照（`scripts/gen-cordis-api.ts` + `verify-cordis-api`），但需注意其生成文档仍存在轻微漂移（`docs/subsystems/workflow.md` 引 `index.ts:157`，实测 168），生成 + 门禁能大幅降低漂移而非消除。

## 与 session log 的关系

统一事件流应同时喂三个消费者：插件、session log、UI 实时流（`apps/server/src/services/client-events.ts` 已有 `publishClientEvent` 基建）。

三者共用同一份事件定义，而非各自造一套。这是本次收敛的附带收益，也是纪律 6 落地的实际路径。
