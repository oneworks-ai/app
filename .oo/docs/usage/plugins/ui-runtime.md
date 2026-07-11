# 界面 Plugin Runtime 与前端入口

## 界面 plugin runtime

界面 plugin 仍然使用同一个 `plugins` 配置和同一个 manifest，不引入新的公开名称。一个 plugin 可以同时提供数据资产、界面贡献、server 命令和 scoped API。

本地目录 plugin 会从这些位置自动发现：

- 全局 plugin：`~/.oneworks/global/plugins/*`
- 项目开发 plugin：`.oo/plugins.dev/*`

`.oo/plugins.dev/*` 默认开启 `watch`，适合调试本地界面 plugin；这个目录是本地开发目录，不应该提交到仓库。普通可提交插件优先作为 package 放在 `packages/plugins/<name>` 并通过 `.oo.config.json` 的 `plugins` 显式声明。如果用户项目没有合适的 package/plugin 目录，也可以把轻量本地插件放在 `.oo/plugins/<name>`，但它只是建议放置位置，不是 runtime 自动发现根，必须在 `plugins` 里显式声明。

普通目录 plugin 至少包含一个 `plugin.json` / `plugin.yaml` / `plugin.yml`，也可以用 `package.json` 里的 plugin manifest。常见结构：

```text
my-plugin/
  package.json
  plugin.json
  README.md
  client/
    src/index.tsx
    src/view.tsx
    src/i18n.ts
    src/styles.ts
    dist/index.js
    vite.config.ts
  server/
    src/index.ts
    dist/index.js
    tsconfig.json
  rules/
  skills/
```

默认约定是：本地源码写在 `client/src/index.tsx`，发布入口是 Vite build 后的 `client/dist/index.js`。`client/src/index.tsx` 仍应保持为薄入口：加载样式和子模块、注册 view / command / launcher provider，并在 `dispose()` 里清理资源。真实页面组件、i18n 文案、数据模型和样式应拆到 `client/src/` 下的普通 ESM 模块，避免把整个插件塞进一个入口文件。

插件入口路径优先走约定的 `package.json` exports，manifest 不需要重复写一遍。推荐写法：

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

`exports["./client"].source` 是宿主 Vite dev server 加载的源码入口；`exports["./client"].default` 是发布 / 提交时的静态 ESM 产物。`exports["./server"].source` 是 watch / 本地开发时的 server TS 入口；`exports["./server"].default` 是发布 / 提交时的 server JS 入口。server entry 还需要在 manifest 的 `plugin.server.roles` 里声明运行层级；未声明时宿主会拒绝注册 server 入口并在 diagnostics 里暴露错误。新插件按 exports + roles 约定生成，不要在 manifest 里重复写入口路径。

静态 `/client` 入口不会在宿主里再做 TypeScript 或 JSX 转译。也就是说，未编译的 `client/src/index.tsx` 不能作为静态入口直接加载。新的 TypeScript / TSX 插件按这条链路处理：

- 本地路径 plugin 在 watch 开启或位于 `.oo/plugins.dev/*` 时，开发态宿主会把 `exports["./client"].source` 转成同源 `/ui/@fs/...` entry，由宿主 Vite dev server 负责 TypeScript / TSX 转译、source map、样式模块 HMR 和 React Fast Refresh；不需要插件自己再启动一个 Vite dev server。
- 可提交 / 发布态运行 `vite build --config client/vite.config.ts`，把 TypeScript / TSX 编译到 `client/dist/index.js`，宿主静态加载这个 JavaScript 产物。
- 新插件不要配置 `plugin.client.devServer`。开发态 HMR、TS / TSX 转译、source map 和 React Fast Refresh 都由宿主 Vite dev server 基于 `exports["./client"].source` 提供。

Server 侧也支持本地 TS：watch 开启的本地插件会优先加载 `exports["./server"].source`，并通过宿主已有的 esbuild register 转译 `.ts` / `.tsx` / `.mts` / `.cts`；发布 / 提交态使用 `exports["./server"].default` 的 JS 产物。server 入口没有独立 dev server，文件变化仍走 plugin scope reload。

`.oo/plugins.dev/*` watch、显式 `watch: true` 和插件详情页 watch 对 manifest、server、README、静态入口，以及 host Vite client source 下普通 TS / 数据 / i18n / model 模块变更提供 plugin scope 级 reload：文件变化后宿主 dispose 当前插件并重新 import entry。TSX / JSX 组件和样式模块由 Vite HMR / React Fast Refresh 自处理，入口文件变化仍走 plugin scope 级 reload。拆分无构建模块时，入口如果动态加载子模块，推荐把宿主传入 entry 的 `pluginVersion` 查询参数继续带到子模块 import 上，否则浏览器的 ESM module registry 可能在同一页面生命周期内复用旧子模块：

```js
const pluginVersion =
  new URL(import.meta.url).searchParams.get('pluginVersion') ?? Date.now()
const load = path =>
  import(`${path}?pluginVersion=${encodeURIComponent(pluginVersion)}`)

export async function activatePlugin(ctx) {
  const [{ createHomeView }, { css }] = await Promise.all([
    load('./view.js'),
    load('./styles.js')
  ])
  // register views and commands...
}
```

Manifest 示例：

