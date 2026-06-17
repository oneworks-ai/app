# RFC 0006：执行流程与验收

返回 [RFC 0006](./0006-official-model-providers.md)。

## 原则

按项目维护经验执行：主线程做 integration owner，先稳定共享契约，再并行开发独立 workstream。子线程不自行合并；主线程 review diff、按依赖顺序合入，并维护验收矩阵。

第一版目标不是把所有 provider 深度能力做满，而是让常见 provider、relay 和 gateway 都能轻量接入：有 preset、图标、主页、购买/充值、配置入口和可手动填写 key/model 的闭环。

## Shared Contract First

先落一个小范围 contract PR 或至少在主线程确认以下类型：

- `ModelProviderId`、`ProviderCategory`、`ProviderCapabilities`
- `IconRef`、`ProviderPortalLinks`、`ProviderStatusDefinition`
- `ModelServiceConfig` 的 `provider`、`icon`、`homepageUrl`、`providerOptions`、`management`
- `ResolvedModelServiceConfig` 和 `ServiceModelOption`
- 服务端 route 名称和响应：registry、probe、models、balance/status、secrets

UI、server、adapter 不能各自发明私有 provider 类型。

## Workstreams

| Stream                | 范围                                                        | 主要文件                                              | 可并行性             |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| A Contract & Registry | 类型、schema、provider registry、轻量 preset                | `packages/types`、`packages/core` 或 `packages/utils` | 最先开始             |
| B Server Actions      | provider probe、model list、balance/status、secret wrappers | `apps/server/src/services/model-providers/`、routes   | 依赖 A，可先 mock    |
| C Config UI           | model service editor、preset、portal/status/action buttons  | `apps/client/src/components/config/`                  | 依赖 A，可用 fixture |
| D Selectors & Icons   | service/model option 解析、图标 fallback、聊天/自动化选择器 | `packages/utils`、client hooks/selectors              | 依赖 A               |
| E Adapter Resolution  | resolved service、base URL/wire API 转换、云资源型 option   | `packages/adapters/*`                                 | 依赖 A，避开 UI      |
| F Provider Presets    | 官方、云厂商、海外 relay、国内 relay、custom templates      | registry data、icons、portal links                    | 可与 B/C/D 并行      |
| G Verification        | 测试矩阵、focused tests、Chrome smoke、最终 gate            | tests、smoke notes                                    | 全程跟进，最后签收   |

## Merge Order

1. A：共享类型、schema、registry 空壳和轻量 preset 结构。
2. F：首批 preset 数据、图标、portal/status link。
3. D：统一 service/model option 和图标 fallback。
4. B：服务端 provider action API，先接 OpenAI/Kimi/DeepSeek/MiniMax。
5. C：配置 UI、管理主页、状态和 action 入口。
6. E：adapter resolved service 改造和云资源型覆盖。
7. G：补齐测试、真实浏览器 smoke、最终质量门。

## Parallel Rules

- A 和 F 可以并行，但 F 不改类型，只按 A 暴露的 shape 填数据。
- C 可以用 fixture 开始，但合入前必须切到 A 的正式类型。
- B 和 D 可并行；B 不改选择器，D 不直接调上游 provider API。
- E 等 A 稳定后再动，避免 adapter 反复跟随字段变化。
- 涉及真实平台账号、充值、实名、MFA 的验证不交给子线程自动化；只做导航和人工确认 runbook。
- 任何线程发现需要改共享 contract，先回报 integration owner，不在本 stream 私自扩字段。

## 验收矩阵

| 验收项                                                 | Owner | 证据                        |
| ------------------------------------------------------ | ----- | --------------------------- |
| provider registry 不返回 secret                        | A/B   | registry API 测试           |
| 官方 provider 可用最小 `provider + apiKey`             | A/E   | config resolution 单测      |
| `apiBaseUrl`、`models`、`homepageUrl` 默认不写但可覆盖 | A/C/D | schema/update 和 UI 测试    |
| 图标 fallback 统一                                     | D/C   | service/model selector 测试 |
| 聊天、配置、自动化启动选择器图标一致                   | D/G   | client focused tests        |
| Kimi 双站点不混用 endpoint                             | A/B/C | probe/list/balance 测试     |
| relay/gateway 首版能打开官网配置                       | C/F   | UI 测试和 Chrome smoke      |
| iframe/webview 禁止嵌入时有 fallback                   | C/G   | 浏览器/Electron smoke       |
| 状态查询失败不阻塞调用                                 | B/C   | status API 测试             |
| agent runbook 在付款/实名/MFA 前停止                   | C/G   | 手动验收记录                |

## Focused Checks

- `pnpm exec dprint check`
- `pnpm typecheck` after A/D/E
- `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler packages/utils/__tests__`
- `pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/server/__tests__`
- `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__`
- Chrome smoke：配置页创建 provider、打开管理主页、刷新模型、选择模型、fallback 图标。

## 子线程 Prompt 模板

```text
实现 RFC 0006 Workstream <X>。只改允许范围：<paths>。
禁止修改相邻 workstream、禁止改共享 contract，除非先回报主线程。
必读：根 AGENTS.md、.oo/rules/maintenance/task-planning.md、RFC 0006 对应分片。
当前主线程未提交 diff 在 /Users/yijie/.codex/worktrees/f764/app。
交付：变更摘要、测试命令和结果、未验证项、需要 integration owner 决策的问题。
```

## 收口

主线程维护矩阵：stream、branch/thread、写入目录、PR、验证、阻塞点。子线程完成后先只读 review diff，再合入；不 ping 正在运行线程。最终回复列出落地文件、验收证据、未接入能力和后续 provider backlog。

会话看板模板：

| Session    | Worktree/Branch   | Owner             | Stream | 允许路径                                                   | 依赖 | 验收证据                                | 只读 Review        | 合入状态   |
| ---------- | ----------------- | ----------------- | ------ | ---------------------------------------------------------- | ---- | --------------------------------------- | ------------------ | ---------- |
| main       | 当前集成 worktree | integration owner | A-G    | 全局协调                                                   | 无   | typecheck、focused tests、lint、smoke   | 第三方 review 完成 | 待最终收口 |
| backend-1  | 独立 worktree     | server owner      | B      | `apps/server/src/services/model-providers/`、routes、tests | A    | node route tests                        | backend reviewer   | 待合入     |
| frontend-1 | 独立 worktree     | client owner      | C/D    | `apps/client/src/components/config/`、selector hooks       | A/D  | bundler.web focused tests、Chrome smoke | frontend reviewer  | 待合入     |
| registry-1 | 独立 worktree     | registry owner    | F      | provider registry、icons、RFC 表格                         | A    | registry tests、链接抽查                | docs reviewer      | 待合入     |

每个 stream 完成后必须附：变更文件、测试命令、未验证项、阻塞点、review 结论。integration owner 只在 review 结论无 P0/P1 后合入。
