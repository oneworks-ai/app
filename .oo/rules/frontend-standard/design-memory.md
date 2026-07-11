# 设计记忆与视觉审阅

返回入口：[FRONTEND-STANDARD.md](../FRONTEND-STANDARD.md)

本文规定用户可见 UI 任务如何复用既有设计语言、识别需要长期保存的设计反馈，并在交付前完成独立视觉一致性审阅。

## 开始前

- 加载项目 `.oo/skills/ui-design-memory` skill 及其团队设计标准；更具体的模块规则和已登记例外继续拥有对应 surface。
- 阅读当前项目的样式规则、design tokens、最近的 `AGENTS.md` 和共享组件入口；先搜索已有标准，再提出新的视觉规则。
- 非机械视觉改动写入前必须形成简短 Visual Brief：
  - 目标 surface 和视口；
  - 参考图或已有产品页面；
  - 页面层级和关键几何；
  - 必须复用的组件和 token；
  - 交互、主题和响应式不变量；
  - 禁止模式；
  - 截图和可观测验收点。

具体数值继续由 [`styles.md`](./styles.md)、共享 token 和模块规则拥有，不把 `10px` 等窄作用域数值复制成跨模块团队原则。

## 判断是否需要持久化

所有设计反馈都要分类，但不是所有反馈都进入长期规则。

应作为稳定规范候选：

- “所有间距保证都是 10px”；
- “以后统一使用现有 toolbar 图标尺寸”；
- “相邻区块不能重复计算 padding”；
- “默认状态必须保持布局稳定”；
- 包含“所有、统一、以后、默认、始终、必须、保证、规范、标准、不要再”等规范性表达。

只留在当前 Visual Brief 或实现中：

- “向左移动 2px”；
- “这张图再放大一点”；
- 当前参考图或单一视口的坐标、裁切和临时探针；
- 仅用于修正当前素材或当前状态的数值。

同一局部调整多次复发时，不持久化字面数值；先提炼可复用根因，例如视觉居中、共享图标槽或 spacing token 错误。

## 持久化前检查冲突

按顺序搜索：

1. 项目 `ui-design-memory` skill 的团队设计标准；
2. 项目 `.oo/rules`；
3. 最近模块 `AGENTS.md`；
4. design tokens 和共享组件；
5. [`design-memory-registry.md`](./design-memory-registry.md) 中已登记的冲突、替代和作用域例外；
6. 当前 Visual Brief。

处理规则：

- 与有效规范一致：合并来源和正反例，不新建重复规则。
- 用户明确限定页面、模块、组件、状态或视口且不与有效规范冲突：记录为更窄作用域规则；只要与任何有效规范冲突，即使看起来已限定范围，仍必须询问用户确认这里确实是特殊例外。
- 用户明确点名已有规范并要求替换：视为已经完成确认，保留旧规则的 superseded 关系，再更新标准。
- 其他任何与有效规范的冲突：即使新话术看起来是全局要求，也必须立即询问用户是替换旧标准还是仅作为当前特例，不能静默覆盖。

询问必须同时展示旧规则、新要求和作用域，例如：

> 当前项目 toolbar 标准间距为 10px；你现在要求这里使用 8px。你希望修改原 toolbar 标准，还是只把当前模块设为 8px 的例外？

用户确认前：当前任务遵循最新明确指令；已有持久化规范保持不变；新候选标记为 `PENDING_CONFLICT_RESOLUTION`。

## 选择持久化位置

- 跨模块稳定设计原则：项目 `.oo/skills/ui-design-memory` skill。
- OneWorks 设计语言和项目 token：本目录规则或 `packages/route-layout`。
- 模块责任、组件入口和局部不变量：最近的 `AGENTS.md`。
- 可自动判断的错误：lint、DOM 几何断言、组件测试或视觉回归。
- 当前参考图的临时关系：Visual Brief，不进入长期规则。

项目级规范候选、作用域例外、替代关系和待确认冲突统一登记到 [`design-memory-registry.md`](./design-memory-registry.md)，再由其中的 `Owning rule` 指向实际拥有规范的 `styles.md`、模块 `AGENTS.md`、token 或组件。规则至少记录 revision、声明、作用域、适用与不适用场景、正例、反例、来源、生效日期、例外、替代关系和能否自动检查。不要记录本机临时路径、端口、账号或完整会话转录。

## 独立视觉一致性审阅门禁

任何用户可见视觉改动在结束前必须创建一个独立、只读、干净上下文的视觉审阅会话。实现者不能批准自己的视觉结果。

审阅输入必须包含：

- 原始用户需求和 Visual Brief；
- 团队、项目和模块设计规范；
- 参考图或既有产品 surface；
- 最新 diff 和 commit / tree hash；
- 目标视口、主题和关键状态截图；
- runtime URL 或应用入口；
- 必要的 DOM 几何、computed style、交互和 console 证据。

创建独立会话本身不满足门禁。主任务必须等待它完成，读取实际结果和证据，确认它打开的是当前 revision 的真实 surface，并实际执行了 Visual Brief 中每一项预期行为和必要状态。仅有计划、代码审阅、未检查的完成消息或来源不明截图都不能通过。

审阅必须检查整个受影响 surface，而不是只看改动 selector：页面层级、视觉重心、组件和 token 复用、spacing ownership、密度、字体、颜色、圆角、边框、交互状态、响应式、主题、溢出、裁切、滚动和参考图一致性。

- reviewer 只读，问题退回原实现者修复，保持单一写入者。
- 只有 reviewer 对当前 revision 给出 `PASS` 才能报告视觉工作完成。
- reviewer 给出结果后，主任务还必须核验它确实完成预期行为验证；没有核验不能停止。
- 相关代码、样式、素材、token 或依赖变化后，旧 PASS 自动失效。
- 独立会话失败、提前停止、遗漏预期行为或无法检查真实 surface 时，必须继续或恢复同一会话直到完成，否则门禁状态为 `BLOCKED`；自查不能冒充独立 PASS。

纯不可见逻辑不触发视觉审阅。确定性的单点像素调整可以使用简化 Visual Brief 和局部截图证据，但仍要由独立 reviewer 检查改动元素及周边一致性，也不得自动提升为长期规范。

## 经验沉淀门禁

每个视觉任务结束前必须给出且只给出一个经验状态：

- `NO_DURABLE_LEARNING`
- `PERSISTED`
- `PERSISTED_AS_SCOPED_EXCEPTION`
- `MERGED_WITH_EXISTING_RULE`
- `PENDING_CONFLICT_RESOLUTION`

发现新稳定经验时优先编码到组件、token、lint 或测试；只有无法可靠自动化的判断才保留为文字规则。规则生效后继续记录复发；同类问题再次出现时，按“规则存在但执行失效”升级门禁，而不是重复增加同义文档。

交付中使用以下最小格式：

```text
Visual Review: PASS / FAIL / BLOCKED
Visual Review Session:
Reviewed Revision:
Expected Behaviors Exercised:
Evidence Inspected by Parent:
Experience Capture: <status>
Persisted Rule or Pending Conflict:
Remaining Visual Risk:
```
