# RFC 0011: 现有扩展面盘点

返回入口：[RFC 0011 总览](0011-plugin-extensibility.md)

本章记录 One Works 插件系统**当前实际具备**的扩展能力，作为后续讨论的基线。所有条目都标注了源码位置。

## 1. 插件实例图（配置解析层）

插件实例来自四个来源，后层覆盖前层：全局 `~/.oneworks/global/plugins/*`、项目 `.oo/plugins.dev/*`（默认 `watch: true`）、`plugins` 配置、运行时/任务 overlay。

**manifest `children` —— 静态组合依赖**（`packages/utils/src/plugin-resolver.ts:891-985`）：

- 父插件 manifest 声明 `children: { "<id>": { source: {type:'package'|'directory', ...}, activation: 'default'|'optional' } }`
- `activation: 'default'` 自动激活；`'optional'` 需用户显式声明
- 环检测：`ancestorKeys` + `cycleKey`，撞环抛 `Detected cyclic child plugin graph`（`:908-911`）
- scope 继承：`const scope = config.scope ?? inheritedScope`（`:917`）
- options 合并：manifest 的 child options 打底，用户配置浅覆盖（`mergeOptions`）
- 用户可覆写单个 child，含 `enabled: false` 关掉默认激活的（`hasExplicitChildOverride`）
- 目录 fallback：`collectFallbackDirectoryChildren` 把插件目录下的子目录登记为 `optional` child

**任务级 overlay**：`PluginOverlayConfig`（`packages/types/src/plugin.ts:76`）的 `mode: 'extend' | 'override'`，`overlaySource` 贯穿整棵解析树（`plugin-resolver.ts:887, 945, 959, 983`），已在 spec/entity 层使用（`packages/workspace-assets/src/prompt-selection.ts:77-81`）。

**skill 依赖锁**：插件可依赖外部 skill 文档，经 lockfile 的 `pluginSkills` 把外部安装的 `SKILL.md` 挂到插件实例名下，标记 `plugin-skill-dependency-lock`（`packages/workspace-assets/src/bundle-internal.ts:682-705`）。

## 2. 插件间依赖装配（运行时层）

**这一层是完整的**，语义等价于 Cordis 的 `inject`/`provide`。参考实现是 `packages/plugins/demo` 与 `packages/plugins/demo-extension` 这对。

### Extension point

- `ctx.extensionPoints.register({ id, title, contributionSchema })` —— 暴露扩展点，完整 id 为 `<scope>/<id>`
- `ctx.extensionPoints.onAvailable(target, cb)` —— **等待语义**：目标已存在立即触发，不存在则挂起，目标注册时唤醒（`apps/client/src/plugins/plugin-registry.ts:635-674`）。`registerExtensionPoint` 注册后调 `activateExtensionPointListeners(key)` 回头唤醒所有等待者（`:630`）
- `ctx.extensionPoints.contribute(target, contribution)` —— 贡献结构化能力
- manifest 的静态 `extensionContributions` **也走 `onAvailable`**（`:844-847`），所以声明式贡献同样不怕激活顺序

**回收语义**：扩展点 dispose 时 `deactivateExtensionPointListeners` 逐个 `disposeExtensionPointListener`，执行 listener 回调返回的 cleanup（`:619-624, 1019-1023, 1061-1066`）。

**竞态保护**：`listener.version` 每次激活自增，异步 handler resolve 回来时比对，不匹配则丢弃刚拿到的 disposable（`:1031-1055`）。等价于 Cordis fiber 的 `epoch`。

### Plugin API

- `ctx.pluginApis.register({ id, inputSchema, outputSchema, handler })` —— handler 的 `meta` 带 `callerScope` / `targetScope` / `apiId`
- `ctx.pluginApis.call(target, input, options?)` —— 目标未注册时不报错，进 `pendingPluginApiCalls` 挂起，`registerPluginApi` 里 `drainPendingPluginApiCalls(key)` 排空（`:472-494, 1091-1128`）。支持 `timeoutMs` 与 `AbortSignal`，调用方插件卸载时通过 signal reject 挂起的 Promise

### 作用域回收

整套清理以 scope 为单位：`disposablesByScope`、`removeExtensionPointListenersByScope`、`rollbackScopeRegistrations(scope, owner)`、`disposeScope(scope)`。owner 是 `Object.freeze` 的 token 存在 `WeakSet` 里（`:190, 340`），用于激活轮次回滚。

## 3. 视图侧扩展

存在**四种**形态，其中两种已在生产使用：

| 形态               | 贡献什么                                     | 状态                                                               |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| 元数据贡献         | `{id, title, icon, command}`，owner 自行渲染 | ✅ `extensionContributions` + `view.extensions.getContributions()` |
| **声明式渲染描述** | path + format + item 映射，宿主渲染          | ✅ `toolUsePresentations`                                          |
| 协议投影           | 跨进程事件 + 上面的描述                      | ✅ ACP / adapter event projection                                  |
| 视图槽挂组件       | React 节点                                   | ❌ 不存在                                                          |

### `toolUsePresentations`

插件提交**结构化渲染指令**，宿主据此渲染任意工具调用的输入输出（`apps/client/src/plugins/plugin-tool-use.ts`）：

- 字段描述：`{ path, title, format, item: { titlePath, subtitlePath, statusPath, metaPath, detailPath } }`
- 输入格式集合封闭：`inline | text | code | list | chips | records | json`
- 结果格式：`auto | text | code | json | markdown`，另有 `mode: auto | declared | hidden` 做渐进披露
- 实例参考：`packages/plugins/cua-driver/plugin.json:145` 起

