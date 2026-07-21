import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'

import type { AdapterCtx, Logger } from '@oneworks/types'

import { resolveCodexBinaryPath } from '#~/paths.js'
import { CodexRpcClient } from '#~/protocol/rpc.js'

const CODEX_CONFIG_READ_TIMEOUT_MS = 10_000

const noop = () => {}
const noopLogger: Logger = {
  debug: noop,
  error: noop,
  info: noop,
  stream: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
  warn: noop
}

interface CachedNativeConfig {
  digest: string
  promise: Promise<Record<string, unknown>>
}

const nativeConfigCache = new Map<string, CachedNativeConfig>()

export interface CodexConfigLayer {
  config?: Record<string, unknown>
  disabledReason?: unknown
  name?: Record<string, unknown>
}

export interface CodexConfigReadResult {
  config: Record<string, unknown>
  layers: CodexConfigLayer[]
}

export const isCodexConfigRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const resolveRealHome = (env: AdapterCtx['env']) => (
  readString(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    readString(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    homedir()
)

export const resolveRealCodexHome = (env: AdapterCtx['env']) => (
  resolve(readString(env.CODEX_HOME) ?? resolve(resolveRealHome(env), '.codex'))
)

const buildConfigReadEnv = (env: AdapterCtx['env'], codexHome: string): NodeJS.ProcessEnv => {
  const commandEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value == null) delete commandEnv[key]
    else commandEnv[key] = value
  }
  commandEnv.HOME = resolveRealHome(env)
  commandEnv.CODEX_HOME = codexHome
  delete commandEnv.NODE_OPTIONS
  return commandEnv
}

const withTimeout = <T>(promise: Promise<T>, description: string) =>
  new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out.`)), CODEX_CONFIG_READ_TIMEOUT_MS)
    timer.unref?.()
    promise.then(
      value => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const waitForProcessExit = (proc: ChildProcess, timeoutMs: number) => {
  if (proc.exitCode != null || proc.signalCode != null) return Promise.resolve(true)
  return new Promise<boolean>(resolvePromise => {
    const finish = (exited: boolean) => {
      clearTimeout(timer)
      proc.off('exit', onExit)
      resolvePromise(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    proc.once('exit', onExit)
  })
}

const terminateProcess = async (proc: ChildProcess) => {
  if (proc.exitCode != null || proc.signalCode != null) return
  proc.kill('SIGTERM')
  if (await waitForProcessExit(proc, 250)) return
  proc.kill('SIGKILL')
  await waitForProcessExit(proc, 750)
}

export const readCodexConfigFromAppServer = async (params: {
  binaryPath: string
  codexHome: string
  cwd?: string
  env: AdapterCtx['env']
  includeLayers: boolean
}): Promise<CodexConfigReadResult> => {
  const proc = spawn(params.binaryPath, ['app-server'], {
    cwd: params.cwd ?? params.codexHome,
    env: buildConfigReadEnv(params.env, params.codexHome),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const rpc = new CodexRpcClient(proc, noopLogger)
  proc.stderr?.resume()
  proc.once('error', error => rpc.destroy(error.message))
  proc.once('exit', () => rpc.destroy('Codex app-server exited while reading config.'))
  rpc.onRequest(id => rpc.respond(id, {}))

  try {
    return await withTimeout(
      (async () => {
        await rpc.request('initialize', {
          capabilities: { experimentalApi: false, optOutNotificationMethods: [] },
          clientInfo: { name: 'oneworks', title: 'One Works', version: 'dev' }
        })
        rpc.notify('initialized', {})
        const result = await rpc.request('config/read', {
          includeLayers: params.includeLayers,
          ...(params.cwd == null ? {} : { cwd: params.cwd })
        })
        if (!isCodexConfigRecord(result) || !isCodexConfigRecord(result.config)) {
          throw new TypeError('Codex app-server returned an invalid config/read response.')
        }
        const layers = Array.isArray(result.layers)
          ? result.layers.flatMap(layer => isCodexConfigRecord(layer) ? [layer as CodexConfigLayer] : [])
          : []
        return { config: result.config, layers }
      })(),
      'Codex config/read'
    )
  } finally {
    rpc.destroy()
    await terminateProcess(proc)
  }
}

export const readCodexModelProviderConfig = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
): Promise<Record<string, unknown> | undefined> => {
  const codexHome = resolveRealCodexHome(ctx.env)
  const configPath = resolve(codexHome, 'config.toml')
  let sourceContent: string
  try {
    sourceContent = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const digest = createHash('sha256').update(sourceContent).digest('hex')
  const binaryPath = String(resolveCodexBinaryPath(ctx.env, ctx.cwd))
  const cacheKey = JSON.stringify([codexHome, binaryPath])
  const cached = nativeConfigCache.get(cacheKey)
  if (cached?.digest === digest) return cached.promise

  const promise = readCodexConfigFromAppServer({
    binaryPath,
    codexHome,
    env: ctx.env,
    includeLayers: true
  }).then(result => {
    const userLayer = result.layers.find(layer => {
      const name = isCodexConfigRecord(layer.name) ? layer.name : undefined
      const file = readString(name?.file)
      return name?.type === 'user' && file != null && resolve(file) === configPath
    })
    if (!isCodexConfigRecord(userLayer?.config)) {
      throw new TypeError('Codex app-server did not return the user config layer.')
    }
    return userLayer.config
  })
  nativeConfigCache.set(cacheKey, { digest, promise })
  void promise.catch(() => {
    if (nativeConfigCache.get(cacheKey)?.promise === promise) nativeConfigCache.delete(cacheKey)
  })
  return promise
}
