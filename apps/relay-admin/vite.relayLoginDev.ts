import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin, ViteDevServer } from 'vite'

import type { RelayLoginProvider } from '../relay-server/src/routes/login-page-types.js'
import type { RelayServerArgs } from '../relay-server/src/types.js'

interface RelayLoginPageModule {
  renderRelayLoginCompletePage: (input: RelayLoginRenderInput) => string
  renderRelayLoginPage: (input: RelayLoginRenderInput) => string
}

interface RelayLoginRenderInput {
  args: RelayServerArgs
  assets?: {
    faviconDarkHref?: string
    faviconLightHref?: string
    scriptSrc?: string
    styleHref?: string
  }
  providers: RelayLoginProvider[]
  req: IncomingMessage
  url: URL
}

interface RelayProviderResponse {
  providers?: unknown
}

const appDir = dirname(fileURLToPath(import.meta.url))
const relayServerRoot = resolve(appDir, '../relay-server')
const relayLoginPageModulePath = resolve(relayServerRoot, 'src/routes/login-page.ts')
const relayRoutesDir = resolve(relayServerRoot, 'src/routes')

const loginPaths = new Set(['/login', '/login/complete'])
const loginDevArgs: RelayServerArgs = {
  adminToken: '',
  allowOrigin: '*',
  dataPath: '',
  deviceOnlineTtlMs: 60 * 1000,
  host: '127.0.0.1',
  oauth: {},
  port: 0,
  publicBaseUrl: undefined,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  storageDriver: undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const isRelayLoginProvider = (value: unknown): value is RelayLoginProvider => (
  isRecord(value) &&
  typeof value.id === 'string' &&
  (value.displayName == null || typeof value.displayName === 'string')
)

const isRelayLoginSource = (file: string) => {
  const normalized = file.replaceAll('\\', '/')
  return normalized.includes('/apps/relay-server/src/routes/login')
}

const loadProviders = async (proxyTarget: string): Promise<RelayLoginProvider[]> => {
  try {
    const response = await fetch(new URL('/api/auth/providers', proxyTarget))
    if (!response.ok) return []
    const body: RelayProviderResponse = await response.json().catch(() => ({}))
    return Array.isArray(body.providers) ? body.providers.filter(isRelayLoginProvider) : []
  } catch {
    return []
  }
}

const loadLoginPageModule = async (server: ViteDevServer) => (
  await server.ssrLoadModule(relayLoginPageModulePath) as RelayLoginPageModule
)

const applyDefaultDevLoginRedirect = (url: URL) => {
  if (url.pathname !== '/login') return
  if ((url.searchParams.get('redirect_uri') ?? '').trim() !== '') return
  url.searchParams.set('redirect_uri', new URL('/admin/users', url.origin).toString())
}

const renderLoginPage = async (
  server: ViteDevServer,
  proxyTarget: string,
  req: IncomingMessage
) => {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  applyDefaultDevLoginRedirect(url)
  const [loginPageModule, providers] = await Promise.all([
    loadLoginPageModule(server),
    loadProviders(proxyTarget)
  ])
  const input: RelayLoginRenderInput = {
    args: loginDevArgs,
    assets: {
      faviconDarkHref: '/favicon-dark.svg',
      faviconLightHref: '/favicon-light.svg',
      scriptSrc: '/src/login/main.tsx',
      styleHref: undefined
    },
    providers,
    req,
    url
  }
  return url.pathname === '/login/complete'
    ? loginPageModule.renderRelayLoginCompletePage(input)
    : loginPageModule.renderRelayLoginPage(input)
}

const sendHtml = async (server: ViteDevServer, req: IncomingMessage, res: ServerResponse, html: string) => {
  const transformedHtml = await server.transformIndexHtml(req.url ?? '/login', html)
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(transformedHtml)
}

const sendError = (server: ViteDevServer, res: ServerResponse, error: unknown) => {
  if (error instanceof Error) server.ssrFixStacktrace(error)
  const message = error instanceof Error ? error.message : String(error)
  server.config.logger.error(message)
  res.statusCode = 500
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(message)
}

export const relayLoginDevPlugin = (proxyTarget: string): Plugin => ({
  name: 'relay-login-dev',
  apply: 'serve',
  configureServer(server) {
    server.watcher.add(relayRoutesDir)
    server.watcher.on('change', file => {
      if (!isRelayLoginSource(file)) return
      server.ws.send({ type: 'full-reload', path: '*' })
    })
    server.middlewares.use((req, res, next) => {
      const host = req.headers.host ?? 'localhost'
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (req.method !== 'GET' || !loginPaths.has(url.pathname)) {
        next()
        return
      }
      void renderLoginPage(server, proxyTarget, req)
        .then(html => sendHtml(server, req, res, html))
        .catch(error => sendError(server, res, error))
    })
  }
})