```json
{
  "__oneworksPluginManifest": true,
  "name": "@acme/plugin-workspace-tools",
  "displayName": "Workspace Tools",
  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "greeting": {
          "type": "string",
          "default": "Hello from Workspace Tools",
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
            "placeholder": "Hello"
          }
        },
        "showLauncherPreview": {
          "type": "boolean",
          "default": true,
          "titleI18n": {
            "en": "Launcher preview",
            "zh-Hans": "启动器预览"
          },
          "x-oneworks-ui": {
            "icon": "manage_search"
          }
        }
      }
    }
  },
  "plugin": {
    "server": {
      "roles": ["workspace"]
    },
    "contributions": {
      "navItems": [
        {
          "id": "dashboard",
          "title": "Workspace Tools",
          "icon": "dashboard"
        }
      ],
      "chatHeaderActions": [
        {
          "id": "snapshot",
          "title": "Snapshot",
          "icon": "camera_alt",
          "command": "snapshot"
        }
      ],
      "workbenchTabs": [
        {
          "id": "debug-web",
          "title": "Debug Web",
          "icon": "language",
          "placement": "bottom",
          "clientView": "debug-web"
        }
      ],
      "workbenchAddMenu": [
        {
          "id": "debug-web",
          "title": "Debug Web",
          "icon": "language",
          "tab": "debug-web"
        }
      ],
      "workspaceDrawerTabs": [
        {
          "id": "context",
          "title": "Context",
          "icon": "account_tree",
          "placement": "right",
          "clientView": "context"
        }
      ],
      "launcherSearchProviders": [
        {
          "id": "docs",
          "title": "Docs",
          "command": "search-docs"
        }
      ],
      "routes": [
        {
          "id": "home",
          "title": "Workspace Tools",
          "clientView": "home"
        }
      ]
    }
  }
}
```

配置字段：

- `config.schema`: 插件配置的 JSON Schema。插件详情页的「配置」tab 会把它渲染成交互表单，值保存到当前实例的 `plugins[].options`。
- `config.jsonSchema`: `config.schema` 的等价别名。
- `config.uiSchema`: 可选。直接提供配置页内部的 `ConfigUiObjectSchema` 时，会跳过 JSON Schema 自动推断。

Server runtime 字段：

- `plugin.server.roles`: server 入口应该在哪些 runtime 运行。普通工作区插件写 `["workspace"]`；只有设备级、launcher 级或跨 workspace 协调能力才声明 `["manager"]` 或同时声明两个角色。
- `exports["./server"]`: 只提供入口路径，不代表插件自动运行在 manager。需要 manager 时必须显式写 roles。

JSON Schema 自动推断当前支持：

- 根对象的 `properties` 会按路径展开成表单字段。
- `string`、`number`、`integer`、`boolean`、字符串数组会渲染成对应输入控件。
- `enum`、`oneOf` / `anyOf` 中的字符串 `const` 会渲染成下拉选项。
- `format: "textarea"` / `"multiline"` 或 `x-oneworks-ui.control: "textarea"` 会渲染成多行文本。
- 无法映射的对象、数组或复杂类型会使用 JSON 编辑字段兜底。
- `titleI18n`、`descriptionI18n` 或 `i18n.<language>.title/description` 会按当前界面语言选择文案；`zh`、`zh-CN` 与 `zh-Hans` 会按同一中文语系兜底匹配。
- `x-oneworks-ui.icon`、`placeholder`、`control`、`sensitive` 可以补充图标、占位符、控件类型和敏感字段展示。

界面贡献字段：

- `navItems`: 注册左侧导航入口。默认打开 `/ui/plugins/<scope>/<id>`，也可以显式写 `route` 或 `command`。
- `navMoreMenu`: 注册左侧更多菜单项，支持 `command`、`route` 或 `href`。
- `navFooterBefore`: 注册左侧底部「菜单」按钮上方的结构化入口，支持 `command`、`route` 或 `href`；宿主负责布局、active 状态和图标尺寸。
- `chatHeaderActions`: 注册 chat header 右上角 action 按钮，点击后执行当前 plugin scope 下的 `command`。
- `chatHeaderMoreMenu`: 注册 chat header 更多菜单项。
- `routeHeaderActions`: 注册通用路由容器 header 右侧按钮，点击后执行当前 plugin scope 下的 `command`，用 `targetRoute` / `targetRoutes` 限定宿主路由。
- `routeWindowBarActions`: 注册侧栏折叠时 window bar 按钮，适合和 `routeHeaderActions` 成对提供紧凑态入口，同样用 `targetRoute` / `targetRoutes` 限定宿主路由。
- `routeMoreMenuItems`: 扩展当前路由容器的「更多」菜单项，支持 `command`、`route` 或 `href`；菜单项里的 `route` 是点击后的导航目标。
- `routeSidebarContextMenu`: 扩展当前路由侧栏 root / group / item 的右键菜单项，支持 `command`、`route` 或 `href`；菜单项里的 `route` 是点击后的导航目标。
- `routes`: 注册 plugin 页面，路径是 `/ui/plugins/<scope>/<routeId>`；未写 `routeId` 时使用 `id`。
- `workbenchTabs`: 声明可创建的 workbench tab 模板。它们不会在启动后常驻显示。
- `workbenchAddMenu`: 注册下方面板 `+` 菜单项。设置 `tab` 后，点击菜单项会根据对应 `workbenchTabs[].id` 创建一个新的 tab 实例；新 tab 可以关闭。未设置 `tab`、`command`、`route`、`href` 时，会尝试用菜单项自己的 `id` 找同名 tab。
- `workspaceDrawerTabs`: 注册工作区抽屉 tab。当前它会归一到同一套 workbench tab 模型里，`placement` 可以是 `right` 或 `bottom`。
- `launcherSearchProviders`: 注册 launcher 搜索源。桌面 launcher 里使用 server-backed `command`；普通 workspace client 里也可以在前端 `activatePlugin` 中动态注册本地搜索源。
- `toolUsePresentations`: 声明插件工具在聊天中的图标、标题、摘要目标、输入字段和结果格式；宿主统一渲染，不加载插件 JSX 或 HTML。

