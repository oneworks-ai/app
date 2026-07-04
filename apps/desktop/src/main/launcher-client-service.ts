/* eslint-disable max-lines -- shared client service owns dev and packaged client startup timing. */
import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import process from 'node:process'

import { app } from 'electron'

import { CLIENT_BASE, SERVER_HOST } from './constants'
import { startPackagedLauncherStaticServer } from './launcher-static-server'
import { clientCliPath, isDev, resolveClientDevExecutable, resolveClientDistPath } from './paths'
import { isChildProcessRunning, killChildProcess, writePrefixedChunk } from './process-utils'
import { getAvailablePort, waitForClientStartup } from './ready-checks'
import { resolveDesktopRuntimePackageCacheVersionEnv } from './runtime-cache-version'
import type { DesktopRuntimeState, LauncherClientService } from './types'

interface LauncherClientServiceManagerInput {
  getIsQuitting: () => boolean
  runtimeState: DesktopRuntimeState
}

const elapsedMs = (startedAt: number) => `${Date.now() - startedAt}ms`

const logClientStartup = (message: string) => {
  process.stdout.write(`[oneworks-client:desktop] ${message}\n`)
}

export const resolvePackagedLauncherClientRuntimeEnv = (
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => ({
  ...env,
  ...resolveDesktopRuntimePackageCacheVersionEnv(env)
})

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve()
    })
  })

export const createLauncherClientServiceManager = ({
  getIsQuitting,
  runtimeState
}: LauncherClientServiceManagerInput) => {
  const stopLauncherClientService = async (service?: LauncherClientService) => {
    if (service == null) return
    if (service.stopPromise != null) {
      await service.stopPromise
      return
    }

    service.stopping = true
    service.status = 'stopping'
    service.stopPromise = (async () => {
      await Promise.all([
        killChildProcess(service.clientProcess),
        service.clientServer == null ? Promise.resolve() : closeServer(service.clientServer)
      ])

      if (isChildProcessRunning(service.clientProcess)) {
        service.stopping = false
        service.status = 'ready'
        service.stopPromise = undefined
        return
      }

      if (runtimeState.launcherClientService === service) {
        runtimeState.launcherClientService = undefined
      }
      service.status = 'stopped'
      service.stopPromise = undefined
    })()
    await service.stopPromise
  }

  const handleClientExit = (
    service: LauncherClientService,
    code: number | null,
    signal: NodeJS.Signals | null
  ) => {
    if (runtimeState.launcherClientService === service) {
      runtimeState.launcherClientService = undefined
    }
    service.status = 'stopped'
    service.stopPromise = undefined

    if (service.stopping || getIsQuitting()) {
      return
    }

    console.error(
      `[oneworks-client:launcher] client dev server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`
    )
  }

  const startLauncherDevClient = async (service: LauncherClientService) => {
    const startedAt = Date.now()
    logClientStartup('startup begin mode=dev')
    const clientPort = await getAvailablePort()
    logClientStartup(`startup port allocated port=${clientPort} elapsed=${elapsedMs(startedAt)}`)
    const clientExecutable = resolveClientDevExecutable()
    logClientStartup(`startup spawning executable=${clientExecutable} elapsed=${elapsedMs(startedAt)}`)
    const child = spawn(clientExecutable, [clientCliPath], {
      cwd: app.getPath('userData'),
      env: {
        ...process.env,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '',
        __ONEWORKS_PROJECT_CLIENT_BASE__: CLIENT_BASE,
        __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__: 'true',
        __ONEWORKS_PROJECT_CLIENT_HOST__: SERVER_HOST,
        __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
        __ONEWORKS_PROJECT_CLIENT_PORT__: String(clientPort),
        __ONEWORKS_PROJECT_SERVER_BASE_URL__: '',
        __ONEWORKS_PROJECT_SERVER_HOST__: '',
        __ONEWORKS_PROJECT_SERVER_PORT__: '',
        __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    service.clientPort = clientPort
    service.clientProcess = child
    logClientStartup(`startup spawned pid=${child.pid ?? 'unknown'} elapsed=${elapsedMs(startedAt)}`)
    child.stdout?.on('data', data => writePrefixedChunk(process.stdout, '[oneworks-client:launcher] ', data))
    child.stderr?.on('data', data => writePrefixedChunk(process.stderr, '[oneworks-client:launcher] ', data))
    child.once('exit', (code, signal) => {
      handleClientExit(service, code, signal)
    })

    await waitForClientStartup(child, clientPort)
    service.clientUrl = `http://${SERVER_HOST}:${clientPort}${CLIENT_BASE}`
    logClientStartup(`startup ready url=${service.clientUrl} elapsed=${elapsedMs(startedAt)}`)
  }

  const startPackagedLauncherClient = async (service: LauncherClientService) => {
    const startedAt = Date.now()
    logClientStartup('startup begin mode=packaged')
    const packagedClientRuntimeEnv = resolvePackagedLauncherClientRuntimeEnv()
    const distPath = resolveClientDistPath(packagedClientRuntimeEnv)
    if (distPath == null) {
      throw new Error('Client dist was not found. Run `pnpm -C apps/desktop build:client` first.')
    }
    logClientStartup(`startup dist resolved path=${distPath} elapsed=${elapsedMs(startedAt)}`)

    const clientPort = await getAvailablePort()
    logClientStartup(`startup port allocated port=${clientPort} elapsed=${elapsedMs(startedAt)}`)
    const { clientUrl, server } = await startPackagedLauncherStaticServer({
      clientBase: CLIENT_BASE,
      distPath,
      port: clientPort
    })

    service.clientPort = clientPort
    service.clientServer = server
    service.clientUrl = clientUrl
    logClientStartup(`startup ready url=${service.clientUrl} elapsed=${elapsedMs(startedAt)}`)
  }

  const ensureLauncherClientService = async () => {
    const existingService = runtimeState.launcherClientService
    if (existingService != null) {
      if (existingService.stopPromise != null) {
        await existingService.stopPromise
        return await ensureLauncherClientService()
      }
      if (existingService.startPromise == null) {
        return existingService
      }
      return await existingService.startPromise
    }

    const service: LauncherClientService = {
      status: 'starting',
      stopping: false
    }
    const startedAt = Date.now()
    logClientStartup('ensure created shared client service')
    runtimeState.launcherClientService = service
    service.startPromise = (async () => {
      if (isDev) {
        await startLauncherDevClient(service)
      } else {
        await startPackagedLauncherClient(service)
      }
      if (service.stopping) {
        service.startPromise = undefined
        await stopLauncherClientService(service)
        return service
      }
      service.status = 'ready'
      service.startPromise = undefined
      logClientStartup(`ensure ready elapsed=${elapsedMs(startedAt)}`)
      return service
    })().catch(async (error) => {
      await stopLauncherClientService(service)
      throw error
    })

    return await service.startPromise
  }

  return {
    ensureLauncherClientService,
    stopLauncherClientService
  }
}

export type LauncherClientServiceManager = ReturnType<typeof createLauncherClientServiceManager>
