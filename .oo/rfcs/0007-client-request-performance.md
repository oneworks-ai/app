---
rfc: 0007
title: Client 请求性能与轮询收敛
status: implemented
authors:
  - Codex
created: 2026-06-25
updated: 2026-06-26
targetVersion: vNext
---

# RFC 0007: Client 请求性能与轮询收敛

## 摘要

当前 workspace/session 页面在初始化和运行过程中会触发多类请求：session/messages/workspace/git、agent room、AI target resources、auth/config、relay plugin status 等。截图中最显眼的是 `agent-rooms` 的持续轮询，但不是唯一问题。整体问题可以分成四类：

- 固定轮询：`/api/agent-rooms`、`/api/agent-rooms/:id`、git state、relay status。
- 初始化突刺：session detail/list、config、auth、voice services、AI target resources。
- 失败重试：`/api/ai/workspaces` 在不支持该 endpoint 的运行环境里出现 404 后仍可能被 SWR 重试。
- 单次请求过重：messages 和 workspace 解析会读取完整 session history，长会话和 remote workspace 场景下成本会持续变高。

核心方向不是只压缩 payload，而是把“列表/摘要/详情/历史窗口/实时事件”拆开，让用户当前不需要的数据不要请求，让可以事件驱动的数据不要轮询，让分页和 limit 在服务端 SQL 层真实生效。

长期方向应提供一个主动推送通道，把 session、agent room、git、config、relay account/device 等变化通过 event stream 推给前端；SWR/polling 只作为初始快照和断线降级手段。主动推送不能推大对象：第一次请求拿完整快照，后续事件只推 revision / cursor / changed keys，客户端按需拉 diff 或局部详情。

## 目标

- 降低 session 页面长期空闲时的背景请求数量。
- 降低 Cloudflare / Relay 代理场景下的固定流量和请求数。
- 避免不相关页面触发 agent room、AI target、voice、adapter account 等请求。
- 让长会话 messages/workspace 恢复成本可控。
- 保留必要的实时性：正在运行的 agent、room、git 状态仍应及时更新。
- 建立可在 Cloudflare / Vercel / 本地 Node 下运行的事件推送模型，减少固定轮询。

## 非目标

- 不在本 RFC 中改变聊天 UX、launcher UX 或 relay workspace 打开链路。
- 不要求一次性替换所有 SWR 调用。
- 不把所有轮询完全删除；第一阶段可以用更低频、按可见性启停的轮询作为事件化之前的过渡方案。
- 不在第一版强制只支持 WebSocket。SSE/EventSource 对当前一方向浏览器推送更简单，WebSocket 可以作为后续双向实时通道。

## 当前请求清单

| 接口                                                           | 当前触发点                                        | 当前行为                               | 主要问题                                                                                                 | 优先级 |
| -------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `/api/agent-rooms`                                             | `ChatRoute`、`Sidebar`                            | session 页 1s 轮询，Sidebar 3s 轮询    | list 不是轻量 list，会间接构造 detail                                                                    | P0     |
| `/api/agent-rooms/:id`                                         | `AgentRoomRoute`、`Sidebar`                       | room 页 1s 轮询，Sidebar 批量拉 detail | detail 构造会合并多类 session messages                                                                   | P0     |
| `/api/sessions/:id/messages`                                   | `useChatSessionMessages`                          | 初始/交互后全量拉历史                  | 前端不传 limit；服务端 limit 也是全量读后 slice；UI 默认只需要层级投影中的用户消息和 stop/completed 摘要 | P0     |
| `/api/sessions/:id/workspace`                                  | interaction panel、git controls                   | 解析 session workspace                 | 服务端会从 session messages 倒扫 session_info                                                            | P1     |
| `/api/sessions/:id/git`、`/api/workspace/git`                  | interaction panel、workspace drawer、git controls | 3s 轮询或重复 key 拉取                 | git 状态适合按可见性或文件事件刷新                                                                       | P0     |
| `/api/ai/specs`、`/api/ai/entities`、`/api/ai/workspaces`      | sender target bar、reference actions              | sender 挂载即拉                        | target 选择未打开也会拉；不支持时可能 404 重试                                                           | P0     |
| `/api/sessions`、`/api/sessions/:id`、`/api/sessions/archived` | ChatRoute、Sidebar                                | 初始化和必要状态拉取                   | 有重复，但已有 websocket cache 更新基础                                                                  | P1     |
| `/api/config`                                                  | ChatRoute、Sidebar、voice hook                    | 多处读取同一配置                       | 可拆 runtime flags，减少启动数据量                                                                       | P2     |
| `/api/auth/status`                                             | AuthGate、nav account actions                     | 初始化账号状态                         | 不是主要轮询源，但可长缓存/事件刷新                                                                      | P2     |
| `/api/adapters/:adapter/accounts`                              | chat adapter account selection                    | adapter/model 变化时拉账号             | 账号选择 UI 未打开时不一定需要                                                                           | P2     |
| `/api/voice/speech-to-text/services`                           | voice input hook                                  | voice enabled 时拉                     | 可延迟到用户打开语音入口                                                                                 | P2     |
| `/api/plugins/relay/proxy/relay/status`                        | relay plugin footer、launcher                     | footer 每 20s 刷新                     | 上 CF 后是稳定背景流量                                                                                   | P1     |
| `/api/module-updates`                                          | AppShell                                          | 5 分钟轮询                             | 已有较保守配置，不优先处理                                                                               | P3     |

