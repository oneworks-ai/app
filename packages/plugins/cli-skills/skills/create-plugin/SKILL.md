---
name: create-plugin
description: 当用户想创建或改造 OneWorks plugin，实现界面入口、按钮、tab、launcher 搜索、server 命令、scoped API 或本地服务时，先理解目标效果；需求不明确时列出不确定点让用户确认，再转成 manifest、前端入口、server 入口和验证步骤。
---

在用户描述“想创建一个插件”“想在界面里加一个入口 / 按钮 / tab / 搜索 / 调试面板 / 本地服务能力”，或明确要求“用 plugin 实现某个 UI 效果”时使用这个 skill。

## 工作目标

先理解用户真正想要的交互效果、入口位置和 runtime 能力，再把自然语言效果转换为一个可运行、可调试、可维护的 OneWorks plugin。优先落到 plugin manifest、前端 `activatePlugin(ctx)`、server `activatePlugin(ctx)` 和 scoped runtime 通道；不要把 plugin 需求改成宿主硬编码，除非现有 plugin 扩展点明显不足。

这是 OneWorks 内置的 create-plugin skill，只面向本仓库的 OneWorks plugin。不要套用 Codex 系统 `$plugin-creator` 的 `.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json`、`~/.codex/skills` 或 marketplace 规则，也不要修改全局 Codex skill。

## 先读这些

开始写或改 plugin 前，先读取当前仓库里的插件规则和示例：

- `assets/homepage/apps/docs/usage/plugins.md`
- `assets/homepage/apps/docs/usage/plugins/ui-runtime.md`
- `assets/homepage/apps/docs/usage/plugins/server-runtime.md`
- `packages/plugins/demo/package.json`
- `packages/plugins/demo/plugin.json`
- `packages/plugins/demo/README.md`
- `packages/plugins/demo/README.zh-Hans.md`

如果用户是在改已有 plugin，先读目标 plugin 自己的 `plugin.json`、README 多语言文件、`client/` 和 `server/` 入口，再决定最小修改点。

## 先理解效果

先把用户诉求拆成这些问题；用户已经给出时不要重复问：

- 入口在哪里：左侧导航、左侧更多菜单、chat header、下方面板 `+` 菜单、右侧/下方 workbench tab、launcher 搜索、独立 plugin route。
- 点击后发生什么：打开页面、创建新 tab、执行命令、调用本地服务、跳转外链或展示状态。
- 展示在哪里：plugin route、可关闭 workbench tab、右侧抽屉 tab、toast、菜单项、launcher result。
- 是否需要 runtime：只需要前端 DOM，还是要 server command、scoped API、loopback 本地服务或文件监听。
- 是否需要开发态热更新：本地开发优先放在 `packages/plugins/<name>` 并通过 `.oo.config.json` 显式声明；临时开发目录才放在 `.oo/plugins.dev/<name>`，开启 watch。本地路径 plugin 的 client source 会通过宿主 Vite dev server 加载，不需要单独启动插件 Vite dev server。

如果缺失信息会改变入口、交互、数据来源、权限、本地服务、scope 或验证方式，先列出“不确定点”让用户确认。每个不确定点都要写清它会影响什么；可以给出推荐默认值，但不要在关键需求模糊时直接替用户拍板。只有名称、图标、文案这类低风险细节缺失时，才采用保守默认并在结果里说明。

## 扩展点选择

按效果选择 manifest 字段：

