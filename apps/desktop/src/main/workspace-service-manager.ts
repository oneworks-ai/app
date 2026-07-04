/* eslint-disable max-lines -- service manager keeps child-process startup and shutdown transitions together. */
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import { resolvePrimaryWorkspaceFolder, resolveProjectHomePath } from '@oneworks/register/dotenv'

import { getWorkspaceDescription, getWorkspaceDisplayName } from '../workspace-state.cjs'
import { resolvePackagedCliPathEnv } from './cli-path-env'
import { CLIENT_BASE, SERVER_HOST } from './constants'
import {
  isDev,
  repoRoot,
  resolveBundledRuntimeConsumerBootstrapPath,
  resolveCachedServerPackageEnv,
  resolveClientDistPath,
  resolveServerExecutable,
  serverChildPath
} from './paths'
import { isChildProcessRunning, killChildProcess, writePrefixedChunk } from './process-utils'
import { getAvailablePort, waitForServerStartup } from './ready-checks'
import { resolveDesktopRuntimePackageCacheVersionEnv } from './runtime-cache-version'
import type {
  DesktopRuntimeState,
  WindowRecord,
  WorkspaceDataPaths,
  WorkspaceSelectorWindowInput,
  WorkspaceService
} from './types'
import { refreshWorkspaceRuntimeCacheInBackground } from './updates'

interface WorkspaceServiceManagerInput {
  broadcastWorkspaceSelectorState: () => void
  findWorkspaceWindowRecord: (workspaceFolder: string) => WindowRecord | undefined
  getDesktopClientOrigin: () => string | undefined
  getIsQuitting: () => boolean
  loadWorkspaceSelectorWindow: (
    windowRecord: WindowRecord,
    input: WorkspaceSelectorWindowInput
  ) => Promise<void> | undefined
  refreshAppMenu: () => void
  runtimeState: DesktopRuntimeState
}

export const getWorkspaceServiceDataPaths = (workspaceFolder: string): WorkspaceDataPaths => {
  const env = createWorkspaceRuntimeEnv(workspaceFolder)
  return {
    dataDir: resolveProjectHomePath(workspaceFolder, env, 'server', 'data'),
    dbPath: resolveProjectHomePath(workspaceFolder, env, '.local', 'server', 'db.sqlite'),
    logDir: resolveProjectHomePath(workspaceFolder, env, 'logs', 'server')
  }
}