## 详细分析

### 1. Agent Room 列表和详情

源码依据：

- `apps/client/src/routes/ChatRoute.tsx`：普通 session 页在 agent room 功能开启时通过 `/api/agent-rooms` 每 `1000ms` 查找当前 session 是否绑定 room。
- `apps/client/src/components/Sidebar.tsx`：Sidebar 每 `3000ms` 拉 `/api/agent-rooms`，并对每个 room 批量请求 detail。
- `apps/client/src/routes/AgentRoomRoute.tsx`：room detail 页面每 `1000ms` 拉 `/api/agent-rooms/:id`。
- `apps/server/src/routes/agent-rooms.ts`：`GET /api/agent-rooms` 返回 `service.listRooms()`，`GET /api/agent-rooms/:id` 返回 `service.getDetail(id)`。
- `apps/server/src/services/agent-room/index.ts`：`listRooms()` 会对每个 room 调 `getDetail(room.id)`；`getDetail()` 会合并 persisted detail、host session messages、child session messages，并做去重和 summary。

问题判断：

- `ChatRoute` 只是需要回答“当前 session 是否对应某个 room”，但现在拉了所有 rooms。
- `Sidebar` 需要展示列表摘要，却会触发 detail 级别的数据构造。
- `agent-rooms` 是截图里最典型的长期背景流量，而且服务端并不轻。

优化方案：

- 新增 `GET /api/agent-rooms/by-host-session/:sessionId`，用于 ChatRoute 精确判断当前 session 绑定关系。
- 新增 `GET /api/agent-rooms/summary`，只返回 `id/title/status/updatedAt/hostSessionId/childCount/unreadCount` 等列表必要字段。
- Sidebar 默认只拉 summary；展开 room 或进入 room 页面后再拉 detail。
- 增加 websocket/SSE 事件：`agent_room_updated`、`agent_room_message_created`、`agent_room_run_updated`，前端用 `mutate` 更新缓存。
- 过渡期轮询策略：运行中 room 3-5s，空闲 room 30-60s，页面 hidden 停止。

### 2. Session Messages 与层级投影

源码依据：

- `apps/client/src/api/sessions.ts`：`getSessionMessages(id, limit?)` 支持传 `limit`。
- `apps/client/src/hooks/chat/use-chat-session-messages.ts`：`refreshHistory()` 当前调用 `getSessionMessages(sessionId)`，没有传 limit。
- `apps/client/src/hooks/chat/use-chat-session-messages.ts`：交互后会在 `0/800/2400/5000/9000/15000ms` 多次 `refreshHistory()`。
- `apps/server/src/routes/sessions.ts`：`GET /api/sessions/:id/messages` 先 `db.getMessages(id)` 全量读取，再按 `limit` 做 `slice`。
- `apps/server/src/db/sessions/messages.repo.ts`：messages repo 使用 `SELECT data, eventKey FROM messages WHERE sessionId = ? ORDER BY id ASC` 全量读取。

问题判断：

