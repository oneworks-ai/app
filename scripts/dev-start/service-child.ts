/* eslint-disable max-lines -- service child coordinates target config, linked services, and process startup. */

import type { ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import type { DesktopControlServer } from '../desktop-control-server'
import { startDesktopControlServer } from '../desktop-control-server'
import { getTargetConfig } from './config'
import { readDevServiceLease } from './coordination'
import { getDocsUrl, startDocsProcess } from './docs-process'
import { buildRuntimeEnv, getClientHost, getServerHost } from './env'
import { waitForHealthUrl, waitForServer, waitForUrl } from './network'
import { componentLogPath, managerLogPath, normalizeText, repoRoot, sleep } from './paths'
import { readState, spawnLogged, waitForChildSpawn } from './process'
import { processFingerprint, terminateTrackedPid } from './process-identity'
import { readOperationFromEnv, replaceDevServiceStateIfCurrent, updateDevServiceStateIfCurrent } from './state'
import type { DevServiceComponentState, DevStartState, DevStartTarget } from './types'

const getClientUrl = (clientPort: number, baseValue: string | undefined, urlSuffix: string | undefined) => {
  const base = baseValue?.endsWith('/') === true ? baseValue : `${baseValue ?? '/ui'}/`
  return `http://${getClientHost()}:${clientPort}${base}${urlSuffix ?? ''}`
}

export const runServiceChild = async (target: DevStartTarget) => {
  const config = getTargetConfig(target)
  const operation = readOperationFromEnv()
  const linkedDocsUrl = normalizeText(process.env.ONEWORKS_DEV_START_LINKED_DOCS_URL) ??
    normalizeText(process.env.PUBLIC_DOCS_URL)
  const linkedHomepageUrl = normalizeText(process.env.ONEWORKS_DEV_START_LINKED_HOMEPAGE_URL) ??
    normalizeText(process.env.VITE_ONEWORKS_DOCS_HOMEPAGE_URL)
  const serverPort = process.env.__ONEWORKS_PROJECT_SERVER_PORT__ == null
    ? undefined
    : Number(process.env.__ONEWORKS_PROJECT_SERVER_PORT__)
  const clientPort = process.env.__ONEWORKS_PROJECT_CLIENT_PORT__ == null
    ? undefined
    : Number(process.env.__ONEWORKS_PROJECT_CLIENT_PORT__)
  const runtimeEnv = await buildRuntimeEnv({
    base: config.base,
    clientMode: config.clientMode,
    clientPort,
    extra: config.extraEnv,
    serverRole: config.serverRole,
    serverPort
  })
  const projectHomeDir = runtimeEnv.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  if (projectHomeDir == null) throw new Error('Project home directory was not resolved')

  const serverLog = componentLogPath(target, 'server')
  const clientLog = componentLogPath(target, 'client')
  mkdirSync(dirname(serverLog), { recursive: true })
  writeFileSync(serverLog, '')
  writeFileSync(clientLog, '')

  const urls: Pick<
    DevStartState,
    'clientUrl' | 'controlUrl' | 'docsUrl' | 'linkedDocsUrl' | 'linkedHomepageUrl' | 'serverUrl'
  > = config.kind === 'desktop-control'
    ? {
      ...(serverPort != null ? { controlUrl: `http://${getServerHost()}:${serverPort}` } : {})
    }
    : config.kind === 'relay'
    ? {
      ...(serverPort != null ? { serverUrl: `http://${getServerHost()}:${serverPort}` } : {}),
      ...(clientPort != null ? { clientUrl: `http://${getClientHost()}:${clientPort}/admin/users` } : {})
    }
    : target === 'homepage'
    ? {
      ...(clientPort != null ? { clientUrl: `http://${getClientHost()}:${clientPort}/` } : {}),
      ...(linkedDocsUrl != null ? { linkedDocsUrl } : {})
    }
    : {
      ...(serverPort != null ? { serverUrl: `http://${getServerHost()}:${serverPort}` } : {}),
      ...(clientPort != null && config.needsClient
        ? {
          clientUrl: getClientUrl(clientPort, config.base, config.urlSuffix)
        }
        : {}),
      ...(target === 'docs' && clientPort != null ? { docsUrl: getDocsUrl(clientPort) } : {}),
      ...(target === 'docs' && linkedHomepageUrl != null ? { linkedHomepageUrl } : {})
    }
  let stopping = false
  let serverProcess: ChildProcess | undefined
  let clientProcess: ChildProcess | undefined
  let serverFingerprint: string | undefined
  let clientFingerprint: string | undefined
  let controlServer: DesktopControlServer | undefined
  const serviceFingerprint = processFingerprint(process.pid)
  if (serviceFingerprint == null) throw new Error(`Could not fingerprint ${target} service manager.`)

  const captureFingerprint = async (child: ChildProcess, label: string) => {
    await waitForChildSpawn(child, label)
    const fingerprint = processFingerprint(child.pid)
    if (fingerprint == null) throw new Error(`Could not fingerprint ${label}.`)
    return fingerprint
  }

  const cleanup = async () => {
    if (stopping) return
    stopping = true
    const results = await Promise.allSettled([
      controlServer?.close(),
      terminateTrackedPid({
        fingerprint: clientFingerprint,
        label: `${target} client`,
        pid: clientProcess?.pid
      }),
      terminateTrackedPid({
        fingerprint: serverFingerprint,
        label: `${target} server`,
        pid: serverProcess?.pid
      })
    ].filter((value): value is Promise<void> => value != null))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      void cleanup()
        .then(() => process.exit(0))
        .catch((error) => {
          console.error(error)
          process.exit(1)
        })
    })
  }

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = readState(target)
      if (
        state?.servicePid === process.pid &&
        (operation == null || state.generation === operation.id)
      ) break
      if (attempt === 49) throw new Error(`${target} manager state was not initialized.`)
      await sleep(100)
    }

    if (config.kind === 'desktop-control') {
      if (serverPort == null || urls.controlUrl == null) throw new Error('Desktop control port was not provided')
      controlServer = await startDesktopControlServer({
        host: getServerHost(),
        port: serverPort
      })
      await waitForHealthUrl(
        `${urls.controlUrl}/health`,
        `Desktop control failed to become ready on ${urls.controlUrl}/health`
      )
    }

    if (config.kind === 'relay') {
      if (serverPort == null || clientPort == null || urls.serverUrl == null || urls.clientUrl == null) {
        throw new Error('Relay ports were not provided')
      }
      const relayDataPath = runtimeEnv.ONEWORKS_RELAY_DATA_PATH ?? join(projectHomeDir, '.local/relay/data.json')
      const relayEnv: NodeJS.ProcessEnv = {
        ...runtimeEnv,
        ONEWORKS_RELAY_DATA_PATH: relayDataPath,
        ONEWORKS_RELAY_HOST: getServerHost(),
        ONEWORKS_RELAY_PORT: String(serverPort),
        ONEWORKS_RELAY_PUBLIC_URL: urls.serverUrl
      }
      serverProcess = spawnLogged({
        args: [
          'apps/relay-server/cli.js',
          '--host',
          getServerHost(),
          '--port',
          String(serverPort),
          '--data',
          relayDataPath
        ],
        command: process.execPath,
        cwd: repoRoot,
        env: relayEnv,
        logPath: serverLog
      })
      serverFingerprint = await captureFingerprint(serverProcess, 'relay server')
      await waitForHealthUrl(`${urls.serverUrl}/health`, `Relay Server failed to become ready on ${urls.serverUrl}`)

      clientProcess = spawnLogged({
        args: [
          '-C',
          'apps/relay-admin',
          'exec',
          'vite',
          '--host',
          getClientHost(),
          '--port',
          String(clientPort),
          '--strictPort'
        ],
        command: 'pnpm',
        cwd: repoRoot,
        env: {
          ...runtimeEnv,
          ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET: urls.serverUrl
        },
        logPath: clientLog
      })
      clientFingerprint = await captureFingerprint(clientProcess, 'relay admin')
      await waitForUrl(urls.clientUrl, `Relay Admin failed to become ready on ${urls.clientUrl}`)
    }

    if (config.kind === 'standard' && target === 'docs') {
      if (clientPort == null || urls.docsUrl == null) throw new Error('Docs port was not provided')
      clientProcess = await startDocsProcess({
        clientPort,
        env: runtimeEnv,
        logPath: clientLog
      })
      clientFingerprint = processFingerprint(clientProcess.pid)
      if (clientFingerprint == null) throw new Error('Could not fingerprint docs service.')
    }

    if (config.kind === 'standard' && target === 'homepage') {
      if (clientPort == null || serverPort == null || urls.clientUrl == null) {
        throw new Error('Homepage ports were not provided')
      }

      const previewUrl = `http://${getClientHost()}:${serverPort}/`
      serverProcess = spawnLogged({
        args: [
          '-C',
          'apps/client',
          'exec',
          'vite',
          '--host',
          getClientHost(),
          '--port',
          String(serverPort),
          '--strictPort'
        ],
        command: 'pnpm',
        cwd: repoRoot,
        env: runtimeEnv,
        logPath: serverLog
      })
      serverFingerprint = await captureFingerprint(serverProcess, 'homepage PWA preview')

      await waitForUrl(previewUrl, `Homepage PWA preview failed to become ready on ${previewUrl}`)

      clientProcess = spawnLogged({
        args: [
          '--filter',
          '@oneworks/homepage',
          'dev',
          '--host',
          getClientHost(),
          '--port',
          String(clientPort)
        ],
        command: 'pnpm',
        cwd: join(repoRoot, 'assets/homepage'),
        env: {
          ...runtimeEnv,
          PUBLIC_PWA_PREVIEW_URL: previewUrl
        },
        logPath: clientLog
      })
      clientFingerprint = await captureFingerprint(clientProcess, 'homepage service')

      await waitForUrl(urls.clientUrl, `Homepage failed to become ready on ${urls.clientUrl}`)
    }

    if (config.kind === 'standard' && target !== 'homepage' && config.needsServer) {
      if (serverPort == null || urls.serverUrl == null) throw new Error('Server port was not provided')
      const serverArgs = target === 'daemon'
        ? [
          'exec',
          'oneworks',
          'daemon',
          '--host',
          getServerHost(),
          '--port',
          String(serverPort),
          '--log-dir',
          join(projectHomeDir, 'logs')
        ]
        : [
          'exec',
          'oneworks-server',
          ...(config.serverRole === 'manager' ? ['--manager'] : []),
          '--port',
          String(serverPort),
          '--allow-cors',
          '--log-dir',
          join(projectHomeDir, 'logs')
        ]
      serverProcess = spawnLogged({
        args: serverArgs,
        command: 'pnpm',
        cwd: repoRoot,
        env: runtimeEnv,
        logPath: serverLog
      })
      serverFingerprint = await captureFingerprint(serverProcess, `${target} server`)

      await waitForServer(urls.serverUrl)
    }

    if (config.kind === 'standard' && target !== 'homepage' && config.needsClient) {
      if (clientPort == null) throw new Error('Client port was not provided')
      const clientArgs = config.clientMode === 'dev'
        ? ['exec', 'vite', '--host', getClientHost(), '--port', String(clientPort)]
        : ['exec', 'oneworks-client']
      clientProcess = spawnLogged({
        args: clientArgs,
        command: 'pnpm',
        cwd: config.clientMode === 'dev' ? join(repoRoot, 'apps/client') : repoRoot,
        env: runtimeEnv,
        logPath: clientLog
      })
      clientFingerprint = await captureFingerprint(clientProcess, `${target} client`)
    }

    const components: DevServiceComponentState[] = []
    if (config.kind === 'desktop-control' && urls.controlUrl != null) {
      components.push({
        fingerprint: serviceFingerprint,
        healthUrl: `${urls.controlUrl}/health`,
        id: 'desktop-control',
        kind: 'http',
        logPath: serverLog,
        pid: process.pid,
        port: serverPort,
        url: urls.controlUrl
      })
    } else if (config.kind === 'relay') {
      if (urls.serverUrl != null) {
        components.push({
          fingerprint: serverFingerprint,
          healthUrl: `${urls.serverUrl}/health`,
          id: 'relay-server',
          kind: 'http',
          logPath: serverLog,
          pid: serverProcess?.pid,
          port: serverPort,
          url: urls.serverUrl
        })
      }
      if (urls.clientUrl != null) {
        components.push({
          fingerprint: clientFingerprint,
          healthUrl: urls.clientUrl,
          id: 'relay-admin',
          kind: 'http',
          logPath: clientLog,
          pid: clientProcess?.pid,
          port: clientPort,
          url: urls.clientUrl
        })
      }
    } else {
      if (serverProcess?.pid != null) {
        components.push({
          ...(urls.serverUrl == null ? {} : { healthUrl: `${urls.serverUrl}/api/auth/status`, url: urls.serverUrl }),
          id: target === 'homepage' ? 'pwa-preview' : 'server',
          kind: urls.serverUrl == null ? 'process' : 'http',
          fingerprint: serverFingerprint,
          logPath: serverLog,
          pid: serverProcess.pid,
          port: serverPort
        })
      }
      if (clientProcess?.pid != null) {
        const clientHealthUrl = urls.docsUrl ?? urls.clientUrl
        components.push({
          ...(clientHealthUrl == null ? {} : { healthUrl: clientHealthUrl, url: clientHealthUrl }),
          id: target === 'docs' ? 'docs' : target === 'homepage' ? 'homepage' : 'client',
          kind: clientHealthUrl == null ? 'process' : 'http',
          fingerprint: clientFingerprint,
          logPath: clientLog,
          pid: clientProcess.pid,
          port: clientPort
        })
      }
    }

    if (operation != null && readDevServiceLease(target)?.id !== operation.id) {
      throw new Error(`${target} operation lease expired before the service became ready.`)
    }
    const readyState = replaceDevServiceStateIfCurrent(
      target,
      {
        generation: operation?.id,
        phase: 'starting',
        servicePid: process.pid
      },
      {
        ...urls,
        clientFingerprint,
        clientPid: clientProcess?.pid,
        clientPort,
        components,
        generation: operation?.id,
        managerLog: managerLogPath(target),
        operation,
        phase: 'ready',
        projectHomeDir,
        readiness: config.readiness,
        root: repoRoot,
        serverPid: serverProcess?.pid,
        serverFingerprint,
        serverPort,
        servicePid: process.pid,
        serviceFingerprint,
        target,
        startedAt: new Date().toISOString()
      } satisfies DevStartState
    )
    if (readyState == null) throw new Error(`${target} generation changed before readiness was published.`)

    const exitFromChild = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
      if (stopping) return
      console.error(`[dev-start] ${name} exited: code=${code ?? ''} signal=${signal ?? ''}`)
      const activeLease = readDevServiceLease(target)
      if (activeLease == null || activeLease.id === operation?.id) {
        updateDevServiceStateIfCurrent(target, {
          generation: operation?.id,
          phase: 'ready',
          servicePid: process.pid
        }, {
          error: `${name} exited: code=${code ?? ''} signal=${signal ?? ''}`,
          phase: 'failed'
        })
      }
      void cleanup().finally(() => process.exit(code ?? 1))
    }
    serverProcess?.on('exit', (code, signal) => exitFromChild('server', code, signal))
    clientProcess?.on('exit', (code, signal) => exitFromChild('client', code, signal))

    await new Promise(() => {})
  } catch (error) {
    let reportedError = error
    try {
      await cleanup()
    } catch (cleanupError) {
      reportedError = new AggregateError([error, cleanupError], `${target} startup and cleanup both failed.`)
    }
    const failureComponents: DevServiceComponentState[] = []
    if (config.needsServer || config.kind === 'desktop-control') {
      failureComponents.push({
        fingerprint: config.kind === 'desktop-control' ? serviceFingerprint : serverFingerprint,
        id: config.kind === 'desktop-control'
          ? 'desktop-control'
          : config.kind === 'relay'
          ? 'relay-server'
          : target === 'homepage'
          ? 'pwa-preview'
          : 'server',
        kind: 'process',
        logPath: serverLog,
        pid: config.kind === 'desktop-control' ? process.pid : serverProcess?.pid
      })
    }
    if (config.needsClient || target === 'docs') {
      failureComponents.push({
        fingerprint: clientFingerprint,
        id: config.kind === 'relay' ? 'relay-admin' : target === 'docs' ? 'docs' : 'client',
        kind: 'process',
        logPath: clientLog,
        pid: clientProcess?.pid
      })
    }
    updateDevServiceStateIfCurrent(target, {
      generation: operation?.id,
      phase: 'starting',
      servicePid: process.pid
    }, {
      clientFingerprint,
      clientPid: clientProcess?.pid,
      components: failureComponents,
      error: reportedError instanceof Error ? reportedError.message : String(reportedError),
      managerLog: managerLogPath(target),
      operation,
      phase: 'failed',
      projectHomeDir,
      readiness: config.readiness,
      serverFingerprint,
      serverPid: serverProcess?.pid,
      serviceFingerprint,
      servicePid: process.pid,
      startedAt: readState(target)?.startedAt ?? new Date().toISOString()
    })
    throw reportedError
  }
}