- 左侧固定入口：`plugin.contributions.navItems`。默认路径是 `/plugins/<scope>/<id>`；也可以给 `route` 或 `command`。
- 左侧更多菜单：`navMoreMenu`，支持 `command`、`route`、`href`。
- 左侧底部「菜单」上方区域：`navFooterBefore`，支持 `command`、`route`、`href`。
- chat header 右上角按钮：`chatHeaderActions`，用 `command` 触发 plugin 命令。
- chat header 更多菜单：`chatHeaderMoreMenu`。
- chat 新建面板默认页操作卡片：`chatInteractionPanelEmptyActions`，支持 `command`、`route`、`href`，额外支持展示用 `shortcut`。
- 通用路由 header 按钮：`routeHeaderActions`，用 `targetRoute` / `targetRoutes` 限定宿主 route container，用 `command` 触发 plugin 命令。
- 通用路由折叠态 window bar 按钮：`routeWindowBarActions`，通常和 `routeHeaderActions` 成对注册，也用 `targetRoute` / `targetRoutes` 限定宿主 route container。
- 通用路由更多菜单：`routeMoreMenuItems`，支持 `command`、`route`、`href`；其中 `route` 是点击后的跳转目标，不是宿主显示条件。
- 通用路由侧栏入口 / 列表右键菜单：`routeSidebarContextMenu`，支持 `command`、`route`、`href`；其中 `route` 是点击后的跳转目标，不是宿主显示条件。
- 独立页面：`routes` + `clientView`，前端用 `ctx.views.register(viewId, render)` 提供内容。
- 下方面板或右侧抽屉 tab：`workbenchTabs` 或 `workspaceDrawerTabs`，用 `placement: "bottom" | "right"` 决定位置。
- 下方面板 `+` 菜单：`workbenchAddMenu`。如果要点击后创建 tab，设置 `tab` 指向 `workbenchTabs[].id`。
- launcher 搜索：`launcherSearchProviders`，桌面 launcher 使用 server-backed `command`；workspace client 可以再用 `ctx.launcher.registerSearchProvider` 注册本地搜索。
- 插件间扩展点：拥有方用 `extensionPoints` 或 `ctx.extensionPoints.register` 暴露 `<scope>/<id>`；其他插件用 `ctx.extensionPoints.onAvailable('<scope>/<id>', point => ctx.extensionPoints.contribute(...))` 监听目标点出现后补充结构化能力。只有 manifest 里声明的静态贡献才用 `extensionContributions`。
- 插件间纯前端 API：拥有方用 `ctx.pluginApis.register({ id, inputSchema, outputSchema, handler })` 暴露 in-client 过程调用；调用方用 `await ctx.pluginApis.call('<scope>/<id>', input)`。所有调用必须是 Promise，运行时会等待目标 API 注册并等待 handler 完成。
- 本地能力：server `ctx.registerCommand` 或 `ctx.registerApi`；前端通过 `ctx.commands.execute` 或 `ctx.api.fetch` 调用。

关键语义：