工具调用展示使用纯声明，适合 MCP plugin 给自己的工具补足业务语义：

```json
{
  "toolUsePresentations": [
    {
      "id": "click",
      "title": "Click",
      "titleI18n": { "en": "Click", "zh-Hans": "点击" },
      "icon": "touch_app",
      "tools": ["click"],
      "target": "element_index",
      "input": {
        "mode": "declared",
        "fields": [
          {
            "path": "element_index",
            "title": "Element",
            "titleI18n": { "en": "Element", "zh-Hans": "元素" },
            "format": "inline"
          }
        ]
      },
      "result": {
        "mode": "declared",
        "fields": [
          { "path": "structuredContent.status", "title": "Status", "format": "inline" }
        ]
      }
    }
  ]
}
```

`tools` 支持工具 base name 和完整 runtime name。`origin` 默认为 `plugin`：base name 只会匹配当前贡献插件 scope 投影出的 OneWorks MCP 工具，避免不同插件都声明 `click` 时互相覆盖；只有明确需要接管外部工具时才写 `origin: "any"`。完整名字优先于 base name，插件自身 scope 匹配优先于 `any`。

`target`、`input.fields[].path` 和 `result.fields[].path` 都是安全点路径，不执行表达式。input 支持 `auto`、`declared`、`hidden`；result 也支持 `declared` 字段，让插件只展示必要结果而不是铺开整个协议 envelope。字段 `format` 支持 `inline`、`text`、`code`、`list`、`chips`、`records`、`json`：`chips` 适合短原子数组，`records` 把对象数组渲染成宿主原生记录行，并可声明 `item.titlePath`、`subtitlePath`、`statusPath`、`metaPath`、`detailPath`。auto 结果仍支持 `auto`、`text`、`code`、`json`、`markdown`。插件只描述语义，折叠交互、错误态、布局、主题和内容转义始终由宿主管理。

launcher 中的插件业务入口必须完全由插件贡献：页面 route 在 `routes[]` 上声明 `surfaces: ["launcher"]`，搜索源在 `launcherSearchProviders[]` 上声明同一 surface，并由插件自己的 `activatePlugin` 通过 `ctx.commands.register(...)` 提供命令结果。结果可以用 `groupId` / `groupTitle`（兼容别名为 `sectionId` / `sectionTitle`）决定 launcher 命令列表中的分组和分组标题。

宿主只负责发现这些结构化贡献、调用 scoped command、按通用分组字段渲染，并在插件没有声明分组时使用通用兜底分组。宿主不能为某个插件复制内置命令、view mode、菜单项、可用性判断、账号或登录 API；插件未启用或未注册对应贡献时，入口应自然消失。

route 级贡献用 `targetRoute` 或 `targetRoutes` 表达“显示在哪个宿主 route container 上”。它们是宿主显示条件，不是点击行为；菜单 / 导航项里的 `route` 仍只表示点击后的跳转目标。不要把 `route` 当成宿主匹配条件，也不要把 `targetRoute` 当成跳转地址。

`targetRoute` / `targetRoutes` 的值支持：

- route key，例如 `plugins`、`plugin-route`、`config`。
- 当前 pathname，例如 `/plugins`、`/plugins/demo`、`/ui/plugins`、`/ui/plugins/demo`。
- 以 `/*` 结尾的路径通配，例如 `/plugins/*` 或 `/ui/plugins/*`。

路径匹配会同时考虑应用内路径和带 client basename 的路径。默认 Web basename 是 `/ui`，所以 `targetRoute: "/plugins/*"` 和 `targetRoute: "/ui/plugins/*"` 都可以匹配插件页面。配置页历史上同时出现过 `settings` / `config` 命名，route key 匹配时二者互为 alias：`targetRoute: "settings"` 可以匹配当前 `config` route，`targetRoute: "config"` 也可以匹配旧的 `settings` route。

route 级 chrome 目前可以扩展四类入口：header action、侧栏折叠态 window bar action、route more menu、route sidebar 入口 / 列表右键菜单。它们会与 route 自己声明的 chrome 合并，不会替换 route-owned action。菜单贡献只提供结构化 item；宿主会用通用 `nav-rail-more-menu` / overlay 结构渲染嵌套菜单、选中态、快捷键、危险态和自定义 item，不要在业务 route 或 plugin 里自己拼菜单 DOM / 样式。

这些能力的可用性取决于宿主 route 是否接入对应 container 能力：header action、window bar action 和 route more menu 由 `useRoutePluginChrome(routeKey)` 统一安装；route sidebar 右键菜单只有在该 route 提供共享 sidebar 数据时才会渲染。sidebar 右键菜单可以由宿主按 root / group / item 动态解析，plugin command 会收到当前 route 和被右键目标的 payload，避免插件读取 DOM 或猜 URL。

