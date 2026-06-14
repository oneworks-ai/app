/* eslint-disable max-lines -- Chii embedding coordinates HTTP assets, target routing, and websocket upgrades. */
import type { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { URL } from 'node:url'

import type Koa from 'koa'
import type { WebSocket, WebSocketServer as WsWebSocketServer } from 'ws'

import { getRunningLauncherWorkspaceServerBaseUrlById } from '#~/services/launcher/manager.js'
import {
  isHttpUpgradeSocketHandled,
  markHttpUpgradeSocketHandled,
  scheduleUnhandledHttpUpgradeSocketClose
} from '#~/utils/http-upgrade.js'

import { getOneWorksDevtoolsAsset, injectOneWorksDevtoolsAssets } from './chii-devtools-assets.js'
import { getPathWithoutTrailingSlash, resolveChiiBasePath } from './chii-paths.js'
import {
  WEB_DEBUG_CHII_BASE_PATH,
  WEB_DEBUG_CHII_WORKSPACE_ROUTE_PREFIX,
  normalizeWebDebugWorkspaceId
} from './chii-runtime.js'
import type { ChiiChannelManager } from './chii-targets.js'
import { buildChiiTargetsResponse } from './chii-targets.js'

const nodeRequire = createRequire(__filename)

type ChiiRouterFactory = (
  channelManager: unknown,
  domain: string,
  cdn: string | undefined,
  basePath: string
) => Koa.Middleware

type ChiiWebSocketConnection = WebSocket & {
  chiiUrl?: string | null
  favicon?: string | null
  id?: string
  rtc?: boolean
  target?: string | null
  title?: string | null
  type?: ChiiConnectionType
  userAgent?: string | null
}

interface ChiiWebSocketRuntime {
  _wss: WsWebSocketServer
  channelManager: ChiiChannelManager
}

type ChiiWebSocketServerConstructor = new() => ChiiWebSocketRuntime
type ChiiConnectionType = 'client' | 'target'

interface ChiiUpgradeRequest {
  id: string
  searchParams: URLSearchParams
  type: ChiiConnectionType
}

interface ChiiWorkspaceProxyRequest {
  proxiedPath: string
  workspaceId: string
}

const installedServers = new WeakSet<Server>()
const debugTargetIds = new Set<string>()
const debugRequestMethodsByTargetId = new Map<string, Map<string, string>>()
const chiiWebSocketKeepAliveIntervalMs = 25_000
const chiiTargetServerUrlQueryKey = 'oneworks_chii_server_url'
let chiiTargetScriptCache: string | undefined

const loadChiiRouter = () => (
  nodeRequire('chii/server/middle/router') as ChiiRouterFactory
)

const loadChiiWebSocketServer = () => (
  nodeRequire('chii/server/lib/WebSocketServer') as ChiiWebSocketServerConstructor
)

const getChiiTargetScript = () => {
  chiiTargetScriptCache ??= readFileSync(nodeRequire.resolve('chii/public/target.js'), 'utf8')
  return chiiTargetScriptCache
}

const isLoopbackHostname = (hostname: string) => (
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]'
)

const normalizeChiiServerUrlOverride = (value: string | null) => {
  if (value == null || value.trim() === '') return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!isLoopbackHostname(url.hostname)) return null
    url.hash = ''
    url.search = ''
    const normalizedUrl = url.toString()
    return normalizedUrl.endsWith('/') ? normalizedUrl : `${normalizedUrl}/`
  } catch {
    return null
  }
}

const buildChiiTargetScriptWithServerUrl = (serverUrl: string) =>
  `window.ChiiServerUrl=${JSON.stringify(serverUrl)};\n${getChiiTargetScript()}`

const parseChiiWorkspaceProxyPath = (pathname: string): ChiiWorkspaceProxyRequest | undefined => {
  if (!pathname.startsWith(WEB_DEBUG_CHII_WORKSPACE_ROUTE_PREFIX)) return undefined

  const relativePath = pathname.slice(WEB_DEBUG_CHII_WORKSPACE_ROUTE_PREFIX.length)
  const slashIndex = relativePath.indexOf('/')
  const rawWorkspaceId = slashIndex === -1 ? relativePath : relativePath.slice(0, slashIndex)
  let decodedWorkspaceId: string
  try {
    decodedWorkspaceId = decodeURIComponent(rawWorkspaceId)
  } catch {
    return undefined
  }
  const workspaceId = normalizeWebDebugWorkspaceId(decodedWorkspaceId)
  if (workspaceId == null) return undefined

  const suffix = slashIndex === -1 ? '' : relativePath.slice(slashIndex + 1)
  return {
    proxiedPath: `${WEB_DEBUG_CHII_BASE_PATH}${suffix}`,
    workspaceId
  }
}

