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
- 每次隔离 monitor 运行都必须在完成所有必要的父会话通知，以及终态运行的 monitor 自删除动作后，显式调用 thread archive 能力归档当前执行 thread。普通“无变化”运行同样必须自归档；任何运行都不得归档父会话。
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

## 协调回调与用户通知边界

- worker、owner 和 monitor 的回调首先是协调器的内部信号，不是自动发送给用户的通知。协调器应消费这些信号来继续任务、核验证据、删除 heartbeat 和归档任务。
- 普通启动、进度、健康 / 无变化与清理事件默认静默处理。多个回调若共同描述同一阶段或结果，应合并成一个结论，不能按回调逐条向用户播报。
- 只有需要用户输入 / 决定 / 批准、失败 / 风险 / 身份不匹配 / 实质计划变化需要关注、用户可见里程碑完成、用户明确询问状态或可以交付最终综合结果时，才发送用户可见更新。
- 是否发送用户消息不影响收口义务。terminal 证据核验、heartbeat 删除和任务归档仍按既定流程执行；静默事件不能成为跳过清理的理由。
- 持久化规则和用户可见摘要只保留可复用的最小证据，不写任务 ID、账号信息、secret、个人路径或按时间排列的过程日志。

## 终态回调与归档

独立任务的完成状态、消息通知和归档是三件不同的事：worker 进入 `idle`、发送最终回复或把结果回调给主线程，都不会自动把线程移出任务列表。除上方明确要求自归档的隔离 scheduled monitor 执行 thread 外，归档由创建它的主线程负责；该特例只允许执行 thread 归档自身，绝不归档父会话。

对于非 monitor 独立任务，主线程必须维护本任务创建的独立 thread id 清单，并对每个 thread 执行以下顺序：

1. 收到最终结构化回调；如果没有回调但线程已经停止，直接读取该线程的最终输出、diff / PR 和外部状态，必要时只追问一次缺失证据。
2. 核验 terminal status、实际结果、写入范围、验证、Git / PR / merge 状态和是否仍需 follow-up。`idle`、`interrupted` 或 `hasUnreadTurn: false` 都不能单独证明任务完成。
3. 仍在运行、等待审批、等待 CI、等待用户输入或需要恢复的线程继续保留，不得提前归档；`BLOCKED` 只有在主线程已经记录阻塞和接手方案后才可归档。
4. 对已核实的 `COMPLETED`、`FAILED`、`STOPPED` 或 `CANCELLED` 线程删除对应 heartbeat。
5. 显式调用线程归档能力，例如 `set_thread_archived`，并检查返回结果确认归档成功。不要依赖 worker 的最终回复、状态变为 `idle` 或消息已送达来推断归档。
6. 从本任务 pending 矩阵中移除该线程，记录其终态和已提取证据。只有本任务创建的独立 worker、reviewer、协调器和 Git / PR operator 进入本流程；不要扫描后归档用户主会话、其他任务的线程或用户仍需继续对话的会话。
7. 主线程最终回复前再检查一次本任务 thread 清单。只要存在已经终止但未归档的独立线程，主任务就不能声称“完全完成”；应立即补做归档，或如实报告清理阻塞。

多角色链路还要按依赖顺序收口：source / fork 在冻结产物已被下游核验、live-main 组装被接受且不再需要返工后才能归档；reviewer 的 PASS / findings 被主线程核验后归档；Git operator 的 commit、PR、CI 或 merge 终态已核验后归档。每个角色先发送终态回调，再由创建任务的主协调者删除对应 heartbeat、完成归档并从本任务 thread 清单 / pending 任务矩阵移除；最后确认本任务创建的已终止 fork、source、reviewer、operator 均不再残留。不要为了清空任务矩阵提前归档仍被下游读取、等待 required checks、可能接回重组或尚未回调的任务。

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

### 无审批独立任务的 CLI 入口