- messages 不一定是最频繁的长期轮询，但单次成本会随 session history 线性增长。
- 即使前端开始传 `limit`，当前服务端仍然先全量读取，无法解决 DB、JSON parse 和 CPU 成本。
- 用户进入 session 时并不需要所有历史消息，尤其不需要远古消息立即渲染。
- 当前“messages”实际是 runtime event history，不是用户界面最终展示的一维消息列表。默认聊天界面主要展示用户发送的信息、已完成/停止的 agent 输出摘要、当前活跃交互状态；大量工具事件、增量片段、终端状态、workspace 变化等属于某个 turn/message 的子层级。
- 因此“只传 limit”仍然不够合适。即使服务端把最近 100 条 raw events 返回给前端，这 100 条里也可能大部分都不是首屏会展示的顶层内容；更正确的是服务端维护面向 UI 的 timeline projection，再让 raw events 成为按 turn 展开的子资源。

优化方案：

- API 改成真实分页窗口：
  - `GET /api/sessions/:id/messages?limit=100`
  - `GET /api/sessions/:id/messages?beforeId=...&limit=100`
  - `GET /api/sessions/:id/messages?afterId=...`
- DB 层新增倒序限量查询，例如 `ORDER BY id DESC LIMIT ?`，再在服务端反转成正序返回。
- 不直接把 raw event history 平铺给 UI。新增面向展示的 `conversation timeline` / `message tree` projection：
  - 顶层节点只包含用户消息、agent turn 摘要、停止/完成状态、当前活跃交互。
  - 子节点保存工具调用、增量输出、终端事件、workspace/git 变化等可展开信息。
  - 每个顶层节点保留 `rawEventStartId` / `rawEventEndId` / `revision`，需要排查或展开详情时再拉 raw events。
- 初始页面只拉最近的可展示顶层节点，例如最近 30-50 个 visible nodes，而不是最近 100 条 raw events。推荐接口形态：
  - `GET /api/sessions/:id/timeline?limit=50&include=visible`
  - `GET /api/sessions/:id/timeline?before=<cursor>&limit=50&include=visible`
  - `GET /api/sessions/:id/timeline/:nodeId/events?limit=100`
- 用户滚动到顶部加载更早的 visible nodes；用户展开某个 turn 时再加载该 turn 的 raw children。默认不加载工具事件、终端事件和完整增量片段。
- 交互后 reconcile 改成 `afterRevision` / `afterEventId` 增量拉取，避免多次全量 history refresh。当前活跃 turn 可以用 SSE 事件驱动追加小 diff，完成后只刷新该 turn 的 projection。
- 把恢复当前 UI 状态需要的 projection 单独存储，例如 latest session_info、latest workspace、latest compaction、current interaction、queued messages。这样不需要通过全量 events 反推当前状态。

这条优化比单纯 `limit` 更适合现有消息结构：`limit` 只能减少网络返回量，而 `conversation timeline` 能直接避免 UI 为了展示少量顶层信息而读取大量不可见 raw event。后续如果要进一步减少传输成本，timeline response 可以返回 `{ snapshot, revision }`；SSE 只推 `{ sessionId, revision, changedNodeIds }`，客户端再请求 `GET /api/sessions/:id/timeline/diff?afterRevision=...`。

### 3. Session List 和 Session Detail

源码依据：

- `apps/client/src/routes/ChatRoute.tsx`：会拉当前 session detail，也会拉 active session list。
- `apps/client/src/components/Sidebar.tsx`：Sidebar 也会拉 `/api/sessions`。
- `apps/server/src/routes/sessions.ts`：`GET /api/sessions` 返回 active sessions，`GET /api/sessions/:id` 返回单个 session。
- `apps/client/src/hooks/use-session-subscription.ts`：已有 `session_updated` websocket 事件，会通过 `updateSessionCaches` 更新缓存。

问题判断：

- `/api/sessions` 本身不算最重，但 ChatRoute 和 Sidebar 有重复触发。
- 既然已有 session websocket，session list 的长期一致性可以更多依赖事件，不需要额外轮询。

优化方案：

- ChatRoute 只保留当前 session detail；只有分支 lineage 或 archived 状态确实需要时才拉 session list。
- Sidebar 初始拉一次 `/api/sessions`，后续由 `session_updated` patch cache。
- archived list 继续懒加载，只在 archived 视图或当前 session archived 时请求。

### 4. Session Workspace

源码依据：

