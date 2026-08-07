# 任务规划、委派与经验沉淀

本文收敛复杂任务中的通用处理方式：怎么拆任务、什么时候开子线程、如何监控、遇到分配或任务问题时怎么收口，以及如何把过程经验沉淀回项目。

## 先判断任务形态

- 如果用户只是要启动开发服务，命中根 `AGENTS.md` 的 dev-service Fast Path，直接执行 `pnpm --silent tools dev-service ensure <target> --json`，不要套用下面的复杂流程。
- 如果用户是在问方案、规划、评审或经验总结，先只读规则和相关代码 / 文档，不要急着改。
- 如果用户明确要实现，先判断主要落点、风险和验证面；需求边界清楚后再改代码。
- 如果任务涉及公开文档、README、AGENTS 或 `.oo/rules`，先按边界归类：用户使用说明进 `.oo/docs` / README，内部维护经验进 `.oo/rules` / AGENTS，迁移过程和个人操作痕迹不落库。
- 如果用户中途改变方向，以最新用户指令为准：停止推进过时目标，更新主线程任务矩阵，必要时给已创建子线程发送窄范围停止 / 改向消息，避免继续消耗在旧任务上。
- 不适合开子线程的情况由主线程本地完成：小改动、上下文强耦合、需要连续用户确认、涉及真实凭据或私有账号操作、没有独立验收面的任务。

## 模型选择与升级

模型选择遵循“最低充分能力”原则。创建子线程或分配模型前必须阅读 [`model-routing.md`](./model-routing.md)，按任务的抽象特征和执行阶段比较 GPT-5.4 / GPT-5.5 与 5.6 Luna / Terra / Sol；不要仅根据任务名称选模型，也不要把示例模型名当成固定依赖。

- prompt 必须给出明确目标、允许与禁止范围、必要输入、验收标准、验证命令和停止条件。缺少这些信息时，先由主线程澄清或收窄任务，不能仅靠提高模型能力补偿含糊委派。
- 较轻量模型产出必须经过与风险匹配的自动验证或主线程审阅。未通过验收时，先判断是 prompt、环境、拆分还是能力问题；确认能力不足或连续失败、越界、遗漏关键约束时再升级。
- medium reasoning 只适合边界确定后的日常实现。非机械代码任务开始写入前必须按 [`code-delivery-quality.md`](./code-delivery-quality.md) 给出 Change Brief、全局影响地图和抽象决策；实现线程不能同时承担最终批准。
- 如果委派、同步和复核的总成本高于任务本身，主线程直接完成。模型分级不构成创建子线程的理由。
- 工具不能设置或核验实际 model / reasoning 时，只能把档位写成计划，不能声称已经降档。成本优化是本次委派目标时，不创建继承父模型的 subagent；用户明确授权独立会话并且线程工具支持模型参数时，才切换到可执行的模型路由通道。
- 创建独立协调线程时，也要为协调器显式选择最低充分 model / reasoning。边界清晰的状态监控、报告集成和常规工程计划使用 Terra / medium；只有协调器需要处理开放式关键判断时才升级 Sol。
- commit、push、PR 创建或更新、满足条件的无冲突 merge 执行等 Git / PR 写操作必须交给显式选定最低充分 model / reasoning 的独立任务，通常为 Luna / low 或 medium；独立线程能力不可用或可信授权无法传递时，停止交付并报告 capability gap，不得回退主线程执行。边界明确的代码实现和证据准备可用 Terra / medium；主线程保留授权、风险判断、独立审阅和是否 merge 的决定。

## 拆分 PR 和子任务

- 先把任务拆成可独立 review 的 PR 或提交范围，每个范围有明确目标、触达目录、验收标准和验证命令。
- 让子任务写入范围尽量不重叠；强依赖前序 diff 的清理或统一收口任务后置。
- 不要一次开满所有线程。先开互相独立的第一波，等结构稳定后再开依赖型任务。
- 主线程维护整体矩阵：范围、推荐 model / reasoning 及理由、分支、pending worktree / thread id、写入目录、验收命令、PR、CI、阻塞点、后续接口，以及适用的 `restartAuthorization`。父任务使用 Sol 不代表所有子任务继承 Sol；按 `model-routing.md` 对每个独立验收面重新选档。

