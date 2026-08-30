# RFC 0011: 行动项与优先级

返回入口：[RFC 0011 总览](0011-plugin-extensibility.md)

行动项按"是否需要产品决策"分组。P0/P1 是纯技术改进，不改变任何对外承诺；P2 起需要先有开放程度的判断。

## P0-1：抽通用 ACP 适配器层

**问题**：`agentclientprotocol` 在 `packages/adapters/{cline,dsh,goose}` 各实现了一遍，无共享层，`packages/adapters/` 下也无 acp 包。下一个 ACP agent 需要写第四遍。

**参照**：DSH 的 `subagent-acp` 是通用的，配置里给 `command` / `args` / `env` 即可接入任意 ACP agent，`providerName` 可配，同进程可注册多个不同名字的外部 provider。

**收益**：抽出共享层后，接入新 ACP agent（Cursor、CodeBuddy、opencode 等）从"写一个适配器"降为"加一段配置"。

**风险**：低。纯内部重构，不涉及任何信任决策或对外接口变更。三个现有适配器有各自的 session 投影与能力声明，需确认可共享的是传输层与协议编解码，而非会话语义。

**建议**：先做可行性评估——对比三处实现的重叠度，确认抽象边界应落在 transport / codec 还是更上层。

## P0-2：生成式能力目录 + CI 门禁

**问题**：插件能力面分散在 `.oo/docs/usage/plugins/ui-runtime.md`（400+ 行手写）、`create-plugin/SKILL.md` 与源码之间，无生成、无门禁。本 RFC 调研中对自身能力误判三次（见[现有扩展面盘点](0011-plugin-extensibility-current-surface.md)的"已知误判记录"）。

**参照**：DSH 的 `scripts/gen-cordis-api.ts` 从 AST 生成，`verify-cordis-api --check` 挂 doc-sync 门禁，产出还经 `cordis_inspect` 工具喂给模型；`docs/user/develop/framework/service.md` 明文拒绝维护第二份手工清单。

**对我们价值更大的理由**：One Works 本身是 AI 工作区，插件作者会用 Claude Code / Codex 对着我们的 API 写插件。机器可读、CI 校验新鲜度的目录直接决定生成代码的正确率。

**建议实现**：`scripts/gen-plugin-api.ts`，从 `PluginClientContext` / `PluginServerContext` / `PluginViewContext` 的 TS 声明抽结构化目录，产出机器可读 JSON + 渲染 markdown，加 `--check` 模式接入现有检查。首次运行即可量化 `ui-runtime.md` 的漂移程度。

**限定**：不是银弹。DSH 的生成文档仍有轻微漂移（`docs/subsystems/workflow.md` 引 157，实测 168），但事件部分行号全对，整体显著优于纯手工。

## P0-3：补 ErrorBoundary

**问题**：`apps/client/src/plugins/` 与 `apps/client/src/components/plugins/` 下**零个** `ErrorBoundary` / `componentDidCatch`，`PluginHost.tsx:275` 裸渲染 `view.renderNode(viewContext)`。

**风险**：插件 route 页面渲染异常直接白屏，无降级。

**与视图槽无关，应独立先做。** 详见[边界与设计纪律](0011-plugin-extensibility-boundaries.md)纪律 2。

## P1：Hook 权限面对 marketplace 场景的审视

**问题**：`resolvePluginHooksEntryPath`（`packages/utils/src/plugin-resolver.ts:703-707`）解析 `<packageId>/hooks` export，`plugin-entry-cache.ts:43-53` 无条件把能解析出 hooks entry 的实例收进中间件链，**解析链上无 gate**。

而 hook 插件的权限包括：`PreToolUse` 返回 `deny` 否决任意工具调用、`GenerateSystemPrompt` 改写系统提示词、`PreCompact.replacementPrompt` 替换压缩提示词、任意事件 `continue: false` 停机。

**需要核实的点**：