- `apps/client/src/api/sessions.ts`：`getSessionWorkspace(id)` 请求 `/api/sessions/:id/workspace`。
- `apps/client/src/components/chat/interaction-panel/use-interaction-panel-workspace-url-keys.ts`：interaction panel URL history key 会触发 workspace 请求。
- `apps/client/src/components/chat/git-controls/use-chat-git-controls.ts`：git controls 也会触发 workspace 请求。
- `apps/server/src/routes/sessions.ts`：`GET /api/sessions/:id/workspace` 调用 `resolveSessionWorkspace(id)`。
- `apps/server/src/services/session/workspace.ts`：`getLatestSessionInfoCwd()` 会读取 `getDb().getMessages(sessionId)` 并从后往前找最新 `session_info.cwd`。

问题判断：

- workspace 请求看起来 payload 小，但服务端解析可能读取完整 messages。
- 前端使用了不同 SWR key：`interaction-panel-session-workspace` 和 `session-workspace`，无法完全复用。

优化方案：

- 在 session 表或单独 projection 表维护 resolved workspace/cwd，不再每次从 messages 倒扫。
- 统一前端 SWR key，例如全部使用 `['session-workspace', sessionId]`。
- 只有 interaction panel / terminal / git UI 需要 workspace key 时再请求；纯聊天显示不提前拉。

### 5. Git State

源码依据：

- `apps/client/src/components/chat/interaction-panel/ChatInteractionPanel.tsx`：git state 每 `3000ms` 刷新。
- `apps/client/src/components/chat/workspace-drawer/ChatWorkspaceDrawer.tsx`：workspace drawer 也以相同 key 每 `3000ms` 刷新。
- `apps/client/src/components/chat/git-controls/use-chat-git-controls.ts`：git controls 使用另一个 SWR key 拉同一类数据。
- `apps/client/src/api/git.ts`：`getSessionGitState()` 请求 `/api/sessions/:id/git`，`getWorkspaceGitState()` 请求 `/api/workspace/git`。
- `apps/server/src/routes/git.ts`、`apps/server/src/routes/workspace.ts`：服务端分别暴露 session git 和 workspace git。

问题判断：

- git status 适合“可见时刷新”或“文件变更事件刷新”，不适合页面常驻 3s 轮询。
- 不同 SWR key 会造成初始重复请求。
- 在 remote workspace + Cloudflare proxy 下，3s git 轮询会变成持续代理流量。

优化方案：

- 只在 git 控件可见、workspace drawer 展开、或 agent 正在运行/刚完成时刷新。
- 用文件系统 watcher 或 runtime event 推送 `git_updated`，前端 mutate。
- fallback 轮询改为 15-30s；tab hidden 停止。
- 统一 git state SWR key，避免重复初始请求。
- 服务端可以返回 revision/hash，未变化时返回轻量 `{ changed: false }` 或 HTTP 304。

### 6. AI Target Resources

源码依据：

- `apps/client/src/components/chat/sender/@components/session-target/SenderSessionTargetBar.tsx`：sender target bar 挂载即请求 `/api/ai/specs`、`/api/ai/entities`、`/api/ai/workspaces`。
- `apps/client/src/components/chat/sender/@components/reference-actions/use-reference-actions-session-target-item.tsx`：More 菜单模式也会请求这三类资源。
- `apps/server/src/routes/ai.ts`：服务端分别提供 specs、entities、workspaces。

问题判断：

- 截图里的 `workspaces` 404 很可能来自 `/api/ai/workspaces`。
- 当前运行环境或 remote workspace proxy 不支持该 endpoint 时，前端不应该继续请求或重试。
- 用户没有打开 target selector 时，不需要提前拉 specs/entities/workspaces。

优化方案：

- target selector 打开时再请求资源。
- 按 tab 懒加载：用户打开 workspace tab 才请求 workspaces。
- 增加 capability gate：例如 `/api/capabilities` 或 config 返回 `supportsAiWorkspaces`。
- 对 404/unsupported 设置 `shouldRetryOnError: false`。
- specs/entities/workspaces 属于低频定义数据，增加分钟级 `dedupingInterval` 和 `revalidateOnFocus: false`。

### 7. Config、Auth、Adapter Accounts、Voice Services

源码依据：