**权限设计**：`origin` 默认只能接管自己 scope 下的工具，经 base64 编码的 `oneworks-<scope>` 命名空间反解校验（`isToolFromPluginScope`）；接管别家工具须显式 `origin: 'any'`，且匹配优先级更低（20/10 vs 40/30）。**表达力做加法，权限做减法。**

约束见 `packages/plugins/cli-skills/skills/create-plugin/SKILL.md:74`：不允许可执行模板、任意 HTML 或插件私有 React renderer。

### 视图侧的已知缺口

`view.extensions.getContributions(target)` 返回的是数据记录（`apps/client/src/plugins/plugin-manifest.ts:800`），owner 自行渲染。**无法把 React 组件贡献进别人的视图。** 相关设计约束见[边界与设计纪律](0011-plugin-extensibility-boundaries.md)。

## 4. Agent loop 拦截（`@oneworks/hooks`）

14 个事件（`packages/hooks/src/type.ts`），其中数个**带决策权**：

| 事件                                                | 插件能做什么                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `PreToolUse`                                        | `permissionDecision: 'allow' \| 'deny' \| 'ask'` + 理由 —— **可否决工具调用** |
| `PostToolUse` / `UserPromptSubmit` / `SessionStart` | `additionalContext` 注入                                                      |
| `PreCompact`                                        | `additionalContext` + **`replacementPrompt`**                                 |
| `GenerateSystemPrompt`                              | system prompt 生成 seam                                                       |
| `TaskStart` / `TaskStop`                            | 拿到 `options` / `adapterOptions`                                             |
| 任意事件                                            | `continue: false` + `stopReason` —— **可终止循环**                            |

插件接口是 koa 式中间件链（`packages/hooks/src/context.ts:11-22`）：

```ts
export type Plugin =
  & { name?: string }
  & {
    [P in keyof HookInputs]: (ctx, input, next) => Promise<HookOutputs[P]>
  }
```

`callPluginHook` 按顺序串联，可 `await next()` 后改结果，也可短路（`packages/hooks/src/plugin-hook.ts`）。

**跨适配器统一**：`HookSource = 'native' | 'bridge'`。适配器原生支持 hook 的直接透传；不支持的由 `packages/hooks/src/bridge.ts`（516 行）把会话消息与工具事件**合成**成统一 hook 协议。协议形状对齐 Claude Code（`type.ts` 的 JSDoc 直接链到 `docs.anthropic.com/.../hooks`）。

**传输是跨进程的**：`call-hook.js` 用 `spawn` 起子进程，`worker-client.ts` 维护 worker 池预热。这决定了它只能承载拦截型 seam，见[总览的结论摘要](0011-plugin-extensibility.md#结论摘要)。

**宿主自身也走这条链**：`packages/hooks/src/builtin-permissions.ts` 是一个内置 hook 插件，读权限镜像文件做 allow/deny 判定。即第三方 hook 插件与宿主权限执行器在同一条链上，顺序决定谁说了算。

## 5. 服务端插件运行时

`PluginServerContext`（`apps/server/src/services/plugins/types.ts:244-268`）的注册原语：

- `registerCommand(commandId, handler)`
- `registerApi(apiId, options)` —— `handler` 模式或 `proxy` 模式
- `registerLocalService(serviceId, start)` —— 生命周期绑到 workspace service
- `runtime.registerChannel(channelId, handler)` / `invokeChannel(...)`

以及三个 facade：`sessions`（`listSessions` / `submitMessage`）、`oneworksChannel`、`roomTunnel`。

## 6. 安全边界

- 前端插件不直接访问文件系统；服务端插件不能注册顶层 `/api/*`，只能在 `/api/plugins/:scope/*` 下
- `proxy.ts`：仅允许 loopback 目标（`isLoopbackProxyTarget`），转发前剥掉 `authorization` / `cookie` / `proxy-authorization`
- client asset 路由拦 `..`、绝对路径、null 字节、符号链接逃逸，强制 `X-Content-Type-Options: nosniff`
- `client-source-boundary.ts` 在**构建期**校验源码引用边界（Vite `enforce: 'pre'` transform）
- CSP：`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`，**无 `blob:`**（`apps/client/index.html:7`），插件代码只能同源经 `/api/plugins/:scope/client/*` 加载

## 已知误判记录

本 RFC 调研过程中对自身扩展面出现的错误判断，保留在此作为"为什么需要生成式能力目录"的证据：

| 误判                                     | 实际情况                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "插件之间不能声明依赖，没有 inject 语义" | `children` 是组合依赖；`extensionPoints.onAvailable` + `pluginApis.call` 是完整的运行时依赖装配，含等待语义、自动回收、epoch 竞态保护 |
| "没有视图侧扩展点"                       | `toolUsePresentations` 是完整的声明式渲染扩展，已在 cua-driver / browser-driver / external-browser-driver 生产使用                    |
| "agent loop 没有任何 seam"               | `@oneworks/hooks` 有 14 个事件，含 `PreToolUse` 否决权、`GenerateSystemPrompt` 改写权、`continue: false` 停机权                       |

三次误判都是在能读到完整代码库的前提下发生的，根因是能力面分散在手写文档（`.oo/docs/usage/plugins/ui-runtime.md` 400+ 行）、SKILL.md 和源码之间，没有单一事实源。
