/* eslint-disable max-lines -- startup timing logs keep server bootstrap phases visible. */
import http from 'node:http'
import process from 'node:process'

import Koa from 'koa'

import { loadEnv } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { migrateProjectHomeSegments } from '@oneworks/utils/project-home-migration'
import type { ProjectHomeMigratedSegment } from '@oneworks/utils/project-home-migration'

import { loadConfigState } from '#~/services/config/index.js'
import { acquireConfigWatchRuntime } from '#~/services/config/watch.js'
import { getPluginManager } from '#~/services/plugins/index.js'
import { startRuntimeStoreWatcher } from '#~/services/runtime-store/watcher.js'
import { installWebDebugChii } from '#~/services/web-debug/chii.js'

import { handleChannelSessionEvent, initChannels } from './channels'
import type { ChannelConfigSourceEntry } from './channels'
import { initMiddlewares } from './middlewares'
import { isDefaultServerDataDir, migrateDefaultServerDataDir } from './project-home-data-migration'
import { mountRoutes } from './routes'
import { logger } from './utils/logger'
import { setupWebSocket } from './websocket'

export interface StartServerOptions {
  entryKind?: 'server' | 'web'
}

export interface ServerRuntime {
  app: Koa
  env: ReturnType<typeof loadEnv>
  server: http.Server
  configs: readonly ChannelConfigSourceEntry[]
  config: Awaited<ReturnType<typeof loadConfigState>>['mergedConfig']
}

type StartupLog = (message: string) => void

const BACKGROUND_PROJECT_HOME_MIGRATION_SEGMENTS = [
  'logs',
  'caches',
  '.mock',
  '.local',
  'runtime'
] as const satisfies readonly ProjectHomeMigratedSegment[]
const BACKGROUND_PROJECT_HOME_MIGRATION_DELAY_MS = 1500
const RUNTIME_STORE_WATCHER_DELAY_MS = 500
const DESKTOP_SERVER_READY_EVENT_PREFIX = '[oneworks-desktop-server-ready]'

const readServerChildStartedAt = () => {
  const startedAt = Number(process.env.__ONEWORKS_DESKTOP_SERVER_CHILD_STARTED_AT__)
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : undefined
}

const createStartupLog = (): StartupLog => {
  const startedAt = Date.now()
  const childStartedAt = readServerChildStartedAt()
  return (message: string) => {
    const childElapsed = childStartedAt == null ? '' : ` processElapsed=${Date.now() - childStartedAt}ms`
    process.stdout.write(`[server-startup] ${message} elapsed=${Date.now() - startedAt}ms${childElapsed}\n`)
  }
}

const hasConfiguredEnvPath = (name: string) => {
  const value = process.env[name]?.trim()
  return value != null && value !== ''
}

const normalizeClientBase = (value?: string, fallback = '/ui/') => {
  let base = value?.trim() || fallback
  if (!base.startsWith('/')) {
    base = `/${base}`
  }
  if (!base.endsWith('/')) {
    base += '/'
  }
  return base
}

const normalizeDisplayHost = (host: string) => {
  const normalized = host.trim()
  if (normalized === '' || normalized === '0.0.0.0') {
    return '127.0.0.1'
  }
  if (normalized === '::' || normalized === '[::]') {
    return 'localhost'
  }
  return normalized
}