route action 状态字段由通用 chrome 统一渲染：`active` 会切换为 `activeIcon` / `activeLabel` / `activeTitle`，`disabled` 会禁用按钮，`danger` 会在 hover/focus 时使用危险色，`shortcut` 会进入 tooltip；菜单型贡献额外支持 `selected`。旧 manifest 里的 `routeMoreMenu` 会被兼容归一到 `routeMoreMenuItems`，新插件只写 `routeMoreMenuItems`。

插件扩展点的原则是：通用布局交互沉淀到 route container / layout 组件；route 层负责业务状态和 slot 内容；plugin 只注册贡献、命令和需要渲染的 view / slot 内容。需要新增通用 chrome 能力时，应扩展宿主结构化 API，而不是让每个 plugin 或 route 复制 header、window bar、右键菜单或 overlay 样式。

`id`、`scope`、命令和贡献注册都在 plugin scope 内隔离。不同 plugin 不能抢占同一个 `scope`；plugin 也不能注册顶层 `/api/*` 路由。

## 前端入口

插件 client 入口会被前端动态加载。新插件优先通过 `package.json` 的 `exports["./client"]` 暴露入口。入口模块导出 `activatePlugin(ctx)`。推荐把 UI 写成 React view，用宿主暴露的 `ctx.react` 和 `view.ui`，避免在插件里拼 DOM 字符串：

```js
function HomeView({ ctx, react, view }) {
  const h = react.createElement
  const { Sender } = view.ui
  const placeholder = view.i18n.resolveText({
    en: 'Type a message',
    'zh-Hans': '输入消息'
  })

  return h(
    'main',
    { className: 'workspace-tools' },
    h('pre', null, JSON.stringify(view.host, null, 2)),
    h(Sender, {
      placeholder,
      onSend(text) {
        console.log('plugin sender submit', text, view.host)
      }
    })
  )
}

export async function activatePlugin(ctx) {
  const style = document.createElement('style')
  style.textContent = '.workspace-tools { padding: 16px; }'
  document.head.appendChild(style)

  const view = ctx.views.register('home', {
    renderNode: view =>
      ctx.react.createElement(HomeView, {
        ctx,
        react: ctx.react,
        view
      })
  })

  const command = ctx.commands.register('snapshot', () => {
    window.dispatchEvent(new CustomEvent('workspace-tools:snapshot'))
    return { ok: true }
  })

  return {
    dispose() {
      view.dispose()
      command.dispose()
      style.remove()
    }
  }
}
```

可用的前端能力：

- `ctx.scope`: 当前 plugin scope。
- `ctx.runtime.endpoint`: 当前 server runtime endpoint。launcher、workspace route、workbench 和 drawer 都通过同一份插件快照获得 endpoint，不要自己探测 server URL。
- `ctx.runtime.invokeChannel(channelId, invocation)`: 调用当前 scope 的 server runtime channel。跨 manager / workspace 或跨 workspace 调用时，在 `invocation.target` 里传目标 role 和 `serverBaseUrl`。
- `ctx.runtime.listEndpoints()`: 获取当前 host 已知的 manager / workspace runtime endpoints；插件需要选择目标 management server 或 workspace server 时使用这个 API，不要自己扫端口或读 launcher 私有缓存。
- `ctx.i18n.getLanguage()`: 读取当前界面语言。前端命令、toast、launcher 本地搜索等不在 view render 内执行的逻辑应在运行时读取它，而不是缓存激活时的语言。
- `ctx.i18n.resolveText(value, fallback)`: 按当前界面语言解析本地化文案。`value` 可以是字符串，也可以是 `{ en, "zh-Hans" }` 这样的语言映射。
- `ctx.react`: 宿主 React 单例的轻量出口，包含 `createElement`、`Fragment`、`useState`、`useEffect`、`useMemo`、`useCallback` 和 `useRef`。无构建插件可以直接用它写 React；有构建插件也应把 React 视为宿主单例，不要 bundle 第二份 React。
- `ctx.views.register(viewId, { renderNode })`: 注册 React view；manifest 里的 `clientView` 会引用这里的 `viewId`。这是新 UI 插件的推荐写法。
- `ctx.views.register(viewId, render)`: 注册兼容 DOM view。只有无 React 需求的简单插件才使用这个路径。
- `ctx.commands.register(commandId, handler)`: 注册前端命令。
- `ctx.commands.execute(commandId, payload)`: 执行当前 scope 的前端命令；如果前端没有注册，会转到 server plugin command。
- `ctx.slots.register(slot, contribution)`: 动态注册 slot 贡献，slot 名包括 `nav.items`、`nav.moreMenu`、`nav.footer.before`、`chat.header.actions`、`chat.header.moreMenu`、`route.header.actions`、`route.windowBar.actions`、`route.moreMenu.items`、`route.sidebar.contextMenu`、`workbench.addMenu`、`workbench.tabs`、`launcher.searchProviders`。动态注册的 route 级贡献也必须遵守同一套语义：`targetRoute` / `targetRoutes` 决定显示在哪个宿主 route，`route` 只表示点击后的跳转目标。
- `ctx.extensionPoints.register({ id, title, description, contributionSchema })`: 注册当前插件暴露给其他插件的扩展点。扩展点完整 id 是 `<scope>/<id>`。
- `ctx.extensionPoints.onAvailable(target, callback)`: 监听扩展点可用事件，`target` 可以是当前 scope 下的 `id`，也可以是跨插件的 `<scope>/<id>`。如果目标点已经存在会立即触发；如果晚于当前插件注册，也会在目标点出现时触发。`callback(point)` 可以返回 disposable 或 Promise，目标扩展点卸载时宿主会自动清理这次贡献。
- `ctx.extensionPoints.has(target)`: 判断扩展点是否存在，仅适合只读判断；需要注册贡献时优先使用 `onAvailable(...)`，避免激活顺序不同导致贡献丢失。
- `ctx.extensionPoints.contribute(target, contribution)`: 向已存在的扩展点贡献结构化能力。`contribution` 必须有稳定 `id`，通常也应提供 `title` / `titleI18n`、`descriptionI18n`、`icon` 和 `command`。
- `ctx.pluginApis.register({ id, title, description, inputSchema, outputSchema, handler })`: 暴露当前插件的纯前端 API，供其他插件在同一个 client runtime 内调用。`handler(input, meta)` 可以返回值或 Promise；`meta` 包含 `callerScope`、`targetScope` 和 `apiId`。
- `ctx.pluginApis.call(target, input, options?)`: 调用其他插件暴露的纯前端 API。所有调用都返回 Promise；如果目标 API 还没注册，Promise 会先等待 API 挂载，再等待 handler 完成。`target` 使用 `<scope>/<id>`，同 scope 调用可只传 `id`。`options.timeoutMs` 可用于需要明确超时的场景。
- `ctx.routes.register({ id, title, viewId })`: 动态注册 `/plugins/<scope>/<id>` 页面。
- `ctx.launcher.registerSearchProvider(provider)`: 在 workspace client 内注册本地 launcher 搜索源。
- `ctx.notifications.show(message)`: 在宿主右下角消息队列里发布界面级消息。宿主会自动注入当前 plugin 来源，卡片会展示插件名、发送时间、标题和 markdown 描述；scope、屏蔽 / 关闭和自定义操作会在 hover / focus 后展示，避免普通消息占用过多视觉密度。
- `ctx.notifications.close(id)`: 关闭一条仍在队列里的消息。
- `ctx.notifications.muteCurrentPlugin()`: 屏蔽当前 plugin 后续发布的界面级消息；用户也可以在消息卡片上执行同样的通用操作。
- `ctx.api.fetch(path, init)`: 只允许访问当前 scope 下的 scoped API，例如 `ctx.api.fetch('echo/foo')` 会请求 `/api/plugins/<scope>/proxy/echo/foo`。
- `ctx.hot.accept(callback)` 和 `ctx.hot.reload()`: 配合 watch / dev server 调试当前 plugin，不需要重启 Electron。

