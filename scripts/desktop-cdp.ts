/* eslint-disable max-lines -- desktop CDP launch helpers keep process lifecycle and target discovery together. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getChromeDebugTargets } from './chrome-debug'
import { DEFAULT_DESKTOP_APP_PATH } from './release-verify'

const DEFAULT_DESKTOP_CDP_ADDRESS = '127.0.0.1'
const DEFAULT_DESKTOP_CDP_WAIT_MS = 30_000
const DEFAULT_DESKTOP_CDP_POLL_MS = 500

export interface DesktopCdpLaunchInput {
  address?: string
  allowUnsupportedApp?: boolean
  appPath?: string
  env?: Record<string, string>
  executable?: string
  json?: boolean
  port?: number
  recordableLauncherWindow?: boolean
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  userDataDir?: string
  waitMs?: number
  workspace?: string
}

export class DesktopCdpUnsupportedAppError extends Error {
  code = 'UNSUPPORTED_ELECTRON_APP'
  statusCode = 409
}

export interface AgentCommandHint {
  args: string[]
  command: string
  commandLine: string
  cwd: string
  intent: string
}

export interface DesktopCdpLaunchResult {
  address: string
  agentCommands: AgentCommandHint[]
  appPath: string
  control: {
    cdpEndpoint: string
    protocol: 'cdp'
    target: 'electron'
  }
  endpoint: string
  executablePath: string
  nextActions: string[]
  ok: boolean
  phase: 'ready'
  pid?: number
  port: number
  targetCount: number
  targets: Awaited<ReturnType<typeof getChromeDebugTargets>>
  userDataDir: string
}

const shellQuote = (value: string) => (
  /^[\w./:@=-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, `'\\''`)}'`
)

const buildAgentCommandHint = (input: {
  args: string[]
  cwd?: string
  intent: string
}): AgentCommandHint => {
  const command = 'pnpm'
  return {
    ...input,
    command,
    cwd: input.cwd ?? process.cwd(),
    commandLine: [command, ...input.args].map(shellQuote).join(' ')
  }
}

const sleep = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const getFreePort = async () => {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, DEFAULT_DESKTOP_CDP_ADDRESS, () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error != null) reject(error)
      else resolve()
    })
  })
  if (address == null || typeof address === 'string') {
    throw new Error('Failed to allocate a local desktop CDP port.')
  }
  return address.port
}

export const resolveDesktopAppExecutablePath = (appPath: string) => {
  if (process.platform !== 'darwin') return appPath
  if (!appPath.endsWith('.app')) return appPath
  return path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app'))
}

const resolveDesktopAppMainBundlePath = (appPath: string) => {
  if (!appPath.endsWith('.app')) return undefined
  return path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
}

export const inspectDesktopExternalCdpSupport = async (appPath: string) => {
  const mainBundlePath = resolveDesktopAppMainBundlePath(appPath)
  if (mainBundlePath == null) {
    return {
      appPath,
      mainBundlePath,
      supported: true,
      reason: 'non-mac-app-path'
    }
  }

  try {
    const content = await readFile(mainBundlePath, 'utf8')
    const supported = content.includes('ONEWORKS_DESKTOP_CDP_PORT') && content.includes('oneworks-cdp-port')
    return {
      appPath,
      mainBundlePath,
      supported,
      reason: supported ? 'external-cdp-hook-found' : 'external-cdp-hook-missing'
    }
  } catch (error) {
    return {
      appPath,
      mainBundlePath,
      supported: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

const assertDesktopExternalCdpSupported = async (appPath: string) => {
  const support = await inspectDesktopExternalCdpSupport(appPath)
  if (support.supported) return support
  throw new DesktopCdpUnsupportedAppError(
    `Desktop app does not include the external CDP control hook (${support.reason}): ${
      support.mainBundlePath ?? appPath
    }. Rebuild and reinstall One Works before using desktop-control against this app.`
  )
}

const createDesktopCdpUserDataDir = async () => (
  await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-cdp-'))
)

const waitForDesktopCdpTargets = async (input: {
  port: number
  waitMs: number
}) => {
  const startedAt = Date.now()
  let lastError: unknown
  let lastTargetCount = 0
  while (Date.now() - startedAt <= input.waitMs) {
    try {
      const targets = await getChromeDebugTargets(input.port)
      lastTargetCount = targets.length
      if (
        targets.some(target =>
          target.type === 'page' &&
          typeof target.url === 'string' &&
          target.url.trim() !== '' &&
          typeof target.webSocketDebuggerUrl === 'string' &&
          target.webSocketDebuggerUrl.trim() !== '' &&
          !target.url.startsWith('about:') &&
          !target.url.startsWith('data:') &&
          !target.url.startsWith('devtools:')
        )
      ) {
        return targets
      }
      lastError = new Error(`CDP endpoint is reachable but has no app page targets; targets=${targets.length}`)
    } catch (error) {
      lastError = error
    }
    await sleep(DEFAULT_DESKTOP_CDP_POLL_MS)
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(
    `Timed out waiting for a controllable Electron CDP target on port ${input.port}: ${message}; lastTargetCount=${lastTargetCount}`
  )
}

const formatDesktopCdpLaunchResult = (result: DesktopCdpLaunchResult) => (
  [
    `[desktop-control] OK ${result.control.cdpEndpoint}`,
    `[desktop-control] pid=${result.pid ?? '<unknown>'} targets=${result.targetCount}`,
    `[desktop-control] app=${result.appPath}`,
    `[desktop-control] userData=${result.userDataDir}`,
    ...result.agentCommands.map(command => `[desktop-control] next=${command.commandLine}`)
  ].join('\n')
)

export const runDesktopCdpLaunch = async (input: DesktopCdpLaunchInput = {}) => {
  const appPath = path.resolve(input.appPath ?? DEFAULT_DESKTOP_APP_PATH)
  const executablePath = path.resolve(input.executable ?? resolveDesktopAppExecutablePath(appPath))
  const address = input.address ?? DEFAULT_DESKTOP_CDP_ADDRESS
  const port = input.port ?? await getFreePort()
  const userDataDir = path.resolve(input.userDataDir ?? await createDesktopCdpUserDataDir())
  const waitMs = input.waitMs ?? DEFAULT_DESKTOP_CDP_WAIT_MS
  const endpoint = `http://${address}:${port}`
  if (input.allowUnsupportedApp !== true) {
    await assertDesktopExternalCdpSupported(appPath)
  }

  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=${address}`,
    `--oneworks-cdp-port=${port}`,
    `--oneworks-cdp-address=${address}`,
    `--oneworks-user-data-dir=${userDataDir}`,
    `--user-data-dir=${userDataDir}`
  ], {
    detached: true,
    env: {
      ...process.env,
      ONEWORKS_DESKTOP_CDP_PORT: String(port),
      ONEWORKS_DESKTOP_CDP_ADDRESS: address,
      ONEWORKS_DESKTOP_USER_DATA_DIR: userDataDir,
      ...(input.recordableLauncherWindow === true
        ? {
          ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW: '1',
          ONEWORKS_DESKTOP_RECORDABLE_WINDOWS: '1'
        }
        : {}),
      ...(input.env ?? {}),
      ...(input.workspace == null ? {} : { ONEWORKS_DESKTOP_WORKSPACE: path.resolve(input.workspace) })
    },
    stdio: 'ignore'
  })
  child.unref()

  const spawnError = new Promise<never>((_resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(
        new Error(`Electron exited before CDP became ready: code=${code ?? '<none>'} signal=${signal ?? '<none>'}`)
      )
    })
  })
  const targets = await Promise.race([
    waitForDesktopCdpTargets({ port, waitMs }),
    spawnError
  ])
  const agentCommands = [
    buildAgentCommandHint({
      intent: 'list-electron-cdp-targets',
      args: ['tools', 'chrome-debug', 'targets', '--port', String(port), '--json']
    }),
    buildAgentCommandHint({
      intent: 'wait-for-runtime-reply-evidence',
      args: [
        'tools',
        'runtime-evidence',
        'wait-reply',
        '--expected-reply',
        '<nonce>',
        '--wait-ms',
        '90000',
        '--json'
      ]
    })
  ]
  const result: DesktopCdpLaunchResult = {
    address,
    agentCommands,
    appPath,
    control: {
      cdpEndpoint: endpoint,
      protocol: 'cdp',
      target: 'electron'
    },
    endpoint,
    executablePath,
    nextActions: [
      'Use the returned CDP target URLs to drive the Electron UI.',
      'After sending a nonce prompt, wait for runtime evidence with the provided command template.'
    ],
    ok: true,
    phase: 'ready',
    pid: child.pid,
    port,
    targetCount: targets.length,
    targets,
    userDataDir
  }

  const stdout = input.stdout ?? process.stdout
  if (input.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    stdout.write(`${formatDesktopCdpLaunchResult(result)}\n`)
  }
  return result
}
