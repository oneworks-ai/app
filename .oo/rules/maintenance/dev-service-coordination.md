# 开发服务跨会话协作协议

本协议定义主会话、运维子会话和多个并行 agent 如何共享当前开发阶段的局部运行态。服务进程由统一后台管理器持有；agent 会话是按需、短生命周期的操作者，不承担常驻职责。

## 适用范围

统一系统管理需要跨会话复用、具有明确健康状态的长期本地开发资源：

| target               | 管理内容                                      |
| -------------------- | --------------------------------------------- |
| `web`                | management server + Vite Web client           |
| `daemon`             | 独立 management daemon                        |
| `electron`           | Electron launcher                             |
| `electron-workspace` | Electron + 当前仓库 workspace                 |
| `pwa`                | server + standalone PWA                       |
| `homepage`           | Astro homepage + PWA preview                  |
| `docs`               | VitePress docs + 可复用 homepage              |
| `relay`              | Relay Server + Relay Admin                    |
| `desktop-control`    | agent 使用的 Electron control protocol bridge |
| `android-emulator`   | 全局协调的机器级可见 Android AVD              |

management server 动态创建的 workspace server、插件 server runtime、WDA / iproxy 等由其宿主服务继续管理，不建立第二个顶层状态源。测试 mock、smoke 临时 server 随测试命令退出；Vercel / Cloudflare 等外部部署由对应平台管理，也不接入本地协议。

## 唯一操作入口

```bash
pnpm --silent tools dev-service ensure <target> --json
pnpm --silent tools dev-service status <target> --json
pnpm --silent tools dev-service events <target> --limit 20 --json
pnpm --silent tools dev-service logs <target> --limit 80 --json
pnpm --silent tools dev-service restart <target> --json
pnpm --silent tools dev-service stop <target> --json
```

旧 `dev-start` 入口只保留兼容，不再作为 agent 文档中的操作路径。查询不得触发启动；正常生命周期操作不得绕过 CLI 手工执行 `ps`、`kill`、端口探测或 target 私有命令。`stop` 与 `restart` 无论服务当前是 `ready`、`failed` 还是其他 phase，都必须先获得用户对该 target 的显式授权；父会话或运维 agent 不得把“服务不健康”推定为停止授权。

## 共享上下文模型

agent 不共享聊天记录，通过三个本地事实层交接：

1. **状态快照**：`.logs/dev-start-<target>.json`。包含 `schemaVersion`、`revision`、`generation`、`phase`、`operation`、URLs、顶层 PID 和 `components[]`；受管进程同时记录启动指纹，component 记录独立 PID、端口、URL、health URL 与 target 日志路径。schema v2 只有在 `phase=ready`、至少一个受管 component 且所有 PID/指纹/health 均匹配时才可复用，不能只凭端口 URL 判定。状态条件写在跨进程 mutation lock 内按 revision / generation / phase 原子校验，旧 generation 不得覆盖新状态。
2. **操作租约**：`.logs/dev-start-<resource>.operation.lock/owner.json`。同一 target 或共享底层资源的 `ensure`、`restart`、`stop` 串行执行；`web` / `daemon` 共享 manager 资源租约，`electron` / `electron-workspace` 共享机器级单实例租约。owner 包含 operation id、actor、target、resource key、PID、进程指纹和开始时间；只读状态只把 PID 与指纹仍匹配的 owner 视为活跃。macOS / Linux 使用随 holder 进程退出自动释放的内核文件锁，平台 fallback 使用 heartbeat stale lock；holder 意外退出时所属 CLI 立即失败关闭，不能在丢锁后继续变更。
3. **事件记录**：`.logs/dev-start-<target>.events.jsonl`。按行记录 operation 的 `started / completed / failed`，用于新会话理解最近发生了什么。读取时逐行容错，崩溃留下的坏尾行不会抹掉其余有效历史。actor 优先使用 `CODEX_THREAD_ID`，不会写入聊天正文。

快照回答“现在是什么”，事件回答“刚才发生了什么”，租约回答“谁正在修改”。日志只用于失败证据，不是状态源；`logs <target>` 只接受 target 目录内、文件名属于该 target 且 realpath 未越界的有限尾部，并在交给 agent 前遮蔽常见 token、密码、账号、Authorization 与连接串模式；非结构化敏感正文无法仅靠模式匹配可靠识别，运维 agent 发现后必须从 handoff 省略并报告脱敏风险。状态、事件和日志默认限定在当前 worktree 的 `.logs/`；另一个 worktree 必须读取自己的状态文档。

