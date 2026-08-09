# Git 交付的权限与授权

本文收敛 permission-sensitive 操作的 capability probe、审批恢复、GitHub CLI 单一入口和独立 Git operator 授权传递。任务拆分、监控、source freeze 与验证入口见 [任务规划、委派与经验沉淀](../task-planning.md)。

## 权限预检与审批恢复

- 配置文件、任务 prompt、delegation 文本或“Full Access”标签只能说明预期权限，不能证明当前任务已经捕获对应 permission profile。任何 permission-sensitive external / network / install / Git 操作前，当前执行任务必须先运行一条与目标、transport 和动作类别匹配的非变更 capability probe；只记录非敏感结论，不把配置文本或旧任务成功当作替代证据。
- 同一 host 的官方 `gh` credential 由任务复用，不为新 worktree / task 重做认证。GitHub API 的权威双信号是 `gh api user` 与 `gh api repos/<owner>/<repo>`：前者确认实际身份，后者确认目标仓库可达性和权限；`gh auth status` 只能作为辅助诊断，不能单独触发用户确认或 credential 变更。不得在任务内运行 `gh auth login`、`logout` 或 `refresh`，也不得仅因 status 文本要求用户登录。
- Git transport 与 GitHub API 分开探测。交付前读取实际 remote，并让目标执行任务用 SSH 对精确目标 ref 做 `git push --dry-run` 或等价非变更协商；只有 API 双信号和 SSH probe 都通过，才说明该任务具备继续执行已授权操作的有效 capability。
- 新任务一旦进入 `waitingOnApproval`，或无法使用 source task 已验证可用的 host localhost proxy，必须保持零变更，向主任务回调 `BLOCKED`、证据和 `Safe to archive`。协调器核验后归档并从已验证 Full Access source task 重建；不得把 approval / login 路由给用户，也不得在受限任务里试做相邻修复。
- 对用户已明确授权、能够安全共享 checkout 的非 Git release / read-only / install 工作，可以从已通过 capability probe 的 Full Access source task 创建 same-directory fork；prompt 必须声明“你就是执行者，不得继续委派”，并保持原授权的目标、动作和停止条件。Git commit、push、PR 创建 / 更新和 merge 继续遵守独立 Git operator 边界；无法建立有效 operator capability 时报告 capability gap，主线程不得接管 Git 写操作。
- 项目 ask / approval 列表只对精确命令类别和目的生效；例如 `kill`、`chmod` 的已有条目不能证明或授权不相关的 external、install、Git 或 credential 操作。
- Git / PR 独立任务的 prompt 必须包含精确的仓库、PR / 分支、允许的写操作、merge 方式、是否删除远端分支和本轮用户授权；只写“处理 PR”或“合入”不足以让审批者判断边界。
- 流程或 skill 要求“获得明确批准后再修复”时，先从当前任务历史解析已有授权；批准约束的是操作范围，不要求必须在诊断结果之后重复发生。用户已明确要求为当前变更创建 PR 并 merge 时，该授权覆盖为同一 PR 补齐 changelog、真实截图、Experience Review、PR body 和其他不扩大产品改动范围的合并门禁材料，以及对应的 commit、push 和 PR 更新。应告知门禁失败与处理内容，但不要让用户重复授权。只有修复会扩大产品代码范围、改变 merge 方式或分支清理范围、需要 rebase / rewrite / force push，或引入新的外部 / 破坏性操作时，才重新确认。
- 创建 Git operator 前先完成官方 `gh` API 双信号、读取仓库实际 remote、运行目标 SSH push dry-run，再运行 `pnpm tools git-delivery check --repository <owner/name> --json`。只有本机官方 `gh`、repo-specific 权限、实际 Git transport 和项目 Full Access 配置的真实加载 probe 都 ready 时才开始 commit / push / PR；不要等到收尾阶段才发现授权链断裂。
- 本项目是可信本地开发项目，`.codex/config.toml` 使用 `approval_policy = "never"` 与 `default_permissions = ":danger-full-access"`，让新加载任务获得完整文件系统和网络能力且不暂停等待审批。Full Access 只提供执行能力，不替代用户授权、独立 Git operator、目标限制、隐私边界或 capability probe；managed requirements 与显式启动覆盖仍有更高优先级。
- 新项目配置与规则只对重新加载后的任务生效。Git 写操作必须交给通过项目线程能力新建、会重新加载 `.codex/config.toml` 的干净独立 Git operator；普通 collaboration child 即使继承 Full Access 也不能承担远端 Git 写操作。真实验收让新 operator 执行一条范围明确且可逆的 Git 元数据写入，并确认没有停在人工 `waitingOnApproval`；旧线程成功不能证明新配置已加载。
- 如果 worker 仍进入 `waitingOnApproval`，不要在该受限 worker 内修改项目层权限或授权上下文。按零变更规则回调并归档后，协调器核对 effective config，再从已验证 Full Access source task 创建至多一个干净验证任务。不要连续 fork 带有长协调历史的主任务；需要共享同一 worktree时，prompt 必须明确“你就是执行者，不得再委派”。权限传递仍失败时记录 capability gap，不能让主线程接管远端 Git 写操作，也不能要求用户重复已经明确给出的授权。
- GitHub Connector 返回 `Resource not accessible by integration` 只说明非标准集成不可用，不能成为修复、安装或改用 connector / 网页 UI 的理由。回到本机官方 `gh` 完成身份与仓库权限核验；`gh` 未 ready 时停止交付，不能绕开此门禁。
- 不要额外添加命令级永久 `allow` 放行 `gh pr merge`、`git push` 或 `gh api`。项目 Full Access 已消除人工停顿；操作边界继续由可追溯用户授权、独立 Git operator、精确目标和 preflight 约束，而不是由宽泛命令前缀替代。

