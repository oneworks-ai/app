# RFC 0012: 运行时与裁决语义

返回入口：[RFC 0012 总览](0012-hook-plugin-convergence.md)

本章定义上报器、runtime endpoint 解析、权限裁决与顺序契约。

## 上报器

`oneworks-call-hook` 从"插件执行宿主"降级为"归一化上报器"。职责三条，不多不少：

1. 读上游 CLI 传入的 hook 输入
2. 归一化为[事件词汇表](0012-hook-plugin-convergence-events.md)定义的事件
3. 上报到 runtime endpoint；若该事件有返回契约（`waterfall` / `bail` / `decide`），等待回执并按上游协议格式写回

**上报器内不加载任何插件代码。** 这条是硬约束——一旦上报器开始加载插件，两套系统就会重新分叉。

### 常驻 worker 的新定位

原设计中常驻 worker 解决的是"原生 hook 被反复调用时，插件上下文重复加载的性能问题"。新模型下插件常驻在 runtime 里，一次加载、跨事件持有状态，该约束被更彻底地解决。

常驻 worker 仍保留，但职责收窄为**省去上报器自身的 Node 冷启动**。判断保留与否的依据应是实测：上报器变薄后冷启动成本可能已低于维护 worker 池的复杂度。**这是实现期的实测决策，不在本 RFC 预先拍板。**

## Runtime endpoint 解析

上报器不关心"谁在听"，只往解析出的 endpoint 报。endpoint 取决于谁在驱动这次任务：

| 运行形态           | endpoint         |
| ------------------ | ---------------- |
| 桌面 / Web         | workspace server |
| `npx oneworks ...` | **CLI 进程自身** |

CLI 的 `run` 命令本来就在自己进程内驱动任务，已有 `apps/cli/src/commands/run/runtime-event-sink.ts`、`permission-decision.ts`、`input-bridge.ts` 等基建；`resolveServerBaseUrl` + `daemon` 选项的模式也已存在（`apps/cli/src/commands/plugin-cli.ts:185`、`channel.ts:682`）。

### 为什么不需要 daemon

**只要有 agent 在跑，驱动它的进程必然活着** —— 否则没人消费 agent 的输出。因此不存在"没有 server"的场景：

- 无需为 hook 拉起 daemon
- 无需设计降级路径
- 插件在桌面与 CLI 两种模式下看到的 ctx 完全一致

这一条是整个方案的承重墙。若未来出现"任务驱动方可以先于任务结束而退出"的形态（例如 fire-and-forget 后台任务），必须重新论证本节，而不是给上报器加降级分支。

## 权限裁决

### 分层

```
宿主基线判定（同步、本地、必答）
        ↓ 作为 decide 事件的初始值
插件判定（各自独立、只能收紧、可超时）
        ↓ 按判定格取 meet
最终判定
```

**宿主内置权限判定是地基**：读权限镜像文件（现由 `packages/hooks/src/builtin-permissions.ts` 实现），同步本地、不依赖插件、不会超时。

**插件只能收紧**：宿主 allow + 插件 deny = deny；宿主 deny + 插件 allow = **仍然 deny**。

### 超时语义

`decide` 事件的插件监听器超时 = **该插件这次没有意见**，按已有判定走。

- 不是 fail-open —— 宿主基线仍然生效
- 不是 fail-closed —— 慢插件不会拖垮 agent

超时**必须产生一条可见诊断**，不得静默。反复超时的插件应在 `/plugins` 详情页可见，让用户能定位是哪个插件在拖慢。

### 为什么这样切

`PreToolUse` 在热路径上——每次工具调用都要跑。若采用链式裁决 + 超时兜底，就必须在"慢插件让 agent 拒绝一切"和"慢插件让权限系统失效"之间二选一，两个都是不可接受的失败模式。

把插件限制为单向收紧之后，这个二选一消失了。代价是插件不能用于"放宽权限"——但那本来就不该是第三方插件的能力。

这与 `toolUsePresentations` 的 `origin` 设计同源：**能力做加法，权限做减法**。

## 顺序契约

现状是数组顺序 + builtin 排第一（`packages/hooks/src/runtime.ts:81-89`）。收敛后必须显式化：

| mode        | 顺序语义                                              |
| ----------- | ----------------------------------------------------- |
| `emit`      | 同步派发，按 priority 升序                            |
| `parallel`  | 并发启动，顺序无关                                    |
| `serial`    | 按 priority 升序，后者可观察前者副作用                |
| `bail`      | 按 priority 升序，首个非 `undefined` 者短路           |
| `waterfall` | 按 priority 升序；同 priority 按 scope 字典序稳定排序 |
| `decide`    | 顺序无关（判定合并可交换）                            |

**宿主内置监听器占用保留的 priority 段，第三方插件无法插到它前面。** 这条替代当前"靠数组第一个位置"的隐式保证。

不采用 Cordis 的 `prepend` 布尔选项——它只能表达"最前"，无法表达多个插件之间的相对顺序，且两个都传 `prepend` 时结果取决于注册顺序。

## 事件流的三个消费者

统一事件流同时喂：

1. **插件** —— 经 `ctx.events.on` 订阅
2. **session log** —— 落实 RFC 0011 纪律 6「model-visible ⟺ logged」
3. **UI 实时流** —— `apps/server/src/services/client-events.ts` 的 `publishClientEvent` 已有 EventEmitter 基建

三者共用同一份事件定义。当前 hook 层对前端完全是黑盒，收敛后可在插件详情页与会话视图里看到实际发生了什么。

## 可见性与权限呈现

RFC 0011 行动项 P1 记录的问题在此一并解决：

- 插件订阅的事件进 `/plugins` 详情页，与 contributions 并列展示
- **订阅 `decide` 类事件应作为"该插件请求的权限"显式呈现给用户**，因为那意味着它能否决工具调用
- 事件订阅进[生成式能力目录](0011-plugin-extensibility-actions.md)（P0-2）

## 待实测确认

以下项目需在实现期用实测数据决定，本 RFC 不预设结论：

1. **上报器变薄后是否仍需常驻 worker** —— 对比冷启动成本与 worker 池维护复杂度
2. **`decide` 事件的超时预算** —— 需要 `tools/pre-execute` 端到端延迟基线；当前无实测数据
3. **`builtin-permissions` 迁移后的等价性** —— 需要一组回归用例证明新旧判定结果一致
