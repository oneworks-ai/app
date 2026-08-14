import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NativeHistoryImportResult } from '../src/services/runtime-store/history-import.js'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { migrateDefaultServerDataDir } from '../src/project-home-data-migration.js'

const startServerMocks = vi.hoisted(() => {
  const runtimeStoreWatcher = {
    scanAndReplay: vi.fn(async () => undefined),
    stop: vi.fn()
  }
  const channelResumeScheduler = { stop: vi.fn() }
  const channelManager = { closeAll: vi.fn(async () => undefined) }
  const mountRoutesOnListen = vi.fn()
  const pluginManager = {
    dispose: vi.fn(async (): Promise<void> => undefined),
    load: vi.fn(async (): Promise<void> => undefined)
  }
  return {
    acquireConfigWatchRuntime: vi.fn(async () => ({ release: vi.fn() })),
    autoImportNativeProjectHistoryAndReplay: vi.fn(async (): Promise<NativeHistoryImportResult> => ({
      aggregateLimitedBytes: 0,
      aggregateLimitedFiles: 0,
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      perFileLimitedBytes: 0,
      perFileLimitedFiles: 0,
      rejectedFiles: 0,
      scannedFiles: 0,
      sessions: [],
      sizeLimitedBytes: 0,
      sizeLimitedFiles: 0
    })),
    channelManager,
    channelResumeScheduler,
    getPluginManager: vi.fn(() => pluginManager),
    handleChannelSessionEvent: vi.fn(),
    initChannels: vi.fn(async () => channelManager),
    initMiddlewares: vi.fn(async () => undefined),
    installAssetCreateConnectionGuard: vi.fn(),
    installWebDebugChii: vi.fn(),
    mountRoutes: vi.fn(async () => ({ onListen: mountRoutesOnListen })),
    mountRoutesOnListen,
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    pluginManager,
    runtimeStoreWatcher,
    setupWebSocket: vi.fn(),
    startChannelResumeScheduler: vi.fn(() => channelResumeScheduler),
    startRuntimeStoreWatcher: vi.fn(() => runtimeStoreWatcher),
    writeServerInstanceState: vi.fn(async () => undefined),
    removeServerInstanceStateForPid: vi.fn(async () => undefined)
  }
})

vi.mock('../src/channels/index.js', () => ({
  handleChannelSessionEvent: startServerMocks.handleChannelSessionEvent,
  initChannels: startServerMocks.initChannels
}))

vi.mock('#~/services/ai/asset-create-operation.js', () => ({
  installAssetCreateConnectionGuard: startServerMocks.installAssetCreateConnectionGuard
}))

vi.mock('#~/services/channel-resume/index.js', () => ({
  startChannelResumeScheduler: startServerMocks.startChannelResumeScheduler
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: vi.fn(async () => ({
    globalConfig: undefined,
    projectSource: undefined,
    userConfig: {},
    mergedConfig: {}
  }))
}))

vi.mock('#~/services/config/watch.js', () => ({
  acquireConfigWatchRuntime: startServerMocks.acquireConfigWatchRuntime
}))

vi.mock('#~/services/model-providers/catalog-loader.js', () => ({
  initializeModelProviderCatalog: vi.fn(async () => undefined)
}))

vi.mock('#~/services/plugins/index.js', () => ({
  getPluginManager: startServerMocks.getPluginManager
}))

vi.mock('#~/services/runtime-store/history-import.js', () => ({
  autoImportNativeProjectHistoryAndReplay: startServerMocks.autoImportNativeProjectHistoryAndReplay
}))

vi.mock('#~/services/runtime-store/watcher.js', () => ({
  startRuntimeStoreWatcher: startServerMocks.startRuntimeStoreWatcher
}))

vi.mock('#~/services/server-instance.js', () => ({
  removeServerInstanceStateForPid: startServerMocks.removeServerInstanceStateForPid,
  writeServerInstanceState: startServerMocks.writeServerInstanceState
}))

vi.mock('#~/services/web-debug/chii.js', () => ({
  installWebDebugChii: startServerMocks.installWebDebugChii
}))

vi.mock('../src/middlewares/index.js', () => ({
  initMiddlewares: startServerMocks.initMiddlewares
}))

vi.mock('#~/utils/logger.js', () => ({
  logger: {
    info: startServerMocks.loggerInfo,
    warn: startServerMocks.loggerWarn
  }
}))

vi.mock('../src/routes/index.js', () => ({
  mountRoutes: startServerMocks.mountRoutes
}))

vi.mock('../src/websocket/index.js', () => ({
  setupWebSocket: startServerMocks.setupWebSocket
}))

const tempDirs: string[] = []
const originalCwd = process.cwd()

afterEach(async () => {
  process.chdir(originalCwd)
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const startRuntimeForRole = async (role: 'manager' | 'workspace') => {
  vi.useFakeTimers()
  vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
  vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '0')
  vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', role)

  const { startServer } = await import('../src/start-server.js')
  const runtime = await startServer()
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        runtime.server.close(error => error == null ? resolve() : reject(error))
      }),
    runtime
  }
}

