import './adapter-config'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

import type { AdapterCtx, AdapterModelSharingBridge, AdapterModelSharingBridgeOptions } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv, sanitizeInheritedNodeRuntimeEnv } from '@oneworks/utils'

import { resolveCodexBinaryPath } from '#~/paths.js'
import { prepareCodexSessionHome } from '#~/runtime/accounts.js'
import { resolveCodexAdapterConfig } from '#~/runtime/config.js'
import { applyCodexNetworkEnv, materializeCodexCaCertificate, resolveCodexNetworkConfig } from '#~/runtime/network.js'

export const CODEX_MODEL_SHARING_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

const isAbortSignalAborted = (signal: AbortSignal | undefined) => signal?.aborted === true

const normalizeJsonRpcMessage = (message: string | Uint8Array) => {
  const text = typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
  if (Buffer.byteLength(text) > CODEX_MODEL_SHARING_MAX_MESSAGE_BYTES) {
    throw new Error('Codex app-server message exceeds the 16 MiB limit.')
  }
  const value = JSON.parse(text) as unknown
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex app-server messages must be JSON objects.')
  }
  return text
}

export const createCodexModelSharingBridge = async (
  ctx: AdapterCtx,
  options: AdapterModelSharingBridgeOptions
): Promise<AdapterModelSharingBridge> => {
  const { native } = resolveCodexAdapterConfig(ctx)
  if (native.shareBuiltinModels !== true) {
    throw new Error('Codex built-in model sharing is disabled.')
  }

  const runtimeHome = await prepareCodexSessionHome({
    ctx,
    sessionId: options.sessionId,
    account: options.account,
    appServerProfileKey: 'model-sharing-v1',
    nativeHooksAvailable: false,
    sharedAppServerHome: false,
    useAccountPool: false
  })
  if (isAbortSignalAborted(options.signal)) {
    throw new DOMException('The Codex model-sharing bridge was aborted.', 'AbortError')
  }
  let networkConfig = resolveCodexNetworkConfig({
    config: native.network,
    env: ctx.env
  })
  networkConfig = await materializeCodexCaCertificate(networkConfig, runtimeHome.homeDir)

  const spawnEnv = sanitizeInheritedNodeRuntimeEnv(
    mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  )
  delete spawnEnv.__ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__
  delete spawnEnv.__ONEWORKS_PROJECT_RUNTIME_BROKER_URL__
  spawnEnv.__ONEWORKS_DISABLE_MOCK_HOME_BRIDGE = '1'
  spawnEnv.HOME = runtimeHome.homeDir
  spawnEnv.USERPROFILE = runtimeHome.homeDir
  spawnEnv.PWD = runtimeHome.homeDir
  spawnEnv.CODEX_HOME = resolve(runtimeHome.homeDir, '.codex')
  applyCodexNetworkEnv(spawnEnv, networkConfig)

  const child = spawn(
    resolveCodexBinaryPath(ctx.env, ctx.cwd),
    ['app-server', '--listen', 'stdio://'],
    {
      cwd: ctx.cwd,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  let closed = false
  let stdoutBuffer = ''
  let writeQueue = Promise.resolve()
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined

  const reportError = (error: unknown) => {
    if (closed) return
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
  const close = () => {
    if (closed) return
    closed = true
    options.signal?.removeEventListener('abort', close)
    child.stdin.end()
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }, 2_000)
      forceKillTimer.unref()
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    while (true) {
      const newlineIndex = stdoutBuffer.indexOf('\n')
      if (newlineIndex < 0) break
      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/u, '')
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (line === '') continue
      try {
        options.onMessage(normalizeJsonRpcMessage(line))
      } catch (error) {
        reportError(error)
        close()
        return
      }
    }
    if (Buffer.byteLength(stdoutBuffer) > CODEX_MODEL_SHARING_MAX_MESSAGE_BYTES) {
      reportError(new Error('Codex app-server message exceeds the 16 MiB limit.'))
      close()
    }
  })
  child.stderr.on('data', () => {
    // Drain stderr without logging paths, account metadata, prompts, or native payloads.
  })
  child.on('error', reportError)
  child.on('exit', (code, signal) => {
    if (forceKillTimer != null) clearTimeout(forceKillTimer)
    options.signal?.removeEventListener('abort', close)
    closed = true
    options.onExit?.(code, signal)
  })
  options.signal?.addEventListener('abort', close, { once: true })
  if (isAbortSignalAborted(options.signal)) {
    close()
  }

  return {
    accountKey: runtimeHome.accountKey,
    send: async (message) => {
      const text = normalizeJsonRpcMessage(message)
      writeQueue = writeQueue.then(async () => {
        if (closed || child.stdin.destroyed) throw new Error('Codex app-server bridge is closed.')
        if (!child.stdin.write(`${text}\n`, 'utf8')) await once(child.stdin, 'drain')
      })
      return writeQueue
    },
    close
  }
}