React view 的 `PluginViewContext` 也会提供同一份 runtime bridge：`view.runtime.endpoint` 暴露当前 server runtime endpoint，`view.runtime.invokeChannel(channelId, invocation)` 用于从 route / workbench / drawer / launcher 页面调用当前 scope 的 server runtime channel，`view.runtime.listEndpoints()` 用于读取当前 host 已知的 manager / workspace endpoints。插件页面不要自己探测 server URL，也不要为 launcher 单独做一套通信 shim。

插件需要提示用户时应使用宿主消息队列，不要自己创建 fixed toast、引入第三方通知组件或复制宿主样式。`description` 默认按 markdown 渲染，普通消息默认约 6.5 秒后自动清理，带操作的消息默认约 9.5 秒后自动清理；用户 hover 消息时会暂停自动清理。只有需要明确常驻时才传 `ttlMs: null`。`actions[].onClick` 可以触发插件命令、跳转或更新插件视图状态：

```js
ctx.notifications.show({
  level: 'success',
  title: ctx.i18n.resolveText({
    en: 'Index completed',
    'zh-Hans': '索引完成'
  }),
  description: 'Indexed **24 files**.',
  actions: [
    {
      id: 'open',
      title: 'Open',
      icon: 'open_in_new',
      onClick: async ({ close }) => {
        await ctx.commands.execute('open-result')
        close()
      }
    }
  ]
})
```

插件间扩展点也可以在 manifest 中声明，适合让点位在所有 client entry 激活前就可发现：

```json
{
  "plugin": {
    "contributions": {
      "extensionPoints": [
        {
          "id": "quick-actions",
          "titleI18n": {
            "en": "Quick actions",
            "zh-Hans": "快捷操作"
          },
          "descriptionI18n": {
            "en": "Lets other plugins add actions to this plugin view.",
            "zh-Hans": "允许其他插件向当前插件视图补充操作。"
          },
          "contributionSchema": {
            "type": "object",
            "required": ["id", "title", "command"],
            "additionalProperties": true
          }
        }
      ],
      "extensionContributions": [
        {
          "id": "run-addon",
          "target": "demo/quick-actions",
          "title": "Run add-on action",
          "icon": "add_link",
          "command": "plugin-demo-extension/run-addon"
        }
      ]
    }
  }
}
```

贡献方不要在激活时只做一次 `has(...)` 判断；扩展点可能来自另一个还没激活完成的插件。推荐写法是监听目标扩展点出现，并把这一次贡献的 disposable 返回给宿主：

```js
ctx.extensionPoints.onAvailable(
  'demo/quick-actions',
  point =>
    ctx.extensionPoints.contribute('demo/quick-actions', {
      id: 'run-addon',
      title: 'Run add-on action',
      icon: 'add_link',
      command: `${ctx.scope}/run-addon`,
      extensionPointTitle: point.title
    })
)
```

