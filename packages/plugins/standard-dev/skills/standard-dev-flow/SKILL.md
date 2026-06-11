---
name: standard-dev-flow
description: 调度规划、实现、评审和验证实体的标准研发工作流。
---

# 标准开发流

这个 skill 用于把通用开发任务拆成稳定的交付阶段，并通过统一 CLI runtime protocol mode 协调不同实体。

## 默认阶段

1. 规划：使用 `dev-planner` 收敛目标、边界、风险和验证点。
2. 实现：使用 `dev-implementer` 完成代码与测试改动。
3. 评审：使用 `dev-reviewer` 检查回归风险、行为变化和测试缺口。
4. 验证：使用 `dev-verifier` 执行相关命令并整理证据。

## 调度原则

- 先规划，再进入实现，不要跳过 `dev-planner`。
- 实现完成后再进行评审和验证，这两个步骤可以并行。
- 如果目标不清、上下文缺失或计划失效，回退到规划阶段。
- 每个子任务都要求输出结论、证据、风险和建议下一步。

## CLI Protocol 使用

- 使用当前 CLI 入口对应的 `<cli> run --input-format stream-json --output-format stream-json` 作为标准入口，向 stdin 写入 typed runtime protocol envelope，并从 stdout 或 runtime store 读取结果。例如上层入口是 `dyai` 时使用 `dyai run`，上层入口是 `ow` 时使用 `ow run`。
- 用 `session.start` protocol command 启动实体任务，字段至少包含 `entity`、`title`、`message`。
- 用 `session.status` / `session.events` protocol command，或直接读取 runtime store 投影出的状态与事件，跟踪后台任务状态。
- 用 `session.message` protocol command 给同一条任务补充指令；已完成或失败的任务会在 runtime 支持时用同一会话直接恢复。
- 用 `session.submit` protocol command 处理等待输入或审批的任务。
- 必要时用 `session.stop` protocol command 停止明显跑偏的任务，只有 graceful stop 无法恢复时才设置 `mode` 为 `force`。
- 不要使用专用 agent 子命令、旧 StartTasks、手写 DB 或临时 TS 脚本来创建子任务；Agent Room 会在 server-managed host session 下由 `session.start` 的 runtime store metadata/events 自动投影生成。
- server-managed host session 会把当前 adapter、model、effort、permission mode 注入为 runtime protocol 默认值；不写这些字段表示继承 host 选择，只有子任务需要不同运行配置时才显式指定。
- 专用 agent start/status/events/send/submit/stop 子命令只可视为兼容或调试 alias，不作为标准工作流入口。

## 可复制启动示例

每个子任务写一条 `session.start` JSONL；多个子任务就写多行：

```bash
cat <<'JSONL' | <cli> run --input-format stream-json --output-format stream-json
{"commandId":"start-planner","type":"session.start","payload":{"title":"规划：<目标>","message":"写清楚目标、约束、已有上下文和交付预期。","entity":"dev-planner","background":true},"title":"规划：<目标>","message":"写清楚目标、约束、已有上下文和交付预期。","entity":"dev-planner","background":true}
{"commandId":"start-implementer","type":"session.start","payload":{"title":"实现：<目标>","message":"附上规划结论、影响范围、需要补的测试或验证。","entity":"dev-implementer","background":true},"title":"实现：<目标>","message":"附上规划结论、影响范围、需要补的测试或验证。","entity":"dev-implementer","background":true}
JSONL
```

保留 `payload.title`、`payload.message`、`payload.entity`、`payload.background: true`；当前 CLI runtime protocol reader 同时消费镜像的顶层字段，所以示例保留两份字段以便直接执行。

## 命名约定

- 如果插件配置了 scope，请使用实体路由里展示的实际标识，例如 `scope/dev-planner`。
- 如果没有配置 scope，直接使用 `dev-planner`、`dev-implementer`、`dev-reviewer`、`dev-verifier`。

## 推荐任务模板

### 规划任务

- `--entity`: `dev-planner` 或 scoped 标识
- `--title`: `规划：<目标>`
- `--message`: 写清楚目标、约束、已有上下文和交付预期

### 实现任务

- `--entity`: `dev-implementer` 或 scoped 标识
- `--title`: `实现：<目标>`
- `--message`: 附上规划结论、影响范围、需要补的测试或验证

### 评审任务

- `--entity`: `dev-reviewer` 或 scoped 标识
- `--title`: `评审：<目标>`
- `--message`: 要求按问题严重度输出主要发现

### 验证任务

- `--entity`: `dev-verifier` 或 scoped 标识
- `--title`: `验证：<目标>`
- `--message`: 列出建议执行的命令、预期结果和阻塞处理方式
