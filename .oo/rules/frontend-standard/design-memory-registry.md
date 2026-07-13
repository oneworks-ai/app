# 项目设计记忆登记表

返回流程：[design-memory.md](./design-memory.md)

本文件只登记 OneWorks 项目级设计规范的身份、作用域、冲突、替代和例外。规范正文仍由 `styles.md`、最近模块 `AGENTS.md`、共享 token 或组件拥有，避免在登记表复制完整规则。

## 有效规范索引

### OW-DM-001 — 相邻边界间距归属

- Revision: 1
- Status: ACTIVE
- Rule: 相邻元素的同一条接缝只能由一层负责留白；项目默认 spacing token 为 10px，双侧内部 padding 同时保留时必须使用可见分割线。
- Scope: OneWorks project / adjacent component and section boundaries
- Applies when: 相邻组件、字段、section、列表行、header 或内容区共享同一条边界。
- Does not apply when: 两个结构各自的内部 padding 由可见分割线明确隔开。
- Positive example: parent gap、前一项底部 padding 或后一项顶部 padding 三选一，并使用项目 token。
- Negative example: parent gap、前一项底部 padding 和后一项顶部 padding 叠加成无语义大空白。
- Owning rule: [`styles.md`](./styles.md) 中的“相邻区块的间距归属”。
- Token or implementation: 由具体 surface 的共享 spacing token / parent gap / 单侧 padding 拥有。
- Source: 用户明确设计标准，已沉淀到 `styles.md`。
- Effective date: 2026-07-11
- Supersedes: none
- Exceptions: 在下方“作用域例外”登记。
- Automatic enforcement: computed box model、DOM 几何检查或模块视觉回归。

### OW-DM-002 — 紧凑 chrome 尺寸语言

- Revision: 1
- Status: ACTIVE
- Rule: Route header actions、panel tab chrome、内嵌网页 toolbar 和窗口控制条使用共享 chrome token；当前 header / toolbar block 与 inline padding 为 10px。
- Scope: OneWorks project / compact chrome
- Applies when: route header actions、panel tab chrome、内嵌网页 toolbar 或窗口控制条使用紧凑 chrome 语言。
- Does not apply when: surface 有已登记的 scoped exception，或不属于紧凑 chrome。
- Positive example: toolbar 直接消费共享 chrome padding 和 icon token，状态变化不改变几何。
- Negative example: 单个 toolbar 在 media query 内硬编码 6px padding，造成同一产品 chrome 密度不一致。
- Owning rule: [`styles.md`](./styles.md) 中的“紧凑 chrome 工具栏”。
- Token or implementation: `packages/route-layout/src/design-tokens.css`
- Source: 项目现有统一视觉标准。
- Effective date: 2026-07-11
- Supersedes: none
- Exceptions: 在下方“作用域例外”登记。
- Automatic enforcement: token consumer 检查、computed padding 和目标 surface 截图。

### OW-DM-003 — 主会话时间线容器阈值与持续可见

- Revision: 4
- Status: ACTIVE
- Rule: 主会话内容容器宽度超过 `820px` 且存在至少一个时间线节点时，左侧 timeline rail 持续展示；未配置时默认使用 `event-line`，用户可通过 global `appearance.historyTimelineMode` 显式切换为原有 `node` 模式。内容是否可滚动只决定上下边缘渐隐，不决定 rail 是否存在。
- Scope: OneWorks project / desktop primary chat history timeline
- Applies when: 宽度超过 `820px`、非嵌入式、非 Agent Room 的主会话消息历史存在时间线节点。
- Does not apply when: 内容容器宽度不超过 `820px`、新会话没有节点、`embeddedSessionChrome`、Agent Room，或用户主动隐藏 rail；用户选择 `node` 时只替换 rail 的渲染模式，不移除可见性约束。
- Positive example: 一问一答的短会话没有滚动空间，左侧仍显示事件短线。
- Negative example: 因消息内容没有超过视口而移除整条 Event lines rail。
- Owning rule: `apps/client/src/components/chat/AGENTS.md` 的消息级操作约束。
- Token or implementation: `history-timeline/timeline-visibility.ts` 与对应单测。
- Source: 用户先要求 Event line 模式在真实聊天页持续展示，随后明确把内容容器阈值调整为 `820px`，并要求在外观设置中支持 Event lines / Nodes 两种展示模式。
- Effective date: 2026-07-13
- Supersedes: OW-DM-003 Revision 3；保留 `820px` 阈值，并把用户显式选择 `node` 登记为 Event lines 默认规则的作用域例外。
- Exceptions: 容器宽度不超过 `820px`、嵌入式会话、Agent Room、无节点、用户主动隐藏，以及用户显式选择 `node` 渲染模式。
- Automatic enforcement: 纯可见性单测、真实短会话 DOM 断言和独立视觉审阅。

## 待确认冲突

当前无。

新增候选时使用：

```text
ID:
Revision:
Status: PENDING_CONFLICT_RESOLUTION
Candidate rule:
Conflicts with:
Candidate scope:
Current-task behavior:
Question asked:
Source:
Created date:
Resolution:
```

用户确认后，不删除记录；把它更新为 `ACTIVE`、`SCOPED_EXCEPTION` 或 `REJECTED`，并链接 owning rule 的实际修改。

## 作用域例外

当前无。

新增例外时使用：

```text
ID:
Revision:
Status: SCOPED_EXCEPTION
Base rule:
Exception rule:
Scope:
Applies when:
Does not apply when:
Positive example:
Negative example:
Source:
Effective date:
Automatic enforcement:
```

## 已替代规范

当前无。规范被替代后保留旧 ID、最后 revision、生效区间、替代它的新 ID 和用户确认来源。
