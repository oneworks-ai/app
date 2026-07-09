# Server 入口、插件商店与调试

## Server 入口与 scoped API

Server 入口会在 One Works server 进程里加载，入口模块同样导出 `activatePlugin(ctx)`。OneWorks 有两类 server runtime：

- `manager`: 本机管理 server，只负责设备级、账号级、launcher 级和跨 workspace 协调能力。
- `workspace`: 具体工作区 server；一台设备上可以同时存在多个 workspace server。

新插件优先通过 `package.json` exports 约定声明入口：

```json
{
  "type": "module",
  "exports": {
    "./server": {
      "source": "./server/src/index.ts",
      "default": "./server/dist/index.js"
    }
  }
}
```

开启 plugin watch 时，宿主会优先加载 `./server.source`，可以直接写 `.ts` / `.tsx` / `.mts` / `.cts`，由 server 侧 esbuild register 转译。关闭 watch 或发布态会加载 `./server.default`，因此发布 / 提交前仍应产出 JS。

有 server 入口的插件必须声明运行层级。`exports["./server"]` 能补 server entry，但不会替插件选择 manager 或 workspace；如果 manifest 没写 `plugin.server.roles`，宿主会拒绝注册这个 server 入口，并在插件 diagnostics 中暴露错误。需要 manager 侧能力时，必须显式 opt-in：

```json
{
  "plugin": {
    "server": {
      "roles": ["workspace"]
    }
  }
}
```

可选值是 `workspace` 和 `manager`。除非插件确实需要管理整台设备、launcher 或跨 workspace 协调，否则不要声明 `manager`；普通文件、项目、工作区 UI、scoped API 和本地服务都应该留在 `workspace`。

`registerApi` 是插件侧的 scoped route 注册工具。它不会让插件抢占宿主顶层 `/api/*`，而是把所有 HTTP API 固定挂在：

```text
/api/plugins/<scope>/proxy/<apiId>/*
```

前端插件通过 `ctx.api.fetch("apiId/path")` 调用，同一个 plugin scope 下自动带上隔离边界。

最小 server 入口示例：

```js
export function activatePlugin(ctx) {
  ctx.registerCommand('snapshot', payload => ({
    ok: true,
    scope: ctx.scope,
    received: payload
  }))

  ctx.registerApi('echo', {
    title: {
      en: 'Echo API',
      'zh-Hans': '回显 API'
    },
    description: {
      en:
        'Returns request method, scoped path, query string, and plugin scope.',
      'zh-Hans': '返回请求方法、作用域路径、查询字符串和插件 scope。'
    },
    inputSchema: {
      type: 'object',
      additionalProperties: true
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'method', 'path', 'query'],
      properties: {
        ok: { type: 'boolean' },
        method: { type: 'string' },
        path: { type: 'string' },
        query: { type: 'string' }
      }
    },
    headerSchema: {
      type: 'object',
      properties: {
        'content-type': { type: 'string' }
      },
      additionalProperties: true
    },
    handler: request => ({
      headers: {
        'content-type': 'application/json; charset=utf-8'
      },
      body: {
        ok: true,
        method: request.method,
        path: request.path,
        query: request.query
      }
    })
  })

  ctx.dispose(() => {
    ctx.logger.info({ scope: ctx.scope }, 'plugin disposed')
  })
}
```

`title`、`description`、`inputSchema`、`outputSchema` 和 `headerSchema` 是 API contract 文档的一部分，会随 `/api/plugins` 返回并展示在插件详情页。旧插件缺少这些字段仍会加载，但会产生 `plugin_api_metadata_missing` 诊断；新插件必须补齐。`desc` 可作为 `description` 的输入别名，运行时会统一序列化为 `description`。

如果需要在一个 API 下放多个子路由，直接在 `handler` 里按 `request.method` 和 `request.path` 分发：