const parseChiiWorkspaceProxyRequest = (request: IncomingMessage) => {
  try {
    const requestUrl = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`)
    const proxyRequest = parseChiiWorkspaceProxyPath(requestUrl.pathname)
    return proxyRequest == null ? undefined : { ...proxyRequest, search: requestUrl.search }
  } catch {
    return undefined
  }
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

const createProxyHeaders = (
  headers: IncomingMessage['headers'],
  targetUrl: URL,
  input: {
    upgrade?: boolean
  } = {}
) => {
  const next: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value == null || hopByHopHeaders.has(name.toLowerCase())) continue
    next[name] = value
  }
  next.host = targetUrl.host
  if (input.upgrade === true) {
    next.connection = 'Upgrade'
    next.upgrade = 'websocket'
  }
  return next
}

const setProxyResponseHeaders = (ctx: Koa.Context, headers: http.IncomingHttpHeaders) => {
  for (const [name, value] of Object.entries(headers)) {
    if (value == null || hopByHopHeaders.has(name.toLowerCase())) continue
    ctx.set(name, value)
  }
}

const resolveWorkspaceChiiProxyTargetUrl = (
  proxyRequest: ChiiWorkspaceProxyRequest & { search?: string }
) => {
  const serverBaseUrl = getRunningLauncherWorkspaceServerBaseUrlById(proxyRequest.workspaceId)
  if (serverBaseUrl == null) return undefined

  return new URL(`${proxyRequest.proxiedPath}${proxyRequest.search ?? ''}`, serverBaseUrl)
}

const proxyChiiWorkspaceHttpRequest = async (
  ctx: Koa.Context,
  proxyRequest: ChiiWorkspaceProxyRequest
) => {
  const targetUrl = resolveWorkspaceChiiProxyTargetUrl({ ...proxyRequest, search: ctx.search })
  if (targetUrl == null) {
    ctx.status = 502
    ctx.body = {
      error: 'Workspace Chii server is not available.'
    }
    return
  }

  const transport = targetUrl.protocol === 'https:' ? https : http
  await new Promise<void>((resolve, reject) => {
    const proxy = transport.request(targetUrl, {
      headers: createProxyHeaders(ctx.req.headers, targetUrl),
      method: ctx.method
    }, (response) => {
      ctx.status = response.statusCode ?? 502
      setProxyResponseHeaders(ctx, response.headers)
      ctx.body = response
      resolve()
    })
    proxy.on('error', reject)
    ctx.req.on('error', reject)
    ctx.req.pipe(proxy)
  })
}

const writeRawResponseHead = (
  socket: Duplex,
  statusCode: number,
  statusMessage: string | undefined,
  rawHeaders: string[]
) => {
  let responseHead = `HTTP/1.1 ${statusCode} ${statusMessage ?? ''}\r\n`
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]
    const value = rawHeaders[index + 1]
    if (name == null || value == null || hopByHopHeaders.has(name.toLowerCase())) continue
    responseHead += `${name}: ${value}\r\n`
  }
  responseHead += '\r\n'
  socket.write(responseHead)
}

const proxyChiiWorkspaceUpgradeRequest = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  proxyRequest: ChiiWorkspaceProxyRequest & { search: string }
) => {
  const targetUrl = resolveWorkspaceChiiProxyTargetUrl(proxyRequest)
  if (targetUrl == null) {
    socket.destroy()
    return
  }

  const transport = targetUrl.protocol === 'https:' ? https : http
  const proxy = transport.request(targetUrl, {
    headers: createProxyHeaders(request.headers, targetUrl, { upgrade: true }),
    method: 'GET'
  })
  proxy.once('upgrade', (response, proxySocket, proxyHead) => {
    writeRawResponseHead(socket, response.statusCode ?? 101, response.statusMessage, response.rawHeaders)
    if (proxyHead.length > 0) socket.write(proxyHead)
    if (head.length > 0) proxySocket.write(head)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })
  proxy.once('response', (response) => {
    writeRawResponseHead(socket, response.statusCode ?? 502, response.statusMessage, response.rawHeaders)
    response.resume()
    socket.end()
  })
  proxy.once('error', () => socket.destroy())
  socket.once('error', () => proxy.destroy())
  socket.once('close', () => proxy.destroy())
  proxy.end()
}

const setChiiCorsHeaders = (ctx: Koa.Context) => {
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  ctx.set('Access-Control-Allow-Headers', 'Content-Type')
}

const protectChiiTargetsFromStaleClose = (channelManager: ChiiChannelManager) => {
  const manager = channelManager as ChiiChannelManager & {
    removeTarget?: (id: string, title?: string) => void
  }
  if (typeof manager.removeTarget !== 'function') return

  const removeTarget = manager.removeTarget.bind(manager)
  manager.removeTarget = (id: string, title = '') => {
    const target = manager.getTargets()[id]
    if (target?.ws?.readyState === 1) return
    removeTarget(id, title)
  }
}

const parseChiiUpgradeRequest = (request: IncomingMessage): ChiiUpgradeRequest | 'invalid' | undefined => {
  let requestUrl: URL
  try {
    requestUrl = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`)
  } catch {
    return undefined
  }

  const basePath = resolveChiiBasePath(requestUrl.pathname)
  if (basePath == null) return undefined

  const pathSegments = requestUrl.pathname
    .slice(basePath.length)
    .split('/')
    .filter(Boolean)
  if (pathSegments.length !== 2) return 'invalid'

  const [type, id] = pathSegments
  if ((type !== 'target' && type !== 'client') || id == null || id.trim() === '') {
    return 'invalid'
  }

  return {
    id,
    searchParams: requestUrl.searchParams,
    type
  }
}

