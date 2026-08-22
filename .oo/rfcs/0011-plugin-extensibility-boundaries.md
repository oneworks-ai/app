# RFC 0011: 边界与设计纪律

返回入口：[RFC 0011 总览](0011-plugin-extensibility.md)

本章把已论证过的边界判断写成可引用的纪律，目的是避免每次提出新扩展点时重新论证。

## 纪律 1：插件不能创造插件

**不新增让插件在运行时实例化其他插件的能力**（相当于 Cordis 的 `ctx.plugin()`）。

需要动态插件图时，由宿主通过 plugin overlay 注入，走同一个 resolver、同一套 scope 分配、同一个 `/plugins` 列举。**动态性发生在配置解析层，不发生在插件代码里。**

### 依据

**(1) 清理模型以 scope 为单位。** `disposablesByScope`、`removeExtensionPointListenersByScope`、`rollbackScopeRegistrations(scope, owner)`、`disposeScope(scope)` 全部 keyed on scope。动态子插件只有两条路：自己占新 scope（谁分配？冲突检测在启动期是 fatal；且 `/plugins` store 与 `PluginDetailPanel` 按服务端解析出的 instance 列表渲染，动态 scope 对 UI、诊断、卸载全部隐形），或共享父 scope（那它就不是插件，只是父插件的代码）。

**(2) reload 会失效。** `PluginProvider.tsx:97-104` 的 `reloadPlugin(scope)` 从 `instancesRef`（服务端解析结果）里找 instance，动态创建的东西不在其中，`watch` / HMR 对它是空操作。

**(3) CSP 已堵死代码生成路径。** `script-src` 无 `blob:`（`apps/client/index.html:7`），插件代码只能同源经 `/api/plugins/:scope/client/*` 加载，即只能来自已安装包——那为什么不声明？

**(4) 卸载语义崩塌。** marketplace 有 removal journal / receipt / quotes 一整套账本，运行时拉起的东西没有 install 记录，也就没有 removal 记录。

### 三种被混为一谈的需求

| 需求                               | 结论                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时决定要不要加载某个已安装插件 | 已有更好答案：`activation: 'optional'` + 用户配置开关 + `onAvailable` 被动等待。若不够，应加"插件请求启用某 optional child、宿主弹窗由用户确认"，决定权在用户 |
| 参数化多实例                       | 配置层已支持（`children` 数组 + 不同 scope）。若诉求是"运行时才知道要几个"，那是插件内部数据结构问题，不是插件粒度问题                                        |
| 运行时生成代码注册为插件           | 一票否决。等于同时绕过 marketplace、构建期边界校验（`client-source-boundary.ts` 只在构建期跑）与 CSP                                                          |

### 正确的落点

`PluginOverlayConfig`（`packages/types/src/plugin.ts:76`）的 `mode: 'extend' | 'override'` 与 `overlaySource` 已贯穿整棵解析树，spec/entity 层已在用。要扩展动态插件图应扩展这里。

## 纪律 2：视图扩展优先扩格式词汇表，而非开组件槽

视图扩展存在一条能力光谱：

| 方式           | 贡献什么                  | 表达力 | 信任成本       |
| -------------- | ------------------------- | ------ | -------------- |
| 元数据贡献     | `{id,title,icon,command}` | 低     | 无             |
| 声明式渲染描述 | path + format + item 映射 | 中高   | 无（格式封闭） |
| 协议投影       | 跨进程事件 + 上面的描述   | 中高   | 进程边界隔离   |
| 视图槽挂组件   | React 节点                | 最高   | owner 让出画布 |
| iframe         | 整页                      | 最高   | 强隔离，代价大 |

**决策顺序：**

1. **先扩格式词汇表。** 有人要塞组件时，先问"缺的是哪个 format"。`toolUsePresentations` 证明了很多"必须自定义渲染"的需求实际是"宿主的声明式格式不够用"——cua-driver 的嵌套对象数组 + 渐进披露，一份 schema 就解决了，还白拿 i18n、主题、无障碍与一致性。补一个 `table` / `diff` / `timeline` / `progress` 受益的是所有插件。
2. **把声明式渲染推广到别处。** 目前 `toolUsePresentations` 只服务 `chat.toolUse.presentations` 一个槽。预留的 `message.renderers`、`settings.sections`、`workspace.resourceOpeners` 应复用同一套 field/format 描述，而非各自发明。
3. **视图槽留给真正无法声明化的场景**（自由画布、图编辑器、地图）。

### 若开视图槽，四个前置条件

