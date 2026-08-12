/* eslint-disable max-lines -- startup timing logs keep server bootstrap phases visible. */
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import process from 'node:process'

import Koa from 'koa'

import { loadEnv } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { migrateProjectHomeSegments } from '@oneworks/utils/project-home-migration'
import type { ProjectHomeMigratedSegment } from '@oneworks/utils/project-home-migration'

import { installAssetCreateConnectionGuard } from '#~/services/ai/asset-create-operation.js'
import type { startChannelResumeScheduler } from '#~/services/channel-resume/index.js'
import { loadConfigState } from '#~/services/config/index.js'
import { acquireConfigWatchRuntime } from '#~/services/config/watch.js'
import { initializeModelProviderCatalog } from '#~/services/model-providers/catalog-loader.js'
import {
  disposeRuntimeBrokerDrivers,
  initializeRuntimeBrokerDrivers,
  scheduleRuntimeBrokerWarmup
} from '#~/services/runtime-broker/drivers/index.js'
import { configureRuntimeBrokerTransport, disposeRuntimeBroker } from '#~/services/runtime-broker/index.js'
import type { startRuntimeStoreWatcher } from '#~/services/runtime-store/watcher.js'
import { removeServerInstanceStateForPid, writeServerInstanceState } from '#~/services/server-instance.js'
import { installWebDebugChii } from '#~/services/web-debug/chii.js'

import type { ChannelConfigSourceEntry, initChannels } from './channels'
import { initMiddlewares } from './middlewares'
import { isDefaultServerDataDir, migrateDefaultServerDataDir } from './project-home-data-migration'
import { mountRoutes } from './routes'
import { startRuntimeBrokerLoopbackTransport } from './routes/runtime-broker-transport'
import type { RuntimeBrokerLoopbackTransport } from './routes/runtime-broker-transport'
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

