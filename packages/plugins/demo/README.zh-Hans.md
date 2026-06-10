# 插件 Demo

这是从 `@oneworks/plugin-demo` 加载的内置 workspace 插件。它保持尽量小，但会覆盖插件详情页需要展示的几类信息：README 多语言版本、点位名称、点位描述以及点位搜索。

它演示了这些入口：

- 左侧导航路由：`/plugins/demo/home`
- 左侧更多菜单命令
- 渲染在侧边栏底部菜单上方的 footer 操作
- 会话头部按钮和会话头部更多菜单命令
- 底部工作区标签页
- 右侧工作区抽屉标签页
- 启动器搜索 Provider
- 服务端命令：`server-ping`
- 作用域 API：`echo/*`，包含标题、描述、输入 Schema、输出 Schema 和 Header Schema 元数据
- 插件扩展点：`demo/quick-actions`
- 客户端插件 API：`demo/describe-extension-point`
- 使用宿主 `ctx.react` 的 React `renderNode` 插件 view
- 通过 `view.i18n.resolveText(...)` 渲染插件 view 文案，并通过 `ctx.i18n.resolveText(...)` 渲染命令文案
- 通过 `ctx.notifications.show(...)` 使用宿主消息队列，包含 markdown 介绍和按钮回调
- 薄 `client/src/index.tsx` 入口，分别加载 React view、i18n 文案、共享模型 helper 和样式模块
- view 宿主状态：语言、主题、实际主题和挂载位置
- 宿主渲染的共享组件：sender、项目目录树，以及 overlay 菜单 / 树 / 搜索 surface
- 宿主渲染的通用控件：icon、segmented、switch、input、overlay dropdown 和 overlay primitives
- 受控 sender 配置：surface、density、可见性、默认文本、placeholder、adapter 和模型
- 从 `plugin.json` JSON Schema 渲染的交互式配置

可以在插件详情页里检查：

- 通过左下角菜单切换界面语言，README、扩展点文案、路由标题、tabs、控件、placeholder 和 overlay 文案都会跟随当前语言切换。
- 打开 **扩展点** 后搜索 `服务端`、`抽屉`、`启动器` 或 `命令`，点位列表会按名称、描述和字段过滤。
- 关闭某个扩展点分组或单个点位，已注册的客户端贡献会随之更新。
- 打开 **配置** 编辑 Demo 选项。表单由 `config.schema` 生成，保存值会写入这个插件实例的 `options`。
- 打开 Demo 路由后使用 **运行服务端命令**、**调用 scoped API** 或 **运行本地命令**，验证插件提示会进入宿主消息队列，并展示来源、时间、markdown 内容和操作按钮。
- 使用 **Render sender**、**Render file tree** 或 **Render overlay**，验证 React 插件 view 可以通过 `view.ui` 直接挂载宿主共享组件，而不用复制 DOM 或样式。overlay demo 使用左侧 tabs 切换当前宿主 overlay surface。sender demo 还通过宿主通用控件提供受控 surface、density、可见性、默认文本、placeholder、adapter 和模型配置。
- 保持 `@oneworks/plugin-demo-extension` 启用，可以验证另一个插件向 `demo/quick-actions` 贡献操作、通过 `onAvailable(...)` 监听扩展点，并在执行贡献命令时调用 Demo 插件 API。

前端源码结构：

- `client/src/index.tsx`：薄运行时入口，负责动态加载模块、注册能力和清理资源。
- `client/src/view.tsx`：使用宿主 `ctx.react` 和 `view.ui` 的 React view factory。
- `client/src/i18n.ts`：本地化文案和文本解析 helper。
- `client/src/demo-model.ts`：Demo actions、tab 数据、事件和结果 helper。
- `client/src/styles.ts`：使用宿主变量的 CSS。
- `client/dist/*.js`：宿主 Vite source entry 未生效时，由宿主加载的浏览器 ESM 产物。
- `server/src/index.ts`：watch 模式下由宿主直接加载的 TypeScript 服务端入口。
- `server/dist/index.js`：watch 关闭时使用的构建后服务端入口。

这个 package exports 已使用插件 source/default 约定：`./client.source` 指向 `client/src/index.tsx`，`./client.default` 指向 `client/dist/index.js`，`./server.source` 指向 `server/src/index.ts`，`./server.default` 指向构建后的 server 入口。在宿主前端开发态，本地插件 client source 会通过宿主 Vite dev server 加载，所以 React Fast Refresh 可以处理 TSX 组件更新，Vite 也能热更新样式模块。静态插件客户端文件是浏览器 ESM，宿主不会自动转译 TypeScript；除非宿主 Vite source entry 已生效，否则修改 client TS/TSX 后需要运行 `pnpm -C packages/plugins/demo build` 生成 JS 产物。server TS 在 watch 使用 source 入口时由宿主 esbuild register 加载。`.oo/plugins.dev/*`、显式 `watch: true` 和插件详情页 watch 对非自处理 client source、manifest、server、README 和静态入口变更提供插件级 reload。
