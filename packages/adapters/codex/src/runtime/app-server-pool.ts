/* eslint-disable max-lines */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'

import type { Logger } from '@oneworks/utils/create-logger'

import { CodexRpcClient } from '#~/protocol/rpc.js'

type NotificationHandler = (method: string, params: Record<string, unknown>) => void
type RequestHandler = (id: number, method: string, params: Record<string, unknown>) => void
type ExitHandler = (code: number | null) => void

interface ThreadHandlers {
  owner: symbol
  onNotification: NotificationHandler
  onRequest: RequestHandler
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
}

export interface CodexAppServerLease {
  pid: number | undefined
  rpc: CodexRpcClient
  registerThread(
    threadId: string,
    handlers: Omit<ThreadHandlers, 'owner'>
  ): void
  unregisterThread(threadId: string): void
  onExit(handler: ExitHandler): void
  release(): void
  runThreadSetup<T>(task: () => Promise<T>): Promise<T>
}

const pool = new Map<string, PoolEntry>()

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

const closeEntry = (entry: PoolEntry, reason: string) => {
  if (entry.exited) return
  entry.exited = true
  if (entry.idleTimer != null) clearTimeout(entry.idleTimer)
  pool.delete(entry.key)
  entry.rpc.destroy(reason)
  entry.proc.kill()
}

const createPoolEntry = (
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
    closeEntry(entry, 'Codex app-server initialization failed')
    throw error
  })

  return entry
}

export const acquireCodexAppServer = async (
  params: AcquireCodexAppServerParams
): Promise<CodexAppServerLease & { userAgent?: string }> => {
  const key = params.profileKey
  let entry = pool.get(key)
  if (entry == null || entry.exited) {
    entry = createPoolEntry(key, params)
    pool.set(key, entry)
  }
  if (entry.idleTimer != null) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  const owner = Symbol('codex-app-server-lease')
  entry.leases.add(owner)
  let released = false
  try {
    const initResult = await entry.initPromise
    return {
      pid: entry.proc.pid,
      rpc: entry.rpc,
      userAgent: initResult.userAgent,
      registerThread: (threadId, handlers) => {
        const existing = entry?.threads.get(threadId)
        if (existing != null && existing.owner !== owner) {
          throw new Error(`Codex thread ${threadId} is already attached to another active session.`)
        }
        entry?.threads.set(threadId, { owner, ...handlers })
      },
      unregisterThread: (threadId) => {
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
            closeEntry(entry, 'Codex app-server idle timeout')
          }
        }, idleTimeoutMs)
        entry.idleTimer.unref?.()
      }
    }
  } catch (error) {
    entry.leases.delete(owner)
    throw error
  }
}

export const resetCodexAppServerPoolForTests = () => {
  for (const entry of [...pool.values()]) closeEntry(entry, 'Codex app-server pool reset')
  pool.clear()
}