export const shouldOwnWorkspaceRuntime = (role: string | undefined) => role !== 'manager'

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
  const sharedModelToken = env.__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__ ?? randomBytes(32).toString('base64url')
  env.__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__ = sharedModelToken
  process.env.__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__ = sharedModelToken
  logStartup?.('env loaded')
  logStartup?.('model provider catalog load begin')
  await initializeModelProviderCatalog(process.env)
  logStartup?.('model provider catalog load complete')
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
  installAssetCreateConnectionGuard(server)
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
  const ownsWorkspaceRuntime = shouldOwnWorkspaceRuntime(env.__ONEWORKS_PROJECT_SERVER_ROLE__)
  logStartup(`entry kind resolved kind=${entryKind}`)
  logStartup('config watch acquire begin')
  const configWatch = await acquireConfigWatchRuntime()
  logStartup('config watch acquire complete')
  let runtimeStoreWatcher: ReturnType<typeof startRuntimeStoreWatcher> | undefined
  let runtimeStoreWatcherTimer: ReturnType<typeof setTimeout> | undefined
  let pluginRuntimePreloadTimer: ReturnType<typeof setTimeout> | undefined
  let pluginRuntimePreloadPromise: Promise<void> | undefined
  let channelResumeScheduler: ReturnType<typeof startChannelResumeScheduler> | undefined
  let channelManager: Awaited<ReturnType<typeof initChannels>> | undefined
  let runtimeBrokerTransport: RuntimeBrokerLoopbackTransport | undefined
  let channelsModule: typeof import('./channels/index.js') | undefined
  let serverClosed = false

  const scheduleRuntimeStoreWatcher = () => {
    logStartup(`runtime store watcher start scheduled delay=${RUNTIME_STORE_WATCHER_DELAY_MS}ms`)
    runtimeStoreWatcherTimer = setTimeout(async () => {
      runtimeStoreWatcherTimer = undefined
      logStartup('runtime store watcher start begin')
      try {
        const [loadedChannels, channelLifecycle, runtimeStoreHistory, runtimeStore] = await Promise.all([
          channelsModule == null ? import('./channels/index.js') : Promise.resolve(channelsModule),
          import('#~/services/channel-lifecycle/index.js'),
          import('#~/services/runtime-store/history-import.js'),
          import('#~/services/runtime-store/watcher.js')
        ])
        if (serverClosed) return
        runtimeStoreWatcher = runtimeStore.startRuntimeStoreWatcher({
          deliverSessionEvent: loadedChannels.handleChannelSessionEvent,
          deliverSessionTerminal: (input) => {
            channelLifecycle.commitChannelChildRunTerminal(input)
          }
        })
        logStartup('runtime store watcher start invoked')
        await runtimeStoreWatcher.scanAndReplay()
          .then(() => runtimeStoreHistory.autoImportNativeProjectHistoryAndReplay(config))
          .then((result) => {
            if (result.importedEvents > 0 || result.matchedFiles > 0) {
              logger.info({
                importedEvents: result.importedEvents,
                importedSessions: result.importedSessions,
                matchedFiles: result.matchedFiles,
                scannedFiles: result.scannedFiles
              }, '[runtime-store] Native project history auto import complete')
            }
          })
      } catch (error) {
        logStartup('runtime store watcher start failed')
        logger.warn({ error }, '[runtime-store] Failed to start watcher or replay runtime history')
      }
    }, RUNTIME_STORE_WATCHER_DELAY_MS)
  }

  const schedulePluginRuntimePreload = () => {
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager') return
    logStartup('plugin runtime preload scheduled')
    pluginRuntimePreloadTimer = setTimeout(() => {
      pluginRuntimePreloadTimer = undefined
      if (serverClosed) return
      logStartup('plugin runtime preload begin')
      pluginRuntimePreloadPromise = import('#~/services/plugins/index.js')
        .then(async ({ getPluginManager }) => {
          if (serverClosed) return
          await getPluginManager().load()
        })
        .then(() => {
          logStartup('plugin runtime preload complete')
        })
        .catch(error => {
          logStartup('plugin runtime preload failed')
          logger.warn({ error }, '[plugins] Failed to preload plugin runtime')
        })
    }, 0)
  }

  const initializeWorkspaceRuntimeOwners = async (serverPublicBaseUrl: string | undefined) => {
    logStartup('channels init begin')
    const loadedChannelsModule = await import('./channels/index.js')
    channelsModule = loadedChannelsModule
    channelManager = await loadedChannelsModule.initChannels(configs, {
      serverBaseUrl: serverPublicBaseUrl
    })
    logStartup('channels init complete')
    logStartup('channel resume scheduler start begin')
    const { startChannelResumeScheduler: startScheduler } = await import(
      '#~/services/channel-resume/index.js'
    )
    channelResumeScheduler = startScheduler()
    logStartup('channel resume scheduler start complete')
  }

  const disposePluginRuntime = async () => {
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager') return
    await pluginRuntimePreloadPromise
    const { getPluginManager } = await import('#~/services/plugins/index.js')
    await getPluginManager().dispose()
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
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
      await initializeRuntimeBrokerDrivers()
    }
    const serverPublicBaseUrl = resolveServerPublicBaseUrl(config)
    logStartup('routes mount begin')
    const { onListen: mountRoutesOnListen } = await mountRoutes(app, env, {
      logClientMount: entryKind !== 'web',
      serverBaseUrl: serverPublicBaseUrl
    })
    logStartup('routes mount complete')
    setupWebSocket(server, env)
    logStartup('websocket setup complete')
    if (ownsWorkspaceRuntime) {
      await initializeWorkspaceRuntimeOwners(serverPublicBaseUrl)
    } else {
      logStartup('channels init skipped for manager role')
    }
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
      runtimeBrokerTransport = await startRuntimeBrokerLoopbackTransport(env)
      configureRuntimeBrokerTransport(runtimeBrokerTransport.baseUrl)
    }
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
        void writeServerInstanceState(env, {
          pid: process.pid,
          role: env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager' ? 'manager' : 'workspace',
          serverBaseUrl: displayBaseUrl,
          startedAt: new Date().toISOString()
        }).then(resolve, reject)
      })
    })
    if (ownsWorkspaceRuntime) {
      scheduleRuntimeStoreWatcher()
    } else {
      logStartup('runtime store watcher skipped for manager role')
      logStartup('channel resume scheduler skipped for manager role')
    }
    schedulePluginRuntimePreload()
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
      scheduleRuntimeBrokerWarmup()
    }
    scheduleProjectHomeSegmentMigration(logStartup)

    server.once('close', () => {
      void removeServerInstanceStateForPid(env, process.pid)
      serverClosed = true
      if (runtimeStoreWatcherTimer != null) {
        clearTimeout(runtimeStoreWatcherTimer)
        runtimeStoreWatcherTimer = undefined
      }
      if (pluginRuntimePreloadTimer != null) {
        clearTimeout(pluginRuntimePreloadTimer)
        pluginRuntimePreloadTimer = undefined
      }
      runtimeStoreWatcher?.stop()
      channelResumeScheduler?.stop()
      void channelManager?.closeAll().catch(error => {
        logger.warn({ error }, '[channels] Failed to close channel runtime')
      })
      configWatch.release()
      void disposePluginRuntime().catch(error => {
        logger.warn({ error }, '[plugins] Failed to dispose plugin runtime')
      })
      if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
        void runtimeBrokerTransport?.close().catch(error => {
          logger.warn({ error }, '[runtime-broker] Failed to close loopback transport')
        })
        runtimeBrokerTransport = undefined
        disposeRuntimeBrokerDrivers()
        void disposeRuntimeBroker()
      }
    })

    return runtime
  } catch (error) {
    if (runtimeStoreWatcherTimer != null) {
      clearTimeout(runtimeStoreWatcherTimer)
      runtimeStoreWatcherTimer = undefined
    }
    if (pluginRuntimePreloadTimer != null) {
      clearTimeout(pluginRuntimePreloadTimer)
      pluginRuntimePreloadTimer = undefined
    }
    runtimeStoreWatcher?.stop()
    channelResumeScheduler?.stop()
    await channelManager?.closeAll()
    configWatch.release()
    await disposePluginRuntime()
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
      await runtimeBrokerTransport?.close()
      runtimeBrokerTransport = undefined
      disposeRuntimeBrokerDrivers()
      await disposeRuntimeBroker()
    }
    throw error
  }
}