## 创建子线程前

- 先查工具 schema，不要凭记忆填参数。模型、reasoning、权限字段以当前工具实际支持为准；在声称“不能指定 subagent 模型”前，必须检查 Codex 的 `create_thread`、`fork_thread`、`send_message_to_thread` 等独立任务能力。确认同目录 fork 是否可复用完成历史和 worktree，并确认后续消息是否支持显式切换 model / reasoning；能力未核验前不得把限制当作事实。用户明确要求“最高推理”时才映射到所选模型实际支持的最高值，不把 `max` / `ultra` 当作默认设置。
- 如果预期档位与父线程不同，创建前必须确认工具能传 model / reasoning，并计划在创建后读取运行记录核验实际值。不能传参时，先比较“当前线程直接完成”和“继承型 subagent 拆上下文”的总成本；除非后者仍有明确独立价值，否则不创建。
- 创建前先查是否已有同范围 pending worktree、thread、branch 或 PR；命中时优先复用、接手或归档，不重复开线程。创建失败后再查一次，确认是否已经部分创建成功。
- prompt 要窄，必须写清楚：
  - 第几个 PR / 审阅 / 子任务，目标是什么。
  - 明确禁止做哪些相邻任务。
  - 必读的 `AGENTS.md`、`.oo/rules/*`、模块文档和当前主线程绝对路径。
  - 是否允许改代码；只读审阅要明确禁止改代码、启动服务、提交和开 PR。
  - 不要 revert 用户或其他线程改动。
  - 建议分支名、验证要求、交付格式。
  - 非机械代码修改还要包含 Change Brief、影响地图、抽象决策和需升级的风险触发器。
- 每个独立任务 prompt 都必须带主任务 thread ID，并要求 worker 在每个阶段完成、失败或阻塞时通过线程消息主动发送结构化摘要（范围、状态、证据 / diff、验证、阻塞或下一步）。没有回调只表示未证实完成，不能静默视为完成。
- 如果当前任务已获得开发服务重启授权租约，prompt 必须按 [`dev-service-coordination.md`](./dev-service-coordination.md) 原样携带 task、worktree、target、action、scope、granted 和 expires。上下文压缩、heartbeat 或委派不得丢失租约；worker 只在字段全部匹配时复用，不匹配时回到主线程确认，不能自行扩大范围。
- prompt 还必须要求最后一次结构化回调包含 `Terminal status`（`COMPLETED` / `FAILED` / `STOPPED` / `CANCELLED` / `BLOCKED`）、最终证据、剩余 follow-up、当前写入者 / Git / PR 状态和 `Safe to archive`。`Safe to archive` 只是 worker 声明，不能代替父线程核验；worker 不要在发出最终回调前自行归档，以免父线程丢失结果。
- 如果主线程有未提交 diff，子线程 prompt 中写入当前 worktree 的绝对路径，让它优先读取这份最新内容，而不是只审默认分支。
- 子线程 prompt 的最小模板字段：目标、允许范围、禁止范围、必读文件、未提交 diff 绝对路径、是否只读、建议分支名、验证命令、交付格式、停止条件。
- 同一 worktree 同时只能有一个写入者。多个只读审阅可共享 worktree；并行实现必须优先分配独立 worktree，并在任务矩阵中登记写入范围和所有者。

## 监控与协作

