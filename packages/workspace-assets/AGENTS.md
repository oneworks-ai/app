# Workspace Assets 包说明

`@oneworks/workspace-assets` 承载 workspace asset bundle 发现、prompt asset 选择与 adapter asset plan 组装。

## 什么时候先看这里

- `.oo/rules`、`.oo/specs`、`.oo/entities`、`.oo/skills` 没有被正确投影到 workspace bundle
- 默认/显式 MCP server 选择结果不对
- promptAssetIds、system prompt 资产选择不对
- adapter native asset plan 或 opencode overlay 异常

## 入口

- `src/bundle.ts`
  - `resolveWorkspaceAssetBundle()`
- `src/bundle-internal.ts`
  - 插件文档与 MCP 资产的 `${ONEWORKS_PLUGIN_*}` 模板投影；实例配置只通过显式 `${ONEWORKS_PLUGIN_OPTION:path}` 占位符注入
- `src/prompt-selection.ts`
  - `resolvePromptAssetSelection()`
- `src/prompt-builders.ts`
  - rules / skills / specs / entities prompt 文本渲染
- `src/adapter-asset-plan.ts`
  - `buildAdapterAssetPlan()`
- `__tests__/bundle.spec.ts`
- `__tests__/prompt-selection.spec.ts`
- `__tests__/adapter-asset-plan.spec.ts`
- `__tests__/workspace-assets.snapshot.spec.ts`
- `__tests__/__snapshots__/workspace-assets-rich.snapshot.json`

## 当前边界

- 本包负责：
  - workspace asset bundle 组装
  - prompt asset 选择
  - prompt 文本拼装
  - adapter asset plan 组装
- 本包不负责：
  - 定义文档发现与解析
  - cache 存储
  - task 生命周期编排

## 维护约定

- 只维护 workspace asset 领域逻辑；定义文档读取留在 `@oneworks/definition-loader`，cache 留在 `@oneworks/utils`。
- 通用路径处理复用 `@oneworks/utils`；definition 名称/标识/摘要与 remote rule 投影复用 `@oneworks/definition-core`；prompt builder 仍留在本包内维护。
- workspace include/exclude、对象 `path`、home bridge roots 和 `REAL_HOME` / `HOME` 都是文件系统身份；空值判断可以 `trim()`，但扫描、解析、约束和 bundle 投影必须使用原字符串，不能把带首尾空格的目录映射到相邻目录。workspace discovery key 与 relative payload 使用宿主分隔符；POSIX literal backslash 目录必须与同名嵌套目录保持不同资产身份。
- 共享 contract 继续依赖 `@oneworks/types`，不要把 task / hooks / mcp 逻辑反向塞进来。
- workspace、rule 与 skill prompt 的最终 path serializer 复用 `resolvePromptPath()`；它保留宿主文件系统身份，POSIX literal backslash 不能在 prompt 中变成嵌套路径，协议 asset id 的 slash presentation 仍单独处理。
- entity rule / skill reference 先按其现有语法区分文本 identifier 与文件系统 ref / glob；后者只判空并把原始字节交给 inheritance、glob 和 prompt selection，不能用文本 trim 选择相邻资产。
- 新增 asset 类型、prompt 选择规则或 adapter 投影时，优先补对应职责下的 spec 文件，不要继续把单测堆回一个综合 spec。
- 影响 bundle / prompt selection / adapter plan 整体投影时，同步检查 `workspace-assets-rich.snapshot.json`；必要时用 `pnpm -C packages/workspace-assets test -- --update` 更新快照。