拥有方 view 通过 `view.extensions.getContributions('quick-actions')` 读取当前扩展点贡献；跨 scope 读取时传 `<scope>/<id>`。如果扩展点不存在会返回空数组。

纯前端插件 API 适合封装不需要 HTTP 边界的插件内部过程调用。调用方只需要 await Promise；运行时会处理“目标插件还没 ready / API 还没 register”的等待：

```js
ctx.pluginApis.register({
  id: 'describe',
  title: 'Describe current plugin state',
  inputSchema: {
    type: 'object',
    additionalProperties: true
  },
  outputSchema: {
    type: 'object',
    required: ['scope'],
    properties: {
      scope: { type: 'string' }
    }
  },
  handler: async (input, meta) => ({
    input,
    callerScope: meta.callerScope,
    scope: ctx.scope
  })
})

const result = await ctx.pluginApis.call('demo/describe', { from: ctx.scope })
```

### React 与热更新边界

- `.oo/plugins.dev/<name>`、显式 `watch: true` 和插件详情页 watch 开关对 manifest、server、README、静态入口，以及 host Vite client source 下普通 TS / 数据 / i18n / model 模块变更提供 plugin 级 reload：文件变化后 server 发送 `plugin.changed`，前端 dispose 当前 scope、重新拉取 plugin 列表并重新 import entry。
- `ctx.hot.reload()` 触发同一套 plugin 级 reload；`ctx.hot.accept(callback)` 用于 reload 前清理或同步状态，不等同于 Vite `import.meta.hot.accept`。
- 本地路径 plugin 的 `exports["./client"].source` 会在开发态走宿主 Vite `/@fs` entry，TSX / JSX 组件和样式模块的 HMR、React Fast Refresh 由宿主 Vite dev server 提供。这一路径仍应复用宿主 React 单例：React 不要被打进插件 bundle，宿主组件继续通过 `view.ui.*` 使用。
- 无构建插件可以直接使用 `ctx.react.createElement` 和 `ctx.react.useState` 等 hooks 写 React view；这种模式没有模块级 Fast Refresh，但能避免 DOM 字符串和手动挂载清理。

## View context、宿主状态与通用组件

React view 的 `renderNode(view)` 会收到 `view` context。兼容 DOM view 的 `render(container, view)` 会收到同一个 `view` 作为第二个参数。宿主会在独立 plugin route、底部 workbench tab 和右侧 drawer tab 渲染时传入当前界面状态：

```js
ctx.views.register('home', {
  renderNode(view) {
    return ctx.react.createElement(HomeView, { ctx, react: ctx.react, view })
  }
})
```

`view.host` 当前包含：

- `language`: 当前界面语言，例如 `zh`、`zh-Hans` 或 `en`。
- `themeMode`: 用户选择的主题来源，值为 `light`、`dark` 或 `system`。
- `resolvedThemeMode`: 实际生效主题，值为 `light` 或 `dark`。
- `isDarkMode`: 当前是否深色模式。
- `surface`: 当前 view 的宿主位置，值为 `route`、`workbench`、`drawer` 或 `launcher`。

语言、主题或宿主位置变化时，React view 会按普通 React 组件更新；DOM view 会重新调用 `render`，并先清理上一轮返回的 `dispose()`。插件如果在 DOM view 内注册事件、timer、MutationObserver 或宿主组件，也必须在 `dispose()` 里清理。

`view.i18n` 当前包含：

- `language`: 当前界面语言，与 `view.host.language` 一致。
- `resolveText(value, fallback)`: 按当前界面语言解析插件自带文案。React view 内的按钮、placeholder、菜单项和状态文案应使用这个方法，不要用 `view.host.language.startsWith('zh')` 手写分支。

`view.ui` 是宿主暴露给 React view 的声明式组件集合，组件名和命令式 component id 一一对应：

- `view.ui.Icon`
- `view.ui.Button`
- `view.ui.ActionBar`
- `view.ui.CodeEditor`
- `view.ui.Input`
- `view.ui.InteractionList`
- `view.ui.List`
- `view.ui.NativeTabs`
- `view.ui.SearchInput`
- `view.ui.Select`
- `view.ui.Segmented`
- `view.ui.Switch`
- `view.ui.Sender`
- `view.ui.ProjectFileTree`
- `view.ui.OverlayDropdown`
- `view.ui.OverlayMenu`
- `view.ui.OverlaySearchMenu`
- `view.ui.OverlaySearchRow`
- `view.ui.OverlaySegmented`
- `view.ui.OverlaySelectLabel`
- `view.ui.OverlayTree`

React view 应优先使用 `view.ui.*`。`view.components.render(component, container, props)` 是 DOM view 的兼容命令式 API，可以把宿主内置组件直接渲染到插件自己的 DOM 挂载点，返回 `{ dispose() }`。

`view.ui.*` 和 `view.components.render(...)` 使用同一套 props：

