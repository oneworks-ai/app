import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import type { PluginConfig, ResolvedPluginInstanceMetadata } from '@oneworks/types'

import type { HookEventName } from './call'
import type { HookInputs } from './type'

export interface HookWorkerWarmupHints {
  light?: boolean
  pluginConfig?: PluginConfig
  pluginInstances?: ResolvedPluginInstanceMetadata[]
}

export interface HookWorkerHookRequest<K extends HookEventName> {
  env: Record<string, string>
  id: string
  input: Omit<HookInputs[K], 'hookEventName'> & {
    hookEventName: K
  }
  type: 'hook'
}

export interface HookWorkerWarmupRequest {
  cwd: string
  env: Record<string, string>
  id: string
  light?: boolean
  pluginConfig?: PluginConfig
  pluginInstances?: ResolvedPluginInstanceMetadata[]
  sessionId?: string
  type: 'warmup'
}

export interface HookWorkerClient {
  child: ChildProcess
  nextId: number
  pending: Map<string, {
    reject: (error: Error) => void
    resolve: (value: unknown) => void
  }>
  stderrChunks: Buffer[]
  warmup?: Promise<void>
  warmupKeys: Set<string>
}

export const sendWorkerRequest = async <T>(
  worker: HookWorkerClient,
  request: HookWorkerHookRequest<HookEventName> | HookWorkerWarmupRequest
): Promise<T> => (
  await new Promise<T>((resolvePromise, rejectPromise) => {
    if (worker.child.stdin == null) {
      rejectPromise(new Error('hook worker stdin is unavailable'))
      return
    }

    worker.pending.set(request.id, {
      reject: rejectPromise,
      resolve: value => resolvePromise(value as T)
    })
    worker.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (error) {
        worker.pending.delete(request.id)
        rejectPromise(error)
      }
    })
  })
)

export const warmWorker = (
  worker: HookWorkerClient,
  env: Record<string, string>,
  cwd: string,
  hints: HookWorkerWarmupHints = {}
) => {
  const warmupKey = hints.pluginInstances != null
    ? 'resolved'
    : (hints.light === true ? 'light' : 'full')
  if (worker.warmupKeys.has(warmupKey)) {
    return
  }
  worker.warmupKeys.add(warmupKey)

  const id = String(worker.nextId++)
  const request = sendWorkerRequest<void>(worker, {
    cwd,
    env,
    id,
    light: hints.light,
    pluginConfig: hints.pluginConfig,
    pluginInstances: hints.pluginInstances,
    sessionId: env.__ONEWORKS_PROJECT_CTX_ID__,
    type: 'warmup'
  }).catch((error) => {
    worker.warmupKeys.delete(warmupKey)
    throw error
  })
  worker.warmup = worker.warmup == null
    ? request
    : worker.warmup.catch(() => {}).then(() => request)
  void worker.warmup.catch(() => {})
}
