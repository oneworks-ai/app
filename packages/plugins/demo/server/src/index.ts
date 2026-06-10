const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value)

const parseBody = body => {
  if (body == null || body.length === 0) return null
  const raw = body.toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const json = body => ({
  headers: {
    'content-type': 'application/json; charset=utf-8'
  },
  body
})

const echoApiInputSchema = {
  type: 'object',
  description: 'Optional JSON body echoed by the demo scoped API.',
  additionalProperties: true
}

const echoApiOutputSchema = {
  type: 'object',
  required: ['ok', 'message', 'scope', 'method', 'path', 'query', 'body', 'at'],
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    scope: { type: 'string' },
    method: { type: 'string' },
    path: { type: 'string' },
    query: { type: 'string' },
    body: {},
    at: { type: 'string', format: 'date-time' }
  }
}

const echoApiHeaderSchema = {
  type: 'object',
  properties: {
    'content-type': {
      type: 'string',
      description: 'Use application/json when sending a JSON request body.'
    }
  },
  additionalProperties: true
}

export function activatePlugin(ctx) {
  ctx.logger.info({ scope: ctx.scope }, '[plugin-demo] activated')

  ctx.registerCommand('server-ping', payload => ({
    ok: true,
    message: 'Hello from the Plugin Demo server command.',
    scope: ctx.scope,
    pluginRoot: ctx.pluginRoot,
    workspaceFolder: ctx.workspaceFolder,
    received: payload,
    at: new Date().toISOString()
  }))

  ctx.registerCommand('launcher.search', payload => {
    const query = isRecord(payload) && typeof payload.query === 'string' ? payload.query.trim().toLowerCase() : ''
    const items = [
      {
        id: 'open-demo',
        title: 'Open Plugin Demo',
        description: 'Launcher result registered by @oneworks/plugin-demo',
        icon: 'layers',
        badge: 'plugin',
        keywords: ['plugin', 'demo', 'local']
      },
      {
        id: 'server-ping',
        title: 'Plugin Demo server ping',
        description: 'Invoke a plugin server command from launcher search.',
        icon: 'terminal',
        badge: 'plugin',
        keywords: ['plugin', 'server', 'ping']
      }
    ]

    return query === ''
      ? items
      : items.filter(item =>
        [item.title, item.description, ...item.keywords].some(value => value.toLowerCase().includes(query))
      )
  })

  ctx.registerApi('echo', {
    title: {
      en: 'Echo API',
      'zh-Hans': '回显 API'
    },
    description: {
      en: 'Returns request metadata, parsed body, plugin scope, and timestamp for scoped API testing.',
      'zh-Hans': '返回请求元数据、解析后的 body、插件 scope 和时间戳，用于测试作用域 API。'
    },
    inputSchema: echoApiInputSchema,
    outputSchema: echoApiOutputSchema,
    headerSchema: echoApiHeaderSchema,
    handler: request =>
      json({
        ok: true,
        message: 'Hello from the Plugin Demo scoped API.',
        scope: ctx.scope,
        method: request.method,
        path: request.path,
        query: request.query,
        body: parseBody(request.body),
        at: new Date().toISOString()
      })
  })

  ctx.registerLocalService('heartbeat', () => {
    const timer = setInterval(() => {
      ctx.logger.info({ scope: ctx.scope }, '[plugin-demo] heartbeat')
    }, 60_000)
    return {
      dispose() {
        clearInterval(timer)
      }
    }
  })

  ctx.dispose(() => {
    ctx.logger.info({ scope: ctx.scope }, '[plugin-demo] disposed')
  })
}