- `button`: 渲染宿主按钮。常用 props：`label`、`icon`、`type: "default" | "primary" | "text" | "link" | "dashed"`、`size: "small" | "middle" | "large"`、`danger`、`disabled`、`title`、`shape`、`onClick()`。
- `actionBar`: 渲染一组宿主按钮。常用 props：`items: [{ key, label, icon, type, danger, disabled, onClick }]`、`size`、`align`、`wrap`。页面底部、编辑器浮层和批量操作优先用 action bar，不要自己拼按钮间距。
- `codeEditor`: 渲染宿主代码编辑器。常用 props：`value`、`language`、`readOnly`、`height`、`minimap`、`folding`、`onChange(value)`。插件需要 JSON、Markdown 或配置预览时走这个入口，不要在插件里单独引入 Monaco。
- `icon`: 渲染宿主图标。常用 props：`name`、`ariaLabel`、`title`、`size: "small" | "middle" | "large" | number`、`tone: "default" | "muted" | "primary" | "success" | "warning" | "danger"`。
- `interactionList`: 渲染平台交互列表，内置搜索、右键菜单、行 actions、选中态、嵌套树、头像 / 图标槽和状态角标。常用 props：`items`、`mode: "grouped" | "launcher" | "resource"`、`search`、`actions(item)`、`actionDisplay: "menu" | "inline"`、`iconSize`、`activeKey`、`emptyText`、`onSelect(item)`。launcher 内打开的插件页面默认按 `mode: "launcher"`、20px 图标槽、菜单式 actions 和 title hover 描述渲染；插件只有业务确实需要不同密度时才显式覆盖 mode 或 action density，不要在插件包里重写 launcher 列表 CSS。普通资源列表用 `resource`，分组入口或无分割线列表用 `grouped`。
- `input`: 渲染宿主输入框。常用 props：`value`、`placeholder`、`ariaLabel`、`type: "text" | "password" | "textarea"`、`rows`、`allowClear`、`size`、`disabled`、`onChange(value)`、`onCommit(value)`。`onCommit` 会在 blur 或回车时触发，适合插件把输入提交为配置。
- `list`: 渲染简单宿主列表，只适合没有搜索、右键菜单、嵌套或标准行 action 的轻量内容；需要资源列表或 launcher 页面时优先用 `interactionList`。
- `nativeTabs`: 渲染宿主原生 tab。常用 props：`items: [{ key, label, icon }]`、`activeKey`、`actions`、`iconSize`、`onChange(key)`。
- `overlayDropdown`: 渲染真实的宿主 dropdown 触发器和浮层。常用 props：`label`、`icon`、`placement`、`open`、`defaultOpen`、`closeOnSelect`、`onOpenChange(open)`、`content`。`content` 支持 `{ type: "menu" | "searchMenu" | "tree", props }`，对应 props 与下面的 `overlayMenu` / `overlaySearchMenu` / `overlayTree` 相同。需要真实弹出式 overlay 时优先用它，不要把 overlay primitive 直接平铺在页面里。
- `overlayMenu`: 渲染宿主 overlay 菜单 primitive。常用 props：`items`、`selectedKeys`、`defaultOpenKeys`、`openKeys`、`submenuPlacement: "left" | "right"`、`submenuTrigger: "click" | "hover"`、`surface`、`width`、`onItemClick(item)`、`onOpenKeysChange(keys)`。`items` 支持 action、`{ type: "divider" }`、`{ type: "section" }`，action 支持 `icon`、`description`、`shortcut`、`selected`、`disabled`、`confirmLabel`、`tone: "danger"` 和 `children`。
- `overlaySearchMenu`: 渲染带搜索行的宿主 overlay 菜单。常用 props：`items`、`searchValue`、`placeholder`、`emptyLabel`、`selectedKeys`、`searchPlacement: "top" | "bottom"`、`onSearchChange(value)`、`onItemClick(item)`。
- `overlaySearchRow`: 渲染宿主 overlay 搜索行。常用 props：`value`、`placeholder`、`clearLabel`、`autoFocus`、`onChange(value)`、`onClear()`。
- `overlaySegmented`: 渲染宿主 overlay 分段控件。常用 props：`ariaLabel`、`value`、`options: [{ value, label, icon }]`、`onChange(value)`。
- `overlaySelectLabel`: 渲染宿主 overlay select label。常用 props：`icon`、`label`、`meta`。
- `overlayTree`: 渲染宿主 overlay 树。常用 props：`nodes`、`collapsedKeys`、`defaultCollapsedKeys`、`expandAll`、`surface`、`onNodeToggle(key)`、`onNodeActivate(node)`。`surface: true` 会给树套用宿主 overlay panel 外观。`nodes` 支持 `key`、`label`、`meta`、`icon`、`collapsedIcon`、`expandedIcon`、`selected`、`disabled`、`confirmLabel`、`trailingIcon` 和 `children`。
- `searchInput`: 渲染平台列表搜索条，统一 18px 搜索图标、6px icon/text gap、输入高度、focus 和清除按钮。独立搜索条用它；绑定列表搜索时优先用 `interactionList.search`，不要自己拼 search icon + AntD input。
- `select`: 渲染宿主选择控件。常用 props：`options`、`value`、`mode`、`placeholder`、`disabled`、`onChange(value)`。
- `segmented`: 渲染宿主分段选择。常用 props：`value`、`options: [{ value, label, icon, disabled }]`、`iconOnly`、`block`、`ariaLabel`、`size`、`disabled`、`onChange(value)`。
- `sender`: 渲染宿主 sender 输入组件，默认套用 chat sender surface，并包含模型、权限、adapter / account 和 status bar 编排。样式只能通过结构化选项控制：`surface: "chat" | "plain"`、`density: "default" | "compact"`。常用 props：`placeholder`、`initialContent`、`defaultAdapter`、`defaultModel`、`submitLabel`、`autoFocus`、`adapterLocked`、`modelUnavailable`、`showHeader`、`showStatusBar`、`hideReferenceActions`、`hideSelectionControls`、`hideSubmitAction`、`submitLoading`、`stopLoading`、`onInputChange(value)`、`onSend(text, mode)`、`onSendContent(content, mode)`、`onCancel()`。
- `switch`: 渲染宿主开关。常用 props：`checked`、`checkedLabel`、`uncheckedLabel`、`size: "small" | "default"`、`disabled`、`onChange(checked)`。
- `projectFileTree`: 渲染项目目录树。常用 props：`sessionId`、`activePath`、`selectedPaths`、`selectionMode: "none" | "multiple"`、`selectableTypes: "all" | "files"`、`showContextMenu`、`showLoadingState`、`refreshKey`、`onOpenFile(path)`、`onReferenceNodes(nodes)`、`onSelectionChange(selection)`。

