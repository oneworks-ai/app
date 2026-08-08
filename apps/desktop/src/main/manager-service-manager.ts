/* eslint-disable max-lines -- manager service keeps child-process startup and shutdown transitions together. */
import { spawn } from 'node:child_process'
import process from 'node:process'

import { app } from 'electron'

import { resolveProjectHomePath } from '@oneworks/register/dotenv'

import { sanitizeDesktopChildProcessEnv } from './child-process-env'
import { resolvePackagedCliPathEnv } from './cli-path-env'
import { CLIENT_BASE, MANAGER_READY_TIMEOUT_MS, SERVER_HOST } from './constants'
import {
  isDev,
  repoRoot,
  resolveCachedServerPackageEnv,
  resolveClientPackageDir,
  resolveServerExecutable,
  serverChildPath
} from './paths'
import { isChildProcessRunning, killChildProcess, writePrefixedChunk } from './process-utils'
import { getAvailablePort, waitForServerStartup } from './ready-checks'
import type { DesktopRuntimeState, ManagerService } from './types'
import {
  resolveDesktopDevClientFsAllowEnv,
  resolveDesktopDevRuntimeVersionEnv,
  resolveDirectSourceLoaderEnv,
  resolveRuntimeConsumerBootstrapEnv
} from './workspace-service-manager'

interface ManagerServiceManagerInput {
  getClientOrigin: () => Promise<string>
  getIsQuitting: () => boolean
  runtimeState: DesktopRuntimeState
}

interface ManagerRuntimeEnvInput {
  clientOrigin: string
  env?: NodeJS.ProcessEnv
  launchCwd?: string
  port: number
}

const elapsedMs = (startedAt: number) => `${Date.now() - startedAt}ms`

const logManagerStartup = (message: string) => {
  process.stdout.write(`[oneworks-server:manager] ${message}\n`)
}

const createManagerBaseEnv = (
  env: NodeJS.ProcessEnv,
  launchCwd: string
): NodeJS.ProcessEnv => {
  const nextEnv: NodeJS.ProcessEnv = {
    ...sanitizeDesktopChildProcessEnv(env),
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'manager',
    __ONEWORKS_PROJECT_LAUNCH_CWD__: launchCwd,
    __ONEWORKS_PROJECT_REAL_HOME__: env.__ONEWORKS_PROJECT_REAL_HOME__ ?? env.HOME ?? app.getPath('home'),
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager'
  }
  delete nextEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  delete nextEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  delete nextEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__
  return nextEnv
}

export const createManagerRuntimeEnv = ({
  clientOrigin,
  env = process.env,
  launchCwd = app.getPath('userData'),
  port
}: ManagerRuntimeEnvInput): NodeJS.ProcessEnv => {
  const baseEnv = createManagerBaseEnv(env, launchCwd)
  const dataDir = resolveProjectHomePath(launchCwd, baseEnv, 'server', 'data')
  const dbPath = resolveProjectHomePath(launchCwd, baseEnv, '.local', 'server', 'db.sqlite')
  const logDir = resolveProjectHomePath(launchCwd, baseEnv, 'logs', 'server')
  const runtimePackageCacheVersionEnv = resolveDesktopDevRuntimeVersionEnv(baseEnv)
  const packagedRuntimeEnv = {
    ...baseEnv,
    ...runtimePackageCacheVersionEnv
  }
  const clientPackageDir = resolveClientPackageDir(packagedRuntimeEnv)
  const serverExecutable = resolveServerExecutable()

  return {
    ...packagedRuntimeEnv,
    DB_PATH: dbPath,
    ELECTRON_RUN_AS_NODE: serverExecutable === process.execPath ? '1' : env.ELECTRON_RUN_AS_NODE,
    ...resolvePackagedCliPathEnv(packagedRuntimeEnv),
    ...resolveRuntimeConsumerBootstrapEnv(),
    ...resolveCachedServerPackageEnv(packagedRuntimeEnv),
    ...resolveDirectSourceLoaderEnv(serverExecutable),
    ...resolveDesktopDevClientFsAllowEnv(packagedRuntimeEnv),
    __ONEWORKS_PROJECT_CLIENT_BASE__: CLIENT_BASE,
    __ONEWORKS_PROJECT_CLIENT_MODE__: 'none',
    __ONEWORKS_PROJECT_CLIENT_PACKAGE_DIR__: clientPackageDir ?? '',
    __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: 'true',
    __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__: clientOrigin,
    __ONEWORKS_PROJECT_SERVER_DATA_DIR__: dataDir,
    __ONEWORKS_PROJECT_SERVER_HOST__: SERVER_HOST,
    __ONEWORKS_PROJECT_SERVER_LOG_DIR__: logDir,
    __ONEWORKS_PROJECT_SERVER_PORT__: String(port),
    __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false'
  }
}