- `apps/client/src/routes/ChatRoute.tsx`、`apps/client/src/components/Sidebar.tsx`、`apps/client/src/components/chat/sender/@hooks/use-sender-voice-input.ts` 都会读取 `/api/config`。
- `apps/client/src/components/auth/AuthGate.tsx` 和 `apps/client/src/components/nav-rail-account-actions.tsx` 读取 `/api/auth/status`。
- `apps/client/src/hooks/chat/use-chat-adapter-account-selection.tsx` 会根据 adapter/model 拉 adapter accounts。
- `apps/client/src/api/adapters.ts` 构造 `/api/adapters/:adapter/accounts`。
- `apps/server/src/routes/adapters.ts` 实现 adapter accounts route。
- `apps/client/src/components/chat/sender/@hooks/use-sender-voice-input.ts` 在 voice enabled 时请求 `/api/voice/speech-to-text/services`。

问题判断：

- 这些接口不是截图里的主要长期流量，但会增加初始化请求数量。
- adapter accounts 和 voice services 都可以按用户打开对应 UI 后再请求。
- `/api/config` 可以拆轻量 runtime flags，避免为了几个 feature flag 读取完整配置。

优化方案：

- `/api/config/runtime-flags`：ChatRoute 只读 agent room、timeline、voice 等必要 flags。
- adapter accounts 改为账号选择器打开时加载，或者 adapter/model 改变后后台低频预热。
- voice services 改为点击语音按钮或打开设置弹层后加载。
- auth status 保留初始读取，但用更长 dedupe，并通过登录/登出事件刷新。

### 8. Relay Plugin Status

源码依据：

- `packages/plugins/relay/src/client/index.ts`：`fetchRelayStatus()` 通过 plugin runtime 请求 `relay/status`。
- `packages/plugins/relay/src/client/index.ts`：账号 footer 每 `20_000ms` 刷新一次。
- `apps/client/src/api/launcher.ts`：launcher 也会请求 `/api/plugins/relay/proxy/relay/status`。
- `apps/client/src/plugins/plugin-runtime.ts`：plugin `ctx.api.fetch()` 最终走 `fetch(buildPluginApiUrl(...))`。

问题判断：

- 20s 单用户看起来不大，但部署到 Cloudflare 后会成为稳定背景流量。
- footer、launcher、账号页可能分别请求 status，应该共享缓存。

优化方案：

- Relay server 推送账号/设备状态变化事件，plugin 接收后更新 footer。
- footer 未展开时停止或退避到 60-120s。
- launcher、footer、账号页共享 status cache。
- 登录、登出、启用/禁用账号后主动 mutate status，不靠下一轮 interval。

### 9. Module Updates

源码依据：

- `apps/client/src/components/layout/AppShell.tsx`：`/api/module-updates` 已配置 `refreshInterval: 300000`、`dedupingInterval: 60000`、`shouldRetryOnError: false`。

问题判断：

- 当前策略已经比较保守，不是主要问题。

优化方案：

- 暂不优先处理。
- 如果后续 remote workspace 极致省流，可以在 remote session 页面禁用或进一步延长。

## 主动推送通道可行性

当前最适合替代固定轮询的是一条浏览器侧长期 event stream。它不要求立即迁移所有接口，只需要把“有变化”这件事主动推给前端，再由前端按需 `mutate` 对应 SWR cache。

### 平台支持

Cloudflare 侧：

- Cloudflare Workers runtime 提供 `EventSource` API，文档说明它用于接收 server-sent events。
- Cloudflare Agents 文档直接给出 HTTP + SSE 模式，说明 Agent 可以用 `ReadableStream` 返回 `Content-Type: text/event-stream`。
- Cloudflare Workers limits 文档说明 HTTP request 没有硬 duration limit；只要客户端保持连接，Worker 可以继续处理、发起 subrequest、stream response body。
- Cloudflare 2026-04 的连接限制更新后，六连接限制只约束等待 response headers 的阶段；headers 返回后连接不再占这个限制。

消耗判断：

- SSE 是一个长 HTTP 请求。Cloudflare 计费仍围绕请求、CPU time、内存等资源；空闲连接本身不应该持续消耗大量 CPU，但心跳、事件 fan-out、状态读写会计入实际执行成本。
- Relay 如果每个 tab 都开一条 stream，连接数会线性增长。需要按账号/浏览器做连接数上限，后续可以用 BroadcastChannel 让同源多 tab 共享一条事件流。
- Fan-out 状态不要放在普通 Worker 局部内存里，建议放 Durable Object 或 relay 已有的 account/device/session 状态层。

