# Agent Room Component Module

本模块只负责 Agent Room 的前端展示层：room / transcript 容器、成员列表、消息气泡、审批队列、reaction、target mention 和样式。数据拉取、URL 解析、消息发送和 API detail 到 view model 的转换不在这里，见 `../../routes/AGENTS.md`。

## 快速入口

- `AgentRoomTranscript.tsx`：嵌入聊天页的 room transcript，只装配消息列表和空态；真实 room 页面 chrome 由 `ChatRouteView` / `ChatRouteShell` 的 route container 负责。
- `@components/AgentRoomMessageList.tsx`：同一 sender 的连续消息如何隐藏 author / avatar。
- `@components/AgentRoomBubble.tsx`：单条消息气泡、target mention、折叠、reaction、run/session 跳转入口。
- `@components/AgentRoomApprovalBatchCard.tsx`：连续权限审批的聚合卡片。
- `@components/AgentRoomRoster.tsx` 和 `@components/AgentRoomRunList.tsx`：成员与子 run 导航。
- `@core/build-room-view-model.ts`：把 route 层给出的 `AgentRoomMessageSource` 补齐成含 member/run 的展示模型。
- `@core/resolve-room-target.ts`：composer 中 `@member`、`@member/run`、leader 等目标解析。
- `@types/agent-room-view.ts`：前端展示层专用类型，不等同于后端 API 原始类型。
- `AgentRoomView.scss`：room 和 transcript 共用的主样式；`AgentRoomTranscript.scss` 只放 transcript 壳层差异。

## 数据流

`AgentRoomDetailResponse` 在 route 层转换为 `AgentRoomViewModel`，再进入：

`AgentRoomTranscript -> AgentRoomMessageList -> AgentRoomBubble`

组件层不要直接读取 server API，也不要自己解析 `AgentRoomMessage.payload`。需要新增展示字段时，先在 `@types/agent-room-view.ts` 定义，再由 route view model 或 `@core/build-room-view-model.ts` 填充。

## 常见改动定位

- 气泡宽度、头像列、长消息折叠、reaction 位置：`AgentRoomBubble.tsx` + `AgentRoomView.scss`
- 审批队列折叠、统计、历史展示：`AgentRoomApprovalBatchCard.tsx` + `AgentRoomView.scss`
- 点击 agent 名称、avatar、reaction 名称后的跳转或 composer target：先看 `AgentRoomBubble.tsx` 的 props，再看 `ChatHistoryView` / route 装配。
- target mention 文案或解析：`@core/resolve-room-target.ts`
- i18n：同时改 `src/resources/locales/zh.json` 和 `src/resources/locales/en.json`。

## 约束

- room 消息是聊天流，不要把状态面板、审批面板和普通回复混成同一种视觉层级。
- 普通 agent 完成回复不因为 `kind: completion` 整条染成成功色；只有任务/状态卡片才用完成态强调。
- reaction 是消息气泡内的聊天 reaction，保留 emoji、agent 名、点击跳转，不要做成消息下方 pinned badge。
- 审批请求卡片默认聚合连续同 run 的权限请求；已处理详情默认收起，避免刷屏。
- 用户消息右侧对齐，但需要保留左侧头像列等价空间，避免在窄屏直接顶到容器边。

## Agent Room 联调注意事项

- `<agent-room-message>` 这类 envelope 是给当前 member session 的路由上下文，不是用户可见正文；聊天气泡默认只展示用户实际输入。
- room timeline 和 member session transcript 是两个视角；改消息渲染时要同时确认用户消息、leader 指令、其他实体消息的来源展示不会混成同一种“你”。
- 改气泡 padding / 宽度 / 头像列时，至少同时看 assignment、interaction request、completion 三类 room event，避免只修一种导致同屏不对齐。

## 回归

- 组件渲染回归：`pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/agent-room-rendering.spec.tsx`
- 路由 / target / sidebar 回归：`pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/agent-room-navigation.spec.ts`
- 样式或交互改动还需要真实 Chrome 验证，尤其是宽度、折叠动画、hover/focus 和移动端尺寸。