- `workbenchTabs` 是“可创建 tab 模板”，不是启动后常驻 tab。
- route 级贡献里的 `targetRoute` / `targetRoutes` 是宿主显示条件，菜单项里的 `route` 是点击后的导航目标，二者不要混用。
- `targetRoute` / `targetRoutes` 支持 route key、当前 pathname 和 `/*` 后缀路径通配。路径可以写应用内路径（如 `/plugins/*`）或带 client basename 的路径（如 `/ui/plugins/*`），两者都会归一匹配。配置页的 `settings` / `config` 是互通 alias：`targetRoute: "settings"` 可以匹配当前 `config` route，`targetRoute: "config"` 也可以匹配旧的 `settings` route。
- route 级 chrome 包括 header action、侧栏折叠态 window bar action、route more menu、route sidebar 入口 / 列表右键菜单。这些贡献会扩展宿主 route 已有 action，不会覆盖 route 自己声明的能力。菜单类贡献只注册结构化 item，由宿主通过通用 `nav-rail-more-menu` / overlay 结构渲染；不要让 plugin 或业务 route 自己拼菜单 DOM、局部 CSS 或 hover / selected / shortcut 样式。
- route 级 chrome 的实际可见位置由宿主 route 已接入的 container 能力决定：header action、window bar action 和 route more menu 由 `useRoutePluginChrome(routeKey)` 统一安装；route sidebar 右键菜单只有在宿主 route 提供共享 sidebar 数据时才会显示。
- route action 状态字段由宿主通用 chrome 统一渲染：`active` 切换 `activeIcon` / `activeLabel` / `activeTitle`，`disabled` 禁用，`danger` hover/focus 使用危险色，`shortcut` 进入 tooltip；菜单型贡献额外支持 `selected`。旧 `routeMoreMenu` 只是兼容别名，新插件写 `routeMoreMenuItems`。
- `chatInteractionPanelEmptyActions` 是 chat 专属扩展点，只扩展新建面板默认页的 action card；它不进入通用 route container，也不替代 `workbenchAddMenu`。如果需要新增真实底部 / 右侧 tab，继续用 `workbenchTabs` + `workbenchAddMenu`。
- 插件扩展点的边界是：通用布局交互沉淀到 route container / layout 组件；route 层负责业务状态、持久化和 slot 内容；plugin 只注册贡献、命令、view 和 slot 内容。现有扩展点不够时，优先补宿主结构化 API，不要把 header、window bar、右键菜单或 overlay 交互复制进 plugin。
- 点击 `workbenchAddMenu` 创建的新 tab 应该可关闭；不要把普通 plugin tab 做成默认固定。
- 需要默认固定或默认打开时，必须有显式配置语义，不要把所有 plugin tab 都自动打开。
- plugin scope 是隔离边界。manifest 不声明 scope；scope 来自用户配置或运行时派生。
- plugin 不注册顶层 `/api/*`；所有 API 必须在 `/api/plugins/<scope>/*` 下。
- 插件间扩展点不是宿主固定 slot。只有当目标扩展点存在时才贡献；贡献项要保持结构化，至少写 `id`、`titleI18n` / `descriptionI18n`、`icon` 和 `command`，由拥有方 view 决定如何渲染。

## 配置 Schema

如果 plugin 需要用户可编辑配置，必须优先在 manifest 里声明 `config.schema`，让插件详情页「配置」tab 自动渲染表单：

- 根 schema 使用 `type: "object"` 和 `properties`。
- 每个用户可见字段都写 `titleI18n` 和 `descriptionI18n`，至少覆盖 `en` 与 `zh-Hans`；保留 `title` / `description` 作为兜底也可以，但不要只写英文标题。
- 支持的常用类型：`string`、`number`、`integer`、`boolean`、字符串数组、`enum`、`oneOf` / `anyOf` 里的字符串 `const` 选项。
- 用 `default` 表达默认值；不要为了默认值提前写入 `.oo.config.json`。
- 用 `x-oneworks-ui.icon`、`placeholder`、`control`、`sensitive` 描述图标、占位符、textarea / 普通输入、敏感字段。
- `format: "password"`、`writeOnly: true` 或 `x-oneworks-ui.sensitive: true` 用于 token、密钥等敏感配置。
- 如果 JSON Schema 自动推断不够，再使用 `config.uiSchema` 直接声明配置页内部 `ConfigUiObjectSchema`；不要为普通字段手写自定义页面。

配置值读取规则：

- 前端和 server 入口读取当前实例的 options，不要自己解析 `.oo.config.json`。
- 运行时没有配置值时，用 schema `default` 或代码里的保守默认兜底。
- 保存配置只应更新当前 plugin 实例的 `plugins[].options`，不要污染其他 scope 或全局配置。
- 独立 plugin view 里需要内联编辑配置时，使用 `view.options.value` 读取当前实例配置，并调用 `await view.options.update(nextOptions)` 写回当前实例；不要绕过宿主去直接请求顶层 `/api/plugins/*/options`。

## Manifest 与 I18n

每个用户可见贡献项都要写清楚名称和说明：

- `id` 是稳定机器标识，短横线命名，不展示给用户当说明。
- `title` 是兜底文案；同时写 `titleI18n.en` 和 `titleI18n.zh-Hans`。
- 宿主会统一把 contribution 的 `titleI18n` / `descriptionI18n` 解析成当前应用语言；不要在左侧导航、菜单、workbench 等宿主 slot 里自己判断浏览器语言。
- `descriptionI18n.en` 和 `descriptionI18n.zh-Hans` 描述这个入口点击后做什么、展示在哪里、是否调用命令或 server。
- `icon` 使用 Material Symbols 名称，选择能表达入口语义的图标。
- 不要依赖 UI 兜底生成“标识 xxx”“命令 xxx”这类说明；缺少描述时应补 manifest。

