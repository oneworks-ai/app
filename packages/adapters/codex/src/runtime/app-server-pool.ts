/* eslint-disable max-lines */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'

import { RuntimeBrokerHttpClient, RuntimeBrokerRemoteError } from '@oneworks/runtime-broker'
import type { Logger } from '@oneworks/utils/create-logger'

import type { NativeCodexHookInput } from '#~/hook-bridge.js'
import { CodexRpcClient, CodexRpcError } from '#~/protocol/rpc.js'
import type { CodexRpcTransport } from '#~/protocol/rpc.js'
import {
  CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
  RUNTIME_BROKER_CALLBACK_TOKEN_ENV,
  RUNTIME_BROKER_CALLBACK_URL_ENV
} from '#~/runtime-broker-contract.js'

type NotificationHandler = (method: string, params: Record<string, unknown>) => void
type RequestHandler = (id: number, method: string, params: Record<string, unknown>) => void
type ExitHandler = (code: number | null) => void

interface ThreadHandlers {
  owner: symbol
  onNotification: NotificationHandler
  onRequest: RequestHandler
}

export interface CodexAppServerCloseSessionParams {
  responses: Array<{ id: number; result: unknown }>
  threadId: string
  turnId?: string
}

interface PoolEntry {
  key: string
  proc: ChildProcess
  rpc: CodexRpcClient
  initPromise: Promise<{ userAgent?: string }>
  leases: Set<symbol>
  exitHandlers: Map<symbol, ExitHandler>
  threads: Map<string, ThreadHandlers>
  threadSetupChain: Promise<void>
  idleTimer?: ReturnType<typeof setTimeout>
  exited: boolean
}

export interface AcquireCodexAppServerParams {
  args: string[]
  binaryPath: string
  clientInfo: Record<string, unknown>
  cwd: string
  env: NodeJS.ProcessEnv
  experimentalApi: boolean
  idleTimeoutMs: number
  logger: Logger
  profileKey: string
  signal?: AbortSignal
}

export interface CodexAppServerLease {
  closeSession?(params: CodexAppServerCloseSessionParams): Promise<void>
  drain?(): Promise<void>
  hookEnv?: Record<string, string>
  pid: number | undefined
  rpc: CodexRpcTransport
  registerThread(
    threadId: string,
    cwd: string,
    handlers: Omit<ThreadHandlers, 'owner'>
  ): Promise<void>
  unregisterThread(threadId: string): Promise<void>
  onExit(handler: ExitHandler): void
  release(): void
  runThreadSetup<T>(task: () => Promise<T>, options?: { cwd?: string; threadId?: string }): Promise<T>
  setHookHandler?(handler: (input: NativeCodexHookInput) => Promise<Record<string, unknown>>): void
}

type CodexAppServerPool = Map<string, PoolEntry>
const standalonePool: CodexAppServerPool = new Map()

const readThreadId = (params: Record<string, unknown>) => {
  if (typeof params.threadId === 'string' && params.threadId !== '') return params.threadId
  const thread = params.thread
  return thread != null && typeof thread === 'object' && !Array.isArray(thread) &&
      typeof (thread as { id?: unknown }).id === 'string'
    ? (thread as { id: string }).id
    : undefined
}

const respondWithoutOwner = (
  rpc: CodexRpcClient,
  id: number,
  method: string
) => {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    rpc.respond(id, { decision: 'decline' })
    return
  }
  if (method === 'mcpServer/elicitation/request') {
    rpc.respond(id, { action: 'cancel' })
    return
  }
  rpc.respond(id, {})
}

const resolveThreadHandlers = (
  entry: PoolEntry,
  params: Record<string, unknown>
) => {
  const threadId = readThreadId(params)
  if (threadId != null) return entry.threads.get(threadId)
  return entry.threads.size === 1 ? entry.threads.values().next().value : undefined
}

