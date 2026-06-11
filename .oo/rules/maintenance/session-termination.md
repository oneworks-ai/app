# 会话终止与创建取消排查

本文沉淀 UI 触发会话终止时的链路、边界场景和回归方法。重点关注 Web / Desktop 界面上的停止按钮，不把 CLI 中断语义混入同一套判断。

## 心智模型

会话终止不要只理解成“杀掉一个已经运行的进程”。UI 可能在三个阶段触发停止：

1. 前端已经创建 optimistic session，但服务端还没完成建库。
2. 服务端正在创建链路中，可能已经进入 workspace 创建、worktree 环境脚本或 runtime start。
3. runtime 已经运行，可能是 cached adapter、external runtime store、parked session，或正在等待权限交互。

这三个阶段都应该有明确反馈：请求发出后按钮立即进入 pending 态；服务端失败时前端及时 toast，并允许再次发起停止或进行其他操作。

## 关键入口

- 前端动作编排：`apps/client/src/hooks/chat/use-chat-session-actions.ts`
- sender 停止按钮：`apps/client/src/components/chat/sender/@components/sender-submit-action/SenderSubmitAction.tsx`
- session API：`apps/client/src/api/sessions.ts`
- HTTP route：`apps/server/src/routes/sessions.ts`
- 创建取消状态：`apps/server/src/services/session/creation-cancellation.ts`
- 创建编排：`apps/server/src/services/session/create.ts`
- runtime 终止：`apps/server/src/services/session/index.ts`
- workspace / env 脚本：`apps/server/src/services/session/workspace.ts`、`apps/server/src/services/worktree-environments.ts`

## 服务端约定

### 1. UI 停止走 terminate endpoint

UI 停止按钮应调用 `POST /api/sessions/:id/terminate`。不要只发 websocket `interrupt`，因为 interrupt 覆盖不了创建期取消、workspace 创建和 external runtime store 终止。

返回体需要能表达请求是否被接住：

- `creationCancellation: "pending"`：session 还没入库，停止请求被登记，稍后创建链路注册同一 id 时会立即 abort。
- `creationCancellation: "active"`：session 正在创建链路中，已触发 AbortController。
- `creationCancellation: "none"`：session 已存在，不登记未来 pending 取消，直接走 runtime 终止。
- `termination.delivery: "creation_pending"`：未入库创建期请求已接收。
- `termination.delivery: "runtime_store"`：external runtime 已通过 runtime store 写入 stop command。
- `termination.delivery: "adapter"` / `"session_service"`：已通过当前 session service 接收。

### 2. 创建链路必须显式检查取消点

`createSessionWithInitialMessage` 需要在每个长耗时阶段前后检查 abort signal：

- DB 创建前。
- DB 创建后、workspace 前。
- workspace provisioning 前后。
- 分支 checkout / create 后。
- runtime start 前后。

如果已经创建 DB session，取消或失败时要清理 session workspace 和 DB session，避免侧边栏留下无法继续也无法停止的半成品。

### 3. AbortSignal 要传到底

workspace 和环境脚本是创建期最容易卡住的阶段。`provisionSessionWorkspace` 应接收 `signal` 并继续传给 worktree environment scripts。

环境脚本执行时要处理两件事：

- abort 前不要启动新的脚本。
- abort 发生在脚本运行中时，杀掉 child process，并用 abort reason 拒绝 promise。

### 4. external runtime 不能只看本进程缓存

external session 可能没有 cached adapter runtime。终止时要通过 runtime store 追加 `stop` command；成功追加后清理 pending permission recovery / interaction，并把 running / waiting_input session 标记为 `terminated`。

如果 runtime store 缺失，应返回明确的 `runtime_store_missing`，让前端展示失败并允许重试，而不是静默吞掉。

## 前端约定

### 1. 请求发出后立刻进入 pending 态

`useChatSessionActions` 中的 `isStopping` 是停止请求的前端 pending 状态。它应传到 `Sender` 的 `stopLoading`：

