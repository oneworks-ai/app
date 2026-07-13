/* eslint-disable max-lines -- plugin route keeps scoped asset, command, watch, and proxy endpoints together. */
import { Buffer } from 'node:buffer'
import path from 'node:path'

import Router from '@koa/router'
import type {
  PluginRuntimeChannelInvocation,
  PluginRuntimeChannelResponse,
  PluginRuntimeEndpoint
} from '@oneworks/types'

import { getPluginManager } from '#~/services/plugins/index.js'
import { setPluginMarketplaceSelection } from '#~/services/plugins/marketplace-selection.js'
import { syncPluginMarketplaceSelection } from '#~/services/plugins/marketplace-sync.js'
import { resolvePluginMarketplaceVersions } from '#~/services/plugins/marketplace-version-resolver.js'
import { listPluginMarketplaceCatalog } from '#~/services/plugins/marketplace.js'
import { listNativeHostPluginAssets, listNativeHostPlugins } from '#~/services/plugins/native-host.js'
import { normalizeRuntimeEndpoint, readProxyHandlerBody } from '#~/services/plugins/runtime.js'
import { HttpError, badRequest, notFound } from '#~/utils/http.js'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

const toAssetPath = (value: unknown) => typeof value === 'string' ? value : ''

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getBodyBuffer = async (ctx: Router.RouterContext) => {
  const request = ctx.request as typeof ctx.request & { rawBody?: string }
  if (typeof request.rawBody === 'string') {
    return Buffer.from(request.rawBody)
  }
  if (Buffer.isBuffer(request.body)) {
    return request.body
  }
  if (typeof request.body === 'string') {
    return Buffer.from(request.body)
  }
  if (request.body == null) {
    return Buffer.alloc(0)
  }
  return Buffer.from(JSON.stringify(request.body))
}

const normalizeRuntimeChannelBody = (body: unknown): {
  invocation: PluginRuntimeChannelInvocation
  source?: PluginRuntimeEndpoint
} => {
  if (!isRecord(body)) return { invocation: {} }
  return {
    invocation: {
      ...('payload' in body ? { payload: body.payload } : {}),
      ...(isRecord(body.target) ? { target: body.target } : {})
    },
    source: normalizeRuntimeEndpoint(body.source)
  }
}

const setProxyHeaders = (
  ctx: Router.RouterContext,
  headers: Record<string, string | string[] | undefined> | undefined
) => {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value == null || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue
    ctx.set(key, value)
  }
}

const contentTypeForPath = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'text/javascript'
    case '.css':
      return 'text/css'
    case '.json':
      return 'application/json'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.avif':
      return 'image/avif'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.html':
      return 'text/html'
    default:
      return 'application/octet-stream'
  }
}

const normalizeRouteError = (error: unknown) => {
  if (error instanceof HttpError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('not registered')) {
    return notFound(message, undefined, 'plugin_not_found')
  }
  if (
    message.startsWith('Invalid plugin') ||
    message.startsWith('Invalid launcher') ||
    message.startsWith('Plugin runtime channel') ||
    (message.includes('README.md') && message.includes('too large')) ||
    message.includes('must stay within the registered API scope')
  ) {
    return badRequest(message, undefined, 'invalid_plugin_request')
  }
  return error
}

