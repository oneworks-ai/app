---
alwaysApply: true
description: 仓库通用维护入口；默认加载时只保留快路径、上下文预算和排查索引。
---

# 项目维护入口

本文件会默认进入会话上下文，必须保持短小。完整维护说明见 [维护细则](./maintenance/README.md)。

## 开发服务 Fast Path

用户要求启动、拉取后启动或复用本地开发服务时，直接运行统一入口：

```bash
pnpm --silent tools dev-service ensure <target> --json
```

常用 target：`web`、`daemon`、`electron`、`electron-workspace`、`pwa`、`homepage`、`docs`、`relay`、`desktop-control`、`android-emulator`。命令退出 0 且 JSON 中对应服务为 `ready: true` 后不要再做额外 `ps`、`curl` 或读日志验证；只有失败或用户明确要求排查时，才读取 target-scoped、有限行且已脱敏的 `logs` / `events`。`stop` 与机器级共享 target 的 `restart` 必须逐次显式授权；worktree-local target 可以复用用户明确授予的当前任务重启授权，不能从服务状态推定。完整协议见 [`maintenance/dev-service-coordination.md`](./maintenance/dev-service-coordination.md)。

## 上下文预算

- `alwaysApply: true` 的规则正文会直接进入默认会话 prompt，只能写稳定硬约束和阅读路由；目标是控制在一屏内，避免把调试手册、命令大全或历史经验塞进默认上下文。
- 用户要求周期性监控外部状态时，必须让隔离的 scheduled task 执行轮询；只有发生有意义的状态变化、需要操作、失败或终态时才向父会话发送一条简报，普通“无变化”轮询必须静默结束且不得追加父会话上下文。每次隔离运行（包括普通“无变化”运行）结束前都必须归档自身的执行 thread，绝不归档父会话；命中终态时还必须先删除 monitor 自身。去重、只读范围、退避与终态清理见 [`maintenance/task-planning.md`](./maintenance/task-planning.md#监控与协作)。
- worker、owner 和 monitor 回调是协调器的内部信号，不自动变成用户通知。普通启动、进度、健康 / 无变化和清理事件应静默核验并收口；只有需要用户输入 / 批准、出现需关注的失败 / 风险 / 身份不匹配 / 实质计划变化、完成用户可见里程碑、用户主动问状态或已有最终综合结果时才对外更新，并合并同一结果的多条回调。heartbeat 删除和任务归档始终独立执行，详见 [`maintenance/task-planning.md`](./maintenance/task-planning.md#协调回调与用户通知边界)。
- 一级 `.oo/rules/*.md` 会进入规则目录。非 `alwaysApply` 规则通常只进摘要和路径，但仍会增加规则清单噪声；领域细节优先放进同名子目录，例如 `release/README.md`、`adapter-design/README.md`。
- 新增或扩写规则时，先判断内容是否需要默认加载。默认加载只保留“必须马上知道”的约束；任务相关细节用链接渐进式披露。
- 扩大 `.oo/rules` 内容后，至少跑一次体积审计，避免下次会话再次膨胀：

```bash
find .oo/rules -maxdepth 1 -type f -name '*.md' -print0 | xargs -0 wc -c -l
```

## 代码交付质量

- medium reasoning 只负责边界明确后的日常实现，不等于可以省略全局设计和最终审阅。非机械代码修改在写入前必须产出 Change Brief、影响地图和抽象决策；实现者不得自审自批。
- 交付前按风险完成独立的局部正确性、全局 / 抽象审阅和自动化门禁；公共契约、状态所有权、权限、安全、数据、复杂并发或不可逆操作必须升级设计或最终审阅。执行清单见 [`maintenance/code-delivery-quality.md`](./maintenance/code-delivery-quality.md)。
- 本地验证按变更形态分层：普通内部 Markdown / 规则只跑格式、diff、链接 / anchor、changed-line privacy、scope 和 PR preflight；policy / workflow / permission / release rule 文档追加独立只读冲突审阅；公开 README / `.oo/docs` 与 changelog / release docs 分别追加对应 docs build / media 或 release-doc preflight。任何 source、workflow、config、lockfile、manifest、script、test 或 mixed change 回退完整产品门禁；纯文档不得重复无关的全量 lint、typecheck 或 macOS packaging。详见 [`maintenance/task-planning.md`](./maintenance/task-planning.md#按变更风险选择验证)。
- 配置或 prompt 中声明的权限不是当前任务已捕获有效权限的证明。权限敏感的 external / network / install / Git 操作前先做窄范围、非变更 capability probe；GitHub API 身份与仓库权限只认本机官方 `gh api user` 加 repo-specific API，Git transport 另用 SSH dry-run 验证。新任务进入 `waitingOnApproval` 或无法复用 host localhost proxy 时保持零变更并回调，由协调器归档 / 重建；Git 写操作仍由独立 operator 承担。完整边界见 [`maintenance/task-planning.md`](./maintenance/task-planning.md#权限预检与审批恢复)。
- GitHub API 身份 / 状态、PR、Actions、release 和 credential 交付只认本机官方 `gh` CLI，不通过 Codex / Claude / GitHub 插件、connector、复制 token 或其他集成绕过。Git clone / fetch / push 统一使用 SSH；同一 host 复用已有 credential 与 SSH / proxy transport，不在任务内 login、logout、refresh 或临时改 host 配置。API 双信号或 SSH probe 失败时停止对应写入并回报 capability gap，详见 [`maintenance/task-planning.md`](./maintenance/task-planning.md#github-cli-单一授权入口)。

## 常见入口

- 代码质量、测试、发布前检查：[`maintenance/README.md`](./maintenance/README.md)
- medium 编码的全局影响、抽象与交付门禁：[`maintenance/code-delivery-quality.md`](./maintenance/code-delivery-quality.md)
- 常见问题索引：[`maintenance/common-issues.md`](./maintenance/common-issues.md)
- 日志消费与排查：[`maintenance/logs.md`](./maintenance/logs.md)
- 开发任务的模型档位、速度、消耗与路由：[`maintenance/model-routing.md`](./maintenance/model-routing.md)
- 新模型的持续评测、结果分析与推荐范围更新：[`maintenance/model-routing-evaluation.md`](./maintenance/model-routing-evaluation.md)
- 历史任务分布与六模型微基准报告：[`maintenance/model-routing-analysis.md`](./maintenance/model-routing-analysis.md)
- 任务规划、委派与经验沉淀：[`maintenance/task-planning.md`](./maintenance/task-planning.md)
- 开发服务跨会话状态、租约、事件与运维子会话：[`maintenance/dev-service-coordination.md`](./maintenance/dev-service-coordination.md)
- 跨进程环境变量命名、继承清洗与污染回归：[`maintenance/process-environment.md`](./maintenance/process-environment.md)
- 能力展示录屏工具：[`maintenance/demo-video.md`](./maintenance/demo-video.md)
- 桌面打包 runtime cache：[`maintenance/desktop-packaged-runtime-cache.md`](./maintenance/desktop-packaged-runtime-cache.md)