README 多语言规则：

- 必须同时提供英文和中文 README；这是硬要求，不因用户只使用单一语言而省略另一种。
- `README.md` 使用用户当前对话语言作为默认语言：用户用中文沟通时写中文，用户用英文沟通时写英文。
- 另一种语言使用带 locale 后缀的 README 文件：默认是中文时补 `README.en.md`，默认是英文时补 `README.zh-Hans.md`。
- 两种语言的 README 都要说明 plugin 做什么、贡献了哪些入口、有哪些配置项、如何验证。
- README 中相对链接和图片路径相对 plugin 根目录；不要写只有当前机器可用的绝对路径。
- 如果 manifest、README 或示例配置变更了用户可见行为，要同步更新对应文档。

## 落地路径

优先复用已有 plugin；没有时创建可提交 package plugin：

```text
packages/plugins/<plugin-name>/
  package.json
  plugin.json
  README.md
  README.zh-Hans.md
  client/src/index.tsx
  client/src/view.tsx
  client/src/i18n.ts
  client/src/styles.ts
  client/dist/index.js
  client/vite.config.ts
  server/src/index.ts
  server/dist/index.js
  server/tsconfig.json
```

`package.json` 最小骨架：

```json
{
  "type": "module",
  "scripts": {
    "build": "pnpm run build:client && pnpm run build:server",
    "build:client": "tsc -p client/tsconfig.json --noEmit && vite build --config client/vite.config.ts",
    "build:server": "tsc -p server/tsconfig.json"
  },
  "exports": {
    "./client": {
      "source": "./client/src/index.tsx",
      "default": "./client/dist/index.js"
    },
    "./server": {
      "source": "./server/src/index.ts",
      "default": "./server/dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "devDependencies": {
    "vite": "^5.4.8"
  }
}
```

`plugin.json` 最小骨架：

```json
{
  "__oneWorksPluginManifest": true,
  "name": "@local/plugin-example",
  "displayName": "Plugin Example",
  "version": "0.1.0",
  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "greeting": {
          "type": "string",
          "default": "Hello from Plugin Example",
          "titleI18n": {
            "en": "Greeting",
            "zh-Hans": "问候语"
          },
          "descriptionI18n": {
            "en": "Text shown by plugin commands and views.",
            "zh-Hans": "插件命令和视图展示的文本。"
          },
          "x-oneworks-ui": {
            "icon": "waving_hand",
            "placeholder": "Hello from Plugin Example"
          }
        }
      }
    }
  },
  "plugin": {
    "contributions": {
      "routes": [
        {
          "id": "home",
          "title": "Plugin Example",
          "titleI18n": {
            "en": "Plugin Example",
            "zh-Hans": "插件示例"
          },
          "descriptionI18n": {
            "en": "Opens the standalone plugin route.",
            "zh-Hans": "打开独立插件页面。"
          },
          "clientView": "home"
        }
      ],
      "workbenchTabs": [
        {
          "id": "panel",
          "title": "Plugin Example",
          "titleI18n": {
            "en": "Plugin Example",
            "zh-Hans": "插件示例"
          },
          "descriptionI18n": {
            "en": "Renders a bottom workbench tab.",
            "zh-Hans": "渲染底部工作区标签页。"
          },
          "placement": "bottom",
          "clientView": "panel"
        }
      ],
      "workbenchAddMenu": [
        {
          "id": "open-panel",
          "title": "Plugin Example",
          "titleI18n": {
            "en": "Open Plugin Example panel",
            "zh-Hans": "打开插件示例面板"
          },
          "descriptionI18n": {
            "en": "Creates a new bottom workbench tab from the panel template.",
            "zh-Hans": "基于面板模板创建新的底部工作区标签页。"
          },
          "tab": "panel"
        }
      ]
    }
  }
}
```