const createWorkspaceRuntimeEnv = (workspaceFolder: string): NodeJS.ProcessEnv => {
  const normalizedWorkspaceFolder = path.resolve(workspaceFolder)
  const inheritedWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim()
  const inheritedWorkspaceMatches = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    path.resolve(inheritedWorkspaceFolder) === normalizedWorkspaceFolder
  const preserveInheritedPrimaryWorkspace = inheritedWorkspaceFolder != null &&
    inheritedWorkspaceFolder !== '' &&
    inheritedWorkspaceMatches &&
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__?.trim() != null &&
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__?.trim() !== ''
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    __ONEWORKS_PROJECT_LAUNCH_CWD__: normalizedWorkspaceFolder,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: normalizedWorkspaceFolder,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: normalizedWorkspaceFolder
  }

  if (!preserveInheritedPrimaryWorkspace) {
    delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(normalizedWorkspaceFolder, env)
    if (primaryWorkspaceFolder != null) {
      env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryWorkspaceFolder
    }
  }
  if (inheritedWorkspaceFolder != null && inheritedWorkspaceFolder !== '' && !inheritedWorkspaceMatches) {
    delete env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  }

  const aiBaseDirSourceCwd = env.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__?.trim()
  if (
    aiBaseDirSourceCwd == null ||
    aiBaseDirSourceCwd === '' ||
    !isPathInside(normalizedWorkspaceFolder, path.resolve(aiBaseDirSourceCwd))
  ) {
    env.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__ = normalizedWorkspaceFolder
  }

  return env
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const quoteNodeOptionValue = (value: string) => (
  /[\s"']/u.test(value) ? JSON.stringify(value) : value
)

const resolveDirectSourceLoaderEnv = (
  executable: string
): Pick<NodeJS.ProcessEnv, 'NODE_OPTIONS' | '__IS_LOADER_CLI__'> | {} => {
  if (!isDev) return {}
  if (executable !== 'node' && path.basename(executable) !== 'node') return {}

  const registerPreloadPath = path.join(repoRoot, 'packages/register/preload.js')
  const nodeOptions = [
    '--conditions=__oneworks__',
    `--require=${quoteNodeOptionValue(registerPreloadPath)}`,
    process.env.NODE_OPTIONS ?? ''
  ].filter(value => value.trim() !== '').join(' ').trim()

  return {
    NODE_OPTIONS: nodeOptions,
    __IS_LOADER_CLI__: 'true'
  }
}

export const resolveRuntimeConsumerBootstrapEnv = ():
  | Pick<
    NodeJS.ProcessEnv,
    | '__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__'
    | '__ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__'
  >
  | {} =>
{
  const bootstrapPath = resolveBundledRuntimeConsumerBootstrapPath()
  if (bootstrapPath == null) return {}

  return {
    __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: bootstrapPath,
    ...(isDev ? {} : { __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: bootstrapPath })
  }
}

export const resolveDesktopDevRuntimeVersionEnv = (
  env: NodeJS.ProcessEnv = process.env
):
  | Pick<
    NodeJS.ProcessEnv,
    '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__' | '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__'
  >
  | {} => resolveDesktopRuntimePackageCacheVersionEnv(env)

const elapsedMs = (startedAt: number) => `${Date.now() - startedAt}ms`

const logServerStartup = (displayName: string, message: string) => {
  process.stdout.write(`[oneworks-server:${displayName}] ${message}\n`)
}

export const createWorkspaceServiceManager = ({
  broadcastWorkspaceSelectorState,
  findWorkspaceWindowRecord,
  getDesktopClientOrigin,
  getIsQuitting,
  loadWorkspaceSelectorWindow,
  refreshAppMenu,
  runtimeState
}: WorkspaceServiceManagerInput) => {
  const handleServiceExit = (
    service: WorkspaceService,
    processLabel: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ) => {
    const wasStopping = service.stopping
    if (runtimeState.services.get(service.workspaceFolder) === service) {
      runtimeState.services.delete(service.workspaceFolder)
    }
    service.status = 'stopped'
    service.stopPromise = undefined
    broadcastWorkspaceSelectorState()
    refreshAppMenu()

    if (wasStopping || getIsQuitting()) {
      return
    }

    service.stopping = true
    void killChildProcess(service.serverProcess)
      .catch(error =>
        console.error(`[oneworks-server] failed to stop ${service.displayName} after process exit`, error)
      )

    const workspaceWindowRecord = findWorkspaceWindowRecord(service.workspaceFolder)
    if (workspaceWindowRecord != null) {
      void loadWorkspaceSelectorWindow(workspaceWindowRecord, {
        errorMessage: `The local ${processLabel} for ${service.displayName} stopped unexpectedly (code=${
          code ?? 'null'
        } signal=${signal ?? 'null'}).`,
        mode: 'dialog'
      })
    } else {
      console.error(
        `[oneworks-server] ${service.displayName} ${processLabel} exited with code=${code ?? 'null'} signal=${
          signal ?? 'null'
        }`
      )
    }
  }

  const stopWorkspaceService = async (service?: WorkspaceService) => {
    if (service == null) return
    if (service.stopPromise != null) {
      await service.stopPromise
      return
    }

    service.stopping = true
    service.status = 'stopping'
    broadcastWorkspaceSelectorState()
    refreshAppMenu()

    service.stopPromise = (async () => {
      await killChildProcess(service.serverProcess)
      if (isChildProcessRunning(service.serverProcess)) {
        service.stopping = false
        service.status = 'ready'
        service.stopPromise = undefined
        broadcastWorkspaceSelectorState()
        refreshAppMenu()
      }
    })()
    await service.stopPromise
  }

  const resolveWorkspaceServiceStartup = async (service: WorkspaceService) => {
    if (service.startPromise == null) {
      return service
    }
    return await service.startPromise
  }

  const ensureWorkspaceServiceRecord = async (workspaceFolder: string): Promise<WorkspaceService> => {
    const existingService = runtimeState.services.get(workspaceFolder)
    if (existingService != null) {
      if (existingService.stopPromise != null) {
        await existingService.stopPromise
        return await ensureWorkspaceServiceRecord(workspaceFolder)
      }
      return existingService
    }

    const service: WorkspaceService = {
      description: getWorkspaceDescription(workspaceFolder),
      displayName: getWorkspaceDisplayName(workspaceFolder),
      status: 'starting',
      stopping: false,
      workspaceFolder
    }
    runtimeState.services.set(workspaceFolder, service)
    broadcastWorkspaceSelectorState()
    refreshAppMenu()

    service.startPromise = (async () => {
      const startedAt = Date.now()
      logServerStartup(service.displayName, `startup begin workspace=${workspaceFolder}`)
      const port = await getAvailablePort()
      logServerStartup(service.displayName, `startup port allocated port=${port} elapsed=${elapsedMs(startedAt)}`)
      const desktopClientOrigin = getDesktopClientOrigin()
      const serverExecutable = resolveServerExecutable()
      logServerStartup(
        service.displayName,
        `startup spawning executable=${serverExecutable} ` +
          `clientOrigin=${desktopClientOrigin ?? 'none'} elapsed=${elapsedMs(startedAt)}`
      )
      const workspaceServiceDataPaths = getWorkspaceServiceDataPaths(workspaceFolder)
      const directSourceLoaderEnv = resolveDirectSourceLoaderEnv(serverExecutable)
      const workspaceRuntimeEnv = createWorkspaceRuntimeEnv(workspaceFolder)
      const runtimePackageCacheVersionEnv = resolveDesktopDevRuntimeVersionEnv(workspaceRuntimeEnv)
      const packagedWorkspaceRuntimeEnv = {
        ...workspaceRuntimeEnv,
        ...runtimePackageCacheVersionEnv
      }
      const clientDistPath = isDev ? undefined : resolveClientDistPath(packagedWorkspaceRuntimeEnv)
      if (!isDev && clientDistPath == null) {
        throw new Error('Client dist was not found. Run `pnpm -C apps/desktop build:client` first.')
      }
      const child = spawn(serverExecutable, [serverChildPath], {
        cwd: workspaceFolder,
        env: {
          ...packagedWorkspaceRuntimeEnv,
          DB_PATH: workspaceServiceDataPaths.dbPath,
          ELECTRON_RUN_AS_NODE: serverExecutable === process.execPath ? '1' : process.env.ELECTRON_RUN_AS_NODE,
          ...resolvePackagedCliPathEnv(packagedWorkspaceRuntimeEnv),
          ...resolveRuntimeConsumerBootstrapEnv(),
          ...resolveCachedServerPackageEnv(packagedWorkspaceRuntimeEnv),
          ...directSourceLoaderEnv,
          __ONEWORKS_PROJECT_CLIENT_BASE__: CLIENT_BASE,
          __ONEWORKS_PROJECT_CLIENT_DIST_PATH__: clientDistPath ?? '',
          __ONEWORKS_PROJECT_CLIENT_MODE__: isDev ? 'none' : 'desktop',
          __ONEWORKS_PROJECT_SERVER_DATA_DIR__: workspaceServiceDataPaths.dataDir,
          __ONEWORKS_PROJECT_SERVER_HOST__: SERVER_HOST,
          __ONEWORKS_PROJECT_SERVER_LOG_DIR__: workspaceServiceDataPaths.logDir,
          __ONEWORKS_PROJECT_SERVER_PORT__: String(port),
          __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: desktopClientOrigin == null ? 'false' : 'true',
          __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__: desktopClientOrigin ?? '',
          __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      service.port = port
      service.serverProcess = child
      logServerStartup(
        service.displayName,
        `startup spawned pid=${child.pid ?? 'unknown'} elapsed=${elapsedMs(startedAt)}`
      )

      child.stdout?.on(
        'data',
        data => writePrefixedChunk(process.stdout, `[oneworks-server:${service.displayName}] `, data)
      )
      child.stderr?.on(
        'data',
        data => writePrefixedChunk(process.stderr, `[oneworks-server:${service.displayName}] `, data)
      )
      child.once('exit', (code, signal) => {
        handleServiceExit(service, 'server', code, signal)
      })

      await waitForServerStartup(child)
      refreshWorkspaceRuntimeCacheInBackground()

      service.serverUrl = `http://${SERVER_HOST}:${port}`
      service.status = 'ready'
      logServerStartup(service.displayName, `startup ready url=${service.serverUrl} elapsed=${elapsedMs(startedAt)}`)
      broadcastWorkspaceSelectorState()
      refreshAppMenu()
      return service
    })().catch(async (error) => {
      await stopWorkspaceService(service)
      throw error
    })
    void service.startPromise.catch(() => undefined)

    return service
  }

  const ensureWorkspaceService = async (workspaceFolder: string): Promise<WorkspaceService> => {
    const service = await ensureWorkspaceServiceRecord(workspaceFolder)
    return await resolveWorkspaceServiceStartup(service)
  }

  return {
    ensureWorkspaceService,
    getWorkspaceServiceDataPaths,
    stopWorkspaceService
  }
}

export type WorkspaceServiceManager = ReturnType<typeof createWorkspaceServiceManager>