```ts
const json = (body: unknown, status = 200) => ({
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8'
  },
  body
})

export function activatePlugin(ctx) {
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

对应前端调用：

```js
const response = await ctx.api.fetch('notes/create', {
  method: 'POST',
  body: JSON.stringify({ title: 'Draft' })
})
const data = await response.json()
```

`handler` 收到的 request 包含 `method`、`path`、`query`、`headers`、`body`。返回值包含可选的 `status`、`headers`、`body`。`path` 是去掉 `<apiId>` 后的相对路径，例如请求 `notes/create` 时，`apiId` 是 `notes`，`request.path` 是 `create`。

Server 侧能力：

- `ctx.workspaceFolder`: 当前 workspace 路径。
- `ctx.projectHome`: 当前项目运行态目录。
- `ctx.pluginRoot`: 当前 plugin 根目录。
- `ctx.runtime.endpoint`: 当前 runtime endpoint，包含 `role`、`serverBaseUrl`、`workspaceId`、`workspaceFolder`、`startedAt` 等识别信息。
- `ctx.runtime.role`: 当前入口正在 `manager` 还是 `workspace` runtime 中运行。
- `ctx.runtime.registerChannel(channelId, handler)`: 注册当前 plugin scope 下的 runtime 通信通道。
- `ctx.runtime.invokeChannel(channelId, invocation)`: 调用同 scope 下的 runtime 通道；可通过 `invocation.target` 指向另一个 runtime endpoint。
- `ctx.registerCommand(commandId, handler)`: 注册 scoped command，前端可通过 `ctx.commands.execute` 或 `/api/plugins/<scope>/commands/<commandId>` 调用。
- `ctx.registerApi(apiId, options)`: 注册 scoped API，路径固定在 `/api/plugins/<scope>/proxy/<apiId>/*`。
- `ctx.registerLocalService(serviceId, start)`: 注册跟随 plugin 生命周期的本地服务。
- `ctx.dispose(callback)`: plugin reload 或 server 关闭时清理资源。

management server 会通过 `/api/plugins/runtime/endpoints` 暴露当前 manager endpoint 和 launcher 已知的 workspace endpoints。workspace client 会从 launcher 连接缓存里读取当前 workspace 对应的 management server 地址；这个缓存不区分本地 launcher 和 Relay 连接来源。

runtime channel 用于同一个插件在 manager 和 workspace runtime 之间传递结构化消息，不替代 scoped HTTP API。manager 调 workspace 时可以使用 `target.workspaceId`，由 manager 按 launcher 记录解析到真实 workspace server；跨 workspace 或 workspace 主动调远端时仍应显式带 `target.serverBaseUrl`，避免因为一台设备上有多个 workspace server 而误发：

```ts
export function activatePlugin(ctx) {
  ctx.runtime.registerChannel('ping-runtime', request => ({
    from: ctx.runtime.role,
    source: request.source.role,
    payload: request.payload
  }))

  if (ctx.runtime.role === 'workspace') {
    void ctx.runtime.invokeChannel('ping-runtime', {
      payload: { ok: true },
      target: {
        role: 'manager',
        serverBaseUrl: 'http://127.0.0.1:5203'
      }
    })
  }
}
```

channel handler 收到 `{ channelId, payload, source, target }`；返回值会作为调用方的 Promise 结果。目标 runtime 没有注册对应 channel 时会返回明确错误。

`registerApi` 可以直接提供 `handler`，也可以代理到 plugin 自己启动的 loopback HTTP 服务。代理目标只允许 loopback HTTP(S)，避免 plugin 抢占宿主顶层 API scope。

如果插件需要完整 Express / Hono / Fastify 这类 router，不要在宿主里注册顶层 route。推荐用 `ctx.registerLocalService(serviceId, start)` 启动一个仅监听 `127.0.0.1` 的本地服务，再用 `ctx.registerApi(apiId, { proxy: { target } })` 把 scoped API 转发过去。这样 plugin reload 时服务会跟随生命周期清理，外部也只能通过 `/api/plugins/<scope>/proxy/<apiId>/*` 访问。

## 插件市场与调试

Web UI 左侧有「插件市场」入口，路径是 `/ui/plugins`。这里展示当前解析到的 plugin、scope、来源路径、诊断信息和 watch 开关。点击单个 plugin 会进入 `/ui/plugins/<scope>` 详情页，详情页会展示：

- plugin 根目录、package / request id、client entry、server entry 和 dev entry。
- manifest 声明的贡献项。
- runtime 注册的 slot、route、view 和 launcher provider。
- plugin 自带 `README.md`，以及 README 中相对资源。
- manifest 声明的配置 schema；如果存在 `config.schema` / `config.jsonSchema`，配置 tab 会渲染为可编辑表单并保存到当前实例的 `plugins[].options`。
- 当前 plugin 的诊断信息。

Watch 模式可以在插件市场或详情页单独打开 / 关闭。打开后，server 会监听该 plugin 根目录的文件变化，忽略 `.git`、`node_modules` 和 `.DS_Store`，然后通过 websocket 的 `channel=plugin` 发送 `plugin.changed` 事件。前端收到后会重新加载 plugin 列表并重新 import 对应 entry，不需要重启 Electron，也不需要手动硬刷新整个页面。

本地路径 plugin 在 watch 开启或位于 `.oo/plugins.dev/*` 时，前端开发态会优先使用 `exports["./client"].source` 生成的宿主 Vite `/ui/@fs/...` entry；否则从 `/api/plugins/<scope>/client/<entry>` 加载发布态静态 JS。新插件不要配置 `plugin.client.devServer`；HMR、TS / TSX 转译、source map 和 React Fast Refresh 都由宿主 Vite dev server 提供。

当前仓库自带一个可直接加载的 demo package，位置是 `packages/plugins/demo/`，并通过根目录 `.oo.config.json` 的 `plugins` 声明显式启用。它演示了左侧入口、菜单项、chat header action、点击 `+` 后创建 workbench tab、右侧 workspace drawer tab、launcher 搜索、server command 和 scoped API。
