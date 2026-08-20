# RFC 0013: 迁移路径

返回：[RFC 0013 插件内核](0013-plugin-kernel.md) · [内核接口](0013-plugin-kernel-surface.md)

## 逐条落位

现有每一条通道都能落到内核，没有剩余项。

| 现在                                     | 内核                                  | 变化                      |
| ---------------------------------------- | ------------------------------------- | ------------------------- |
| `ctx.slots.register(slot, c)`            | `ctx.contribute(Host.slots[slot], c)` | 宿主定义集合              |
| `ctx.views / routes / themes.register`   | `ctx.contribute(def, entry)`          | 同上                      |
| `plugin.json` 的 `extensionPoints[]`     | `ctx.defineRegistry({ … })`           | 插件定义集合              |
| `ctx.extensionPoints.contribute(id, c)`  | `ctx.contribute(def, c)`              | —                         |
| `ctx.extensionPoints.onAvailable(id, f)` | **删除**                              | 等待进内核                |
| `view.extensions.getContributions(id)`   | `ctx.read(def)`                       | 定义者独占，非 owner 报错 |
| manifest 的 `extensionContributions[]`   | 静态 `contribute`                     | 装配路径不变              |
| `ctx.pluginApis.register({ id, … })`     | `ctx.provide(def, handler)`           | —                         |
| `ctx.pluginApis.call(id, input, opts)`   | `ctx.invoke(def, input, opts)`        | —                         |
| `ctx.commands.register(id, fn)`          | `ctx.provide(def, fn)`                | **command 类型消失**      |
| `ctx.commands.execute('<scope>/<id>')`   | `ctx.invoke(def, input)`              | 跨 scope 语义一并澄清     |
| contribution 的 `command` 字段           | `api` 引用                            | 宿主代调路径不变          |
| hook `Partial<Plugin>` 的 14 个事件      | `ctx.on(Events.x, fn)`                | 即 RFC 0012               |
| server `ctx.runtime.registerChannel`     | `ctx.provide(def, handler)`           | scope 绑死问题消失        |
| server `ctx.registerApi`                 | `ctx.provide(def, handler)`           | HTTP 投影另做             |

`command` 不是被删除，是被识别为 `api` 的残缺版——它缺的正好是等待、schema、超时、caller 身份四样，而这四样在内核里是集合的默认性质。

## 分阶段

每阶段可独立评审、独立回滚。

### Phase 0 — 内核包，零消费者

新建 `packages/plugin-kernel`：类型定义 ＋ 三个横切设施 ＋ 定律的归属校验。带自己的单元测试，不接任何现有代码。

**验收**：`disposeScope` / 挂起排空 / 契约校验三条各有测试；定律违反（非定义者 `read`）有测试。

### Phase 1 — client registry 内部改用内核

`plugin-registry.ts` 的五个纯贡献集合（`slots` / `views` / `routes` / `themes` / `launcherProviders`）加 `extensionPoints` 改由内核承载。**公开 API 一律不变**，`ctx.slots.register` 等仍存在，内部转调 `contribute`。

**验收**：第 279–297 行的 9 个 filter 删到 0，`extensionPointListeners` 删除。现有插件零改动通过。

这一阶段就能验证"12 份变 3 份"的收益，且不动任何插件契约。

### Phase 2 — plugin API 与 command 合流

`pluginApis` 走内核。`ctx.commands.register / execute` 标记 deprecated，实现改为代理到 `provide` / `invoke`，并在 `/plugins` 详情页显示 deprecation 诊断。

**验收**：`pendingPluginApiCalls` 删除；跨 scope command 调用（`plugin-registry.ts:405`）行为在文档与实现上一致。

### Phase 3 — server 侧接内核

`ctx.runtime.registerChannel` / `registerApi` 改由内核承载，`invokeChannel` 的 scope 绑死（`runtime.ts:3519`）解除。server 插件之间可互相提供能力。

**验收**：新增一个 server 侧跨插件调用的集成测试——这是当前完全不可能的场景。

### Phase 4 — 事件进内核

RFC 0012 的 `ctx.events` 直接建在内核 `event` 集合上，而不是另起一套。上报器降级为归一化上报，`builtin-permissions` 改为 `reserved` 段注册。

**验收**：`packages/hooks/src/runtime.ts:80` 的数组顺序 hack 删除；第三方注册进保留段被拒绝且有诊断。

### Phase 5 — 清理

删除 deprecated 的 command 路径与 `onAvailable`。

## 兼容性

Phase 1–4 期间现有插件契约完全不变，`@oneworks/plugin-demo` 与 `@oneworks/plugin-demo-extension` 不需要改一行。Phase 5 才有 breaking change，且只影响用了 `commands.register` 与 `onAvailable` 的插件——两者都有机械可迁移的等价写法，可提供 codemod。

## 与既有 RFC 的关系

- **RFC 0011** 盘点了扩展面并给出七条设计纪律。本 RFC 是纪律的实现载体：纪律 1（能力做加法权限做减法）由 `decide` ＋ `reserved` 强制，纪律 2（视图槽的四个前置条件）不受影响。
- **RFC 0012** 定义了事件词汇表与六个 mode。本 RFC 不改动它的任何结论，只是把它的 `ctx.events` 建在内核上而不是另起一套。**若本 RFC 不被采纳，RFC 0012 仍可独立实施**——代价是横切能力再抄一遍。
- **`.oo/rules/plugin-system/`** 的三种关系模型在本 RFC 里从"规定的分类"变成"从定义者归属推导出的结果"。规范文本需相应改写，但结论不变。

## 不做的事

- 不引入 fiber / 作用域嵌套。参与者是平的，实例化仍在配置解析层。
- 不开放 `ctx.plugin()` 或任何自举实例化。
- 不改 `scope` 的语义——它仍是逻辑隔离而非安全边界。
- 不落地 model provider seam。内核为 `keyed` 留了位置，但那需要凭证 seam 与产品决策。
