import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

const importBoundaryMocks = vi.hoisted(() => {
  const channelResumeScheduler = { stop: vi.fn() }
  const pluginManager = {
    dispose: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined)
  }
  const runtimeStoreWatcher = {
    scanAndReplay: vi.fn(async () => undefined),
    stop: vi.fn()
  }

  return {
    channelsModuleLoaded: vi.fn(),
    channelResumeModuleLoaded: vi.fn(),
    channelResumeScheduler,
    pluginManager,
    pluginsModuleLoaded: vi.fn(),
    runtimeStoreHistoryModuleLoaded: vi.fn(),
    runtimeStoreWatcher,
    runtimeStoreWatcherModuleLoaded: vi.fn()
  }
})

vi.mock('../src/channels/index.js', () => {
  importBoundaryMocks.channelsModuleLoaded()
  return {
    handleChannelSessionEvent: vi.fn(),
    initChannels: vi.fn(async () => undefined)
  }
})

vi.mock('#~/services/ai/asset-create-operation.js', () => ({
  installAssetCreateConnectionGuard: vi.fn()
}))

vi.mock('#~/services/channel-lifecycle/index.js', () => ({
  commitChannelChildRunTerminal: vi.fn()
}))

vi.mock('#~/services/channel-resume/index.js', () => {
  importBoundaryMocks.channelResumeModuleLoaded()
  return {
    startChannelResumeScheduler: vi.fn(() => importBoundaryMocks.channelResumeScheduler)
  }
})

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: vi.fn(async () => ({
    globalConfig: undefined,
    projectSource: undefined,
    userConfig: {},
    mergedConfig: {}
  }))
}))

vi.mock('#~/services/config/watch.js', () => ({
  acquireConfigWatchRuntime: vi.fn(async () => ({ release: vi.fn() }))
}))

vi.mock('#~/services/model-providers/catalog-loader.js', () => ({
  initializeModelProviderCatalog: vi.fn(async () => undefined)
}))

vi.mock('#~/services/plugins/index.js', () => {
  importBoundaryMocks.pluginsModuleLoaded()
  return {
    getPluginManager: vi.fn(() => importBoundaryMocks.pluginManager)
  }
})

vi.mock('#~/services/runtime-broker/drivers/index.js', () => ({
  disposeRuntimeBrokerDrivers: vi.fn(),
  initializeRuntimeBrokerDrivers: vi.fn(async () => undefined),
  scheduleRuntimeBrokerWarmup: vi.fn()
}))

vi.mock('#~/services/runtime-broker/index.js', () => ({
  configureRuntimeBrokerTransport: vi.fn(),
  disposeRuntimeBroker: vi.fn(async () => undefined)
}))

vi.mock('#~/services/runtime-store/history-import.js', () => {
  importBoundaryMocks.runtimeStoreHistoryModuleLoaded()
  return {
    autoImportNativeProjectHistoryAndReplay: vi.fn(async () => ({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      scannedFiles: 0
    }))
  }
})

vi.mock('#~/services/runtime-store/watcher.js', () => {
  importBoundaryMocks.runtimeStoreWatcherModuleLoaded()
  return {
    startRuntimeStoreWatcher: vi.fn(() => importBoundaryMocks.runtimeStoreWatcher)
  }
})

vi.mock('#~/services/web-debug/chii.js', () => ({
  installWebDebugChii: vi.fn()
}))

vi.mock('../src/middlewares/index.js', () => ({
  initMiddlewares: vi.fn(async () => undefined)
}))

vi.mock('../src/routes/index.js', () => ({
  mountRoutes: vi.fn(async () => ({ onListen: vi.fn() }))
}))

vi.mock('../src/routes/runtime-broker-transport.js', () => ({
  startRuntimeBrokerLoopbackTransport: vi.fn(async () => ({
    baseUrl: 'http://127.0.0.1:12345',
    close: vi.fn(async () => undefined),
    server: {}
  }))
}))

vi.mock('../src/websocket/index.js', () => ({
  setupWebSocket: vi.fn()
}))

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('server startup import boundaries', () => {
  it('keeps workspace and post-listen modules out of the manager listen path', async () => {
    vi.useFakeTimers()
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '0')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'manager')

    const { startServer } = await import('../src/start-server.js')

    expect(importBoundaryMocks.channelsModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.channelResumeModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.pluginsModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.runtimeStoreHistoryModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.runtimeStoreWatcherModuleLoaded).not.toHaveBeenCalled()

    const runtime = await startServer()

    expect(importBoundaryMocks.channelsModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.channelResumeModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.pluginsModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.runtimeStoreHistoryModuleLoaded).not.toHaveBeenCalled()
    expect(importBoundaryMocks.runtimeStoreWatcherModuleLoaded).not.toHaveBeenCalled()

    await new Promise<void>((resolve, reject) => {
      runtime.server.close(error => error == null ? resolve() : reject(error))
    })
  })
})