宿主组件仍然运行在 One Works 前端里，会自动跟随语言、主题、布局、权限和 workspace API。插件不要复制图标、按钮、输入框、分段选择、开关、sender、目录树、菜单、浮层、模型选择器或文件选择器的 DOM/CSS；现有组件不够时应优先扩展 `view.ui` / `view.components` 的结构化 API。

### 宿主组件用法示例

React view 直接从 `view.ui` 取宿主组件：

```js
function HomeView({ react, view }) {
  const h = react.createElement
  const { OverlayDropdown, Sender } = view.ui
  const senderPlaceholder = view.i18n.resolveText({
    en: 'Type a message',
    'zh-Hans': '输入消息'
  })
  const commandsLabel = view.i18n.resolveText({
    en: 'Commands',
    'zh-Hans': '命令'
  })
  const searchPlaceholder = view.i18n.resolveText({
    en: 'Search commands',
    'zh-Hans': '搜索命令'
  })

  return h(
    'main',
    { className: 'workspace-tools' },
    h(Sender, {
      surface: 'chat',
      density: 'default',
      showHeader: true,
      showStatusBar: true,
      placeholder: senderPlaceholder,
      initialContent: '',
      defaultAdapter: 'default',
      defaultModel: 'model-key',
      onSend(text, mode) {
        console.log('sender submit', { text, mode })
      }
    }),
    h(OverlayDropdown, {
      label: commandsLabel,
      icon: 'terminal',
      content: {
        type: 'searchMenu',
        props: {
          placeholder: searchPlaceholder,
          items: [
            {
              key: 'open',
              label: 'Open command',
              icon: 'terminal',
              shortcut: 'O'
            },
            {
              key: 'view',
              label: 'View mode',
              icon: 'visibility',
              children: [
                {
                  key: 'view-list',
                  label: 'List',
                  icon: 'view_list',
                  selected: true
                },
                { key: 'view-tree', label: 'Tree', icon: 'account_tree' }
              ]
            }
          ],
          onItemClick(item) {
            console.log('command selected', item.key)
          }
        }
      }
    })
  )
}

ctx.views.register('home', {
  renderNode(view) {
    return ctx.react.createElement(HomeView, { react: ctx.react, view })
  }
})
```

如果不是弹出式浮层，而是要在当前插件页面里平铺一个宿主 overlay surface，可以直接渲染 primitive，并让宿主套上 panel 外观：

```js
function TreePanel({ react, view }) {
  const h = react.createElement
  const { OverlayTree } = view.ui

  return h(OverlayTree, {
    surface: true,
    nodes: [
      {
        key: 'workspace',
        label: 'Workspace',
        collapsedIcon: 'folder',
        expandedIcon: 'folder_open',
        children: [{ key: 'readme', label: 'README.md', icon: 'article' }]
      }
    ],
    onNodeActivate(node) {
      console.log('tree node', node.key)
    }
  })
}
```

兼容 DOM view 仍然可以使用 `view.components.render(...)` 命令式挂载宿主组件。这个路径需要插件自己准备 DOM 挂载点，并在 `dispose()` 里清理：

```js
ctx.views.register('home-dom', (container, view) => {
  container.innerHTML =
    '<main class="workspace-tools"><div data-sender></div></main>'

  const sender = view.components.render(
    'sender',
    container.querySelector('[data-sender]'),
    {
      placeholder: 'Type a message',
      onSend(text) {
        console.log('sender submit', text)
      }
    }
  )

  return {
    dispose() {
      sender.dispose()
    }
  }
})
```

## 可用 CSS 变量

插件 CSS 应优先使用宿主 token，而不是硬编码新主题。常用稳定变量：

- 文本与背景：`--ant-color-text`、`--ant-color-text-secondary`、`--ant-color-bg-container`、`--ant-color-bg-layout`、`--bg-color`、`--sub-bg-color`、`--text-color`、`--sub-text-color`。
- 边框与填充：`--ant-color-border`、`--ant-color-border-secondary`、`--ant-color-fill-quaternary`、`--border-color`、`--sub-border-color`。
- 品牌与状态：`--primary-color`、`--primary-soft-bg`、`--primary-text-color`、`--success-color`、`--warning-color`、`--danger-color`。
- Chrome 尺寸：`--app-chrome-icon-size`、`--app-chrome-action-gap`、`--route-container-header-overlay-height`、`--route-container-header-padding-inline`、`--route-container-header-padding-block`。

推荐写法：

```css
.workspace-tools {
  color: var(--ant-color-text, var(--text-color));
  background: transparent;
}

.workspace-tools__output {
  border: 1px solid var(--ant-color-border-secondary, var(--border-color));
  background: var(--ant-color-fill-quaternary, var(--sub-bg-color));
}
```