## GitHub CLI 单一授权入口

- GitHub API 身份、repository 元数据 / 状态、PR、Actions、release 状态和 credential 相关交付操作只使用本机官方 `gh` CLI。禁止用 Codex、Claude 或 GitHub 插件、隐藏 connector 身份、复制 token、环境变量注入 token 或其他集成绕过；源码的 clone / fetch / push 由 `git` 统一通过 SSH transport 执行。
- `gh` API 身份与 Git transport 是两条独立链路。GitHub API 操作仍需要 browser / device OAuth；SSH 只承载 clone / fetch / push，不会替代、恢复或延长 `gh` OAuth credential，也不改变 `gh` API 身份。
- 用户指定 GitHub 写入身份时，operator 必须使用该身份；用户明确要求通过 `gh` CLI 操作时，先运行 `gh auth status` 做本机 CLI 诊断，再以 `gh api user` 和 repo-specific API 作为实际身份与权限的权威信号。不得把 GitHub App、connector 或网页集成绑定的身份当成用户指定的 CLI 身份，也不得把具体账号、credential 输出或机器路径写入规则、PR body、changelog 或回调。
- Git transport 以 SSH 为标准协议：本机官方 `gh` 的 Git 协议偏好必须为 `ssh`，repository remote 应使用 SSH URL。交付预检同时核对实际 remote URL，并通过精确 `git push --dry-run` 证明当前任务能到达 SSH remote；配置文本和普通连通性检查都不能代替这次 capability probe。
- 每次 GitHub API / PR 写入前运行 `gh api user` 和 repo-specific API。若任一调用实际返回身份不匹配、仓库不可达或权限不足，立即停止 GitHub API / PR 写入并回报；不得尝试备用插件、隐藏凭据、登录 / 登出 / 刷新 credential 或其他认证路径，也不得把辅助 `gh auth status` 文本单独升级成用户阻塞。
- SSH 22 端口不可达时，可以复用 host 已配置的 GitHub 官方 SSH-over-443 路径；若新任务无法复用 host localhost proxy 或既有 SSH transport，按零变更规则回调并由协调器归档 / 重建。不得在受限 worker 内临时修改 host 网络、SSH 或 credential 配置。
- 状态报告和规则沉淀只记录协议、门禁与非敏感结论，不包含 token、账号细节、绝对个人路径或某台机器 / 网络的一次性事故时间线。

## Git operator 的可信授权传递

Git / PR 写操作需要同时满足“任务范围精确”和“用户授权可追溯”。父 agent 在普通 collaboration worker prompt 中复述“用户已授权”只提供任务上下文，不能把普通 worker 变成独立 Git operator。平台生成的 `create_thread` delegation 不等同于普通 worker prompt：它会成为新独立任务的直接输入，当前实测可以形成可信的 Git operator 授权链路，但允许范围仍不得超过来源用户请求。

当前 Codex 工具的实测边界：

| 独立任务入口                                       | 授权上下文来源                              | Git 交付资格                                     | 当前用途               |
| -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ---------------------- |
| `collaboration.spawn_agent` + `fork_turns: "none"` | 只有父 prompt 转述                          | 不具备独立远端写授权链路                         | 只读审阅、无远端写实现 |
| `collaboration.spawn_agent` + 正数 `fork_turns`    | 携带近期对话，但没有可采信的授权 capability | 不具备独立远端写授权链路                         | 只读审阅、无远端写实现 |
| `codex_app.create_thread` + project worktree       | 新任务直接收到可追溯的 delegation 输入      | 已验证 dry-run，并完成真实 push / PR / merge     | 独立 worktree operator |
| `codex_app.fork_thread` + `same-directory`         | 继承源任务已完成的真实用户历史              | 已验证可加载 Full Access 并执行受限 Git 写入探针 | 同目录 operator        |

