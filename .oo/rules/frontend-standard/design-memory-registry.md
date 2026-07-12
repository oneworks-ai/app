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
