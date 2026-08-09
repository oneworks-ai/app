/* eslint-disable max-lines -- the Codex driver keeps one acquire/invoke/release state machine together. */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { RuntimeBrokerError } from '@oneworks/runtime-broker'
import type {
  RuntimeBrokerDriver,
  RuntimeBrokerDriverContext,
  RuntimeBrokerHttpConnection
} from '@oneworks/runtime-broker'
import type { Logger } from '@oneworks/utils/create-logger'

import type { NativeCodexHookInput } from './hook-bridge'
import { CodexRpcError } from './protocol/rpc'
import {
  CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
  RUNTIME_BROKER_CALLBACK_TOKEN_ENV,
  RUNTIME_BROKER_CALLBACK_URL_ENV
} from './runtime-broker-contract'
import { createLocalCodexAppServerPool } from './runtime/app-server-pool'
import type {
  AcquireCodexAppServerParams,
  CodexAppServerLease,
  acquireLocalCodexAppServer
} from './runtime/app-server-pool'

type CodexBrokerAcquirePayload = Omit<AcquireCodexAppServerParams, 'logger' | 'profileKey'>

export {
  CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
  RUNTIME_BROKER_CALLBACK_TOKEN_ENV,
  RUNTIME_BROKER_CALLBACK_URL_ENV
} from './runtime-broker-contract'
export { buildCodexAppServerWarmupProfiles } from './runtime/app-server-warmup'
export type { CodexAppServerWarmupProfile } from './runtime/app-server-warmup'

interface CodexBrokerLeaseState {
  context: RuntimeBrokerDriverContext
  hookCallbacks: Map<string, Promise<unknown>>
  hookCallbackTimers: Set<ReturnType<typeof setTimeout>>
  lease: CodexAppServerLease
  pendingRpcIds: Set<number>
  pendingSetups: Map<string, { cwd: string; release: () => void; threadId?: string }>
  respondedRpcIds: Set<number>
  threads: Map<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RuntimeBrokerError('invalid_driver_payload', `Codex broker field "${field}" is required.`)
  }
  return value
}