标准处理：

1. 先按状态共享需求选择入口：
   - 已审阅状态能由目标仓库、base、ref / commit / branch 或 operator 自己的受限改动精确定位时，优先用 `create_thread` 创建 project worktree。delegation 必须直接写清来源任务、仓库、状态锚点、允许的 Git / PR 动作、merge 方式和分支清理范围；该新任务本身就是 operator，不要求它再 fork。
   - 必须读取当前 worktree 或未提交 diff 时，用 `fork_thread` + `same-directory`。用户授权必须已经进入源任务的已完成历史，因为 same-directory fork 不复制仍在运行的 active turn。
2. 创建前核验 `create_thread`、`fork_thread`、`send_message_to_thread`、`wait_threads` 和归档工具的当前 schema，确认项目 / worktree 选择、状态锚点以及 model / reasoning 能力；不要用旧记忆猜参数。
3. 创建后同步登记 thread / worktree、约十分钟 heartbeat、deadline 和 cleanup cutoff，并要求 operator 在阶段边界回调主任务。无论使用哪种入口，都要明确“你就是执行者，不得再委派”；任务输入用于收窄 capability，不得自行扩大来源用户授权。
4. 第一次写入前完成只读 preflight：确认目标 worktree、已审阅的 diff、当前分支 / ref、远端同步、已有或重复 PR、base branch、适用 PR policy、Draft / merge 授权、merge 方式和分支清理范围。前置条件未满足时停在只读阶段；不要先创建 PR 再补查这些边界。
5. 新 operator 先执行官方 `gh` API 双信号，再执行 `git push --dry-run` 或等价的无写入远端协商。只有这些受限命令真实到达对应 API / SSH remote，才能证明该任务的 host capability 有效；它们不授权后续 `commit`、真实 `push`、PR 创建 / 更新或 merge。任一 probe 进入 `waitingOnApproval` 或无法使用 host proxy 时保持零变更并回调，由协调器归档 / 重建；每一项 Git / PR 写操作仍须落在来源用户授权和 operator prompt 的精确 scope 内。
6. preflight 和授权链路均通过后，operator 才按授权依次 commit、push、创建或复用 PR；required checks 和审批在 PR 上继续等待、核验。主线程保留是否满足 merge 条件的判断，operator 只执行已明确授权的 merge 方式和清理范围。
7. 用 `wait_threads` 获取紧凑进度；终态证据核验后删除 heartbeat，立即 `set_thread_archived` 并确认归档成功，不要把执行日志重新灌入主线程。
8. 如果授权只存在于当前 active turn，且状态可以交给独立 project worktree，使用带精确 delegation 的 `create_thread`；如果必须走 same-directory fork，则等该用户回合进入 completed history 后再创建。两条路径都无法形成可信 capability 时，记录并修复能力缺口，不让用户复述授权，也不回退主线程执行。

继承完整历史的 same-directory fork 只是共享当前状态的兼容路径，不是唯一可信路径。`create_thread` delegation 已实测可以直接承担独立 Git operator；长期目标仍是由运行时传递结构化授权：来源用户回合、目标仓库、提交 / 分支、允许操作、有效期和禁止事项。能力变化后应重新执行 Full Access 加载和真实 Git capability 验收。

## 区分 Codex 审批与 GitHub 授权

- 命令尚未启动就返回 `Rejected(...)` 或进入 `waitingOnApproval`：检查 managed requirements、显式启动覆盖、任务是否重新加载项目 Full Access 配置，以及独立任务类型；不要让用户重复授权。
- 官方 `gh api` 已到达 GitHub 后返回 scope / repository permission 错误：这是当前 credential capability gap，不是 subagent prompt 权限问题。停止对应 API / PR 写入并回调，由协调器从已验证 source task 重建或报告缺口；不得在 worker 内 login、refresh 或修改 credential。Git push 的 SSH authority 仍由独立 dry-run 证明，不能用 API scope 文本代替。
- GitHub Connector 返回 `Resource not accessible by integration`：这是被禁止用于交付的备用集成状态，不据此安装、修复或切换插件；GitHub 身份和权限只回到本机 `gh` 核验，Codex shell 审批仍单独处理。