const attachChiiConnectionMetadata = (
  ws: ChiiWebSocketConnection,
  upgradeRequest: ChiiUpgradeRequest
) => {
  const { searchParams, type } = upgradeRequest
  ws.type = type
  ws.id = upgradeRequest.id

  if (type === 'target') {
    ws.chiiUrl = searchParams.get('url')
    ws.title = searchParams.get('title')
    ws.favicon = searchParams.get('favicon')
    ws.userAgent = searchParams.get('userAgent')
    ws.rtc = searchParams.get('rtc') === 'true'
    return
  }

  ws.target = searchParams.get('target')
}

const isDebugValueEnabled = (value: string | null) => {
  if (value == null) return false
  const normalizedValue = value.trim().toLowerCase()
  return normalizedValue === '' || (
    normalizedValue !== '0' &&
    normalizedValue !== 'false' &&
    normalizedValue !== 'off' &&
    normalizedValue !== 'no'
  )
}

const getDebugTargetId = (connection: ChiiWebSocketConnection) =>
  connection.type === 'target' ? connection.id : connection.target

const shouldLogChiiProtocol = (connection: ChiiWebSocketConnection) => {
  const targetId = getDebugTargetId(connection)
  return targetId != null && debugTargetIds.has(targetId)
}

const getRequestMethodsForTarget = (targetId: string) => {
  let methodsById = debugRequestMethodsByTargetId.get(targetId)
  if (methodsById == null) {
    methodsById = new Map()
    debugRequestMethodsByTargetId.set(targetId, methodsById)
  }
  return methodsById
}

const readTextProtocolData = (data: unknown) => {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  }
  return null
}

const isInterestingChiiProtocolMethod = (method: unknown) => (
  typeof method === 'string' &&
  (
    method === 'DOM.enable' ||
    method === 'DOM.disable' ||
    method === 'DOM.getDocument' ||
    method === 'DOM.requestChildNodes' ||
    method === 'DOM.documentUpdated' ||
    method === 'DOM.setChildNodes' ||
    method === 'DOM.childNodeInserted' ||
    method === 'DOM.childNodeRemoved' ||
    method === 'Page.enable' ||
    method === 'Page.loadEventFired' ||
    method === 'Inspector.detached'
  )
)

const readProtocolObject = (value: unknown) =>
  value != null && typeof value === 'object' ? value as Record<string, unknown> : null

const readNumberValue = (value: unknown) => typeof value === 'number' ? value : null
const readStringValue = (value: unknown) => typeof value === 'string' ? value : null

const readProtocolNodeSummary = (value: unknown) => {
  const node = readProtocolObject(value)
  if (node == null) return null
  const children = Array.isArray(node.children) ? node.children : null
  return {
    backendNodeId: readNumberValue(node.backendNodeId),
    childNodeCount: readNumberValue(node.childNodeCount),
    childrenLength: children?.length ?? null,
    localName: readStringValue(node.localName),
    nodeId: readNumberValue(node.nodeId),
    nodeName: readStringValue(node.nodeName),
    nodeType: readNumberValue(node.nodeType)
  }
}

