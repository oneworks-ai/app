# Config 组件维护说明

本目录承载配置页与 worktree environment 编辑器；涉及以下入口时，先读本文件：

- `../ConfigView.tsx`
- `ExternalSessionsPanel.tsx`
- `WorktreeEnvironmentPanel.tsx`
- `use-worktree-environment-auto-save.ts`
- `configConflict.ts`
- `../../hooks/use-session-subscription.ts`
- `../../hooks/session-subscription-cache.ts`

## 当前设计

配置文件被 CLI、手动编辑或 extends 链路中的文件改动后，后端会通过 websocket 广播 `config_updated`。前端订阅层只负责刷新 `/api/config` 及其派生缓存，不直接覆盖本地草稿；真正的冲突处理留在配置编辑器内部完成。

外部软件会话历史管理属于配置页的独立 app 级入口：`ExternalSessionsPanel.tsx` 负责当前项目维度的 Codex / Claude Code 历史导入、平台选择和已导入外部会话列表；不要把这类管理入口塞进 NavRail More 菜单或一次性弹窗。

配置页和 worktree environment 编辑器都遵循相同的“三份状态”模型：

- `base`：开始编辑时或上次成功保存后的远端基线。
- `draft`：用户当前正在修改的本地草稿。
- `server`：收到 `config_updated` 后重新拉取到的最新远端值。

## 配置页通用交互规范

- 复杂 detail 页优先组织为 tabs，而不是把所有字段纵向堆在同一页。tab 应按用户任务分组，例如服务信息、接入配置、模型配置、展示与链接、套餐信息、高级配置；只在对应类型确实需要时显示特定 tab。
- 列表创建、编辑、删除和进入详情优先复用 `ConfigRecordList` 这类统一记录列表。列表组件必须允许外部决定按钮行为，例如点击行进入详情、打开对话框、执行内联创建或跳转；不要把某个页面的一次性行为写死在通用组件里。
- 主流程保持简洁，低频或实现视角字段放进高级配置。服务图标、管理主页、Base URL 覆盖、扩展 JSON、服务类型等字段，只有没有 provider 或当前类型必须用户配置时才默认展开。
- 卡片标题、列表行尾、tab chrome 和配置页工具区的按钮优先使用 icon-only + tooltip + `aria-label`，尺寸和 hover 状态跟随现有 config / sidebar inline action 风格。必要快捷动作放在更多按钮左侧，低频动作收进更多菜单。
- 外部网页、管理后台和 provider portal 优先接入配置页底部 dock / portal tabs，不使用一次性的 iframe dialog。底部 dock 是 route 级状态，切换配置 section、detail 或 source 时不能被清空。
- 查询类信息默认自动触发并使用缓存；界面只展示正在查询、查询失败、实际结果三类状态。额度、余额、状态和模型列表要按数据语义分别呈现，不为了复用 UI 把不同含义混成同一种卡片。
- PR 证据截图必须覆盖本次改动影响到的服务类型和关键交互，例如普通 API、Coding Plan、collection、standalone、profiles / tokens、portal 下方面板。截图前要等待异步加载完成，不能用旧页面、局部错误页面或未加载完成的状态替代。

## 模型服务配置建模经验

- 新增模型服务能力时，先判断产品类型再设计表单：普通 API、Coding Plan / Token Plan、relay / gateway、平台 collection 是不同心智模型，不要在普通服务表单里不断追加特殊字段。
- provider catalog 只表达服务商默认能力、官方链接、默认 base URL、默认模型和限制提示；具体用户密钥、选择的远端令牌、本地模型参数和展示名属于 `modelServices` 实例或 collection profile。
- collection 类型代表一个平台账号或管理入口，下面的 profile 才是可被模型选择器消费的模型服务。collection 页默认展示平台信息、profile 列表、令牌管理和高级配置；profile 详情只展示该 profile 真正可编辑的本地补充项。
- 管理型平台的远端令牌和本地 profile 不要拆成两套用户概念：profile 选择一个远端令牌并补充本地参数。创建 profile 时默认选择第一个可用远端令牌；没有远端令牌时应引导去令牌管理，而不是让用户填一堆无效字段。
- 普通 API key、Coding Plan key、subscription key、平台管理 token 是不同凭证。界面文案和字段分组必须明确区分，不要把“模型调用密钥”和“平台管理密钥”混用。
- 能从 provider、collection 或远端令牌推导的模型列表、base URL、provider 图标和默认配置，优先自动生成或合并；不要暴露“写入模型列表”这类实现视角操作。
- Coding Plan / Token Plan 的专属 base URL 和 key 类型只在对应服务类型里展示和校验；普通 API 服务不因为同一 provider 存在 Coding Plan 就继承其限制。

## 不变式

- 不要在 `use-session-subscription.ts` 收到 `config_updated` 后直接覆盖本地编辑状态；订阅层只能触发 revalidate。
- `ConfigSourceSwitch` 如果放进 `RouteContainerHeader.actions`，必须保持和 route header chrome 一致的布局尺寸：外层文档高度 20px、按钮 20px、图标 14px。不要再用 `Space` 或额外 wrapper 包一层，也不要用 24px 高度直接撑大 header；如果需要更大的可视边框，用伪元素外扩，不改变布局高度。
- 主配置编辑器按 `source + section` 做冲突判断，不要退化成整页级别的统一提示。
- `draft === base` 且 `server !== base` 时，说明用户未改动，可直接把草稿同步到远端最新值。
- `draft !== base` 且 `server !== base` 且 `draft !== server` 时，必须视为真实冲突：暂停自动保存并要求用户显式选择。
- 冲突出现时，不允许静默偏向本地或远端；必须通过确认框让用户选择“保留当前编辑”或“采用外部修改”。
- 用户选择前，该草稿的自动保存必须保持阻断状态，避免背景定时器把另一份内容写回去。
- `ConfigView.tsx` 与 `use-worktree-environment-auto-save.ts` 的行为需要保持一致；不要只修一条编辑链路，另一条继续静默覆盖。
- `configConflict.ts` 负责共享比较逻辑；比较时需要归一化对象 key 顺序，避免仅因字段顺序不同而误判冲突。
- 配置页底部 dock / portal tabs 是 `ConfigView` route 级状态，不属于某个配置 section 或 detail。切换 `tab`、`source`、`detail` 时不要清空已打开的底部 tabs；只有用户关闭 panel 或关闭 tab 时才改变打开状态。

## 修改建议

- 如果需要调整冲突交互，优先保留 “先拦截自动保存，再让用户选择” 这个顺序。
- 如果需要新增配置编辑入口，接入同样的 `base / draft / server` 语义，而不是只复用自动保存逻辑。
- 如果需要修改 websocket 或缓存刷新逻辑，确认配置草稿仍然只在编辑器内部合并，不要把合并责任上提到订阅层。

## 最低验证

修改这块后，至少验证：

- `pnpm exec eslint apps/client/src/components/ConfigView.tsx apps/client/src/components/config/*.ts* apps/client/src/hooks/use-session-subscription.ts apps/client/src/hooks/session-subscription-cache.ts`
- `pnpm exec vitest run --workspace vitest.workspace.ts apps/client/__tests__/config-conflict.spec.ts apps/client/__tests__/session-subscription-cache.spec.ts`
- 如果改动了配置表单渲染，再补 `apps/client/__tests__/config-schema-form.spec.tsx`