const normalizePublicDomain = (value: string | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return trimmed.replace(/^https?:\/\//u, '').replace(/\/+$/u, '')
}

const resolveServerPublicBaseUrl = (
  config: Awaited<ReturnType<typeof loadConfigState>>['mergedConfig']
) => {
  const domain = normalizePublicDomain(config.server?.public?.domain)
  if (domain == null) return undefined

  const schema = config.server?.public?.schema ?? 'https'
  const port = config.server?.public?.port
  const portSuffix = port == null || (schema === 'http' && port === 80) || (schema === 'https' && port === 443)
    ? ''
    : `:${port}`
  return `${schema}://${domain}${portSuffix}`
}

const resolveDisplayBaseUrl = (
  env: ReturnType<typeof loadEnv>,
  config: Awaited<ReturnType<typeof loadConfigState>>['mergedConfig']
) => {
  const configuredBaseUrl = resolveServerPublicBaseUrl(config)
  if (configuredBaseUrl != null) {
    return configuredBaseUrl
  }
  return `http://${normalizeDisplayHost(env.__ONEWORKS_PROJECT_SERVER_HOST__)}:${env.__ONEWORKS_PROJECT_SERVER_PORT__}`
}

const resolveEntryKind = (options: StartServerOptions): NonNullable<StartServerOptions['entryKind']> => {
  const explicitEntryKind = options.entryKind
  if (explicitEntryKind != null) {
    return explicitEntryKind
  }

  return process.env.__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__ === 'web'
    ? 'web'
    : 'server'
}

const toChannelConfigSourceEntry = (
  source: ChannelConfigSourceEntry['source'],
  config: ChannelConfigSourceEntry['config'] | undefined
): ChannelConfigSourceEntry => ({
  source,
  ...(config == null ? {} : { config })
})

const summarizeProjectHomeMigration = (
  results: Awaited<ReturnType<typeof migrateProjectHomeSegments>>
) => {
  const segmentSummaries = results.map((result, index) => {
    const segment = BACKGROUND_PROJECT_HOME_MIGRATION_SEGMENTS[index] ?? 'unknown'
    return `${segment}:${result.migratedSources.length}`
  })
  const migratedSources = results.reduce((sum, result) => sum + result.migratedSources.length, 0)
  return `migratedSources=${migratedSources} segments=${segmentSummaries.join(',')}`
}

const scheduleProjectHomeSegmentMigration = (logStartup: StartupLog) => {
  const cwd = process.cwd()
  const env = process.env
  logStartup(`project home segment migration scheduled delay=${BACKGROUND_PROJECT_HOME_MIGRATION_DELAY_MS}ms`)

  setTimeout(() => {
    logStartup('project home segment migration begin')
    void migrateProjectHomeSegments(cwd, env, BACKGROUND_PROJECT_HOME_MIGRATION_SEGMENTS)
      .then(results => {
        logStartup(`project home segment migration complete ${summarizeProjectHomeMigration(results)}`)
      })
      .catch((err: unknown) => {
        logStartup('project home segment migration failed')
        logger.warn({ err }, '[server-startup] project home segment migration failed')
      })
  }, BACKGROUND_PROJECT_HOME_MIGRATION_DELAY_MS)
}

const emitDesktopServerReadyEvent = (serverBaseUrl: string) => {
  if (readServerChildStartedAt() == null) return
  process.stdout.write(`${DESKTOP_SERVER_READY_EVENT_PREFIX} ${JSON.stringify({ serverBaseUrl })}\n`)
}

export async function createServerRuntime(logStartup?: StartupLog): Promise<ServerRuntime> {
  logStartup?.('create runtime begin')
  logStartup?.('project home segment migration deferred')
  const env = loadEnv()
  logStartup?.('env loaded')
  if (!hasConfiguredEnvPath('__ONEWORKS_PROJECT_SERVER_DATA_DIR__')) {
    logStartup?.('default server data dir migration begin')
    await migrateDefaultServerDataDir(process.cwd(), process.env).catch(() => undefined)
    env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = resolveProjectHomePath(process.cwd(), process.env, 'server', 'data')
    logStartup?.('default server data dir migration complete')
  } else if (
    isDefaultServerDataDir(process.cwd(), process.env, process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ ?? '')
  ) {
    logStartup?.('configured default server data dir migration begin')
    await migrateDefaultServerDataDir(process.cwd(), process.env).catch(() => undefined)
    logStartup?.('configured default server data dir migration complete')
  }
  if (!hasConfiguredEnvPath('__ONEWORKS_PROJECT_SERVER_LOG_DIR__')) {
    env.__ONEWORKS_PROJECT_SERVER_LOG_DIR__ = resolveProjectHomePath(process.cwd(), process.env, 'logs', 'server')
  }

  const app = new Koa()
  const handler = app.callback()
  const server = http.createServer((req, res) => {
    void handler(req, res)
  })
  logStartup?.('koa and http server created')
  logStartup?.('config load begin')
  const { globalConfig, projectSource, userConfig, mergedConfig } = await loadConfigState()
  logStartup?.('config load complete')
  const configs = [
    toChannelConfigSourceEntry('global', globalConfig),
    toChannelConfigSourceEntry('project', projectSource?.resolvedConfig),
    toChannelConfigSourceEntry('user', userConfig)
  ] as const satisfies readonly ChannelConfigSourceEntry[]

  logStartup?.('create runtime complete')
  return { app, env, server, configs, config: mergedConfig }
}

export async function startServer(options: StartServerOptions = {}): Promise<ServerRuntime> {
  const logStartup = createStartupLog()
  logStartup('startServer begin')
  const runtime = await createServerRuntime(logStartup)
  logStartup('create runtime returned')
  const { app, env, server, configs, config } = runtime
  const entryKind = resolveEntryKind(options)
  const shouldStartRuntimeStoreWatcher = env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager'
  logStartup(`entry kind resolved kind=${entryKind}`)
  logStartup('config watch acquire begin')
  const configWatch = await acquireConfigWatchRuntime()
  logStartup('config watch acquire complete')
  let runtimeStoreWatcher: ReturnType<typeof startRuntimeStoreWatcher> | undefined
  let runtimeStoreWatcherTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleRuntimeStoreWatcher = () => {
    logStartup(`runtime store watcher start scheduled delay=${RUNTIME_STORE_WATCHER_DELAY_MS}ms`)
    runtimeStoreWatcherTimer = setTimeout(() => {
      runtimeStoreWatcherTimer = undefined
      logStartup('runtime store watcher start begin')
      try {
        runtimeStoreWatcher = startRuntimeStoreWatcher({ deliverSessionEvent: handleChannelSessionEvent })
        logStartup('runtime store watcher start invoked')
      } catch (error) {
        logStartup('runtime store watcher start failed')
        logger.warn({ error }, '[runtime-store] Failed to start watcher')
      }
    }, RUNTIME_STORE_WATCHER_DELAY_MS)
  }

  try {
    logStartup('web debug chii install begin')
    installWebDebugChii({ app, server })
    logStartup('web debug chii install complete')
    logStartup('middlewares init begin')
    await initMiddlewares(app, env, {
      publicPaths: config.server?.publicPaths
    })
    logStartup('middlewares init complete')
    const serverPublicBaseUrl = resolveServerPublicBaseUrl(config)
    logStartup('routes mount begin')
    const { onListen: mountRoutesOnListen } = await mountRoutes(app, env, {
      logClientMount: entryKind !== 'web',
      serverBaseUrl: serverPublicBaseUrl
    })
    logStartup('routes mount complete')
    setupWebSocket(server, env)
    logStartup('websocket setup complete')
    logStartup('channels init begin')
    await initChannels(configs, { serverBaseUrl: serverPublicBaseUrl })
    logStartup('channels init complete')
    const {
      __ONEWORKS_PROJECT_SERVER_HOST__: serverHost,
      __ONEWORKS_PROJECT_SERVER_PORT__: serverPort,
      __ONEWORKS_PROJECT_SERVER_WS_PATH__: serverWSPath
    } = env

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      logStartup(`listen begin host=${serverHost} port=${serverPort}`)
      server.listen(serverPort, serverHost, () => {
        server.off('error', reject)

        const displayBaseUrl = resolveDisplayBaseUrl(env, config)
        if (entryKind === 'web') {
          const clientBase = normalizeClientBase(env.__ONEWORKS_PROJECT_CLIENT_BASE__, '/')
          const clientPath = env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager'
            ? `${clientBase}launcher`
            : clientBase
          logger.info(
            `[web] ready at ${displayBaseUrl}${clientPath}`
          )
        } else {
          const host = `${serverHost}:${serverPort}`
          logger.info(`[server] listening on http://${host}`)
          logger.info(`[server]              ws://${host}${serverWSPath}`)
        }

        mountRoutesOnListen(displayBaseUrl)
        logStartup('listen callback complete')
        emitDesktopServerReadyEvent(displayBaseUrl)
        resolve()
      })
    })
    if (shouldStartRuntimeStoreWatcher) {
      scheduleRuntimeStoreWatcher()
    } else {
      logStartup('runtime store watcher skipped for manager role')
    }
    scheduleProjectHomeSegmentMigration(logStartup)

    server.once('close', () => {
      if (runtimeStoreWatcherTimer != null) {
        clearTimeout(runtimeStoreWatcherTimer)
        runtimeStoreWatcherTimer = undefined
      }
      runtimeStoreWatcher?.stop()
      configWatch.release()
      void getPluginManager().dispose()
    })

    return runtime
  } catch (error) {
    if (runtimeStoreWatcherTimer != null) {
      clearTimeout(runtimeStoreWatcherTimer)
      runtimeStoreWatcherTimer = undefined
    }
    runtimeStoreWatcher?.stop()
    configWatch.release()
    throw error
  }
}