- Desktop `create_thread` 的宿主启动策略可能高于 `~/.codex/config.toml` 和项目 `.codex/config.toml`，且当前线程 schema 不一定暴露 `approval_policy` / `permission_profile`。用户已明确要求“无需审批”时，不得把配置文件值当作新会话的实际权限，也不得先启动正式任务再等审批问题暴露。
- 无审批独立任务优先使用专用 worktree 中的持久化 CLI 会话：`codex exec --dangerously-bypass-approvals-and-sandbox --ignore-rules -C <worktree> --json <prompt>`。`--ignore-rules` 是必要组成：项目 / 用户 exec-policy 的 `prompt` 规则可能在 bypass 模式下直接拒绝命令，而不是弹出审批。不要加 `--ephemeral`；从 JSONL 捕获 session ID，并记录 worktree、owner、deadline 和停止方法。首次采用或 Codex 版本、`CODEX_HOME`、项目 exec-policy 改变后，先运行无写入 smoke，并至少用一个明确授权但可逆的受限命令验证 exec-policy 不会拦截，再确认 CLI session 能被同一 Desktop / session inventory 按 ID 读取，最后才发送真实任务。
- 后续指令只用 `codex exec resume --dangerously-bypass-approvals-and-sandbox --ignore-rules <session-id> <prompt>`。当前交互式 `codex resume` 不支持 `--ignore-rules`，不得用于承诺无审批的任务；需要持续输出时由创建者持有非交互 exec 的进程句柄、读取 JSONL 并按 deadline 停止。结束后由创建者核验终态、保留所需 worktree 证据并执行 `codex archive <session-id>`，用户无需照看、审批或清理子会话。
- `--dangerously-bypass-approvals-and-sandbox --ignore-rules` 只取消 Codex 审批、sandbox 和本地 exec-policy 拦截，不扩大用户授予的任务范围；因本地规则不再提供防线，必须把精确授权、禁止事项、隔离 worktree、单一写入者、deadline、heartbeat、身份 / remote / scope preflight 和独立审阅写入 prompt 并由创建者核验。若任一 CLI flag、持久化、session ID 捕获、受限命令 smoke 或 Desktop inventory smoke 失败，立即停止并报告 capability gap，不回退到可能产生人工审批的正式 Desktop worker。
- 如果由本任务创建的会话仍意外进入 `waitingOnApproval`，创建者不得要求用户处理。先中断 / 拒绝待审批操作，保留未提交 worktree，再将任务标记 `STOPPED` 并归档；只有可能丢失用户数据、需要扩大授权或无法安全停止时才向用户报告。该收口是下方“运行中等待审批不得提前归档”的窄例外：必须先确认 turn 已被中断，再归档。
- Git commit、push、PR 创建 / 更新、merge 等远端写入仍必须由独立 Git operator 执行，主线程不得因 bypass 可用而接管。用户明确要求该独立任务无需审批时，可以使用同一持久化 CLI 入口，但 operator prompt 必须直接携带可追溯的本轮用户授权，并精确列出仓库、目标分支、允许的 commit / push / PR / merge 动作、merge 方式和分支清理范围；首次写入前仍须完成 `gh` 身份、remote、重复 PR、base、diff 和 `git push --dry-run` 预检。缺少精确授权、身份或范围时立即停止，不得把 full-access 当作授权，也不得扩大或重写历史。未要求绕过审批时，继续优先使用下方 project thread / same-directory fork 与项目 auto-review。

## 权限预检与审批恢复

- Permission-sensitive external / network / install / Git 操作前，先用与目标、transport 和动作类别匹配的非变更 capability probe；配置文本、授权标签或旧任务成功不能替代真实探测。
- GitHub API 只使用本机官方 `gh`，Git transport 只使用 SSH；身份、仓库权限和 transport 必须分别核验，不得用 connector、复制 token、credential 变更或宽泛命令放行绕过。
- Git / PR 写操作仍需可追溯的用户授权、精确 scope 和独立 Git operator；任务进入 `waitingOnApproval` 或 capability 不足时保持零变更并回调，主线程不得接管远端写入。

### GitHub CLI 单一授权入口

完整的权限恢复、GitHub CLI 身份边界、operator 授权传递和审批故障分类见 [Git 交付的权限与授权](./task-planning/git-delivery-authorization.md)。

## 集成与验证