- 用户要求长期、周期性监控外部状态时，默认创建与父会话隔离的 cron / scheduled task，不让父会话承担普通轮询回合。创建前先查同一目标和终态条件是否已有 monitor，优先复用或更新，避免重复监控。
- 隔离 monitor 的每次运行只做有界、只读检查；监控授权不扩大为状态修改授权。只有出现有意义的状态变化、需要操作、检查失败或命中终态时，才向父会话发送一条简洁消息；普通“无变化”运行必须静默结束，不得向父会话追加任何内容。
- 监控频率应按预期变化窗口和近期活动自适应：接近预期转换或刚发生变化时可短暂加密，长期稳定时逐步退避并设置合理上限。仅保留检测变化所需的最小非敏感游标或摘要，不在任务或调度状态中存储 secret、凭据、私有状态或私有载荷；命中终态并发送最终消息后，monitor 必须删除自身。
- 创建独立任务时同步建立约十分钟的 heartbeat，同时记录 pending worktree id；只有任务在同步创建调用内已经完成、已回调主任务且无需后续观察时才能省略。不要只靠子线程主动回来报喜。每次 heartbeat 至少检查线程状态、deadline、范围是否越界、Git 写入者、开发服务归属和是否已回调主任务；任务完成、失败、停止或取消后按下方“终态回调与归档”清单收口。
- 为每个成本敏感子任务记录实际 `startedAt`、deadline 和可用的 interrupt / cancel 方法。Prompt 停止条件不构成硬超时；deadline 到达时必须主动中断，或停止等待、标记超时并使用已有证据，不能因为线程仍在推理而继续放任消耗。
- 同时为协调器记录 worker cutoff、cleanup cutoff、integration cutoff 和 final deadline；在 cleanup cutoff 前完成结果提取、heartbeat 删除和独立线程归档，不能把正常清理拖到最终输出之后。若硬 deadline 迫使主线程先返回，必须明确报告尚未完成的归档，并让已经绑定本任务的外部监控器执行；不得把“已完全收口”作为结果交付。
- 监控顺序：
  1. 查 pending worktree 是否已经变成 thread。
  2. 查线程状态和最后输出。
  3. 查 branch diff、commit、PR 和 CI。
  4. 只有 failed、blocked、长时间 idle 且无变化，或明确需要输入时才发消息。
- 不要 ping 正在运行或思考的线程，避免打断推理。
- 监控发现 worker 走偏时，把可复现的证据发送给原独立任务，要求其在既定范围内纠偏；主线程不应悄悄代做该任务。纠偏后涉及 Git / PR 的机械操作仍按最低充分档位切回 Luna。
- deadline 中断不属于无意义 ping，优先级高于“不打断正在推理”的一般规则。
- worker、协调器和总任务是否超时只认平台或外部监控时间；模型自报“约 N 秒”不能覆盖 `durationMs`。
- 线程因 rate limit、工具失败或中断卡住时，主线程应读取已有 diff / PR 接手，或另开小范围新线程继续；不要无限等待原线程。
- 完成的审阅线程提取结论后归档；完成的实现线程先由主线程 review diff，再决定是否合并。

## 终态回调与归档

独立任务的完成状态、消息通知和归档是三件不同的事：worker 进入 `idle`、发送最终回复或把结果回调给主线程，都不会自动把线程移出任务列表。归档由创建它的主线程负责。

主线程必须维护本任务创建的独立 thread id 清单，并对每个 thread 执行以下顺序：

1. 收到最终结构化回调；如果没有回调但线程已经停止，直接读取该线程的最终输出、diff / PR 和外部状态，必要时只追问一次缺失证据。
2. 核验 terminal status、实际结果、写入范围、验证、Git / PR / merge 状态和是否仍需 follow-up。`idle`、`interrupted` 或 `hasUnreadTurn: false` 都不能单独证明任务完成。
3. 仍在运行、等待审批、等待 CI、等待用户输入或需要恢复的线程继续保留，不得提前归档；`BLOCKED` 只有在主线程已经记录阻塞和接手方案后才可归档。
4. 对已核实的 `COMPLETED`、`FAILED`、`STOPPED` 或 `CANCELLED` 线程删除对应 heartbeat。
5. 显式调用线程归档能力，例如 `set_thread_archived`，并检查返回结果确认归档成功。不要依赖 worker 的最终回复、状态变为 `idle` 或消息已送达来推断归档。
6. 从本任务 pending 矩阵中移除该线程，记录其终态和已提取证据。只有本任务创建的独立 worker、reviewer、协调器和 Git / PR operator 进入本流程；不要扫描后归档用户主会话、其他任务的线程或用户仍需继续对话的会话。
7. 主线程最终回复前再检查一次本任务 thread 清单。只要存在已经终止但未归档的独立线程，主任务就不能声称“完全完成”；应立即补做归档，或如实报告清理阻塞。

推荐的最终回调最小格式：