const closeEntry = (pool: CodexAppServerPool, entry: PoolEntry, reason: string) => {
  if (entry.exited) return
  entry.exited = true
  if (entry.idleTimer != null) clearTimeout(entry.idleTimer)
  pool.delete(entry.key)
  entry.rpc.destroy(reason)
  entry.proc.kill()
}

const createPoolEntry = (
  pool: CodexAppServerPool,
  key: string,
  params: AcquireCodexAppServerParams
): PoolEntry => {
  params.logger.info('[codex app-server pool] spawning shared app-server', {
    binaryPath: params.binaryPath,
    cwd: params.cwd
  })
  const proc = spawn(
    String(params.binaryPath),
    ['app-server', ...params.args],
    { env: params.env, cwd: params.cwd, stdio: ['pipe', 'pipe', 'inherit'] }
  )
  const rpcLogger: Logger = {
    stream: params.logger.stream,
    paths: params.logger.paths,
    debug: () => {},
    info: (...args) => params.logger.info(args[0]),
    warn: (...args) => params.logger.warn(args[0]),
    error: (...args) => params.logger.error(args[0])
  }
  const rpc = new CodexRpcClient(proc, rpcLogger)
  const entry: PoolEntry = {
    key,
    proc,
    rpc,
    initPromise: Promise.resolve({}),
    leases: new Set(),
    exitHandlers: new Map(),
    threads: new Map(),
    threadSetupChain: Promise.resolve(),
    exited: false
  }

  rpc.onNotification((method, notificationParams) => {
    const handler = resolveThreadHandlers(entry, notificationParams)
    if (handler == null) {
      params.logger.debug('[codex app-server pool] notification has no active thread owner', {
        method,
        threadId: readThreadId(notificationParams)
      })
      return
    }
    handler.onNotification(method, notificationParams)
  })
  rpc.onRequest((id, method, requestParams) => {
    const handler = resolveThreadHandlers(entry, requestParams)
    if (handler == null) {
      params.logger.warn('[codex app-server pool] request has no active thread owner; denying', {
        id,
        method,
        threadId: readThreadId(requestParams)
      })
      respondWithoutOwner(rpc, id, method)
      return
    }
    handler.onRequest(id, method, requestParams)
  })

  proc.on('exit', (code) => {
    if (entry.exited) return
    entry.exited = true
    if (entry.idleTimer != null) clearTimeout(entry.idleTimer)
    pool.delete(key)
    rpc.destroy('Codex app-server exited')
    for (const handler of [...entry.exitHandlers.values()]) handler(code)
    entry.leases.clear()
    entry.exitHandlers.clear()
    entry.threads.clear()
  })
  proc.on('error', (error) => {
    if (entry.exited) return
    entry.exited = true
    if (entry.idleTimer != null) clearTimeout(entry.idleTimer)
    pool.delete(key)
    rpc.destroy(`Codex app-server process error: ${error.message}`)
    for (const handler of [...entry.exitHandlers.values()]) handler(-1)
    entry.leases.clear()
    entry.exitHandlers.clear()
    entry.threads.clear()
  })

  entry.initPromise = rpc.request<{ userAgent?: string }>('initialize', {
    clientInfo: params.clientInfo,
    capabilities: {
      experimentalApi: params.experimentalApi,
      optOutNotificationMethods: [
        'turn/diff/updated',
        'turn/plan/updated'
      ]
    }
  }).then((result) => {
    rpc.notify('initialized', {})
    return result
  }).catch((error) => {
    closeEntry(pool, entry, 'Codex app-server initialization failed')
    throw error
  })

  return entry
}