结论：Cloudflare 官方托管 Relay 可以做 SSE。需要注意 CPU/memory、断线重连、心跳和事件游标；CF 上 SSE 明显优于短周期全量轮询，但必须控制连接数和事件 payload。

Vercel 侧：

- Vercel Functions streaming 文档给出 `Content-Type: text/event-stream` 的 streaming response 示例。
- Vercel Functions 文档说明 Functions 支持 streaming data，Fluid Compute 面向 I/O-bound workloads。
- Vercel Functions limits 文档说明 Edge runtime 必须在 25s 内开始 response，随后 streaming 最长 300s。
- Vercel max duration 文档说明 Node.js 等 Functions 有最大运行时长，可配置但不是无限长连接。
- Vercel WebSockets 已是 Functions beta，官方文档说明它依赖 Fluid Compute，并且连接关闭时需要客户端重连；持久状态不能依赖单个 Function instance 内存。

消耗判断：

- Vercel 上长连接会占用 Function duration / compute 资源，不能按“永久连接”设计。
- `vc` 类型服务应把 SSE 看成“有上限的长轮询升级版”：连接建立后由服务端主动推事件，但客户端必须在 duration 到期、网络断开或平台回收时自动重连。
- 状态和事件游标必须存在外部存储或 relay server 持久层，不能依赖某个 Function instance 内存。

结论：Vercel 可以做 SSE/streaming；WebSocket 也可选但仍是 beta。对官方 `vc` 类型服务，第一版建议优先 SSE + 断线重连，不把状态存在 Function 内存里；超过 function duration 时让客户端自动 reconnect 并通过 `Last-Event-ID` 补事件。

### 长轮询 vs SSE

对当前 OneWorks/Relay 场景，推荐默认选择 SSE，长轮询只做降级：

- 活跃 workspace / session 页面：SSE 更好。一次初始快照后，后续只推事件 id、revision 和 changed keys，避免每 1-15s 重复请求 `config/sessions/status/messages` 这类完整数据。
- 后台页、hidden tab、launcher 空闲态：可以不开 SSE，或者只保留低频 heartbeat 和非常粗的状态事件；必要时退回 60-120s 慢轮询。
- Vercel official-vc：SSE 仍优于频繁轮询，但连接必须有 reconnect 机制，不能假设长期不掉线。
- Cloudflare official-cf：SSE 适合常驻在线状态和 session 增量通知，但要限制每用户连接数和心跳频率。
- 不适合 SSE 的场景：用户主动打开详情页时的大对象读取，例如完整 messages raw children、文件树、配置详情、token 列表。这些仍应按需 HTTP 请求。

事件 payload 规则：

- 第一次：HTTP snapshot 返回完整可见状态，例如 session detail、timeline visible window、room summary、relay status summary。
- 后续：SSE 只推 `{ eventId, revision, entityId, changedFields }` 或 `{ afterRevision }`，不推完整大对象。
- 客户端：收到事件后精确 mutate 对应 SWR key；如果本地 revision 落后太多，再补一次 bounded diff；只有 diff 不可用时才拉完整 snapshot。
- 服务端：保留短期事件游标，支持 `Last-Event-ID` 和 `afterRevision`。这样既减少请求数，也减少每次传输量。

### 推荐协议

新增统一事件入口：

```text
GET /api/events?channels=session:{id},rooms,git,relay,config
Accept: text/event-stream
Last-Event-ID: <optional>
```

事件格式：

```text
id: <monotonic-event-id>
event: session_updated
data: {"sessionId":"...","revision":42,"changedNodeIds":["turn_123"]}

event: heartbeat
data: {}
```

约定：

- 每个事件必须有稳定递增 id，支持 `Last-Event-ID` 恢复。
- 事件 payload 默认只放 summary、revision、changed keys，不推大对象。
- 前端收到事件后按 key 精确 mutate，例如 session、timeline diff、room summary、git state、relay status。
- 连接打开时先返回当前 server time / snapshot revision，避免错过连接建立期间的事件。
- 断线后指数退避重连，重连失败时退回低频 polling。
- 每 15-30s 发送 heartbeat，帮助浏览器、代理和平台保持连接状态。
- 页面 hidden 时可以保留单条低频事件流，但暂停高成本 detail revalidation。