```text
Main thread:
Scope:
Terminal status: COMPLETED / FAILED / STOPPED / CANCELLED / BLOCKED
Result and evidence:
Validation:
Git / PR / merge state:
Remaining follow-up:
Safe to archive: yes / no
```

主线程收到此回调后仍要自行核验。`Safe to archive: yes` 不是归档指令，也不能覆盖未完成的 CI、merge、用户确认或证据检查。

## 权限预检与审批恢复

- Git / PR 独立任务的 prompt 必须包含精确的仓库、PR / 分支、允许的写操作、merge 方式、是否删除远端分支和本轮用户授权；只写“处理 PR”或“合入”不足以让审批者判断边界。
- 流程或 skill 要求“获得明确批准后再修复”时，先从当前任务历史解析已有授权；批准约束的是操作范围，不要求必须在诊断结果之后重复发生。用户已明确要求为当前变更创建 PR 并 merge 时，该授权覆盖为同一 PR 补齐 changelog、真实截图、Experience Review、PR body 和其他不扩大产品改动范围的合并门禁材料，以及对应的 commit、push 和 PR 更新。应告知门禁失败与处理内容，但不要让用户重复授权。只有修复会扩大产品代码范围、改变 merge 方式或分支清理范围、需要 rebase / rewrite / force push，或引入新的外部 / 破坏性操作时，才重新确认。
- 创建 Git operator 前先运行 `pnpm tools git-delivery check --repository <owner/name> --json`。只有项目 auto-review、本机 `gh`、仓库写权限和 remote 认证都 ready 时才开始 commit / push / PR；不要等到收尾阶段才发现授权链断裂。
- 本项目通过 `.codex/config.toml` 保持 `on-request` 审批并把 eligible prompt 交给 auto-review。该项目层配置有意作用于可信项目内所有新加载任务，不只作用于独立 worker，并可能覆盖用户层较严格的 reviewer / approval 默认值（managed requirements 与显式启动覆盖仍有更高优先级）；它只替换审批者，不扩大 sandbox、网络或 GitHub 权限。
- 新项目配置与规则只对重新加载后的任务生效。Git 写操作必须交给通过项目线程能力新建、会重新加载 `.codex/config.toml` 的干净独立 Git operator；不要把继承父任务有效 `AskForApproval=Never` 的 collaboration child 当作交付 operator。真实验收让新 operator 执行一条已明确授权的远端写操作，并确认没有停在人工 `waitingOnApproval`；旧线程成功不能证明新配置已加载。
- 如果 worker 进入 `waitingOnApproval`，先检查任务是否加载了可信项目层、`approval_policy` / `approvals_reviewer` 的有效值、命中规则和授权上下文；修复后创建至多一个干净验证任务。不要连续 fork 带有长协调历史的主任务：这种 fork 可能把自己误判成协调器并继续创建 worker。需要共享同一 worktree 时，prompt 必须明确“你就是执行者，不得再委派”。权限传递仍失败时记录 capability gap，不能让主线程接管远端 Git 写操作，也不能要求用户重复已经明确给出的授权。
- GitHub Connector 返回 `Resource not accessible by integration` 表示外部 GitHub App / 集成授权不足，可能来自安装仓库范围、App permission 或组织策略，与本地 shell approval 是两个权限层。只有补齐对应组织 / 仓库授权并复测 connector 写操作后，才能声称 Connector 已修复；`git-delivery check` 已确认本机 `gh` ready 时立即切到 `gh`，不要反复尝试 Connector 或网页 UI。远端写入仍经过上述逐次审批。
- 不要用永久 `allow` 放行 `gh pr merge`、`git push` 或 `gh api`。prefix 只能约束命令前缀，后续 URL / flags 仍可能改变目标；需要零人工停顿时由 auto-review 根据精确用户授权逐次判断，而不是取消边界。

### Git operator 的可信授权传递

Git / PR 写操作需要同时满足“任务范围精确”和“用户授权可追溯”。父 agent 在普通 collaboration worker prompt 中复述“用户已授权”只提供任务上下文，不会把用户权限转化为可供 auto-review 采信的 capability。平台生成的 `create_thread` delegation 不等同于普通 worker prompt：它会成为新独立任务的直接输入，当前实测可以形成可信的 Git operator 授权链路，但允许范围仍不得超过来源用户请求。