const acquireCodexAppServerFromPool = async (
  pool: CodexAppServerPool,
  params: AcquireCodexAppServerParams
): Promise<CodexAppServerLease & { userAgent?: string }> => {
  const key = params.profileKey
  let entry = pool.get(key)
  if (entry == null || entry.exited) {
    entry = createPoolEntry(pool, key, params)
    pool.set(key, entry)
  }
  if (entry.idleTimer != null) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  const owner = Symbol('codex-app-server-lease')
  entry.leases.add(owner)
  let released = false
  let removeAbortListener: () => void = () => undefined
  try {
    const initializationAborted = new Promise<never>((_resolve, reject) => {
      if (params.signal == null) return
      const onAbort = () =>
        reject(
          params.signal?.reason instanceof Error
            ? params.signal.reason
            : new Error('Codex app-server acquisition was aborted.')
        )
      if (params.signal.aborted) onAbort()
      else {
        params.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => params.signal?.removeEventListener('abort', onAbort)
      }
    })
    const initResult = await Promise.race([entry.initPromise, initializationAborted])
    return {
      pid: entry.proc.pid,
      rpc: entry.rpc,
      userAgent: initResult.userAgent,
      registerThread: async (threadId, _cwd, handlers) => {
        const existing = entry?.threads.get(threadId)
        if (existing != null && existing.owner !== owner) {
          throw new Error(`Codex thread ${threadId} is already attached to another active session.`)
        }
        entry?.threads.set(threadId, { owner, ...handlers })
      },
      unregisterThread: async (threadId) => {
        if (entry?.threads.get(threadId)?.owner === owner) entry.threads.delete(threadId)
      },
      onExit: (handler) => {
        if (entry?.exited === true) handler(entry.proc.exitCode)
        else entry?.exitHandlers.set(owner, handler)
      },
      runThreadSetup: async <T>(task: () => Promise<T>) => {
        let unlock = () => {}
        const previous = entry?.threadSetupChain ?? Promise.resolve()
        const current = new Promise<void>((resolve) => {
          unlock = resolve
        })
        if (entry != null) entry.threadSetupChain = previous.catch(() => undefined).then(() => current)
        await previous.catch(() => undefined)
        try {
          return await task()
        } finally {
          unlock()
        }
      },
      release: () => {
        if (released || entry == null) return
        released = true
        for (const [threadId, handlers] of entry.threads) {
          if (handlers.owner === owner) entry.threads.delete(threadId)
        }
        entry.exitHandlers.delete(owner)
        entry.leases.delete(owner)
        if (entry.leases.size !== 0 || entry.exited) return
        const idleTimeoutMs = Math.max(0, params.idleTimeoutMs)
        entry.idleTimer = setTimeout(() => {
          if (entry != null && entry.leases.size === 0) {
            closeEntry(pool, entry, 'Codex app-server idle timeout')
          }
        }, idleTimeoutMs)
        entry.idleTimer.unref?.()
      }
    }
  } catch (error) {
    entry.leases.delete(owner)
    if (params.signal?.aborted === true && entry.leases.size === 0 && !entry.exited) {
      closeEntry(pool, entry, 'Codex app-server acquisition aborted')
    }
    throw error
  } finally {
    removeAbortListener()
  }
}

export const acquireLocalCodexAppServer = async (params: AcquireCodexAppServerParams) =>
  await acquireCodexAppServerFromPool(standalonePool, params)

export const createLocalCodexAppServerPool = () => {
  const pool: CodexAppServerPool = new Map()
  return {
    acquire: async (params: AcquireCodexAppServerParams) => await acquireCodexAppServerFromPool(pool, params),
    dispose: () => {
      for (const entry of [...pool.values()]) closeEntry(pool, entry, 'Codex app-server pool disposed')
      pool.clear()
    }
  }
}

const readBrokerConnection = (env: NodeJS.ProcessEnv) => {
  const url = env.__ONEWORKS_PROJECT_RUNTIME_BROKER_URL__?.trim()
  const token = env.__ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__?.trim()
  if (url == null && token == null) return undefined
  if (url == null || url === '' || token == null || token === '') {
    throw new Error('Runtime broker connection is incomplete; both URL and token are required.')
  }
  return { url, token }
}