const summarizeChiiProtocolMessage = (
  message: unknown,
  direction: string,
  targetId: string
) => {
  const protocolMessage = readProtocolObject(message)
  if (protocolMessage == null) return null

  const idValue = protocolMessage.id
  const id = typeof idValue === 'number' || typeof idValue === 'string' ? String(idValue) : null
  const method = readStringValue(protocolMessage.method)
  const methodsById = getRequestMethodsForTarget(targetId)
  if (id != null && method != null && direction === 'client-to-target') {
    methodsById.set(id, method)
  }
  const requestMethod = method ?? (id == null ? null : methodsById.get(id) ?? null)
  const error = protocolMessage.error ?? null

  if (
    !isInterestingChiiProtocolMethod(method) &&
    !isInterestingChiiProtocolMethod(requestMethod) &&
    error == null
  ) return null

  const result = readProtocolObject(protocolMessage.result)
  const params = readProtocolObject(protocolMessage.params)
  return {
    direction,
    error,
    id,
    method,
    params: params == null ? null : {
      depth: params.depth ?? null,
      nodeId: params.nodeId ?? null,
      parentId: params.parentId ?? null,
      nodesLength: Array.isArray(params.nodes) ? params.nodes.length : null
    },
    requestMethod,
    result: result == null ? null : {
      root: readProtocolNodeSummary(result.root)
    }
  }
}

const summarizeChiiProtocolData = (
  data: unknown,
  direction: string,
  targetId: string
) => {
  const text = readTextProtocolData(data)
  if (text == null || (!text.startsWith('{') && !text.startsWith('['))) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  return messages
    .map(message => summarizeChiiProtocolMessage(message, direction, targetId))
    .filter((message): message is NonNullable<typeof message> => message != null)
}

const logChiiProtocol = (
  connection: ChiiWebSocketConnection,
  direction: string,
  data: unknown
) => {
  if (!shouldLogChiiProtocol(connection)) return
  const targetId = getDebugTargetId(connection)
  if (targetId == null) return
  const summaries = summarizeChiiProtocolData(data, direction, targetId)
  if (summaries.length === 0) return
  // eslint-disable-next-line no-console
  console.debug(
    '[web-debug:chii]',
    JSON.stringify({
      connectionId: connection.id,
      connectionType: connection.type,
      direction,
      summaries,
      targetId
    })
  )
}

const attachChiiProtocolDebugLogging = (
  ws: ChiiWebSocketConnection,
  upgradeRequest: ChiiUpgradeRequest
) => {
  if (
    upgradeRequest.type === 'client' &&
    isDebugValueEnabled(upgradeRequest.searchParams.get('oneworks_debug'))
  ) {
    const targetId = upgradeRequest.searchParams.get('target')
    if (targetId != null && targetId !== '') {
      debugTargetIds.add(targetId)
      // eslint-disable-next-line no-console
      console.debug(
        '[web-debug:chii]',
        JSON.stringify({
          clientId: upgradeRequest.id,
          event: 'debug-client-connected',
          targetId
        })
      )
    }
  }

  ws.on('message', data => {
    logChiiProtocol(
      ws,
      upgradeRequest.type === 'client' ? 'client-to-target' : 'target-to-client',
      data
    )
  })

  const nativeSend = ws.send.bind(ws)
  ws.send = ((data: unknown, ...args: unknown[]) => {
    logChiiProtocol(
      ws,
      upgradeRequest.type === 'client' ? 'target-to-client' : 'client-to-target',
      data
    )
    return Reflect.apply(nativeSend, ws, [data, ...args])
  }) as ChiiWebSocketConnection['send']
}

const attachChiiWebSocketKeepAlive = (ws: ChiiWebSocketConnection) => {
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return
    try {
      ws.ping()
    } catch {
      // The socket can close between the readyState check and ping.
    }
  }, chiiWebSocketKeepAliveIntervalMs)
  timer.unref?.()

  const cleanup = () => clearInterval(timer)
  ws.once('close', cleanup)
  ws.once('error', cleanup)
}