### 事件类型

第一阶段建议覆盖：

- `session_updated`：替代 session list/detail 的重复刷新。
- `session_message_appended`：驱动当前 session 增量拉取 `afterId` 或更新 timeline projection。
- `agent_room_updated`：替代 `/api/agent-rooms` 固定轮询。
- `agent_room_message_appended`：room detail 页面增量更新。
- `git_updated`：替代 3s git status 轮询。
- `config_updated`：现有 websocket 已支持，迁入统一 event stream。
- `relay_status_updated`：替代 relay footer 20s status 轮询。
- `workspace_updated`：remote workspace/cwd/proxy 状态变化。

### 为什么优先 SSE

- 我们主要需要 server-to-browser 的一方向通知；SSE 正好匹配。
- SSE 使用普通 HTTP，经过 Cloudflare/Vercel/本地 Node 的部署路径更简单。
- EventSource 自带重连模型，配合 `Last-Event-ID` 更适合 cache invalidation。
- WebSocket 适合后续双向协作、presence、remote terminal 等场景，但第一阶段不是必须。

### 风险

- 事件乱序或丢失会造成 cache stale，因此必须有 revision 和补偿拉取。
- 多 tab 同时打开会产生多条 event stream；后续可以用 BroadcastChannel 让同源 tab 共享一条连接。
- Vercel Function duration 到期会断开连接；必须接受定期 reconnect。
- Cloudflare Worker/DO fan-out 需要限制每用户连接数，避免一个账号开多个 tab 造成连接膨胀。
- 事件流不能承载大消息体，否则会把 polling 问题换成 streaming 大 payload 问题。

## SWR 与错误重试策略

当前全局 SWR 只配置了默认 fetcher，没有全局错误重试策略。`fetchApiJson` 在非 2xx 时会 throw，因此 404/500 会进入 SWR 错误流程。

需要建立约定：

- capability/optional endpoint：`shouldRetryOnError: false`。
- user action endpoint：失败展示 toast，不自动重试。
- long polling replacement：尽量用 websocket/SSE；保留 polling 时必须配置 `refreshWhenHidden: false` 或手动 visibility gate。
- 定义类数据：长 `dedupingInterval`，禁用 focus revalidate。
- 运行中状态：按状态动态 interval，运行中较短，空闲较长。

## 建议落地阶段

### 阶段 1：止血

- ChatRoute 不再 1s 拉全量 `/api/agent-rooms`，改精确查询当前 session。
- `/api/ai/workspaces` 增加 capability gate；404 不重试。
- git polling 加可见性 gate，hidden tab 停止。
- relay status footer 隐藏时退避。

### 阶段 2：拆 summary/detail

- Agent room 新增 summary endpoint。
- Sidebar 使用 room summary，不批量拉 detail。
- Session list 依赖 websocket patch cache，减少重复 list 请求。
- 统一 workspace/git SWR key。

### 阶段 3：历史数据和 projection

- Messages 增加 cursor/limit 的 DB 层真实分页。
- 初始 history 只拉最近窗口，旧消息滚动加载。
- Session workspace、latest session_info、interaction、compaction 等建立 projection。
- 交互后 reconcile 改成增量拉取。

### 阶段 4：事件化

- Agent room、git、relay device/account status 增加 server event。
- 前端集中订阅并 mutate SWR cache。
- 轮询只作为 websocket 断连后的降级策略。

## 验证指标

本 RFC 的优化完成后，需要用真实页面验证：

- 打开普通 session 页面后，空闲 60s 内请求总数。
- 空闲状态下每分钟请求数。
- 正在运行 agent 时每分钟请求数。
- 远端 workspace 通过 relay proxy 时每分钟请求数。
- `/api/agent-rooms`、`/api/sessions/:id/messages`、`/api/sessions/:id/workspace` 的服务端耗时 P50/P95。
- 长会话消息数量达到 1k、5k、10k 时的 session 首屏恢复耗时。
- 404 endpoint 是否停止重试。
- 页面 hidden 后请求是否下降到预期范围。

## 本轮实施与验收

2026-06-25 已按当前请求流量问题完成第一轮落地，覆盖 P0/P1 止血与 summary/detail 拆分：