export const getManagerServiceDataPaths = (
  env: NodeJS.ProcessEnv = process.env,
  launchCwd = app.getPath('userData')
) => {
  const managerEnv = createManagerBaseEnv(env, launchCwd)
  return {
    dataDir: resolveProjectHomePath(launchCwd, managerEnv, 'server', 'data'),
    dbPath: resolveProjectHomePath(launchCwd, managerEnv, '.local', 'server', 'db.sqlite'),
    logDir: resolveProjectHomePath(launchCwd, managerEnv, 'logs', 'server')
  }
}

export const createManagerServiceManager = ({
  getClientOrigin,
  getIsQuitting,
  runtimeState
}: ManagerServiceManagerInput) => {
  const handleManagerExit = (
    service: ManagerService,
    code: number | null,
    signal: NodeJS.Signals | null
  ) => {
    if (runtimeState.managerService === service) {
      runtimeState.managerService = undefined
    }
    service.status = 'stopped'
    service.stopPromise = undefined

    void killChildProcess(service.serverProcess, { killProcessGroup: true })
      .catch(error => console.error('[oneworks-server:manager] failed to stop server process group', error))

    if (service.stopping || getIsQuitting()) {
      return
    }

    console.error(
      `[oneworks-server:manager] server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`
    )
  }

  const stopManagerService = async (service?: ManagerService) => {
    if (service == null) return
    if (service.stopPromise != null) {
      await service.stopPromise
      return
    }

    service.stopping = true
    service.status = 'stopping'
    service.stopPromise = (async () => {
      await killChildProcess(service.serverProcess, { killProcessGroup: true })
      if (isChildProcessRunning(service.serverProcess)) {
        service.stopping = false
        service.status = 'ready'
        service.stopPromise = undefined
        return
      }

      if (runtimeState.managerService === service) {
        runtimeState.managerService = undefined
      }
      service.status = 'stopped'
      service.stopPromise = undefined
    })()
    await service.stopPromise
  }

  const ensureManagerService = async () => {
    const existingService = runtimeState.managerService
    if (existingService != null) {
      if (existingService.stopPromise != null) {
        await existingService.stopPromise
        return await ensureManagerService()
      }
      if (existingService.startPromise == null) {
        return existingService
      }
      return await existingService.startPromise
    }

    const service: ManagerService = {
      status: 'starting',
      stopping: false
    }
    const startedAt = Date.now()
    runtimeState.managerService = service
    service.startPromise = (async () => {
      logManagerStartup('startup waiting for launcher client origin')
      const clientOrigin = await getClientOrigin()
      const port = await getAvailablePort()
      service.port = port
      service.serverUrl = `http://${SERVER_HOST}:${port}`
      const serverExecutable = resolveServerExecutable()
      const launchCwd = isDev ? repoRoot : app.getPath('userData')
      const runtimeEnv = createManagerRuntimeEnv({
        clientOrigin,
        launchCwd,
        port
      })
      logManagerStartup(
        `startup spawning executable=${serverExecutable} clientOrigin=${clientOrigin} ` +
          `port=${port} elapsed=${elapsedMs(startedAt)}`
      )
      const child = spawn(serverExecutable, [serverChildPath, '--manager'], {
        cwd: launchCwd,
        detached: process.platform !== 'win32',
        env: {
          ...runtimeEnv,
          __ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__: 'ipc-v1'
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })

      service.serverProcess = child
      child.stdout?.on(
        'data',
        data => writePrefixedChunk(process.stdout, '[oneworks-server:manager] ', data)
      )
      child.stderr?.on(
        'data',
        data => writePrefixedChunk(process.stderr, '[oneworks-server:manager] ', data)
      )
      child.once('exit', (code, signal) => {
        handleManagerExit(service, code, signal)
      })

      await waitForServerStartup(child, MANAGER_READY_TIMEOUT_MS)
      service.status = 'ready'
      service.startPromise = undefined
      logManagerStartup(`startup ready url=${service.serverUrl} elapsed=${elapsedMs(startedAt)}`)
      return service
    })().catch(async (error) => {
      await stopManagerService(service)
      throw error
    })

    return await service.startPromise
  }

  return {
    ensureManagerService,
    getManagerServiceDataPaths,
    stopManagerService
  }
}

export type ManagerServiceManager = ReturnType<typeof createManagerServiceManager>