const installChiiHttpMiddleware = (app: Koa, chiiWebSocketServer: ChiiWebSocketRuntime) => {
  const routerFactory = loadChiiRouter()
  const routerByDomain = new Map<string, Koa.Middleware>()
  const pathWithoutTrailingSlash = getPathWithoutTrailingSlash(WEB_DEBUG_CHII_BASE_PATH)

  const getRouter = (domain: string, basePath: string) => {
    const routerKey = `${domain}\n${basePath}`
    let router = routerByDomain.get(routerKey)
    if (router == null) {
      router = routerFactory(chiiWebSocketServer.channelManager, domain, undefined, basePath)
      routerByDomain.set(routerKey, router)
    }
    return router
  }

  app.use(async (ctx, next) => {
    const workspaceProxyRequest = parseChiiWorkspaceProxyPath(ctx.path)
    if (workspaceProxyRequest != null) {
      await proxyChiiWorkspaceHttpRequest(ctx, workspaceProxyRequest)
      return
    }

    if (ctx.path === pathWithoutTrailingSlash) {
      ctx.redirect(WEB_DEBUG_CHII_BASE_PATH)
      return
    }

    const basePath = resolveChiiBasePath(ctx.path)
    if (basePath == null) {
      await next()
      return
    }

    if (ctx.path === getPathWithoutTrailingSlash(basePath)) {
      ctx.redirect(basePath)
      return
    }

    const oneWorksDevtoolsAsset = getOneWorksDevtoolsAsset(ctx.path, basePath)
    if (oneWorksDevtoolsAsset != null) {
      ctx.set('Cache-Control', 'no-store')
      ctx.type = oneWorksDevtoolsAsset.contentType
      ctx.body = oneWorksDevtoolsAsset.body
      return
    }

    if (ctx.path === `${basePath}front_end/chii_app.html`) {
      ctx.set('Cache-Control', 'no-store')
      ctx.type = 'text/html; charset=utf-8'
      ctx.body = injectOneWorksDevtoolsAssets(basePath)
      return
    }

    const targetsPath = `${basePath}targets`
    if (ctx.path === targetsPath) {
      setChiiCorsHeaders(ctx)
      if (ctx.method === 'OPTIONS') {
        ctx.status = 204
        return
      }
      ctx.body = buildChiiTargetsResponse(chiiWebSocketServer.channelManager)
      return
    }

    if (ctx.path === `${basePath}target.js`) {
      const serverUrl = normalizeChiiServerUrlOverride(ctx.query[chiiTargetServerUrlQueryKey] as string | null)
      if (serverUrl != null) {
        ctx.set('Cache-Control', 'no-store')
        ctx.type = 'application/javascript; charset=utf-8'
        ctx.body = buildChiiTargetScriptWithServerUrl(serverUrl)
        return
      }
    }

    const router = getRouter(ctx.host, basePath)
    await router(ctx, next)
  })
}

const installChiiUpgradeMiddleware = (server: Server, chiiWebSocketServer: ChiiWebSocketRuntime) => {
  const { _wss: wss } = chiiWebSocketServer

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (isHttpUpgradeSocketHandled(socket)) return

    const workspaceProxyRequest = parseChiiWorkspaceProxyRequest(request)
    if (workspaceProxyRequest != null) {
      markHttpUpgradeSocketHandled(socket)
      proxyChiiWorkspaceUpgradeRequest(request, socket, head, workspaceProxyRequest)
      return
    }

    const upgradeRequest = parseChiiUpgradeRequest(request)
    if (upgradeRequest == null) {
      scheduleUnhandledHttpUpgradeSocketClose(socket)
      return
    }

    if (upgradeRequest === 'invalid') {
      markHttpUpgradeSocketHandled(socket)
      socket.destroy()
      return
    }

    markHttpUpgradeSocketHandled(socket)
    wss.handleUpgrade(request, socket, head, (ws) => {
      const chiiWs = ws as ChiiWebSocketConnection
      attachChiiConnectionMetadata(chiiWs, upgradeRequest)
      attachChiiWebSocketKeepAlive(chiiWs)
      attachChiiProtocolDebugLogging(chiiWs, upgradeRequest)
      wss.emit('connection', chiiWs, request)
    })
  })

  server.once('close', () => {
    wss.close()
    installedServers.delete(server)
  })
}

export const installWebDebugChii = ({ app, server }: { app: Koa; server: Server }) => {
  if (installedServers.has(server)) return

  const ChiiWebSocketServer = loadChiiWebSocketServer()
  const chiiWebSocketServer = new ChiiWebSocketServer()
  protectChiiTargetsFromStaleClose(chiiWebSocketServer.channelManager)
  installChiiHttpMiddleware(app, chiiWebSocketServer)
  installChiiUpgradeMiddleware(server, chiiWebSocketServer)
  installedServers.add(server)
}