const acquireRemoteCodexAppServer = async (
  params: AcquireCodexAppServerParams,
  connection: { token: string; url: string }
): Promise<CodexAppServerLease & { userAgent?: string }> => {
  const client = new RuntimeBrokerHttpClient({
    ...connection,
    onError: error => params.logger.warn('[codex runtime broker] transport failed', { error })
  })
  const lease = await client.acquire({
    driverId: CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
    profileKey: params.profileKey,
    payload: {
      args: params.args,
      binaryPath: params.binaryPath,
      clientInfo: params.clientInfo,
      cwd: params.cwd,
      env: params.env,
      experimentalApi: params.experimentalApi,
      idleTimeoutMs: params.idleTimeoutMs
    }
  })
  const metadata = lease.metadata != null && typeof lease.metadata === 'object' && !Array.isArray(lease.metadata)
    ? lease.metadata as { hookConnection?: unknown; pid?: unknown; userAgent?: unknown }
    : {}
  const hookConnection = metadata.hookConnection != null &&
      typeof metadata.hookConnection === 'object' &&
      !Array.isArray(metadata.hookConnection)
    ? metadata.hookConnection as { token?: unknown; url?: unknown }
    : undefined
  const hookEnv = typeof hookConnection?.url === 'string' && typeof hookConnection.token === 'string'
    ? {
      [RUNTIME_BROKER_CALLBACK_TOKEN_ENV]: hookConnection.token,
      [RUNTIME_BROKER_CALLBACK_URL_ENV]: hookConnection.url
    }
    : undefined
  const threadHandlers = new Map<string, Omit<ThreadHandlers, 'owner'>>()
  const exitHandlers = new Set<ExitHandler>()
  const outstandingInvocations = new Set<Promise<void>>()
  const pendingResponsePayloads = new Map<number, unknown>()
  let closing = false
  let hookHandler: ((input: NativeCodexHookInput) => Promise<Record<string, unknown>>) | undefined

  const trackInvocation = (
    invocation: Promise<unknown>,
    onFailure: (error: unknown) => void
  ) => {
    const tracked = invocation
      .then(() => undefined)
      .catch(onFailure)
      .finally(() => outstandingInvocations.delete(tracked))
    outstandingInvocations.add(tracked)
  }

  lease.onEvent('codex.rpc.notification', (rawPayload) => {
    const payload = rawPayload as { method?: unknown; params?: unknown }
    if (typeof payload?.method !== 'string' || payload.params == null || typeof payload.params !== 'object') return
    const rpcParams = payload.params as Record<string, unknown>
    const threadId = readThreadId(rpcParams)
    const handlers = threadId == null
      ? threadHandlers.size === 1 ? threadHandlers.values().next().value : undefined
      : threadHandlers.get(threadId)
    handlers?.onNotification(payload.method, rpcParams)
  })
  lease.onEvent('codex.rpc.request', (rawPayload) => {
    const payload = rawPayload as { id?: unknown; method?: unknown; params?: unknown }
    if (
      typeof payload?.id !== 'number' || typeof payload.method !== 'string' ||
      payload.params == null || typeof payload.params !== 'object'
    ) return
    const rpcParams = payload.params as Record<string, unknown>
    const threadId = readThreadId(rpcParams)
    const handlers = threadId == null
      ? threadHandlers.size === 1 ? threadHandlers.values().next().value : undefined
      : threadHandlers.get(threadId)
    handlers?.onRequest(payload.id, payload.method, rpcParams)
  })
  lease.onEvent('codex.exit', (rawPayload) => {
    const code = (rawPayload as { code?: unknown })?.code
    for (const handler of exitHandlers) handler(typeof code === 'number' ? code : null)
  })
  lease.onRequest('codex.hook', async rawInput => (
    hookHandler == null
      ? { continue: true }
      : await hookHandler(rawInput as NativeCodexHookInput)
  ))

  const rpc: CodexRpcTransport = {
    request: async <T = unknown>(method: string, rpcParams?: Record<string, unknown>) => {
      try {
        return await lease.invoke<T>('rpc.request', { method, params: rpcParams })
      } catch (error) {
        if (error instanceof RuntimeBrokerRemoteError && error.code === 'codex_rpc_error') {
          const details = error.details != null && typeof error.details === 'object'
            ? error.details as { code?: unknown; data?: unknown }
            : {}
          throw new CodexRpcError(
            typeof details.code === 'number' ? details.code : -1,
            error.message,
            details.data
          )
        }
        throw error
      }
    },
    notify: (method, rpcParams) => {
      trackInvocation(lease.invoke('rpc.notify', { method, params: rpcParams }), error => {
        params.logger.warn('[codex runtime broker] notification failed', { error, method })
      })
    },
    respond: (id, result) => {
      pendingResponsePayloads.set(id, result)
      const tracked = lease.invoke('rpc.respond', { id, result })
        .then(() => {
          pendingResponsePayloads.delete(id)
        })
        .catch((error) => {
          params.logger.warn('[codex runtime broker] response failed', { error, id })
        })
        .finally(() => outstandingInvocations.delete(tracked))
      outstandingInvocations.add(tracked)
    }
  }

  return {
    closeSession: async (closeParams) => {
      closing = true
      threadHandlers.delete(closeParams.threadId)
      const responses = new Map(pendingResponsePayloads)
      for (const response of closeParams.responses) responses.set(response.id, response.result)
      await lease.invoke('session.close', {
        responses: [...responses].map(([id, result]) => ({ id, result })),
        threadId: closeParams.threadId,
        turnId: closeParams.turnId
      }, { requestTimeoutMs: 1_000 })
      pendingResponsePayloads.clear()
    },
    drain: async () => {
      if (closing) return
      while (outstandingInvocations.size > 0) {
        await Promise.allSettled([...outstandingInvocations])
      }
    },
    hookEnv,
    pid: typeof metadata.pid === 'number' ? metadata.pid : undefined,
    rpc,
    userAgent: typeof metadata.userAgent === 'string' ? metadata.userAgent : undefined,
    registerThread: async (threadId, cwd, handlers) => {
      threadHandlers.set(threadId, handlers)
      try {
        await lease.invoke('thread.register', { cwd, threadId })
      } catch (error) {
        threadHandlers.delete(threadId)
        throw error
      }
    },
    unregisterThread: async (threadId) => {
      threadHandlers.delete(threadId)
      await lease.invoke('thread.unregister', { threadId })
    },
    onExit: handler => exitHandlers.add(handler),
    runThreadSetup: async <T>(
      task: () => Promise<T>,
      options: { cwd?: string; threadId?: string } = {}
    ) => {
      const result = await lease.invoke<{ setupId: string }>('setup.begin', {
        cwd: options.cwd ?? params.cwd,
        ...(options.threadId == null ? {} : { threadId: options.threadId })
      })
      try {
        return await task()
      } finally {
        await lease.invoke('setup.end', { setupId: result.setupId })
      }
    },
    setHookHandler: handler => {
      hookHandler = handler
    },
    release: () => {
      closing = true
      threadHandlers.clear()
      exitHandlers.clear()
      pendingResponsePayloads.clear()
      lease.release()
    }
  }
}

export const acquireCodexAppServer = async (
  params: AcquireCodexAppServerParams
): Promise<CodexAppServerLease & { userAgent?: string }> => {
  const connection = readBrokerConnection(params.env)
  return connection == null
    ? await acquireLocalCodexAppServer(params)
    : await acquireRemoteCodexAppServer(params, connection)
}

export const disposeLocalCodexAppServerPool = () => {
  for (const entry of [...standalonePool.values()]) {
    closeEntry(standalonePool, entry, 'Codex app-server pool reset')
  }
  standalonePool.clear()
}

export const resetCodexAppServerPoolForTests = disposeLocalCodexAppServerPool