- 主线程负责最终集成，不让子线程自行合并到主干。
- 合入顺序固定：基础结构、独立功能、依赖功能、统一清理、文档和收口验证。
- 每个子 PR 合入前检查契约：数据模型、API、权限、UI 状态、i18n、文档、测试。
- 非机械代码修改必须独立检查局部正确性与全局 / 抽象影响；低风险窄改可由一个独立 reviewer 同时覆盖，中高风险或跨模块修改拆成两个关注面。审阅必须直接读取 diff 和相关调用方，不以实现者自报结论代替。
- 验证按下方“按变更风险选择验证”分层；窄改只跑能证明对应风险的局部门禁，跨模块或用户流程再跑类型检查、相关单测、浏览器回归和完整 CI。
- 合入后如果发现提交信息、CI 或文档边界问题，优先 follow-up PR；需要 rewrite / force push 时必须有明确授权。
- `pr` 不等于“创建 PR 即完成”。创建 PR 前从 `.github/pull_request_template.md` 准备已忽略的 `.logs/pr-body.md`，并运行 `pnpm tools pr-preflight origin/main HEAD --body-file .logs/pr-body.md`；通过后再创建、复用或收口 PR。逐项检查适用的 PR policy、CI、changelog、真实 UI 截图、Experience Review、Draft / merge 授权、重复 PR、工作区是否干净、远端是否同步和正文隐私。PR 正文不得包含用户名、本机绝对路径、worktree ID、临时路径、会话 ID 或任何秘密。
- UI 截图先用 `pnpm --silent tools dev-service status <target> --json` 或 `ensure` 核验服务属于目标 worktree / 分支，再用 DOM 证据和可见截图共同证明目标变化；不能因端口已存在就相信它对应本任务。
- 测试、失败和完成的独立任务按约定归档；测试 PR 未获明确授权不得 merge。收口时删除 heartbeat，并清理为测试创建且不再需要的远端分支。
- 最终收口回复要列清：落地文件、采纳的审阅建议、未采纳建议及原因、验证结果、剩余风险、follow-up 和已归档线程。不要把长过程日志塞进最终回复。

### 高变动 main 上的 source freeze 与 Git 交付

当多个 PR 串行落在持续前进的 `main`，实现、审阅和 Git 写入必须围绕同一份不可变 source 身份协作，不能让 operator 在陈旧 worktree 上临场解决差异：

1. **冻结 source**：source owner 先 `git fetch --prune origin` 或用等价权威方式刷新远端，从实时 `origin/main` 建立初始 clean worktree；只产生目标 tracked changes 后，记录 base SHA、冻结 diff 和精确 manifest。manifest 逐 path 记录变更状态 / 删除 tombstone、Git object type、mode 与 clean filter 后的 blob / tree OID；这里的 canonical bytes 指将进入 repository 的 Git blob bytes，不是未经 clean filter 的 worktree 文件。base、path state、mode 和 object OID 共同定义本轮可交付范围，未跟踪文件、生成物和 policy addendum 不能隐式混入。
2. **审阅冻结内容**：独立 reviewer 直接读取冻结 diff、相关调用方和 manifest，分别报告局部正确性、全局 / 抽象影响与 exact scope 是否 PASS。审阅结论必须绑定完整冻结身份；source path state、mode 或 canonical bytes / object OID 变化后，旧 PASS 失效。
3. **分层审阅 policy addendum**：产品 source 与 changelog、截图资产、PR body、CI / policy 补充材料分开列 scope。repository addendum 使用相同的 path state、mode 与 object OID manifest；PR body 和外部稳定截图证据绑定经审阅的 digest 或不可变标识。先确认产品 source 与已审版本完全一致，再单独审阅 addendum 的真实性、隐私、链接稳定性和 policy 合规性；addendum 若触碰产品 source，必须重新 freeze 并重新审阅，不能借“补门禁”扩大已批准实现。
4. **operator 复核 live main**：Git operator 先刷新远端，从实时 `origin/main` 建立初始 clean worktree。只有 live main 仍等于冻结 base，或协调器已在新 base 上完成下述重组并取得新 PASS 时，才按 manifest 组装；组装后、commit 前不要求 worktree clean，而是确认没有 manifest 外路径，并比较 assembled index 的 exact path state、mode 和 object OID。commit 后、push / PR 写入前再次刷新并确认 live main 未移动、worktree clean、commit tree 与已审 source / addendum manifests 一致；写入 PR 后还要回读远端 head、PR body 和外部证据标识，确认与已审身份相同。
5. **main 移动就重新组装**：如果 live main 已前进，从新的 live main 创建全新 clean worktree，重新应用精确 scope、验证新 base 上的行为并生成新的 freeze / review 身份。交付 operator 不执行 rebase、force push，也不手工解决冲突；同路径变化或冲突返回 source owner 与 reviewer 重新判断，避免把未经审阅的冲突产物送入 PR。