路径规则：

- 在 OneWorks 仓库或具备前端构建环境的项目里，可提交 plugin 优先放在 `packages/plugins/<plugin-name>/`，通过 package name / exports 和 `.oo.config.json` 的 `plugins` 数组显式声明启用。
- 本地开发和临时调试目录放在 `.oo/plugins.dev/<plugin-name>/`，它会自动发现并默认开启 watch。
- 如果用户项目没有 `packages/plugins` 语义、不是前端工程，或只是想在普通项目资产目录快速放一个轻量插件，可以使用 `.oo/plugins/<plugin-name>/`，但需要在 `.oo.config.json` 里用显式目录路径声明；宿主不会再把 `.oo/plugins/*` 普通子目录自动当成 UI plugin 加载。
- OneWorks plugin manifest 文件名是 `plugin.json` / `plugin.yaml` / `plugin.yml`，不放在 `.codex-plugin/` 下面。
- README 必须覆盖英文和中文；`README.md` 使用当前对话语言，另一种语言使用 `README.en.md` 或 `README.zh-Hans.md`。两个 README 描述同一组入口、配置项、命令、API 和调试方式。
- 不要把用户配置值写进 manifest；具体值保存到项目配置里的 `plugins[].options`。

## 前端实现规则

`client/src/index.tsx` 导出 `activatePlugin(ctx)`，并由 Vite 编译到 `client/dist/index.js`：