当前 Codex 工具的实测边界：

| 独立任务入口                                       | 授权上下文来源                              | Git auto-review 结果                              | 当前用途               |
| -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ---------------------- |
| `collaboration.spawn_agent` + `fork_turns: "none"` | 只有父 prompt 转述                          | 在 Git 命令启动前拒绝                             | 只读审阅、无远端写实现 |
| `collaboration.spawn_agent` + 正数 `fork_turns`    | 携带近期对话，但没有可采信的授权 capability | 在 Git 命令启动前拒绝                             | 只读审阅、无远端写实现 |
| `codex_app.create_thread` + project worktree       | 新任务直接收到可追溯的 delegation 输入      | 已验证通过 dry-run，并完成真实 push / PR / merge  | 独立 worktree operator |
| `codex_app.fork_thread` + `same-directory`         | 继承源任务已完成的真实用户历史              | 已验证可通过受限 `git push --dry-run` auto-review | 同目录 operator        |

标准处理：

1. 先按状态共享需求选择入口：
   - 已审阅状态能由目标仓库、base、ref / commit / branch 或 operator 自己的受限改动精确定位时，优先用 `create_thread` 创建 project worktree。delegation 必须直接写清来源任务、仓库、状态锚点、允许的 Git / PR 动作、merge 方式和分支清理范围；该新任务本身就是 operator，不要求它再 fork。
   - 必须读取当前 worktree 或未提交 diff 时，用 `fork_thread` + `same-directory`。用户授权必须已经进入源任务的已完成历史，因为 same-directory fork 不复制仍在运行的 active turn。
2. 创建前核验 `create_thread`、`fork_thread`、`send_message_to_thread`、`wait_threads` 和归档工具的当前 schema，确认项目 / worktree 选择、状态锚点以及 model / reasoning 能力；不要用旧记忆猜参数。
3. 创建后同步登记 thread / worktree、约十分钟 heartbeat、deadline 和 cleanup cutoff，并要求 operator 在阶段边界回调主任务。无论使用哪种入口，都要明确“你就是执行者，不得再委派”；任务输入用于收窄 capability，不得自行扩大来源用户授权。
4. 第一次写入前完成只读 preflight：确认目标 worktree、已审阅的 diff、当前分支 / ref、远端同步、已有或重复 PR、base branch、适用 PR policy、Draft / merge 授权、merge 方式和分支清理范围。前置条件未满足时停在只读阶段；不要先创建 PR 再补查这些边界。
5. 新 operator 执行 `git push --dry-run` 或等价的无写入远端协商。只有这条受限命令通过 Codex 审批并真实到达 Git 远端，才能证明该命令的可信授权链路有效；它不授权后续 `commit`、真实 `push`、PR 创建 / 更新或 merge。每一项 Git / PR 写操作仍须在精确 scope 下逐次通过 auto-review。
6. preflight 和授权链路均通过后，operator 才按授权依次 commit、push、创建或复用 PR；required checks 和审批在 PR 上继续等待、核验。主线程保留是否满足 merge 条件的判断，operator 只执行已明确授权的 merge 方式和清理范围。
7. 用 `wait_threads` 获取紧凑进度；终态证据核验后删除 heartbeat，立即 `set_thread_archived` 并确认归档成功，不要把执行日志重新灌入主线程。
8. 如果授权只存在于当前 active turn，且状态可以交给独立 project worktree，使用带精确 delegation 的 `create_thread`；如果必须走 same-directory fork，则等该用户回合进入 completed history 后再创建。两条路径都无法形成可信 capability 时，记录并修复能力缺口，不让用户复述授权，也不回退主线程执行。

继承完整历史的 same-directory fork 只是共享当前状态的兼容路径，不是唯一可信路径。`create_thread` delegation 已实测可以直接承担独立 Git operator；长期目标仍是由运行时传递结构化授权：来源用户回合、目标仓库、提交 / 分支、允许操作、有效期和禁止事项。能力变化后应重新执行真实 Git auto-review 验收。

### 区分 Codex 审批与 GitHub 授权