1. **ErrorBoundary 是前置条件，不是可选项。** 现状：`apps/client/src/plugins/` 与 `components/plugins/` 下**零个** `ErrorBoundary` / `componentDidCatch`，`PluginHost.tsx:275` 是裸渲染 `view.renderNode(viewContext)`。单插件页面崩溃只影响自己尚可接受；一旦 contributor 组件挂进 owner 页面，一个异常会带塌 owner 整页，而用户只会认为是 owner 插件坏了。**此项与是否做视图槽无关，应独立先做。**
2. **挂载权归宿主。** owner 拿到的必须是宿主包好的不透明节点（内部仍走 `PluginHost` 的 `(scope, viewId)` 路径），而非 contributor 的组件引用。否则 contributor 代码会跑在 **owner 的 viewContext** 里——`view.options.update()` 会把配置写到 owner 头上，`data.useQuery` 的 SWR key 前缀也会串（`PluginHost.tsx:136, 160`）。
3. **扩展点须显式声明接受视图**，并携带布局约束（`maxHeight` / `orientation` / 是否允许自撑高），由宿主在包裹层强制。默认应保持数据模式。
4. **顺序必须稳定可预期**——按 `order` 字段或 `pluginScope` 字典序，不能是 Map 插入顺序（那取决于插件激活顺序，而激活顺序本身不保证，这正是 `onAvailable` 要解决的问题）。

## 纪律 3：注册型 seam 走常驻 runtime，不扩 hook 事件表

hook 传输是跨进程的（`call-hook.js` 用 `spawn`，`worker-client.ts` 维护 worker 池），形态是"一次事件，JSON 进 JSON 出"。

- 对**拦截型**完美契合——事件本来就是离散的
- 对**注册型**不成立——LLM adapter 要维持流式连接、跨多次调用持有状态

因此新增注册型 seam 应落在 `registerLocalService` 那条常驻线上，而非新增 hook 事件。

**DSH 提供了一个可行的折中形态**：`SubagentProvider` 的 `start()` 只负责"怎么起、怎么说话"，真正的长连接与进程生命周期由宿主的 `ctx.subprocess` 托管。`subagent-claude-code` 尤其典型——SDK 自己要拉进程，它用 `spawnClaudeCodeProcess` hook 把进程句柄夺回来交给宿主统管，于是 teardown 阶梯、孤儿进程回收、超时全归宿主。

**插件提供协议适配，宿主拥有进程和生命周期** —— 这个形态比让插件直接持有连接安全得多，且已被上游验证。

## 纪律 4：禁止 accepted-then-ignored

能力不支持时必须 fail loud，不得静默降级。

DSH 把这条作为相对 Claude Code 的**刻意分歧**记录在案：hook 误用在 CC 里退化成 `null`，DSH 一律 fatal 抛出。其远程 subagent provider 的 `NO_START_CAPABILITIES` 也是同理——服务层在 `start()` 之前就抛 `UNSUPPORTED_CAPABILITY`，而非接受后忽略。

我们已有部分实践（`resolveInstance` 的环检测抛错、scope 冲突启动期 fatal、`duplicate()` 诊断），应确立为统一纪律。

**反例警示**：`subagent-acp` 的 `toAcpPrompt()` 把非 text block **静默丢弃**，而同抽象下的 Codex / Claude Code provider 则**直接抛错**。同一 seam 两种行为是需要避免的形态。

## 纪律 5：trust / scope 字段的语义须明确写出

DSH 的 `PresetTrust` README 写得很直白：trust 字段"exists so consumers can present that difference, **not to enforce it**"。

我们的 `scope` 同理——它是**逻辑隔离**（防命名冲突、划分 API 命名空间），真正的安全边界来自进程边界、CSP、构建期校验与 proxy 白名单。这一点必须在文档中明确，避免团队产生虚假安全感。

**当前需要澄清的一处**：因为 child 默认继承 parent scope（`plugin-resolver.ts:917`），parent 与 child 落在同一 scope 命名空间。已确认 `runtime.ts:2802` 的冲突检查针对的是内置 route key，同 scope 内 command id 撞名的处理路径尚未核实，应在实现能力目录时一并查清并写入文档。

## 纪律 6：Model-visible ⟺ logged（建议采纳）

来自 DSH `AGENTS.md`：任何进入模型请求的内容必须能从 session log 重建；新增模型可见输入必须同时新增 session event。

这条对可复现性、审计与"用户能看懂 agent 为什么这么做"是根本性的，且与开放程度无关。DSH 的 `agent-preset/selected` 会话事件就是例证——因为 preset 决定模型看到的工具 schema 与 prompt，切换必须可从日志重建。

## 纪律 7：capability seam 的定义

来自 DSH `AGENTS.md`：**一个 capability seam 由 Service Definition / Service Provider / Consumer 三个 role 构成，单个 role 不构成 seam。**

这个定义可以直接用来防止"开了个接口但没人实现也没人消费"的假扩展点。新增 seam 的评审应要求三个 role 同时存在或有明确规划。