- 新插件按 `package.json` exports 约定暴露入口：`exports["./client"].source` 指向 `client/src/index.tsx`，`exports["./client"].default` 指向 `client/dist/index.js`，`exports["./server"].source` 指向 `server/src/index.ts`，`exports["./server"].default` 指向 `server/dist/index.js`。不要在 manifest 里重复写 `plugin.client.entry`、`plugin.client.root` 或 `plugin.server.entry`，除非是在兼容旧插件。
- 本地路径 plugin 在 watch 开启或位于 `.oo/plugins.dev/*` 时，开发态宿主会把 `exports["./client"].source` 转成同源 `/@fs/...` entry，由宿主 Vite dev server 负责 TS / TSX 转译、source map、样式模块 HMR 和 React Fast Refresh；不需要配置 `plugin.client.devServer`。`plugin.client.devServer` 只作为旧插件或外部 loopback dev server 兼容路径保留。
- `client/src/index.tsx` 只做薄入口：加载子模块、注入样式、注册 view / command / launcher provider、集中 dispose。页面组件、i18n 文案、样式和数据模型拆到 `client/src/view.tsx`、`client/src/i18n.ts`、`client/src/styles.ts` 等 ESM 模块；不要把整套插件都写进一个入口文件。
- 静态入口只加载浏览器可执行的 JavaScript，不会由宿主自动转译 TypeScript / TSX。发布 / 提交前运行 `vite build --config client/vite.config.ts` 生成 `client/dist/index.js`；不要把含 TS / TSX 语法的源码文件当作静态入口。
- server 侧本地开发可以直接写 TS：watch 开启时宿主会加载 `exports["./server"].source`，并用 esbuild register 转译 `.ts` / `.tsx` / `.mts` / `.cts`。发布 / 提交时使用 `exports["./server"].default` 的 JS 产物。
- `.oo/plugins.dev/*` watch、显式 `watch: true` 和插件详情页 watch 对 manifest、server、README、静态入口，以及 host Vite client source 下普通 TS / 数据 / i18n / model 模块变更提供 plugin scope 级 reload。TSX / JSX 组件和样式模块交给 Vite HMR / React Fast Refresh，入口文件变化仍走 plugin scope 级 reload。
- 用 `ctx.views.register(viewId, { renderNode })` 注册 React view；manifest 的 `clientView` 必须能找到同名 view。无构建插件从 `ctx.react` 取 `createElement` / hooks；TSX 插件也必须复用宿主 React 单例，不要 bundle 第二份 React。`ctx.views.register(viewId, render)` 是兼容 DOM view，只用于简单无 React 插件。
- view context 读取宿主状态：`view.host.language` 是当前界面语言，`view.host.themeMode` 是用户选择的 `light | dark | system`，`view.host.resolvedThemeMode` 是实际 `light | dark`，`view.host.isDarkMode` 是深色状态，`view.host.surface` 表示当前挂载在 `route | workbench | drawer`。
- 插件自己的按钮、placeholder、菜单项、状态文案必须走 i18n：React view 内使用 `view.i18n.resolveText({ en, "zh-Hans": "..." })`；前端命令、界面消息、launcher 本地搜索这类不在 view render 内执行的逻辑使用 `ctx.i18n.resolveText(...)` 或 `ctx.i18n.getLanguage()`。不要用 `view.host.language.startsWith('zh')` 手写分支，也不要只写英文硬编码。
- 需要复用宿主 UI 时，React view 优先用 `view.ui.*` 声明式组件，不要复制宿主组件 DOM。当前组件包括 `Icon`、`Button`、`Input`、`Segmented`、`Switch`、`Sender`、`ProjectFileTree`，以及 overlay 系列的 `OverlayDropdown`、`OverlayMenu`、`OverlaySearchMenu`、`OverlaySearchRow`、`OverlaySegmented`、`OverlaySelectLabel`、`OverlayTree`；菜单、搜索、树、确认态、danger 态、快捷键和嵌套 submenu 都应该走这些结构化 overlay props。需要真实弹出浮层时优先用 `OverlayDropdown`，不要把 overlay primitive 直接平铺在插件页面里。overlay 树需要独立浮层外观时传 `surface: true`，不要在插件内手写 panel 样式。`Sender` 默认套用 chat sender surface，并包含模型、权限、adapter / account 和 status bar 编排。sender 样式只能通过 `surface: "chat" | "plain"`、`density: "default" | "compact"`、`showHeader`、`showStatusBar`、`placeholder`、`initialContent`、`defaultAdapter`、`defaultModel` 这类结构化选项控制。DOM view 兼容路径才使用 `view.components.render(component, container, props)`，返回的 `{ dispose() }` 必须在 view 的 `dispose()` 里清理；需要示例时参考 `assets/homepage/apps/docs/usage/plugins/ui-runtime.md` 的“宿主组件用法示例”。
- 用 `ctx.commands.register(commandId, handler)` 注册前端命令。
- 用 `ctx.commands.execute(commandId, payload)` 调用前端或 server command。
- 用 `ctx.extensionPoints.register({ id, title, description, contributionSchema })` 暴露插件自己的扩展点；贡献方用 `ctx.extensionPoints.onAvailable('other-scope/point', point => ctx.extensionPoints.contribute('other-scope/point', contribution))`，不要用激活时的一次性 `has(...)` 判断来决定是否贡献。React view 里用 `view.extensions.getContributions('point')` 读取当前插件扩展点的贡献。
- 用 `ctx.pluginApis.register({ id, title, description, inputSchema, outputSchema, handler })` 暴露插件内过程调用；其他插件用 `await ctx.pluginApis.call('other-scope/api-id', input)` 调用。`call` 的 Promise 会等待目标 API ready，也会等待 handler 处理完成；必要时传 `timeoutMs` 明确失败边界。
- 用 `ctx.api.fetch('apiId/path')` 调 scoped API；不要传绝对 URL、协议相对 URL 或顶层 `/api/*`。
- 用 `ctx.notifications.show({ title, description, actions })` 发布宿主级消息。宿主会自动显示插件来源、发送时间、markdown 描述、按钮回调和关闭 / 屏蔽插件这类通用操作。不要在插件里自己创建 fixed toast 或引入另一套通知 UI。
- 用 `ctx.i18n.t({ en, "zh-Hans": ... })` / `ctx.i18n.select(...)` 渲染插件自带文案，跟随宿主应用语言；DOM view 需要在 `ctx.i18n.subscribe()` 里重绘，并在 `dispose()` 中清理订阅。
- 用 `ctx.hot.accept()` 和 `ctx.hot.reload()` 支持本 plugin 的 scope 级调试重载；它不是 Vite Fast Refresh。React Fast Refresh 由宿主 Vite `/@fs` client source entry 提供，插件仍要复用宿主 React 单例、宿主组件继续走 `view.ui.*`。
- 所有 DOM 事件、style、timer、subscription 都必须在返回的 `dispose()` 里清理。
- 前端 plugin 不直接访问文件系统；需要本地能力时交给 server entry。