- 点击停止后立即设置。
- 请求成功或失败后释放。
- pending 期间阻止重复点击和 Esc 停止快捷键。

### 2. pending 状态要可见

停止按钮 pending 时至少需要同时具备：

- 图标切到 `progress_activity`。
- 按钮 class / `aria-disabled` 表达不可重复触发。
- tooltip 显示正在请求终止，而不是继续显示 Esc 停止提示。
- toast 显示请求已发出；失败时用错误 toast 覆盖并允许重试。

这类按钮不要只做 clickable `div`。如果视觉上不是原生 button，也要补 `role="button"`、`tabIndex`、键盘触发和禁用语义，便于真实 Chrome / 可访问树回归。

### 3. optimistic 创建要能被丢弃

如果停止发生在 optimistic creation 阶段，成功发出 terminate 后前端要：

- 标记 optimistic session discarded。
- 从 optimistic creation store 移除。
- 从 session cache 移除对应 id。
- 释放 `isCreating`。

这样即使服务端稍后返回创建成功，也不会把用户已经停止的会话重新插回列表。

## 边界场景清单

每次改会话停止或创建链路，至少考虑下面这些场景：

- session id 还未入库时点击停止。
- DB session 已创建，但 workspace 还没完成。
- managed worktree 创建后，env create script 正在运行。
- env create script 失败或被 abort 后，destroy script / worktree cleanup 是否执行。
- runtime start 请求已经发出，但 runtime store 还没完全投影。
- external runtime 没有本进程 cached adapter。
- session 正在等待权限审批或有 pending interaction。
- 重复点击停止、快速按 Esc、停止请求失败后重试。
- 停止按钮 tooltip / loading / disabled 语义是否同步。

## 推荐回归命令

目标测试：

```bash
pnpm exec vitest run \
  apps/client/__tests__/sender-submit-action.spec.tsx \
  apps/server/__tests__/services/session-create.spec.ts \
  apps/server/__tests__/services/session.spec.ts \
  apps/server/__tests__/routes/sessions.spec.ts \
  apps/server/__tests__/services/session-workspace.spec.ts \
  apps/client/__tests__/agent-room-rendering.spec.tsx
```

质量检查：

```bash
pnpm exec dprint check <touched-files...>
pnpm exec eslint <touched-files...>
pnpm typecheck
```

HTTP smoke 可以用临时 DB 和端口启动服务后执行：

```bash
curl -sS -X POST http://127.0.0.1:<server-port>/api/sessions/ui-smoke-pending-create/terminate
```

预期能看到 `creationCancellation: "pending"` 和 `termination.delivery: "creation_pending"`。

## 真实界面验证建议

- 优先在 Web / Desktop UI 中操作，不要用 CLI 中断结果代替 UI 结果。
- 尝试从简单任务开始，再逐步切到需要工具调用、权限审批、长时间运行、workspace 创建和 env 脚本的任务。
- 浏览器脚本不要强依赖易变文案；优先断言 `aria-label`、稳定 class、按钮 disabled 语义和 runtime API 返回。
- 如果用 Chrome 自动化，先确认 tooltip、popover 和输入框可访问树能反映真实状态；无法稳定自动化时，要补组件测试锁住按钮语义。
- 验证结束后关闭临时 dev server，避免后台 runtime 干扰下一轮 DB / port / runtime-store 观察。

## 常见误判

- 只看到按钮变红不代表终止请求已经发出去；必须看 pending 状态、toast 或 API 返回。
- 只杀 adapter process 不等于取消创建链路；workspace 和 env script 也要响应 abort。
- session 已存在时不应登记 pending creation cancellation；否则会污染未来同 id 的创建语义。
- `waiting_input` 和权限审批状态需要清理 pending interaction，否则 UI 可能继续展示已失效的审批入口。
- 本地测试通过不代表 PR 已可合并；终止链路横跨前端、server、workspace、runtime store，至少等远端 `lint`、`format-check`、`typecheck` 通过。
