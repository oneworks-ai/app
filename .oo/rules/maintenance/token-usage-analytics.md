# Token 用量统计维护

本文记录统一 Token 用量链路的稳定边界。相关改动通常同时涉及 adapter、runtime protocol、
workspace ledger、Launcher 聚合、插件扩展和前端筛选，不能只在单层补一个计数器。

## 模块入口

- `packages/types/src/usage.ts`：跨 adapter、插件、server 和 client 的 observation、resource、query、report 契约。
- `packages/types/src/adapter.ts`：native adapter 可通过可选 `getUsage` 能力提供 Launcher 级全局用量。
- `packages/adapters/*/src/runtime/usage*.ts`：工具原生历史的只读采集与 provider 快照归一化。
- `apps/server/src/db/usage/`：workspace 本地 ledger、资源补全、查询过滤、累计 / 增量选择与 facet 聚合。
- `apps/server/src/services/usage/`：本地 report、插件 usage source、Launcher 在线 workspace 的跨 runtime 聚合。
- `apps/client/src/components/usage/`：Launcher、workspace 设置、模型服务和账号详情复用的渐进式视图。
- `packages/runtime-protocol/` 与 `apps/server/src/services/runtime-store/`：CLI terminal usage 到 workspace ledger 的持久化桥。

## Observation 与跨 runtime 去重

- 每条上游 usage 必须有跨传输稳定的 observation ID。同一条记录经 Relay 转发后不能生成新 ID，否则全局统计会重复。
- report 合并不能相加已经聚合的 summary。跨 report 边界必须合并原始 observation，先按稳定 ID 去重，再重新执行累计 / 增量选择和 facet 聚合。
- 同 ID 同时存在本地直连与 transport 副本时优先本地直连；可以用另一份补齐 authority，但不能把 transport provenance 带到直连副本。
- session 级累计 / 增量选择至少按 workspace、device、tool、session 隔离。存在 delta 时不能再叠加 cumulative token；最终 cumulative cost 可以在 delta 未提供费用时补齐。
- `UsageReport.observations` 当前承担 server 间二次聚合 envelope。数据量增长到影响 365 天或多 workspace 查询时，应拆分 server 内部 merge envelope 与面向 UI 的紧凑 / 分页 report，不能直接删除 raw observation 后退回 summary 相加。

## 资源归因与 provenance

- model service 表示用户配置的服务入口，model 表示运行时实际返回的模型；两者必须分别解析和保存，不能用实际 model 覆盖 model service。
- 插件返回的 `UsageSourceResult.resources` 必须在过滤和 facet 聚合前参与 observation 补全，用于账号父模型服务、展示标签和所属插件推导。
- authority plugin 与 transport plugin 是两条独立关系：
  - authority 表示谁创建并管理模型服务、账号或套餐资源；
  - transport 表示谁把 observation 从另一个 runtime 搬运过来。
- Relay 等 transport 不能自动成为资源 authority。筛选和 UI 也必须分别展示“所属插件”和“同步插件”。

## 插件可用性与 scope

- usage source availability 使用统一优先级：source 自身 `roles` / `surfaces`，其次 contribution 级声明，最后回退 `plugin.server.roles`。
- Launcher 只调用 launcher surface 的 source；workspace 只调用 workspace surface 的 source。不要把错误 surface 的 command 调用失败包装成正常的 unavailable coverage。
- workspace route 必须由宿主强制注入当前 workspace ID；不能只把 `scope: workspace` 交给插件自行遵守。只有 Launcher manager 聚合全量 workspace 和账号级数据。
- workspace 用量页默认调用当前 workspace report；只有用户在 route header 显式选择“全局”或多个 workspace 时，client 才切到 Launcher manager 聚合，并通过 `workspaces[]` 限定所选集合。
- Launcher 的公开 workspace ID（`w_*`）与各 runtime ledger 的本地 workspace ID 不是同一命名空间。跨 runtime report 进入 Launcher merge 前必须把 observation 和 workspace resource 统一映射到 endpoint 的公开 ID，再执行 `workspaces[]` 过滤；不能拿公开 ID 直接过滤 runtime 的本地 ledger ID。
- Launcher 聚合可能同时收到不同版本 workspace runtime 的 report；`observations`、`resources` 或 `coverage` 等后增量字段在合并边界要按缺省空数组兼容，不能让一个旧 runtime 使全局用量接口整体失败。
- 插件 observations 与 resources 都要经过同一套 normalization。transport source 只增加 transport provenance，collector 才能在资源未声明 authority 时作为默认 authority。

## 自适应筛选与时间窗口

- 简单配置只隐藏真正无意义的控件。facet 有多个值时显示；只有一个显式值但还混有未归因 observation 时也必须显示，用户仍需要隔离该显式值。
- 判断 partial attribution 应比较 facet options 的 `observationCount` 覆盖率与 report summary，而不是只看 option 数量。纯单值且完全覆盖时才隐藏。
- transport 维度用明确的本地直连 sentinel，使“本地直连 + 一个 Relay”成为两个可筛选来源；纯直连或纯单一 Relay 仍隐藏。
- 模型服务和账号详情通过 locked filters 固定当前资源，不能再展示可把用户带离当前详情的重复筛选。
- 30 / 90 / 365 天查询与 heatmap 必须共享本地日历日起点。用 `setDate` 推进日历日以覆盖 DST，不能用固定 `24h` 毫秒回推后再按日期渲染。
- 年度 heatmap 首次展示或日期窗口变化时默认对齐最右侧的最新日期；数据值刷新不得覆盖用户已经产生的水平滚动位置。

## 采集与浏览器构建边界

- 优先记录 provider / CLI 明确上报的 usage 和费用；没有上报时保持缺失，不猜测成精确值。
- native adapter 的 `getUsage` 只由 Launcher 聚合；workspace 继续使用本地 ledger，避免把设备级全局历史重复投影到每个 workspace。
- 原生历史采集必须按查询时间范围限制候选文件与最终记录，只解析 usage、模型和安全会话元数据。Codex resume 会继续写入 session 初始日期目录中的 JSONL，因此不能只扫描 query 起始日附近的目录；应保留 query 结束日的目录上界，并用文件 mtime 剔除 query 开始前已停止写入的历史文件，最终仍按每条记录时间过滤。提示词、回复、工具参数和绝对工作区路径不得进入 observation 或浏览器响应。
- 如果原生历史能区分 One Works 自己启动的会话，必须排除这部分外部记录，因为同一用量已经由 workspace ledger 持久化。
- Claude 等会在 terminal stop 才给出累计 usage 或最终费用的 adapter，stop 路径和 CLI terminal event 都必须进入 ledger，同时避免重复写入消息正文。
- client 从 `@oneworks/types` 使用契约时保持 type-only import。浏览器需要的 runtime 常量放在浏览器安全模块；不要从 types barrel 运行时导入，否则 barrel 中的 Node-only export 会被 Vite 遍历。

## 验证清单

- DB：稳定 ID、workspace/device/session 隔离、累计 / 增量、最终费用、资源补全和模型 / 模型服务拆分。
- Service：跨 report 去重、直连优先、authority / transport、usage source roles / surfaces、workspace 强制 scope。
- Client：日历范围、partial-attribution 筛选、单值隐藏、locked filter 和真实筛选后的 breakdown。
- Runtime：native stop、CLI terminal event、runtime-store projection。
- 交付：相关测试、`pnpm typecheck`、client production build、全部变更 lint / format / diff check，以及 Launcher、workspace、筛选浮层和资源详情截图。