创建 PR 前把门禁材料当作实现交付的一部分准备完毕，而不是等 required checks 失败后再补：

- 产品功能 / 修复按发布范围准备正确 changelog；UI 变化准备从目标 head 的真实可运行界面取得、可长期渲染、无敏感信息的发布级截图。临时本地路径、将被删除的 head ref、旧图或未披露的示意图不能作为真实证据。
- PR body 从 `.github/pull_request_template.md` 生成；`## Experience Review` 标题和三项 checklist 必须逐字保留并按事实勾选，规范正文见 [`pr-experience-review.md`](./pr-experience-review.md)。不要改写标题层级或关键短语；需要沉淀经验时，必须等对应独立 reviewer PASS 后才能勾选 reviewer 条目。
- 在 Git operator 接手前完成适用的 changelog、截图、Experience Review、Policy Conflict Review、CI scope 和隐私检查；operator 只发布已审阅的 source freeze 与明确列出的 addendum，不负责临场补产品内容。

PR-event required contexts 的故障恢复按 [Actions 事件或队列异常导致 required context 缺失](./common-issues.md#actions-事件或队列异常导致-required-context-缺失) 处理；手动 dispatch 或旧 PR revision 的成功不能替代当前 PR-event 门禁证据。

## 按变更风险选择验证

本地验证只覆盖当前 diff 的真实风险，不能因为远端 required context 名称固定，就在纯文档任务中重复其完整产品命令。先用 `scripts/pr-validation-scope.cjs` 对精确 base / head 分类，再按下列层级执行；命中多个文档层级时取并集，出现任一非文档路径时 fail closed 到完整产品门禁。

| 变更形态                                                                       | 本地最低门禁                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 普通内部 Markdown、AGENTS 或 `.oo/rules`                                       | 对 changed paths 做格式检查；`git diff --check`；`scripts/docs-only-validation.mjs` 的 scope、changed-line privacy、链接 / anchor 检查；PR body / scope / duplicate / privacy preflight |
| policy、workflow、permission 或 release-rule 文档                              | 上述普通内部文档门禁，加一份独立、只读的规则冲突与隐私审阅；reviewer 必须直接读取 exact diff，并在 PASS 后才进入 Git / PR 写入                                                          |
| 面向用户的 public README（包括根 README / `README.zh-Hans.md`）或 `.oo/docs`   | 对应文档门禁，加相关 public docs build 和 media verify；只运行该文档站 / 媒体路径实际需要的依赖与命令                                                                                   |
| `changelog/` 或 release docs                                                   | 对应文档门禁，加 `scripts/docs-only-validation.mjs --release-preflight` 与现有 release-doc preflight                                                                                    |
| source、workflow、config、lockfile、manifest、script、test 或任何 mixed change | 完整 product lint / typecheck / test / build / package 等适用门禁，并叠加命中的 policy、public 或 release 文档门禁                                                                      |

纯内部文档不本地重复无关的全量 ESLint、全量 typecheck、macOS packaging 或产品 build。PR 上仍保留稳定 required context 名称，但 docs-only context 的 body 应只执行 classifier、格式、文档 scope / privacy / link / anchor 和适用的 policy / public / release 门禁；验收 hosted canary 时必须查看 step-level evidence，确认 heavy install、full lint / typecheck、package 和 product build step 实际 skipped，而不是只看 check conclusion。

## 经验沉淀流程

经验沉淀流程与常见反例见 [经验沉淀](./experience-retention.md)。