`android-emulator` 与 Electron 是例外的机器级共享资源：它们的状态、租约、事件与日志统一保存在用户目录 `.oneworks/dev-service/`。Android 快照记录 owner worktree、generation、AVD、serial、PID 与进程指纹；launcher registry 记录 AVD、PID、进程指纹、`coordination` 和 `ownerRoot`。由 dev-service 调用时 registry 标记 `coordination: "dev-service"` 并写入 owner worktree；直接启动内部 launcher 只属于前台诊断，但也必须经过同一个机器级 kernel guard，新进程 registry 标记 `coordination: "uncoordinated"`、`ownerRoot: null`。直接复用已由 dev-service 协调的 emulator 时必须保留原 owner，不能覆写为 uncoordinated；直接 `--restart` 必须拒绝，由统一 CLI 在完整 operation lease 和显式授权下执行。复用和停止前分别核对 AVD command / serial / 进程身份；`electron` 与 `electron-workspace` 的全局快照记录 owner worktree 和 launch identity，并共享单实例租约。切换 AVD、Electron mode 或 workspace 前必须按显式授权走统一停止 / 重启流程。

## 主会话与运维子会话

- 单一 `dev-service ensure` 快路径由当前会话直接执行，避免委派开销。
- 多服务组合、重复重启、失败日志收集或需要在主会话之外保持噪声隔离时，按需创建 `dev_service_operator`；不要创建永久在线 agent。
- 父会话给出 target、允许动作、完成条件、deadline，以及用户是否显式授权 stop/restart。运维 agent 不接收代码修改任务。
- 运维 agent 先读 target-scoped `status --json`，再执行一个受租约保护的动作，最后读同一 target 的 status/events，并只在失败时读取有限且已脱敏的 logs，然后返回紧凑 handoff。
- 代码根因、架构判断和修复回到父会话；运维 agent 只收集受限日志，不在失败后自行扩大范围。
- 运维工作属于低歧义、多工具、强验收任务，项目自定义 agent 使用 Luna / medium。出现未知根因或公共契约问题时停止并升级，不通过提高运维 agent reasoning 继续试错。

推荐 handoff 字段：`target`、`resourceKey`、`action`、`ready` / `phase`、入口 URL 或 device serial、operation id、state path、events path、bounded sanitized error。父会话不依赖子会话的自然语言记忆恢复状态。

## 并发与恢复规则

- 同一 worktree 的生命周期 mutation 经过 worktree lifecycle lock 整体串行，保证 fetch / pull / install / submodule / build 与启动交付处于同一源码一致性边界；只读 status/events/logs 仍可并行。首次运行缺少 TS register 时，`run-tools` 在加载主协议前使用独立的 worktree bootstrap guard（macOS / Linux 为内核锁，其他平台为 owner-PID/token fallback）只在锁内二次检查并按需安装依赖，释放后才执行实际 CLI；JSON 模式抑制安装器原始 stderr，失败返回统一 error envelope。资源级租约进一步约束共享 owner：`web` / `daemon` 共享 manager owner，`electron` / `electron-workspace` 受机器级单实例互斥，`android-emulator` 受机器级全局协调。跨 worktree 的机器级 target 仍必须等待其全局资源租约。
- `ensure` 只幂等复用健康、身份相符的服务或占用空槽启动。遇到已有 live PID、failed / stale / partially-started 状态或不同 launch identity 时必须拒绝并要求显式授权 stop/restart；不能仅因加载改动或恢复异常自行替换。仅本次 ensure 新建的 generation 启动失败时允许自动回滚该 generation。
- `stop` / `restart` 会记录 `stopping` 和最终 `stopped` / `ready` phase；停止后保留不含活动 PID 的快照，便于后续会话交接。
- 后台 component 非预期退出时，当前 generation 写入 `failed`；旧 generation 不得覆盖新状态。
- schema v1 快照不直接复用；显式 stop 只在进程 cwd 仍属于记录的 repo root 时临时采纳 fingerprint 并清理，否则失败关闭，避免 PID 复用误杀。
- 停止 `desktop-control` 时必须先终止 bridge 记录的 Electron sessions，再关闭 HTTP server；不能留下失去 owner 的 detached Electron。
- 命令失败后先读 target-scoped `events`，必要时再读有限且已脱敏的 `logs`。租约 owner 已死亡或进程指纹不再匹配时，`status` 不再把它报告为 active；下一操作会在内核锁保护下覆盖陈旧 owner，不手工删除活跃租约。
- 状态文件与事件不得写入 token、密码、真实账号、连接串或聊天正文；日志输出给 agent 前必须再次执行常见敏感模式遮蔽，无法可靠识别的非结构化正文由运维 agent 省略。

## 扩展新服务

新顶层 target 只有同时满足“长期运行、跨会话复用、可定义健康检查、生命周期由本仓控制”才接入。扩展时必须补 target config、component 状态、启动/清理、健康检查、CLI 描述、测试和本文清单；宿主内部子进程优先作为 component 或由宿主负责，不重复建立顶层 manager。
