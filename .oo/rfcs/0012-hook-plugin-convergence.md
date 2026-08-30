# RFC 0012: Hook 与插件系统收敛

返回入口：[RFC 索引](../../rfc.md)

Status: 设计草案，待评审\
前置: [RFC 0011 插件扩展面盘点与边界](0011-plugin-extensibility.md)\
对照上游: `deepseek-ai/deepseek-harness@99f6f02`\
Reviewed: 2026-08-18

## 问题

`@oneworks/hooks` 与插件运行时目前是两套几乎零交集的系统。它们共用同一棵插件实例树（都经 `resolveConfiguredPluginInstances`），除此之外没有任何共享。

具体差距：

1. **两个 ctx 不对等。** `HookContext` 只有 `{ logger }` 一个字段（`packages/hooks/src/context.ts:7-9`）；`PluginServerContext` 有 scope / pluginRoot / workspaceFolder / projectHome / options / sessions / registerCommand / registerApi / registerLocalService / dispose / runtime.registerChannel。hook 侧能经工厂形态 `(config) => Partial<Plugin>` 拿到 options（`loader.ts:39-41`），但 scope、pluginRoot 与自己 server 端注册的一切都拿不到。
2. **同一个插件包要写两套形状的代码。** hook 是 `<pkg>/hooks` 导出 `Partial<Plugin>`；server 是 `plugin.server.entry` 导出 `activatePlugin(ctx)`。
3. **没有跨侧通道。** `packages/hooks/src/` 全部源码中没有 `serverBaseUrl` / `runtimeEndpoint` 等任何指向宿主的东西。
4. **生命周期语义不一致。** server 插件有 activate / dispose / watch reload；hook 侧契约上是无状态的每事件调用。
5. **可见性不一致。** server / client 的 contributions 在 `/plugins` 详情页可见；运行时 hook 插件在 `plugin-entry-cache.ts:43-53` 无条件收进链，而它握有 `PreToolUse` 否决权。

## 为什么不能直接照抄 DSH

DSH 没有独立的 hook 子系统——它的 `docs/cookbook/extension-cookbook.md` 把"Hook 系统"直接映射到监听 `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/post-execute`、`agent/turn-stopping` 这些 ctx 事件。所谓 hook 插件（`hooks-claude-code` / `hooks-codex`）只是读外部 hook 配置文件、桥接到这条内部总线上的普通插件。

**它能这么做是因为它自己就是 agent，hook 点在它自己的 loop 里，是进程内事件。** 我们是驱动 16 个外部 CLI 的宿主，`native` 源的 hook 点在那些 CLI 的进程里，由它们 spawn 我们的 `oneworks-call-hook`。这个进程位置不由我们决定。

可迁移的是**"一个插件只有一种心智模型"**这个结果，不是"进程内事件"这个实现。

## 方案

**hook 子进程降级为上报器，不再承载任何插件代码；插件在"驱动这次任务的那个进程"里消费统一事件流。**

```
适配器 CLI ──spawn──> oneworks 上报器（薄）
                          │ 归一化 + 上报（裁决型再等回执）
                          ▼
              驱动这次任务的进程内的插件运行时
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           插件消费    session log    UI 实时流
```

三点结论：

**1. 不需要 daemon。** 上报器只往环境里给的 runtime endpoint 报，谁是那个 endpoint 取决于谁在驱动任务：桌面/Web 是 workspace server，`npx oneworks ...` 是 CLI 进程自己（`apps/cli/src/commands/run/` 已有 `runtime-event-sink.ts` / `permission-decision.ts`，本来就在进程内跑任务并处理权限决策）。

**只要有 agent 在跑，驱动它的进程必然活着**——否则没人消费 agent 的输出。因此不存在"没有 server"的场景，无需为此拉 daemon，也无需降级路径。插件在两种模式下看到的 ctx 完全一致。

**2. 常驻 worker 的职责收窄。** 原设计中常驻 worker 承担的是"原生 hook 反复调用时避免重复加载插件上下文"。新模型下上报器不跑插件代码，插件常驻在 runtime 里一次加载、跨事件持有状态——这个约束被更彻底地解决了。常驻 worker 仍可保留以省去上报器自身的 Node 冷启动，但职责从"承载执行上下文"降为"省一次进程启动"。

**3. 第三方插件对权限只有否决权。** 宿主内置权限判定是同步本地的（读权限镜像文件），不依赖插件、不会超时，是地基；插件只能在其上收紧。宿主 allow + 插件 deny = deny；宿主 deny + 插件 allow = **仍然 deny**。

于是"插件超时"= 该插件这次没有意见 = 按宿主判定走。既不是 fail-open（地基仍在），也不是 fail-closed（慢插件不会拖垮 agent）。这与 `toolUsePresentations` 的 `origin` 设计同源——**能力做加法，权限做减法**。

## 命名与迁移

采用 DSH 的 `namespace/kebab` 事件命名与 `emit | waterfall | serial | parallel` mode 词汇。理由有二：该约定本身更好（带命名空间、可扩展、不撞名），且顺带买到迁移友好。

**但要写清楚它买到的是什么。** DSH 插件是 Cordis 插件（`apply(ctx)` + `ctx.on(...)`），ctx 是完全不同的对象，payload 形状也不同。命名对齐买到的是"概念可移植 + 机械适配层可行"，不是 drop-in。

目标形态：同时对齐**事件名 + mode 词汇 + 重叠事件的 payload 形状**，使 `@oneworks/plugin-dsh-compat` 垫片对**纯监听型插件**可行。详见[迁移与兼容](0012-hook-plugin-convergence-migration.md)。

## 章节

- [通用事件 API 设计](0012-hook-plugin-convergence-events-api.md) —— `ctx.events` 的三个 mode 与派发语义
- [事件词汇表](0012-hook-plugin-convergence-events.md) —— 名称、mode、payload、按 source 的可用性分级
- [运行时与裁决语义](0012-hook-plugin-convergence-runtime.md) —— 上报器、endpoint 解析、权限收紧、顺序契约
- [迁移与兼容](0012-hook-plugin-convergence-migration.md) —— 落地顺序、旧入口下线、DSH 垫片

## 非目标

- 不开放注册型 seam（model provider / adapter provider）。那属于 RFC 0011 行动项的 P2，需要产品决策，与本 RFC 无关。
- 不改变插件的分发、安装与卸载模型。
- 不引入 Cordis 或任何 IoC 容器。本 RFC 只收敛事件面，不动插件装配模型。
