import { spawn } from 'node:child_process'
import process from 'node:process'
import { Writable } from 'node:stream'

import type { Logger } from '@oneworks/types'
import { resolveManagedNpmCliBinaryPath } from '@oneworks/utils/managed-npm-cli'

import { CodexRpcClient } from '#~/protocol/rpc.js'

import { parseCodexAppServerPluginList, parseCodexAppServerPluginSummary } from './app-server-marketplace-parser'
import type { CodexAppServerPluginList } from './app-server-marketplace-parser'

export { parseCodexAppServerPluginList } from './app-server-marketplace-parser'
export type {
  CodexAppServerMarketplace,
  CodexAppServerPluginInterface,
  CodexAppServerPluginList,
  CodexAppServerPluginSummary
} from './app-server-marketplace-parser'

const APP_SERVER_TIMEOUT_MS = 45_000
const CATALOG_CACHE_TTL_MS = 60_000

const noop = () => {}
const noopLogger: Logger = {
  debug: noop,
  error: noop,
  info: noop,
  stream: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
  warn: noop
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const resolveCodexPluginBinaryPath = (
  env: Record<string, string | null | undefined>,
  cwd: string
) =>
  resolveManagedNpmCliBinaryPath({
    adapterKey: 'codex',
    binaryName: 'codex',
    cwd,
    defaultPackageName: '@openai/codex',
    defaultVersion: 'latest',
    env
  })

const buildCommandEnv = (env: Record<string, string | null | undefined>) => {
  const commandEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete commandEnv[key]
    else commandEnv[key] = value
  }
  return commandEnv
}

const withTimeout = <T>(promise: Promise<T>, description: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out.`)), APP_SERVER_TIMEOUT_MS)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const withPluginAppServer = async <T>(params: {
  cwd: string
  env: Record<string, string | null | undefined>
  includeRemoteCatalog: boolean
  run: (rpc: CodexRpcClient) => Promise<T>
}) => {
  const binaryPath = resolveCodexPluginBinaryPath(params.env, params.cwd)
  const proc = spawn(binaryPath, [
    'app-server',
    ...(params.includeRemoteCatalog ? ['--enable', 'remote_plugin'] : [])
  ], {
    cwd: params.cwd,
    env: buildCommandEnv(params.env),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const rpc = new CodexRpcClient(proc, noopLogger)
  proc.stderr.resume()
  proc.once('error', error => rpc.destroy(error.message))
  proc.once('exit', () => rpc.destroy('Codex app-server exited.'))
  rpc.onRequest(id => rpc.respond(id, {}))

  try {
    return await withTimeout(
      (async () => {
        await rpc.request('initialize', {
          capabilities: { experimentalApi: false, optOutNotificationMethods: [] },
          clientInfo: { name: 'oneworks', title: 'One Works', version: 'dev' }
        })
        rpc.notify('initialized', {})
        return params.run(rpc)
      })(),
      'Codex app-server plugin operation'
    )
  } finally {
    rpc.destroy()
    proc.kill()
  }
}

interface CachedCatalog {
  expiresAt: number
  promise: Promise<CodexAppServerPluginList>
}

const catalogCache = new Map<string, CachedCatalog>()

export const listCodexAppServerPlugins = (params: {
  cwd: string
  env: Record<string, string | null | undefined>
  includeRemoteCatalog: boolean
}) => {
  const binaryPath = resolveCodexPluginBinaryPath(params.env, params.cwd)
  const cacheKey = [
    binaryPath,
    params.env.CODEX_HOME ?? '',
    params.env.HOME ?? '',
    params.cwd,
    params.includeRemoteCatalog ? 'remote' : 'local'
  ].join('\0')
  const now = Date.now()
  const cached = catalogCache.get(cacheKey)
  if (cached != null && cached.expiresAt > now) return cached.promise

  const promise = withPluginAppServer({
    ...params,
    run: async rpc => parseCodexAppServerPluginList(await rpc.request('plugin/list', { cwds: [params.cwd] }))
  })
  catalogCache.set(cacheKey, { expiresAt: now + CATALOG_CACHE_TTL_MS, promise })
  void promise.catch(() => {
    if (catalogCache.get(cacheKey)?.promise === promise) catalogCache.delete(cacheKey)
  })
  return promise
}

export const installCodexAppServerPlugin = async (params: {
  cwd: string
  env: Record<string, string | null | undefined>
  includeRemoteCatalog: boolean
  marketplace: string
  pluginName: string
}) =>
  withPluginAppServer({
    ...params,
    run: async rpc => {
      await rpc.request('plugin/install', {
        pluginName: params.pluginName,
        remoteMarketplaceName: params.marketplace
      })
      catalogCache.clear()
      const readResult = await rpc.request('plugin/read', {
        pluginName: params.pluginName,
        remoteMarketplaceName: params.marketplace
      })
      if (!isRecord(readResult) || !isRecord(readResult.plugin)) {
        throw new TypeError('Invalid Codex app-server plugin/read response.')
      }
      const summary = parseCodexAppServerPluginSummary(readResult.plugin.summary)
      if (summary == null) throw new TypeError('Codex app-server did not return an installed plugin summary.')
      return summary
    }
  })

export const resetCodexAppServerPluginCatalogCache = () => catalogCache.clear()
