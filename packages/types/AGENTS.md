# Types Package

`@oneworks/types` 承载共享契约层。
当前收口的是 config、cache、benchmark、workspace assets、session/websocket/message、logger，以及 adapter contract 与 adapter loader。

## 先看哪里

- `src/config.ts`
  - `Config`、adapter 配置、MCP 配置与 UI 配置返回契约
- `src/workspace.ts`
  - workspace asset contract、adapter asset plan
- `src/adapter.ts`
  - `Adapter`、`AdapterCtx`、`AdapterQueryOptions`
  - `loadAdapter()` / `defineAdapter()`
- `src/logger.ts`
  - 共享 `Logger` 接口
- `src/mcp.ts`
  - task <-> mcp contract
- `src/agent-room.ts`
  - Agent Room 跨包共享契约：room/member/run/message、room event、用户消息 target/delivery/reaction、HTTP request/response 类型
  - 改字段前同步确认 client view model、server service、db payload 兼容
- `src/launcher.ts`
  - launcher manager / client / desktop 共用的项目选择、目录浏览与打开 workspace 响应契约。
- `src/device-shell.ts`
  - Electron、Android 等 device shell 注入给前端的 workspace 选择 / 打开项目能力契约；具体 IPC、Intent、窗口或系统实现留在各 app。

## 当前边界

- 本包负责：
  - 跨包共享契约
  - adapter 公共 contract
  - adapter 动态 loader
- 本包不负责：
  - task 生命周期编排
  - hooks runtime
  - workspace asset 实现
  - config 读取与写回

## 维护约定

- 只放跨包稳定 contract 和极薄的 runtime glue；不要把编排逻辑塞进来。
- 新增共享字段时，优先先看是否应该落在 `types`，再决定放到上层包。
- adapter 包名解析规则集中在 `src/adapter.ts`，不要在消费方重复拼 `@oneworks/adapter-*`。