## 插件界面设计标准

默认把 plugin UI 做成宿主里的功能界面，不做营销页或展示页：

- plugin route、workbench tab、drawer tab 的根节点要直接填满宿主给的容器：`box-sizing: border-box; width: 100%; min-width: 0; min-height: 0;`，需要纵向布局时再加 `display: flex; flex-direction: column;`。
- 默认不要在 plugin 根节点加大块 padding、max-width、居中容器、渐变背景、装饰色块、hero、阴影卡片或“卡片套卡片”。宿主 route body / panel chrome 已经提供外层边界，plugin 内容应直接平铺在里面。
- 首个内容块或 header 默认不要再加额外 top padding；内容应该从宿主提供的可用区域顶部开始。
- 独立 plugin route 已经由宿主 route header 展示标题和图标时，plugin view 内不要再重复 `h1`、eyebrow 或解释性 header；直接呈现当前页面的工具栏、表单、列表、输出区域等核心内容。
- 独立 plugin route 里的内容默认透明背景；只有表格、输出日志、表单组、可重复列表项、modal 等真正需要边界的局部元素才加 1px border 和小圆角。不要给整页加实色背景或大面积主题色。
- 按钮用克制的工具按钮风格：小尺寸、图标加短文案、普通边框或透明背景；图标优先使用宿主已加载的 Material Symbols，不要把 action 做成大卡片或醒目 hero CTA。route header、window bar、更多菜单、侧栏右键这类 chrome action 必须通过 manifest 贡献给宿主结构化渲染，不在 plugin view 里手写一套 header。
- 文案只保留任务所需信息。示例 / demo 页面可以说明来源和用途，但不要罗列所有扩展点或写大段介绍；把详细说明放 README。
- 输出 JSON、日志、状态面板可以用 `pre` / 列表 / 表格展示，但应跟随父容器宽度，避免固定宽度导致右侧空白。
- 使用宿主 token：`var(--ant-color-text)`、`var(--ant-color-text-secondary)`、`var(--ant-color-bg-container)`、`var(--ant-color-border)`、`var(--ant-color-border-secondary)`、`var(--ant-color-fill-quaternary)`、`var(--primary-color)`、`var(--primary-soft-bg)`、`var(--primary-text-color)`、`var(--bg-color)`、`var(--sub-bg-color)`、`var(--text-color)`、`var(--border-color)` 等；不要硬编码一套高饱和主题色。
- chrome 尺寸用 `var(--app-chrome-icon-size)`、`var(--app-chrome-action-gap)`、`var(--route-container-header-overlay-height)`、`var(--route-container-header-padding-inline)`、`var(--route-container-header-padding-block)`；不要在 plugin 里重新定义 header、tab、图标按钮高度。
- 如果某个 view 看起来没有填满左右宽度，先检查宿主挂载点和 plugin 根节点是否都是 `flex: 1 1 auto; width: 100%; min-width: 0;`，不要用额外 wrapper 或固定 `max-width` 掩盖问题。

## Server 实现规则

`server/src/index.ts` 或发布态 `server/dist/index.js` 导出 `activatePlugin(ctx)`：

