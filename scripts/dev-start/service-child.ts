import type { ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { getTargetConfig } from './config'
import { getDocsUrl, startDocsProcess } from './docs-process'
import { buildRuntimeEnv, getClientHost, getServerHost } from './env'
import { waitForServer, waitForUrl } from './network'
import { managerLogPath, normalizeText, repoRoot, statePath } from './paths'
import { killPid, spawnLogged, writeJsonAtomic } from './process'
import type { DevStartState, DevStartTarget } from './types'

const getClientUrl = (clientPort: number, baseValue: string | undefined, urlSuffix: string | undefined) => {
  const base = baseValue?.endsWith('/') === true ? baseValue : `${baseValue ?? '/ui'}/`
  return `http://${getClientHost()}:${clientPort}${base}${urlSuffix ?? ''}`
}

export const runServiceChild = async (target: DevStartTarget) => {
  const config = getTargetConfig(target)
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
    serverPort
  })
  const projectHomeDir = runtimeEnv.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  if (projectHomeDir == null) throw new Error('Project home directory was not resolved')

  const serverLog = join(projectHomeDir, 'logs/server.log')
  const clientLog = join(projectHomeDir, 'logs/client.log')
  mkdirSync(join(projectHomeDir, 'logs'), { recursive: true })

  const urls: Pick<DevStartState, 'clientUrl' | 'docsUrl' | 'linkedDocsUrl' | 'linkedHomepageUrl' | 'serverUrl'> =
    target === 'homepage'
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

  const cleanup = () => {
    if (stopping) return
    stopping = true
    killPid(clientProcess?.pid)
    killPid(serverProcess?.pid)
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      cleanup()
      setTimeout(() => process.exit(0), 200)
    })
  }

  if (target === 'docs') {
    if (clientPort == null || urls.docsUrl == null) throw new Error('Docs port was not provided')
    clientProcess = await startDocsProcess({
      clientPort,
      env: runtimeEnv,
      logPath: join(projectHomeDir, 'logs/docs.log')
    })
  }

  if (target === 'homepage') {
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
      logPath: join(projectHomeDir, 'logs/homepage-pwa-preview.log')
    })

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

    await waitForUrl(urls.clientUrl, `Homepage failed to become ready on ${urls.clientUrl}`)
  }

  if (target !== 'homepage' && config.needsServer) {
    if (serverPort == null || urls.serverUrl == null) throw new Error('Server port was not provided')
    serverProcess = spawnLogged({
      args: [
        'exec',
        'oneworks-server',
        '--port',
        String(serverPort),
        '--allow-cors',
        '--log-dir',
        join(projectHomeDir, 'logs')
      ],
      command: 'pnpm',
      cwd: repoRoot,
      env: runtimeEnv,
      logPath: serverLog
    })

    await waitForServer(urls.serverUrl)
  }

  if (target !== 'homepage' && config.needsClient) {
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
  }

  writeJsonAtomic(
    statePath(target),
    {
      ...urls,
      clientPid: clientProcess?.pid,
      clientPort,
      managerLog: managerLogPath(target),
      projectHomeDir,
      readiness: config.readiness,
      root: repoRoot,
      serverPid: serverProcess?.pid,
      serverPort,
      servicePid: process.pid,
      target,
      startedAt: new Date().toISOString()
    } satisfies DevStartState
  )

  const exitFromChild = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    if (stopping) return
    console.error(`[dev-start] ${name} exited: code=${code ?? ''} signal=${signal ?? ''}`)
    cleanup()
    process.exit(code ?? 1)
  }
  serverProcess?.on('exit', (code, signal) => exitFromChild('server', code, signal))
  clientProcess?.on('exit', (code, signal) => exitFromChild('client', code, signal))

  await new Promise(() => {})
}