const parseAcquirePayload = (value: unknown): CodexBrokerAcquirePayload => {
  if (!isRecord(value)) throw new RuntimeBrokerError('invalid_driver_payload', 'Codex broker payload is required.')
  const args = Array.isArray(value.args) && value.args.every(item => typeof item === 'string')
    ? value.args
    : []
  const env = isRecord(value.env)
    ? Object.fromEntries(
      Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    : {}
  return {
    args,
    binaryPath: readString(value.binaryPath, 'binaryPath'),
    clientInfo: isRecord(value.clientInfo) ? value.clientInfo : {},
    cwd: readString(value.cwd, 'cwd'),
    env,
    experimentalApi: value.experimentalApi === true,
    idleTimeoutMs: typeof value.idleTimeoutMs === 'number' && Number.isFinite(value.idleTimeoutMs)
      ? Math.max(0, value.idleTimeoutMs)
      : 0
  }
}

const parseHookCallback = (value: unknown): NativeCodexHookInput => {
  if (!isRecord(value)) {
    throw new RuntimeBrokerError('invalid_callback', 'Codex hook callback payload is invalid.')
  }
  const hookEventName = readString(value.hookEventName, 'hookEventName')
  if (!['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].includes(hookEventName)) {
    throw new RuntimeBrokerError('invalid_callback', 'Codex hook callback event is not supported.')
  }
  return {
    ...value,
    cwd: readString(value.cwd, 'cwd'),
    hookEventName,
    sessionId: readString(value.sessionId, 'sessionId')
  } as NativeCodexHookInput
}

const normalizeCwd = (cwd: string) => resolve(cwd)
const hookCallbackKey = (input: NativeCodexHookInput) => JSON.stringify(input)

const rpcAccessDenied = (message: string) => new RuntimeBrokerError('codex_rpc_access_denied', message)

export const createCodexAppServerRuntimeBrokerDriver = (options: {
  acquireLocal?: typeof acquireLocalCodexAppServer
  getCallbackConnection: (
    driverId: string,
    profileKey: string,
    leaseId: string
  ) => RuntimeBrokerHttpConnection | undefined
  logger: Logger
}): RuntimeBrokerDriver => {
  const leases = new Map<string, CodexBrokerLeaseState>()
  const threadOwners = new Map<string, { cwd: string; ownerId: string }>()
  const ownedPool = options.acquireLocal == null ? createLocalCodexAppServerPool() : undefined
  const acquireLocal = options.acquireLocal ?? ownedPool!.acquire

  return {
    id: CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
    acquire: async (rawPayload, context) => {
      const payload = parseAcquirePayload(rawPayload)
      const callback = options.getCallbackConnection(
        CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
        context.profileKey,
        context.leaseId
      )
      const env = { ...payload.env }
      delete env.__ONEWORKS_PROJECT_RUNTIME_BROKER_URL__
      delete env.__ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__
      delete env[RUNTIME_BROKER_CALLBACK_URL_ENV]
      delete env[RUNTIME_BROKER_CALLBACK_TOKEN_ENV]
      const lease = await acquireLocal({
        ...payload,
        env,
        logger: options.logger,
        profileKey: context.profileKey,
        signal: context.signal
      })
      const state: CodexBrokerLeaseState = {
        context,
        hookCallbacks: new Map(),
        hookCallbackTimers: new Set(),
        lease,
        pendingRpcIds: new Set(),
        pendingSetups: new Map(),
        respondedRpcIds: new Set(),
        threads: new Map()
      }
      const respondOnce = (id: number, result: unknown) => {
        if (state.respondedRpcIds.has(id)) return
        if (!state.pendingRpcIds.delete(id)) {
          throw rpcAccessDenied(`Codex RPC response ${id} is not owned by this workspace lease.`)
        }
        state.respondedRpcIds.add(id)
        if (state.respondedRpcIds.size > 512) {
          const oldest = state.respondedRpcIds.values().next().value
          if (oldest != null) state.respondedRpcIds.delete(oldest)
        }
        lease.rpc.respond(id, result)
      }
      const assertOwnedThread = (threadId: string) => {
        if (!state.threads.has(threadId)) {
          throw rpcAccessDenied(`Codex thread "${threadId}" is not owned by this workspace lease.`)
        }
      }
      const assertRpcRequestAllowed = (method: string, params: Record<string, unknown>) => {
        if (method === 'thread/start') {
          const cwd = normalizeCwd(readString(params.cwd, 'cwd'))
          if (![...state.pendingSetups.values()].some(setup => setup.cwd === cwd && setup.threadId == null)) {
            throw rpcAccessDenied('Codex thread/start requires this lease to hold the matching setup claim.')
          }
          return
        }
        if (method === 'thread/resume') {
          const cwd = normalizeCwd(readString(params.cwd, 'cwd'))
          const threadId = readString(params.threadId, 'threadId')
          const ownsSetup = [...state.pendingSetups.values()].some(
            setup => setup.cwd === cwd && setup.threadId === threadId
          )
          const owner = threadOwners.get(threadId)
          if (!ownsSetup || (owner != null && owner.ownerId !== context.ownerId)) {
            throw rpcAccessDenied(`Codex thread "${threadId}" cannot be resumed by this workspace lease.`)
          }
          return
        }
        if (['thread/unsubscribe', 'turn/interrupt', 'turn/start', 'turn/steer'].includes(method)) {
          assertOwnedThread(readString(params.threadId, 'threadId'))
          return
        }
        throw rpcAccessDenied(`Codex RPC method "${method}" is not available through a workspace lease.`)
      }
      leases.set(context.leaseId, state)
      lease.onExit(code => context.emit('codex.exit', { code }))

      return {
        metadata: {
          ...(callback == null ? {} : { hookConnection: callback }),
          pid: lease.pid,
          userAgent: lease.userAgent
        },
        invoke: async (operation, rawOperationPayload) => {
          const operationPayload = isRecord(rawOperationPayload) ? rawOperationPayload : {}
          switch (operation) {
            case 'rpc.request': {
              const method = readString(operationPayload.method, 'method')
              const params = isRecord(operationPayload.params) ? operationPayload.params : {}
              assertRpcRequestAllowed(method, params)
              try {
                return await lease.rpc.request(
                  method,
                  params
                )
              } catch (error) {
                if (error instanceof CodexRpcError) {
                  throw new RuntimeBrokerError('codex_rpc_error', error.message, {
                    code: error.code,
                    data: error.data
                  })
                }
                throw error
              }
            }
            case 'rpc.notify': {
              const method = readString(operationPayload.method, 'method')
              throw rpcAccessDenied(`Codex RPC notification "${method}" is not available through a workspace lease.`)
            }
            case 'rpc.respond':
              if (typeof operationPayload.id !== 'number') {
                throw new RuntimeBrokerError('invalid_driver_payload', 'Codex RPC response id is required.')
              }
              respondOnce(operationPayload.id, operationPayload.result)
              return {}
            case 'session.close': {
              const threadId = readString(operationPayload.threadId, 'threadId')
              assertOwnedThread(threadId)
              const responses = Array.isArray(operationPayload.responses)
                ? operationPayload.responses.filter((response): response is { id: number; result?: unknown } => (
                  isRecord(response) && typeof response.id === 'number'
                ))
                : []
              for (const response of responses) respondOnce(response.id, response.result)
              if (typeof operationPayload.turnId === 'string' && operationPayload.turnId !== '') {
                void lease.rpc.request('turn/interrupt', {
                  threadId,
                  turnId: operationPayload.turnId
                }, { timeoutMs: 5_000 }).catch(error => {
                  options.logger.debug('[codex runtime broker] turn interrupt during close failed', { error, threadId })
                })
              }
              state.threads.delete(threadId)
              await lease.unregisterThread(threadId)
              void lease.rpc.request('thread/unsubscribe', { threadId }, { timeoutMs: 5_000 }).catch(error => {
                options.logger.debug('[codex runtime broker] thread unsubscribe during close failed', {
                  error,
                  threadId
                })
              })
              return {}
            }
            case 'thread.register': {
              const threadId = readString(operationPayload.threadId, 'threadId')
              const cwd = normalizeCwd(readString(operationPayload.cwd, 'cwd'))
              const owner = threadOwners.get(threadId)
              if (owner != null && owner.ownerId !== context.ownerId) {
                throw rpcAccessDenied(`Codex thread "${threadId}" is owned by another workspace.`)
              }
              await lease.registerThread(threadId, cwd, {
                onNotification: (method, params) => context.emit('codex.rpc.notification', { method, params }),
                onRequest: (id, method, params) => {
                  state.pendingRpcIds.add(id)
                  context.emit('codex.rpc.request', { id, method, params })
                }
              })
              state.threads.set(threadId, cwd)
              threadOwners.set(threadId, { cwd, ownerId: context.ownerId })
              return {}
            }
            case 'thread.unregister': {
              const threadId = readString(operationPayload.threadId, 'threadId')
              assertOwnedThread(threadId)
              state.threads.delete(threadId)
              await lease.unregisterThread(threadId)
              return {}
            }
            case 'setup.begin': {
              const cwd = normalizeCwd(readString(operationPayload.cwd, 'cwd'))
              const threadId = typeof operationPayload.threadId === 'string' && operationPayload.threadId !== ''
                ? operationPayload.threadId
                : undefined
              const owner = threadId == null ? undefined : threadOwners.get(threadId)
              if (owner != null && owner.ownerId !== context.ownerId) {
                throw rpcAccessDenied(`Codex thread "${threadId}" is owned by another workspace.`)
              }
              const setupId = randomUUID()
              let enter!: () => void
              let release!: () => void
              const entered = new Promise<void>(resolve => {
                enter = resolve
              })
              const held = new Promise<void>(resolve => {
                release = resolve
              })
              state.pendingSetups.set(setupId, { cwd, release, ...(threadId == null ? {} : { threadId }) })
              void lease.runThreadSetup(async () => {
                enter()
                await held
              }).catch(error => {
                enter()
                options.logger.warn('[codex runtime broker] setup lock failed', { error })
              })
              await entered
              return { setupId }
            }
            case 'setup.end': {
              const setupId = readString(operationPayload.setupId, 'setupId')
              state.pendingSetups.get(setupId)?.release()
              state.pendingSetups.delete(setupId)
              return {}
            }
            default:
              throw new RuntimeBrokerError('operation_not_found', `Unknown Codex broker operation "${operation}".`)
          }
        },
        release: async () => {
          leases.delete(context.leaseId)
          for (const timer of state.hookCallbackTimers) clearTimeout(timer)
          state.hookCallbackTimers.clear()
          state.hookCallbacks.clear()
          state.pendingRpcIds.clear()
          state.respondedRpcIds.clear()
          for (const pending of state.pendingSetups.values()) pending.release()
          state.pendingSetups.clear()
          for (const threadId of state.threads.keys()) {
            await lease.unregisterThread(threadId)
          }
          state.threads.clear()
          lease.release()
        }
      }
    },
    callback: async (rawPayload, callbackContext) => {
      const input = parseHookCallback(rawPayload)
      const owner = callbackContext.leaseId == null ? undefined : leases.get(callbackContext.leaseId)
      if (owner?.context.profileKey !== callbackContext.profileKey) return { continue: true }
      const cwd = normalizeCwd(input.cwd)
      const registeredCwd = owner.threads.get(input.sessionId)
      const hasPendingSetup = [...owner.pendingSetups.values()].some(pending => pending.cwd === cwd)
      if (registeredCwd !== cwd && !hasPendingSetup) return { continue: true }

      const key = hookCallbackKey(input)
      const existing = owner.hookCallbacks.get(key)
      if (existing != null) return await existing
      const callback = owner.context.request('codex.hook', input, { timeoutMs: 590_000 })
      owner.hookCallbacks.set(key, callback)
      void callback.finally(() => {
        const timer = setTimeout(() => {
          owner.hookCallbacks.delete(key)
          owner.hookCallbackTimers.delete(timer)
        }, 5_000)
        timer.unref?.()
        owner.hookCallbackTimers.add(timer)
      }).catch(() => undefined)
      return await callback
    },
    ...(ownedPool == null ? {} : { dispose: ownedPool.dispose })
  }
}