- `ctx.registerCommand(commandId, handler)` 暴露 scoped command。
- `ctx.registerApi(apiId, { handler })` 暴露 scoped HTTP API，真实路径固定为 `/api/plugins/<scope>/proxy/<apiId>/*`。它就是插件的 route 注册工具；不要注册顶层 `/api/*`。
- `ctx.registerApi(apiId, { proxy: { target } })` 只能代理到 loopback HTTP(S) 本地服务。
- 每个 `registerApi` 都必须写清 `title`、`description`、`inputSchema`、`outputSchema`、`headerSchema`。旧插件缺失时运行时兼容但会产生 `plugin_api_metadata_missing` 诊断；新插件不要省略。
- `ctx.registerLocalService(serviceId, start)` 管理随 plugin 生命周期启动/停止的本地服务。
- `ctx.dispose(callback)` 清理 timer、server、watcher、临时资源。
- 使用 `ctx.workspaceFolder`、`ctx.projectHome` 和 `ctx.pluginRoot`，不要猜路径。
- `registerApi` 的 `handler` 按 `request.method` 和 `request.path` 分发子路由；如果需要完整 Express / Hono / Fastify router，使用 `registerLocalService` 启动本地 loopback 服务，再用 `registerApi(..., { proxy })` 暴露为 scoped API。

Server route 示例：

```ts
const json = (body: unknown, status = 200) => ({
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8'
  },
  body
})

export function activatePlugin(ctx) {
  ctx.registerCommand('snapshot', payload => ({
    ok: true,
    scope: ctx.scope,
    received: payload
  }))

  ctx.registerApi('notes', {
    title: {
      en: 'Notes API',
      'zh-Hans': '笔记 API'
    },
    description: {
      en: 'Creates and lists notes inside the plugin scoped API.',
      'zh-Hans': '在插件作用域 API 内创建和列出笔记。'
    },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      additionalProperties: true
    },
    headerSchema: {
      type: 'object',
      properties: {
        'content-type': { const: 'application/json' }
      },
      additionalProperties: true
    },
    handler: async request => {
      if (request.method === 'GET' && request.path === '') {
        return json({ notes: [] })
      }

      if (request.method === 'POST' && request.path === 'create') {
        const payload = JSON.parse(request.body.toString('utf8') || '{}')
        return json({ created: true, payload }, 201)
      }

      return json({ error: 'Not found' }, 404)
    }
  })
}
```

前端调用时使用 `ctx.api.fetch("notes/create", { method: "POST", body: JSON.stringify(payload) })`，不要拼绝对 URL。

## 调试与验证

实现后按影响面验证：

- `GET /api/plugins` 能看到 plugin、scope、贡献项和诊断。
- `/plugins` 插件商店能看到 plugin；`/plugins/<scope>` 详情能看到 README、entry、contributions、runtime 注册项和 watch 开关。
- 点击每个入口验证真实效果：左侧入口、菜单项、chat header、`+` 菜单、创建/关闭 workbench tab、launcher 搜索。
- 验证 `workbenchAddMenu.tab` 创建的是新 tab 实例，不是常驻 tab。
- 调用 server command 和 scoped API，确认 scope 不串。
- 改本地路径 plugin 的 `client/src/view.tsx` 或样式文件后，宿主 Vite dev server 应能触发模块 HMR / React Fast Refresh；改 `client/src/index.tsx`、普通 TS / 数据 / i18n / model 模块、manifest、server 或 README 后，plugin watch 触发 scope 级 reload，不需要重启 Electron。
- 如果改了宿主代码，运行相关 `vitest`、`pnpm typecheck` 和 `pnpm exec dprint check`。

## 文档同步

如果新增了用户可见 plugin 能力，同步更新：

- `assets/homepage/apps/docs/usage/plugins.md`：manifest、扩展点、watch、plugin store、server API。
- `assets/homepage/apps/docs/usage/web.md`：Web UI 上的具体入口和交互变化。
- plugin 自己的英文和中文 README：告诉使用者它注册了哪些入口、有哪些配置项、需要哪些本地服务、如何调试。