- marketplace 安装的插件是否自动获得 hook 能力，还是需要用户额外确认
- 插件详情页的 `hooks` tab（`PluginDetailPanel.tsx:313`）展示的是资产 hooks（`PluginManifestAssets.hooks`）还是运行时 hook 插件——初步判断是前者（`NativePluginDetailPanel.tsx:116` 把 'mcp' 与 'hooks' 作同类资产分组），但未读完渲染逻辑
- 这些权限是否作为"该插件请求的权限"呈现给用户

**背景**：这条线是命令行时代的设计（插件由用户手写进配置），marketplace 接上后同一条链变成了分发面。DSH 至少在文档里把等价风险明说了（"允许该包在你机器上、在 agent sandbox 之外执行代码"）。

**注意**：宿主自身的权限执行器 `builtin-permissions.ts` 也是这条链上的一个 hook 插件，第三方插件与它同链、顺序决定优先级。

## P2：Model provider seam（需产品决策）

**问题**：`packages/model-provider-catalog/src/catalog.ts` 是硬编码内置注册表，第三方加 provider 只能提 PR。

**为什么是最值得开的注册型 seam**：

- 数据面而非控制面——provider 只负责发请求、转流，不干预 agent 决策
- RFC 0006 已把"官方模型服务商"做成一等公民，但目录硬编码
- 销毁机制现成（`addDisposable(scope, ...)` + frozen owner token + `rollbackScopeRegistrations`）

**要抄的形状**（来自 `ctx.llm`）：

- `registerConfigurableProviders` 的休眠路由——插件声明能力，用户配置才激活
- 全有或全无 + 重复检测（对应我们已有的 `duplicate()` 诊断）
- **凭证 seam：插件拿 ref 不拿明文 key**。marketplace 插件碰 API key 是明确风险面
- 强制 server-only（`PluginServerManifest.roles` 已有角色概念可挂）

**落点**：常驻 server plugin runtime，不是 hook。见[边界与设计纪律](0011-plugin-extensibility-boundaries.md)纪律 3。

**需要的决策**：是否允许第三方提供模型 provider。这直接关系 RFC 0006 的商业路径。

## P2：适配器 seam 化（需产品决策）

**现状**：16 个 `@oneworks/adapter-*` 是编译期内置（根 `package.json` devDependencies + 静态 import）。加一个适配器要改仓库、进 root package.json、重新发版。

**对照**：DSH 的 `SubagentProvider` 是 seam，第三方发 npm 包、用户配置加一行即可。其社区已产出第三方版的 Codex/Claude Code/ACP provider。

**我们的优势不应低估**：16 个适配器有统一 hook 协议、账号池、历史导入、权限镜像，深度显著超过 DSH 的 3 个薄 provider（one-shot、不继承上下文、纯文本、无审批）。seam 化不等于放弃深度，但需要设计"第三方 provider 能拿到多少宿主能力"的分层。

**需要的决策**：这是本 RFC 中影响最大的一项，涉及维护成本、质量控制与品牌。DSH 的策略是核心保持瘦、扩展面全让给社区（明确不收外部 PR），并有守门测试断言可选 provider 不进 base bundle。这是一种可选路径，不是唯一路径。

## 待核实项

以下问题在调研中出现但未查清，建议在实施 P0-2 时一并解决：

1. 同 scope 内 parent 与 child 的 command id 撞名如何处理（覆盖 / 报错 / 静默保留第一个）——`runtime.ts:2802` 的检查针对内置 route key，此路径未核实
2. 插件详情页 `hooks` tab 的确切数据来源（见 P1）
3. 16 个适配器的上游版本漂移防护是否都达到 dsh 适配器的水平（`DSH_VERSION` 固定 + `isOfficialCompositionComplete` 完整性校验）。DSH 只维护 2 个 product provider 就把限制写成明文 Known Limitations 清单，我们 16 个的成本是另一个量级

## 不建议做的

- **开放 `agentLoop` / `tools` / `approval` / `sandboxPolicy` 的注册型控制面**。DSH 敢开是因为其插件等同 shell 权限（明文记录）；我们是 marketplace 分发，开了即提权通道。
- **视图槽先于格式词汇表**。见[边界与设计纪律](0011-plugin-extensibility-boundaries.md)纪律 2。
- **让插件创造插件**。见纪律 1。