describe('createServerRuntime', () => {
  it('migrates legacy default data when the configured data dir is the project-home default', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-start-'))
    tempDirs.push(root)
    const workspace = resolve(root, 'workspace')
    const projectsDir = resolve(root, 'home-projects')

    await mkdir(resolve(workspace, '.data'), { recursive: true })
    await writeFile(resolve(workspace, '.data', 'web-auth-password'), 'legacy-password\n', 'utf8')

    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspace,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir
    }
    const dataDir = resolveProjectHomePath(workspace, env, 'server', 'data')

    vi.stubEnv('__ONEWORKS_PROJECT_LAUNCH_CWD__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', projectsDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_DATA_DIR__', dataDir)
    process.chdir(workspace)

    const { createServerRuntime } = await import('../src/start-server.js')
    const runtime = await createServerRuntime()

    expect(runtime.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toBe(dataDir)
    await expect(readFile(resolve(dataDir, 'web-auth-password'), 'utf8')).resolves.toBe('legacy-password\n')
  })

  it('migrates default server data from the primary workspace into shared project home', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-start-'))
    tempDirs.push(root)
    const primary = resolve(root, 'primary')
    const worktree = resolve(root, 'worktree')
    const projectsDir = resolve(root, 'home-projects')

    await mkdir(resolve(primary, '.data'), { recursive: true })
    await mkdir(resolve(primary, '.oo', 'server', 'data'), { recursive: true })
    await writeFile(resolve(primary, '.data', 'web-auth-password'), 'primary-password\n', 'utf8')
    await writeFile(resolve(primary, '.oo', 'server', 'data', 'state.json'), '{"primary":true}\n', 'utf8')

    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: worktree,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir
    }
    const dataDir = resolveProjectHomePath(worktree, env, 'server', 'data')

    await expect(migrateDefaultServerDataDir(worktree, env)).resolves.toBe(dataDir)
    await expect(readFile(resolve(dataDir, 'web-auth-password'), 'utf8')).resolves.toBe('primary-password\n')
    await expect(readFile(resolve(dataDir, 'state.json'), 'utf8')).resolves.toBe('{"primary":true}\n')
  })
})

describe('shouldOwnWorkspaceRuntime', () => {
  it('keeps channels and runtime consumers on workspace servers', async () => {
    const { shouldOwnWorkspaceRuntime } = await import('../src/start-server.js')

    expect(shouldOwnWorkspaceRuntime('manager')).toBe(false)
    expect(shouldOwnWorkspaceRuntime('workspace')).toBe(true)
    expect(shouldOwnWorkspaceRuntime(undefined)).toBe(true)
  })
})

describe('startServer workspace runtime ownership', () => {
  it('does not start workspace channel or runtime owners in manager mode', async () => {
    const { close, runtime } = await startRuntimeForRole('manager')

    expect(startServerMocks.initChannels).not.toHaveBeenCalled()
    expect(startServerMocks.startChannelResumeScheduler).not.toHaveBeenCalled()
    expect(startServerMocks.writeServerInstanceState).toHaveBeenCalledWith(
      runtime.env,
      expect.objectContaining({
        pid: process.pid,
        role: 'manager',
        serverBaseUrl: expect.stringMatching(/^http:\/\//u)
      })
    )
    await vi.advanceTimersByTimeAsync(500)
    expect(startServerMocks.startRuntimeStoreWatcher).not.toHaveBeenCalled()

    await close()
    expect(startServerMocks.removeServerInstanceStateForPid).toHaveBeenCalledWith(runtime.env, process.pid)
  })

  it('initializes channel owners before advertising the workspace server', async () => {
    const { close } = await startRuntimeForRole('workspace')

    expect(startServerMocks.initChannels).toHaveBeenCalledOnce()
    expect(startServerMocks.startChannelResumeScheduler).toHaveBeenCalledOnce()
    expect(startServerMocks.mountRoutesOnListen).toHaveBeenCalledOnce()
    expect(startServerMocks.initChannels.mock.invocationCallOrder[0]).toBeLessThan(
      startServerMocks.mountRoutesOnListen.mock.invocationCallOrder[0]!
    )
    expect(startServerMocks.startRuntimeStoreWatcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    await vi.dynamicImportSettled()
    expect(startServerMocks.startRuntimeStoreWatcher).toHaveBeenCalledOnce()

    await close()
  })

  it('serializes manager plugin disposal after an in-flight preload', async () => {
    let finishLoad: (() => void) | undefined
    startServerMocks.pluginManager.load.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        finishLoad = resolve
      })
    )
    const { close } = await startRuntimeForRole('manager')

    await vi.advanceTimersByTimeAsync(0)
    expect(startServerMocks.pluginManager.load).toHaveBeenCalledOnce()
    const closePromise = close()
    finishLoad?.()
    await closePromise
    await vi.dynamicImportSettled()

    expect(startServerMocks.pluginManager.dispose).toHaveBeenCalledOnce()
    expect(startServerMocks.pluginManager.load.mock.invocationCallOrder[0]).toBeLessThan(
      startServerMocks.pluginManager.dispose.mock.invocationCallOrder[0]!
    )
  })

  it('reports an optional Goose auto-import skip without treating startup replay as failed', async () => {
    startServerMocks.autoImportNativeProjectHistoryAndReplay.mockResolvedValueOnce({
      aggregateLimitedBytes: 0,
      aggregateLimitedFiles: 0,
      diagnostics: [{
        adapter: 'goose',
        code: 'adapter_unavailable',
        level: 'warning',
        message: 'Skipped Goose native history because its configured CLI is unavailable.'
      }],
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      perFileLimitedBytes: 0,
      perFileLimitedFiles: 0,
      rejectedFiles: 0,
      scannedFiles: 2,
      sessions: [],
      sizeLimitedBytes: 0,
      sizeLimitedFiles: 0
    })
    const { close } = await startRuntimeForRole('workspace')

    await vi.advanceTimersByTimeAsync(500)
    await vi.waitFor(() => {
      expect(startServerMocks.loggerWarn).toHaveBeenCalledWith({
        adapter: 'goose',
        code: 'adapter_unavailable',
        level: 'warning',
        skippedSessions: undefined
      }, 'Skipped Goose native history because its configured CLI is unavailable.')
    })
    expect(startServerMocks.loggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      '[runtime-store] Runtime store initial replay or native history auto import failed'
    )

    await close()
  })
})