- 命令尚未启动就返回 `Rejected(...)`：Codex / sandbox 审批问题，检查独立任务类型、可信用户历史和项目 auto-review。
- `git push` 已完成远端协商后返回 OAuth scope 错误：GitHub 凭据问题，不是 subagent 权限问题。提交包含 `.github/workflows/**` 时，使用 OAuth token 的 operator 要先通过 `gh auth status` 确认具有 `workflow` scope；缺少时先恢复 GitHub 授权，再重试同一个 operator。
- GitHub Connector 返回 `Resource not accessible by integration`：GitHub App 安装范围或 permission 问题，与本机 `gh` token 和 Codex shell 审批分别处理。

## 集成与验证

- 主线程负责最终集成，不让子线程自行合并到主干。
- 合入顺序固定：基础结构、独立功能、依赖功能、统一清理、文档和收口验证。
- 每个子 PR 合入前检查契约：数据模型、API、权限、UI 状态、i18n、文档、测试。
- 非机械代码修改必须独立检查局部正确性与全局 / 抽象影响；低风险窄改可由一个独立 reviewer 同时覆盖，中高风险或跨模块修改拆成两个关注面。审阅必须直接读取 diff 和相关调用方，不以实现者自报结论代替。
- 验证按风险选择：窄改跑局部测试；跨模块或用户流程跑类型检查、相关单测、浏览器回归和 CI 状态检查。
- 合入后如果发现提交信息、CI 或文档边界问题，优先 follow-up PR；需要 rewrite / force push 时必须有明确授权。
- `pr` 不等于“创建 PR 即完成”。创建 PR 前从 `.github/pull_request_template.md` 准备已忽略的 `.logs/pr-body.md`，并运行 `pnpm tools pr-preflight origin/main HEAD --body-file .logs/pr-body.md`；通过后再创建、复用或收口 PR。逐项检查适用的 PR policy、CI、changelog、真实 UI 截图、Experience Review、Draft / merge 授权、重复 PR、工作区是否干净、远端是否同步和正文隐私。PR 正文不得包含用户名、本机绝对路径、worktree ID、临时路径、会话 ID 或任何秘密。
- UI 截图先用 `pnpm --silent tools dev-service status <target> --json` 或 `ensure` 核验服务属于目标 worktree / 分支，再用 DOM 证据和可见截图共同证明目标变化；不能因端口已存在就相信它对应本任务。
- 测试、失败和完成的独立任务按约定归档；测试 PR 未获明确授权不得 merge。收口时删除 heartbeat，并清理为测试创建且不再需要的远端分支。
- 最终收口回复要列清：落地文件、采纳的审阅建议、未采纳建议及原因、验证结果、剩余风险、follow-up 和已归档线程。不要把长过程日志塞进最终回复。

## 经验沉淀流程

- 只有稳定、可复用的经验才写入项目；一次性过程、个人账号、临时路径、secret、token、邮箱路由目标和平台 account id 不写入仓库。
- 经验写入前先选择位置：
  - 项目协作和任务规划：`.oo/rules/maintenance/` 或 `.oo/rules/DEVELOPMENT.md`。
  - 模块入口和代码归属：最近的 `AGENTS.md`。
  - 用户可见使用说明：`.oo/docs` 或模块 README。
  - 具体线上部署经验：对应部署规则文件，例如 `.oo/rules/RELAY-DEPLOYMENT.md`。
- 写完后做一次交叉检查：至少从文档边界、准确性 / 可执行性、安全 / 隐私三个角度审阅。
- 交叉审阅要只读、范围互斥、输出建议；主线程统一判断哪些建议采纳，避免审阅线程直接扩大改动。

## 常见反例

- 用 unsupported thinking 值，例如工具实际不支持的 `max`。
- 子线程 prompt 范围过大，顺手做了相邻 PR。
- 开线程后不记录 pending/thread/branch，后续无法追踪。
- 直接 ping 正在运行的子线程问“怎么样了”。
- 主线程等子线程等到卡死，而不是读取已有产物接手。
- 把真实账号、secret、邮箱目的地、临时测试凭据写入公开文档或规则。
- 发现经验可复用却只写在最终回复里，没有沉淀到项目规则。