- Agent Room：
  - 新增 `/api/agent-rooms/summary`，Sidebar 使用 summary，不再为列表批量拉 full detail。
  - 新增 `/api/agent-rooms/by-host-session/:sessionId`，普通 session 页面不再 1s 轮询全量 `/api/agent-rooms`。
  - 新增 `/api/events` SSE 通道，agent room/session/config/workspace 事件驱动 SWR 精确 mutate。
  - room detail 轮询从固定 1s 改为运行中 10s、空闲 60s，并在 hidden tab 停止。
- Session messages：
  - `/api/sessions/:id/messages` 支持 `limit`、`beforeId`、`afterId`，并下推到 SQLite 查询层，不再先全量读后 slice。
  - session 首屏恢复默认只拉最近窗口，创建 session 后的恢复读取也改为小窗口。
- Session workspace：
  - `resolveSessionWorkspace` 不再全量倒扫 messages，而是 DB 层倒序查找最近 `session_info` 事件。
- Git 状态：
  - interaction panel 与 workspace drawer 的 git polling 从 3s 调整到 15s，并关闭 hidden tab 刷新。
- AI target resources：
  - `/api/ai/specs`、`/api/ai/entities`、`/api/ai/workspaces` 改为打开 target selector 时懒加载。
  - 定义类数据使用分钟级 dedupe，不再 focus revalidate。
- SWR 错误重试：
  - 全局对 `404/405/501` 停止自动重试，避免 optional endpoint 在不支持环境里持续打流量。

本轮验收命令：

- `pnpm exec eslint ...` 针对本次改动文件通过。
- `pnpm exec vitest run apps/server/__tests__/routes/agent-rooms.spec.ts apps/server/__tests__/routes/sessions.spec.ts apps/client/__tests__/agent-room-route-refresh.spec.tsx` 通过：`3` 个测试文件、`39` 个测试。
- `pnpm typebuild` 已执行；当前仍被仓库既有 TypeScript 配置 / 测试夹具问题阻断，例如 `packages/runtime-protocol/package.json` 未被 tsconfig include、`apps/relay-admin/__tests__/adminSessionStorage.spec.ts` 缺少 `effectiveAccess/groupIds`、`apps/bootstrap` 与 `apps/desktop` 多处 node test tsconfig include/ESM-CJS 问题。本轮请求优化相关文件未再出现在 typebuild 错误列表中。

保留为后续架构演进的项：

- Conversation timeline / message tree projection：本轮先完成 DB 窗口和首屏窗口，尚未把 raw runtime events 投影成顶层 user/stop/completed 节点。
- `git_updated`、`relay_status_updated` 等更细事件：本轮先建立 SSE 基础设施和 agent/session/config/workspace 事件。
- Event stream 的 `Last-Event-ID` 恢复、revision 补偿、BroadcastChannel 多 tab 共享连接：本轮先建立可用的单连接 SSE 与 SWR mutate 通道。
- Adapter accounts、voice services、auth/config 的进一步 runtime capability 拆分：优先级低于当前已出现的 agent-rooms/messages/git/AI resources 流量。

## Open Questions

- Agent room 是否应该新增独立 websocket channel，还是复用现有 `sessions` channel。
- Session projection 是写入 session 表字段，还是单独建 `session_projections` 表。
- Messages cursor 使用自增 DB id、eventKey、createdAt，还是新增稳定 seq。
- Remote workspace 的 capability 应由本地 shell 返回，还是由目标 daemon 通过 relay 暴露。
- Relay status 是否需要一个 client-side shared cache API，供 launcher、footer、账号页统一读取。
- Event stream 是否直接复用现有 websocket server，还是新增 SSE endpoint 并逐步把 websocket cache invalidation 迁入。

## 参考资料

- Cloudflare Workers EventSource runtime API: <https://developers.cloudflare.com/workers/runtime-apis/eventsource/>
- Cloudflare Agents HTTP and Server-Sent Events: <https://developers.cloudflare.com/agents/runtime/communication/http-sse/>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers relaxed connection limiting changelog: <https://developers.cloudflare.com/changelog/post/2026-04-09-relaxed-connection-limiting/>
- Vercel Functions streaming: <https://vercel.com/docs/functions/streaming-functions>
- Vercel Functions: <https://vercel.com/docs/functions>
- Vercel Functions WebSockets beta: <https://vercel.com/docs/functions/websockets>
