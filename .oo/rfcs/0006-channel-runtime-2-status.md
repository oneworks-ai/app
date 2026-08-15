---
rfc: 0006
title: Channel Runtime 2.0 - Implementation Status
status: tracking
authors:
  - Codex
created: 2026-08-15
updated: 2026-08-15
targetVersion: vNext
---

# RFC 0006：实施状态与剩余工作

GitHub 总跟踪：[Issue #370 — Channel Runtime 2.0 V1 交付加固与后续路线图](https://github.com/oneworks-ai/app/issues/370)

## 结论

最初提出的三期运行时 baseline 已落地，但按完整产品标准并非三期全部完成：

1. Channel Session 长期状态与每条消息独立 ChildSession；
2. 软屏蔽、上下班、节流、backlog 和白名单已有后端执行引擎，但实体默认策略、频道覆盖继承和配置页未完成；
3. Entity 多频道绑定、分层记忆，以及按用户和运行模式选择模型与 adapter。

此外，[Channel Runtime 2.0 主 RFC](./0006-channel-runtime-2.md) 后来扩展了 Room、Relay、跨平台身份、授权恢复、产品插件和跨 provider 验收。因此，“运行时 baseline 已落地”不等于“原始三期的完整产品体验或 RFC 全部愿景已经完成”。当前可定义为：**本地 Channel Runtime 与 Team Chat 主链路已完成，策略配置产品化、自动记忆提炼、跨账号授权和完整跨 provider / 跨设备验收仍有后续工作。**

## 原始三期规划

| 阶段                | 原始目标                                                                                          | 当前状态        | 已落地能力                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Session 模型重构 | Channel Session 保存长期状态；每条需要处理的消息创建新的 ChildSession；启动时加载记忆，结束时写回 | 已完成          | fresh ChildSession、child run 审计、不可变 actor/context snapshot、thread continuity、pending intent、MemorySnapshot、terminal writeback |
| 2. Policy Engine    | 软屏蔽和警告等级、回复节流、管理员/老板白名单、下班 backlog 及上班后聚合处理                      | 部分完成        | 后端执行引擎和命令已完成；实体默认策略、ChannelLink 特殊覆盖、有效配置来源展示和可视化配置页未完成                                       |
| 3. Entity + Routing | 一个实体使用多个频道；实体/频道/用户维度记忆；按用户、账号和模式选择模型及 adapter                | 已完成 baseline | ChannelLink 唯一实体绑定、Entity 多 ChannelLink、issuer 隔离、account/user/mode/entity/global 路由优先级、无工具轻量 Ingress Router      |

以上状态分别由 [Conversation Continuity](./0006-channel-runtime-2-continuity.md)、[Memory Resolver](./0006-channel-runtime-2-memory.md)、[Policy Engine](./0006-channel-runtime-2-policy.md)、[Identity And Routing](./0006-channel-runtime-2-identity-routing.md) 和 [Ingress Router](./0006-channel-runtime-2-ingress-router.md) 记录。

## 后续扩展规划的完成度

| 工作流                                | 当前状态                  | 说明                                                                                                                                                                 |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room 统一领域与本地权威               | 已完成 baseline           | Agent Room 已作为唯一 Room 产品领域；消息、成员、run、source、delivery 和幂等审计均有持久化边界                                                                      |
| Channel command 与授权恢复            | 已完成 baseline           | slash、CLI 和 Agent typed tool 共用 command kernel；actor snapshot、短期 capability token、authorization request、pending intent 和 fresh ChildSession resume 已闭环 |
| OneWorks provider 与产品插件          | 已完成 baseline           | provider 与产品插件职责分离；Team Chat、真实 Room、分享入口、trace/navigation facade 和 host capability 已落地                                                       |
| 外部频道进入 Team Chat                | 已完成                    | 同一外部群可映射到多个 Team Chat；连接归属成员；支持仅观察、处理每条消息和 require-mention；来源与投递使用对应平台图标                                               |
| Leader 与 Auto Leader                 | 已完成                    | 创建页支持单选定义型 Leader、关联成员自动选择、Auto Leader、关联头像预览和响应式实体卡片；Auto Leader 通过专用外部 delegation 让 owning member 回复原线程            |
| Lark / OneWorks 真实链路              | 已完成当前验收            | 已完成真实 Lark 群消息进入 Team Chat、成员处理和回复原群，并留存 PR 截图证据                                                                                         |
| 显式 Room 分享与 Relay live-only 边界 | 已完成代码和测试 baseline | descriptor、ACL、presence、owner 二次授权与离线 fail-closed 已实现；Relay 不保存 Room 正文                                                                           |
| 实体文档化与记忆策略                  | 已完成 baseline           | 多份语义文档、继承来源、有效上下文、结构化配置和受控记忆写回已落地；独立模型自动提炼器仍是可选增强                                                                   |

主要交付节点包括 [PR #346](https://github.com/oneworks-ai/app/pull/346) 的 Channel Runtime / Chat Rooms 主闭环，以及 [PR #368](https://github.com/oneworks-ai/app/pull/368) 的外部频道映射、Team Chat Leader 与 Auto Leader 闭环。

## 尚未完成的远期项

这些项目不阻塞最初三期 MVP，但仍属于完整愿景：

1. **真实多账号可执行登录态**：已有 CanonicalUser、跨账号绑定、credential metadata 和授权请求；尚未实现完整 OAuth/token 存储、刷新、撤销和多个用户账号同时作为 executable principal。当前缺凭证时必须授权、降级或拒绝。
2. **管理员身份治理**：自助 link code 已有；管理员 merge、split、冲突处理及完整 audit 产品流程尚未完成。
3. **自动记忆提炼与 consolidator（未完成）**：已完成的是 MemorySnapshot 加载、agent 显式写回、文件同步、内容 hash 去重和 terminal 审计。尚未完成的是每轮自动提炼候选记忆、语义冲突合并、自动过期/遗忘和“为什么记住”的治理界面；这些能力必须继续受隐私和 provenance 约束。
4. **实体策略继承与配置页（未完成）**：Policy Engine 后端已完成，但配置当前直接落在 ChannelLink。目标模型应是“实体默认策略 -> 特定 ChannelLink 覆盖 -> 临时运行时 override”，并在实体详情和频道关联页展示、编辑最终生效策略及来源。
5. **更智能的话题连续性**：当前 thread resolver 使用平台 reply、direct channel 和 group entity + actor 的确定性规则；模型化 topic split/merge、多人共享 thread 以及平台专属 ephemeral delivery 尚未完成。
6. **完整跨 provider 验收矩阵**：Lark 与 OneWorks 已有真实 E2E；主 RFC 中“Lark 入站后显式另发到 WeChat”、同一实体跨多个真实 provider/account 且权限和记忆不串 issuer 的端到端验收仍需补齐。
7. **跨设备 Room 分享的生产级验收**：Relay live-only 代码和自动化测试已有；仍需用两个真实账号/节点完成在线 send、owner 离线、重连、撤销和中断恢复的完整演练。
8. **完整 event sourcing**：当前 `room_events` 用于审计和命令幂等，权威 projection 直接维护；事件不足以从零重建 Room。只有确实需要 replay 时才单独补事件版本和迁移，不把它算作当前 baseline 缺陷。
9. **单平台账号代理多个实体**：部分平台不便创建多个机器人账号时，允许一个明确标记的共享服务账号统一接收和投递，OneWorks 内部再按 Room、规则或显式目标路由给不同实体。对外消息必须清楚署名，例如 `「产品实体」：消息正文`，不能伪装成多个平台原生账号。该模式需要单独设计共享账号 ownership、逻辑实体来源、入站选择规则、权限复核、记忆隔离、审计和回复线程语义；在这些契约落地前，不直接放宽“一个 ChannelLink 只绑定一个实体”和 issuer 隔离规则。

## 本轮追加而非原始三期的能力

以下能力是在实现过程中根据真实使用反馈追加的，不应反向算成原始规划遗漏：

- 同一外部群进入多个 Team Chat，并按成员分别决定观察或处理；
- 来源图标在用户气泡左侧、投递图标在 Agent 气泡右侧；
- Leader / 普通实体分组、Auto Leader、definition-driven related entities 和 Leader 预设数据；
- 创建页大屏三行、中屏三行、手机两行正方形卡片和“启动招聘”入口；
- 实体详情中继承文档来源和有效内容的正确展示；
- 外部 delegation 的单次授权、原始 thread 回复目标、session/token 防重放和启动失败终结。

## 完成判定

- 如果问题是“最开始约定的三期 runtime baseline 是否落地”：**是。**
- 如果问题是“最开始三期是否已经具备完整产品配置体验”：**否；Policy 配置产品化和自动记忆提炼仍未完成。**
- 如果问题是“Channel Runtime 2.0 主 RFC 的所有远期目标和验收矩阵是否全部完成”：**否。**

## 交付原则

首版按以下两条产品原则取舍：

1. **理解错误必须被处理**：目标实体、频道、用户意图、身份、权限、线程或平台能力不明确时，系统必须澄清、拒绝、降级或明确记录 unsupported；不得静默猜测后继续产生外部副作用。
2. **核心逻辑必须跑通**：承诺支持的 provider 必须从真实入站消息一直走到正确实体执行、原线程回复、投递记录和可解释失败；只有单元测试或模拟页面不算完成。

由此得到三档优先级：

| 优先级      | 定义                                                                      | 发布规则                                 |
| ----------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| P0 必须完成 | 会导致理解错误、错误对象执行、权限越界、消息丢失/重复、主链路不可用的问题 | 任一项未通过都阻塞 V1                    |
| P1 重要完善 | 不破坏当前 Lark + OneWorks 主链路，但影响配置完整性、更多平台或规模化使用 | 进入 V1.1 / V1.2，不能在宣传中冒充已完成 |
| P2 锦上添花 | 自动化、智能化或架构演进；已有人工/确定性路径能够安全工作                 | 不阻塞首版，无真实需求不提前实现         |

## P0：V1 必须完成

### 理解错误处理

为避免把“理解”“是否执行”和“外部投递”混成一个状态机，V1 固定使用三层结果：

- 理解结果：`understood`、`needs_clarification`、`denied`、`unsupported`、`conflict`、`failed`；
- Ingress Router 决策：`ignore`、`observe`、`create_child`、`defer`；
- 投递结果：`pending`、`delivered`、`failed`、`unknown`。

三层结果必须分别持久化或映射，不能用普通业务执行掩盖解析失败，也不能把 `observe` 当成理解失败、把 `unknown` 当成投递成功。

| 场景                                        | 必须行为                                                          | 禁止行为                                                     |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 找不到目标实体、Room 或频道映射             | 给出可操作错误；需要用户选择时创建可续接 clarification            | 选列表第一项或默认实体继续执行                               |
| 同名、别名或映射命中多个候选                | 展示候选及差异，等待明确选择                                      | 依赖数据库或文件遍历顺序                                     |
| 群消息没有明确触发当前实体                  | `observe` 或 `ignore`；只有配置允许时进入无工具 Router            | 把普通群聊都升级成任务                                       |
| @ 了其他机器人或只命中另一个账号            | 当前连接不处理，并保证正确 owning bot 仍能消费同一 provider event | 非 owning bot 抢占全局 dedup，或复用另一 bot 的 mention 结果 |
| Lark mention、发送者或 reply 引用无法规范化 | 保留安全原文和结构化错误；必要时澄清                              | 把 `<at ...>`、open_id 等平台标记直接当用户正文展示或推理    |
| 线程归属不确定                              | 优先使用当前 provider reply/root；没有可靠证据时新建话题或澄清    | 使用“最近一次线程”猜回复目标                                 |
| 身份已识别但用户 credential 缺失            | 发起授权、降级为草稿或拒绝                                        | 借用 runner、桌面登录态、CLI 用户或 bot secret               |
| 平台不支持请求的投递能力                    | 明确说明 unsupported 并提供可用替代方案                           | 假装已发送或静默换到另一个账号/平台                          |
| 记忆候选互相冲突                            | 保留来源和冲突状态；不确定内容不得覆盖已确认事实                  | 静默选择最新一条或模型偏好的版本                             |
| 外部发送结果不确定                          | 保留 pending/unknown 证据并进入人工确认或 provider 查询           | 把不确定结果标记为成功，或无幂等保护地重发                   |

### 核心链路

V1 的正式范围是 Lark + OneWorks。以下链路必须在真实环境中完整通过：

```text
Lark provider event
  -> normalize sender / mention / message / thread
  -> deduplicate without losing the owning bot copy
  -> resolve ChannelLink and every eligible Team Chat mapping
  -> apply access / moderation / availability / ingress rules
  -> persist Room message with source provenance
  -> select explicit Leader / Auto Leader / owning member
  -> create a fresh authorized ChildSession or external delegation
  -> execute the selected entity
  -> channel.send to the original reply target
  -> persist delivery result and platform message reference
  -> render source icon on the user side and delivery icon on the Agent side
```

必须覆盖的真实场景：

1. 同一个 Lark 外部群进入两个 Team Chat，两边按各自成员连接策略独立处理。
2. 同一 Room 有多个 bot connection 时，非 owning bot 的 webhook 不重复执行，也不阻断 owning bot。
3. 分别 @ bot A / bot B 时，只唤醒对应 require-mention 成员。
4. 消息来自 thread A，等待期间 connection 收到 thread B，最终回复仍回到 A。
5. 显式 Leader、Auto Leader 和普通成员三条执行路径都能产生正确 child run、权限上下文和投递。
6. Auto Leader 只把外部回复授权交给拥有该连接的成员；host、非 owning member 和复制 token 的 session 均被拒绝。
7. 服务启动、session 创建、模型执行或 provider 发送失败时，消息、child run、delegation 和 delivery 都进入一致的 terminal / retryable 状态，不留下永久 `started` / `running` 脏记录。
8. 旧 Room、移除连接、不可用连接和 legacy 数据不会被下一条消息静默恢复或错误重绑。
9. 桌面与手机宽度均能看到正确的成员、来源、投递和错误状态，无破图、横向溢出或不可操作控件。
10. Fresh Chrome 中没有由本链路新增的 HTTP 4xx/5xx、console error 或 runtime exception。

### V1 发布门禁

以下条件必须同时满足：

- 没有已知 P0，也没有未解决的 V1 范围理解、权限、重复投递、数据破坏或生命周期回归；列入 V1.1/V1.2 的 P1 路线项不阻塞 V1，但不能在发布说明中冒充已完成。
- Lark 真实群聊的入站、执行和原线程回复至少连续通过三轮，包含一次显式 Leader、一次 Auto Leader 和一次 require-mention。
- 相同 provider event 重放不会重复创建外部副作用。
- 所有失败都能在 trace、Room timeline 或结构化状态中定位到具体阶段和 reason code。
- 相关 node/web 测试、完整 typecheck、lint、format、diff check 全部通过。
- 桌面、390px 和至少一个中间宽度完成真实浏览器交互及 Network/Console 验收。
- 发布说明明确首版只承诺 Lark + OneWorks；未完成能力在 UI 和文档中不出现“已支持”文案。

## P1：重要但不阻塞 V1

### V1.1：实体策略与配置产品化

目标是修正当前 Policy 配置所有权，并让用户不编辑 JSON 也能配置：

1. 在 Entity 定义中增加 availability、moderation、routing 和默认白名单策略。
2. ChannelLink 只保存特定频道的 override；未配置字段继承实体默认值。
3. 临时 `/availability on|off` 继续作为最高优先级的运行时 override，并显示操作者和生效时间。
4. 实体详情增加“工作策略”页；频道关联面板增加“覆盖实体默认值”。
5. UI 展示每个有效字段的来源：实体、父实体、ChannelLink 或临时 override。
6. 迁移现有 ChannelLink 配置，保证有效策略不变，并为冲突或无效时区提供显式错误。

验收标准：同一实体绑定两个群时默认使用同一工作策略，其中一个群可以只覆盖工作时间和话术；修改实体默认值后，未覆盖的群立即继承，覆盖项保持不变。

### V1.2：跨 Provider 与共享账号模式

1. 完成 Lark 入站后显式投递到 WeChat / WeCom 的真实 E2E，并验证 issuer、记忆和权限不串线。
2. 完成同一实体在同 provider 下使用两个真实账号的执行与审计。
3. 设计单平台共享账号代理多个实体的显式模式：共享服务账号负责传输，逻辑实体保持独立。
4. 共享账号发送消息必须使用可配置署名格式，例如 `「产品实体」：消息正文`；原始 service principal 和逻辑实体都进入审计。
5. 入站无法确定目标实体时必须澄清或进入明确的 Router，不按最近活跃实体猜测。

验收标准：共享账号下两个实体的线程、记忆、策略和权限互不串线；接收方始终能看出当前发言实体；关闭共享模式后恢复严格的一账号/实体绑定。

### V2：身份授权与远端分享

1. 完成用户 OAuth/token 的加密存储、scope、刷新、过期、撤销和授权恢复。
2. 完成管理员 bind/unbind/merge/split、冲突处理、审计和安全回滚。
3. 使用两个真实账号和两个 owner node 完成 Relay 分享、在线 send、离线 fail-closed、重连、撤销和中断恢复。
4. 验证 Relay 的持久化、日志和重试路径始终不包含 Room 消息正文、prompt、memory 或 credential。

## P2：锦上添花

- 自动记忆候选提炼、语义冲突合并、自动过期和遗忘。
- 更智能的 topic split/merge、多人共享 thread 和 provider 专属 ephemeral delivery。
- 完整 event sourcing、版本化 replay 和从零重建 Room projection。
- 更丰富的策略模板、数据看板、批量配置和推荐值。

这些项目只有在确定性 baseline、隐私边界和可解释审计稳定后再做。自动记忆提炼不能早于实体策略与 provenance 模型；完整 event sourcing 只有出现真实 replay / 审计需求时才启动。

## 建议排期

以下估算按 1 名主开发、独立审阅与真实验收支持计算；不包含第三方平台审核等待时间。

| 里程碑                | 预计工期   | 内容                                                            | 退出条件                                   |
| --------------------- | ---------- | --------------------------------------------------------------- | ------------------------------------------ |
| V1.0 范围冻结         | 0.5 天     | 冻结 Lark + OneWorks 承诺、错误分类和验收矩阵                   | 需求、reason code、测试和真实场景一一对应  |
| V1.0 理解错误加固     | 1.5 天     | 歧义、mention、thread、unsupported、credential 和 conflict 处理 | 所有高风险歧义 fail-closed，澄清可续接     |
| V1.0 核心链路回归     | 1.5 天     | 多 Room、多 bot、Leader/Auto Leader、失败终结和幂等             | 自动化矩阵与真实 Lark 三轮通过             |
| V1.0 UI/可观测性/发布 | 1.5 天     | reason 展示、trace、三档响应式、文档和 release gate             | 无新增 app error，首版范围表述准确，可发布 |
| V1.1 实体策略模型     | 2 天       | Entity defaults、ChannelLink override、runtime override 和迁移  | 新旧有效策略一致，来源可解释               |
| V1.1 配置 UI          | 3 天       | 实体策略页、频道覆盖编辑、校验和 i18n                           | 全部核心策略无需手写 JSON                  |
| V1.1 验收与文档       | 2 天       | 继承/覆盖/冲突测试、真实上下班/backlog 验收                     | 两频道继承/覆盖矩阵通过                    |
| V1.2 跨 Provider      | 3 天       | Lark -> WeChat/WeCom、多账号 issuer 隔离                        | 真实跨平台 E2E 通过                        |
| V1.2 共享账号多实体   | 4 天       | 契约、路由、署名、权限、记忆隔离和 UI                           | 两实体共享账号但不串线                     |
| V1.2 收口             | 1 天       | 失败矩阵、迁移、文档和发布门禁                                  | 无新增 P0/P1                               |
| V2 OAuth/身份治理     | 7 至 10 天 | OAuth/token lifecycle、管理员身份治理和恢复                     | 两真实用户授权、撤销、恢复均通过           |
| V2 Relay 双节点验收   | 3 至 5 天  | 双账号/双节点在线、离线、重连、撤销                             | live-only 与隐私边界真实通过               |

推荐节奏：

- **第 1 周**：只做 V1.0 加固并发布，不插入新能力。
- **第 2 至 3 周**：完成 V1.1 实体策略与配置页。
- **第 4 至 5 周**：完成 V1.2 跨 provider 与共享账号模式。
- **第 6 周以后**：根据真实用户需求决定先做 OAuth/身份治理还是双节点 Relay；P2 不预排固定日期。

## 实施拆分

每个里程碑独立冻结、审阅和验收，避免把安全主链与 UI/智能增强混进一个大 PR：

1. 理解结果契约与 reason code。
2. Ingress / mention / thread / target clarification。
3. Child lifecycle、幂等、authority 与 failure terminalization。
4. 真实 Lark E2E 与用户可见错误状态。
5. Entity policy schema / resolver / migration。
6. Entity policy UI 与 ChannelLink override UI。
7. 跨 provider E2E。
8. 共享账号多实体契约和实现。
9. OAuth / identity governance。
10. Relay 双节点验收。

任何 PR 若让理解错误退化为默认选择、扩大 credential、跨 entity 复用记忆或隐藏外部投递失败，直接按 P0 阻断，不以“后续再优化”放行。