export function pluginsRouter(): Router {
  const router = new Router()

  router.get('/', async (ctx) => {
    const manager = getPluginManager()
    await manager.load()
    ctx.body = manager.snapshot()
  })

  router.get('/runtime', async (ctx) => {
    const manager = getPluginManager()
    await manager.load()
    ctx.body = {
      runtime: manager.getRuntimeEndpoint()
    }
  })

  router.get('/runtime/endpoints', async (ctx) => {
    const manager = getPluginManager()
    await manager.load()
    ctx.body = {
      endpoints: await manager.listRuntimeEndpoints()
    }
  })

  router.get('/native', async (ctx) => {
    ctx.body = await listNativeHostPlugins()
  })

  router.get('/native/:id/assets', async (ctx) => {
    const id = String(ctx.params.id ?? '')
    const groups = await listNativeHostPluginAssets(id)
    if (groups == null) throw notFound('Native plugin not found.', undefined, 'native_plugin_not_found')
    ctx.body = { groups, id }
  })

  router.get('/marketplace/catalog', async (ctx) => {
    ctx.body = await listPluginMarketplaceCatalog()
  })

  router.post('/marketplace/versions', async (ctx) => {
    const body = ctx.request.body as { generation?: unknown; items?: unknown }
    if (
      typeof body?.generation !== 'string' || body.generation.trim() === '' || body.generation.length > 128 ||
      !Array.isArray(body?.items) || body.items.length > 50 || body.items.some(item => (
        item == null || typeof item !== 'object' ||
        typeof (item as { marketplace?: unknown }).marketplace !== 'string' ||
        (item as { marketplace: string }).marketplace.trim() === '' ||
        (item as { marketplace: string }).marketplace.length > 256 ||
        typeof (item as { plugin?: unknown }).plugin !== 'string' ||
        (item as { plugin: string }).plugin.trim() === '' ||
        (item as { plugin: string }).plugin.length > 256
      ))
    ) {
      throw badRequest(
        '"generation" and at most 50 marketplace/plugin pairs are required.',
        undefined,
        'invalid_plugin_versions_request'
      )
    }
    const result = await resolvePluginMarketplaceVersions(
      body.generation,
      body.items as Array<{ marketplace: string; plugin: string }>
    )
    if (!result.found) {
      throw new HttpError(
        409,
        'plugin_version_generation_expired',
        'Plugin catalog changed before versions were resolved.'
      )
    }
    if (result.retryable.length > 0) {
      throw new HttpError(
        503,
        'plugin_version_lookup_retryable',
        'Some plugin versions could not be resolved yet.',
        { retryable: result.retryable },
        { expose: true }
      )
    }
    ctx.body = { versions: result.versions }
  })

  router.post('/marketplace/plugins/:marketplace/:plugin/sync', async (ctx) => {
    const body = ctx.request.body as { enabled?: unknown }
    if (typeof body?.enabled !== 'boolean') {
      throw badRequest('"enabled" must be a boolean.', undefined, 'invalid_plugin_marketplace_request')
    }
    const results = await syncPluginMarketplaceSelection({
      enabled: body.enabled,
      marketplace: String(ctx.params.marketplace ?? ''),
      plugin: String(ctx.params.plugin ?? '')
    })
    await getPluginManager().reload()
    ctx.body = { results }
  })

  router.post('/marketplace/plugins/:marketplace/:plugin/selection', async (ctx) => {
    const body = ctx.request.body as { enabled?: unknown; target?: unknown }
    if (typeof body?.enabled !== 'boolean' || (body.target !== 'global' && body.target !== 'project')) {
      throw badRequest(
        '"enabled" must be a boolean and "target" must be global or project.',
        undefined,
        'invalid_plugin_marketplace_selection_request'
      )
    }
    const results = await setPluginMarketplaceSelection({
      enabled: body.enabled,
      marketplace: String(ctx.params.marketplace ?? ''),
      plugin: String(ctx.params.plugin ?? ''),
      target: body.target
    })
    await getPluginManager().reload()
    ctx.body = { results }
  })

  router.post('/launcher/search', async (ctx) => {
    const body = ctx.request.body as { query?: unknown }
    const query = typeof body?.query === 'string' ? body.query : ''
    ctx.body = await getPluginManager().searchLauncher(query)
  })

  router.post('/launcher/results/:resultId/invoke', async (ctx) => {
    try {
      ctx.body = await getPluginManager().invokeLauncherResult(String(ctx.params.resultId ?? ''))
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.get('/:scope/readme', async (ctx) => {
    try {
      const scope = String(ctx.params.scope ?? '')
      const readmes = await getPluginManager().readReadmes(scope)
      ctx.body = {
        scope,
        readme: readmes[0] ?? null,
        readmes
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.get('/:scope/readme/assets/:assetPath(.*)', async (ctx) => {
    const asset = await getPluginManager().resolveReadmeAsset(
      String(ctx.params.scope ?? ''),
      toAssetPath(ctx.params.assetPath)
    )
    if (asset == null) {
      throw notFound('Plugin README asset not found', undefined, 'plugin_asset_not_found')
    }

    ctx.state.skipApiEnvelope = true
    ctx.type = contentTypeForPath(asset.filePath)
    ctx.length = asset.size
    ctx.set('Cache-Control', 'private, no-cache')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.body = asset.stream
  })

  router.get('/:scope/assets', async (ctx) => {
    try {
      const scope = String(ctx.params.scope ?? '')
      ctx.body = {
        scope,
        groups: await getPluginManager().listDetailAssets(scope)
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.get('/:scope/watch', async (ctx) => {
    try {
      const scope = String(ctx.params.scope ?? '')
      const manager = getPluginManager()
      await manager.load()
      const record = manager.getRecord(scope)
      if (record == null) {
        throw notFound(`Plugin scope "${scope}" is not registered.`, undefined, 'plugin_not_found')
      }
      ctx.body = {
        scope,
        watch: record.instance.watch ?? { enabled: false }
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.post('/:scope/watch', async (ctx) => {
    try {
      const body = ctx.request.body as { enabled?: unknown }
      const enabled = typeof body?.enabled === 'boolean' ? body.enabled : true
      const scope = String(ctx.params.scope ?? '')
      ctx.body = {
        scope,
        watch: await getPluginManager().setWatch(scope, enabled)
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.delete('/:scope/watch', async (ctx) => {
    try {
      const scope = String(ctx.params.scope ?? '')
      ctx.body = {
        scope,
        watch: await getPluginManager().setWatch(scope, false)
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.post('/:scope/enabled', async (ctx) => {
    try {
      const body = ctx.request.body as { enabled?: unknown; target?: unknown }
      const enabled = typeof body?.enabled === 'boolean' ? body.enabled : true
      const target = body?.target === 'global' ? 'global' : 'workspace'
      const scope = String(ctx.params.scope ?? '')
      ctx.body = {
        scope,
        state: await getPluginManager().setEnabled(scope, enabled, target)
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.patch('/:scope/options', async (ctx) => {
    try {
      const body = ctx.request.body as { options?: unknown; target?: unknown }
      if (body?.options != null && !isRecord(body.options)) {
        throw badRequest('Plugin options must be an object.', undefined, 'invalid_plugin_options')
      }
      const options = isRecord(body?.options) ? body.options : {}
      const target = body?.target === 'global' ? 'global' : 'workspace'
      const scope = String(ctx.params.scope ?? '')
      ctx.body = {
        scope,
        state: await getPluginManager().setOptions(scope, options, target)
      }
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.post('/:scope/commands/:commandId', async (ctx) => {
    try {
      ctx.body = await getPluginManager().invokeCommand(
        String(ctx.params.scope ?? ''),
        String(ctx.params.commandId ?? ''),
        ctx.request.body as { payload?: unknown }
      )
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.post('/:scope/runtime/channels/:channelId', async (ctx) => {
    try {
      const { invocation, source } = normalizeRuntimeChannelBody(ctx.request.body)
      const payload = await getPluginManager().handleRuntimeChannel(
        String(ctx.params.scope ?? ''),
        String(ctx.params.channelId ?? ''),
        invocation,
        source
      )
      ctx.state.skipApiEnvelope = true
      ctx.body = {
        ok: true,
        payload
      } satisfies PluginRuntimeChannelResponse
    } catch (error) {
      const normalizedError = normalizeRouteError(error)
      if (normalizedError instanceof HttpError) {
        ctx.state.skipApiEnvelope = true
        ctx.status = normalizedError.status
        ctx.body = {
          ok: false,
          error: normalizedError.message
        } satisfies PluginRuntimeChannelResponse
        return
      }
      throw normalizedError
    }
  })

  router.get('/:scope/client/:assetPath(.*)', async (ctx) => {
    const asset = await getPluginManager().resolveClientAsset(
      String(ctx.params.scope ?? ''),
      toAssetPath(ctx.params.assetPath)
    )
    if (asset == null) {
      throw notFound('Plugin client asset not found', undefined, 'plugin_asset_not_found')
    }

    ctx.state.skipApiEnvelope = true
    ctx.type = contentTypeForPath(asset.filePath)
    ctx.length = asset.size
    ctx.set('Cache-Control', 'private, no-cache')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.body = asset.stream
  })

  router.get('/:scope/shared/:assetPath(.*)', async (ctx) => {
    const asset = await getPluginManager().resolveClientSharedAsset(
      String(ctx.params.scope ?? ''),
      toAssetPath(ctx.params.assetPath)
    )
    if (asset == null) {
      throw notFound('Plugin client shared asset not found', undefined, 'plugin_asset_not_found')
    }

    ctx.state.skipApiEnvelope = true
    ctx.type = contentTypeForPath(asset.filePath)
    ctx.length = asset.size
    ctx.set('Cache-Control', 'private, no-cache')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.body = asset.stream
  })

  router.all('/:scope/dev/:devPath(.*)', async (ctx) => {
    try {
      const manager = getPluginManager()
      const response = await manager.handleDevAsset(
        String(ctx.params.scope ?? ''),
        {
          method: ctx.method,
          path: toAssetPath(ctx.params.devPath),
          query: ctx.querystring === '' ? '' : `?${ctx.querystring}`,
          headers: ctx.headers,
          body: await getBodyBuffer(ctx)
        }
      )
      ctx.state.skipApiEnvelope = true
      ctx.status = response.status ?? 200
      setProxyHeaders(ctx, response.headers)
      ctx.body = await readProxyHandlerBody(response.body)
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.all('/:scope/proxy/:apiId/:proxyPath(.*)', async (ctx) => {
    try {
      const manager = getPluginManager()
      const response = await manager.handleProxy(
        String(ctx.params.scope ?? ''),
        String(ctx.params.apiId ?? ''),
        {
          method: ctx.method,
          path: toAssetPath(ctx.params.proxyPath),
          query: ctx.querystring === '' ? '' : `?${ctx.querystring}`,
          headers: ctx.headers,
          body: await getBodyBuffer(ctx)
        }
      )
      ctx.state.skipApiEnvelope = true
      ctx.status = response.status ?? 200
      setProxyHeaders(ctx, response.headers)
      ctx.body = await readProxyHandlerBody(response.body)
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  router.all('/:scope/proxy/:apiId', async (ctx) => {
    try {
      const manager = getPluginManager()
      const response = await manager.handleProxy(
        String(ctx.params.scope ?? ''),
        String(ctx.params.apiId ?? ''),
        {
          method: ctx.method,
          path: '',
          query: ctx.querystring === '' ? '' : `?${ctx.querystring}`,
          headers: ctx.headers,
          body: await getBodyBuffer(ctx)
        }
      )
      ctx.state.skipApiEnvelope = true
      ctx.status = response.status ?? 200
      setProxyHeaders(ctx, response.headers)
      ctx.body = await readProxyHandlerBody(response.body)
    } catch (error) {
      throw normalizeRouteError(error)
    }
  })

  return router
}
