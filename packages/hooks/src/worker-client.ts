import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { HookEventName } from './call'
import { resolveManagedHookScriptPath } from './native'
import type { HookInputs, HookOutputs } from './type'
import { sendWorkerRequest, warmWorker } from './worker-client-shared'
import type { HookWorkerClient, HookWorkerHookRequest, HookWorkerWarmupHints } from './worker-client-shared'

interface HookWorkerResponse<K extends HookEventName> {
  error?: string
  id: string
  ok: boolean
  output?: HookOutputs[K]
}

export interface PersistentHookWorkerPrewarmResult {
  error?: string
  status: 'failed' | 'reused' | 'started'
}

export interface PersistentHookWorkerPrewarmOptions extends HookWorkerWarmupHints {
  warmup?: boolean
}

const workers = new Map<string, HookWorkerClient>()

const resolveWorkerScriptPath = () =>
  resolve(dirname(resolveManagedHookScriptPath('call-hook.js')), 'call-hook-worker.js')

const createWorkerKey = (cwd: string, env: Record<string, string>) =>
  JSON.stringify({
    aiBaseDir: env.__ONEWORKS_PROJECT_BASE_DIR__ ?? '',
    configDir: env.__ONEWORKS_PROJECT_CONFIG_DIR__ ?? '',
    cwd,
    nodePath: env.NODE_PATH ?? '',
    packageDir: env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? '',
    workspace: env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? ''
  })

const rejectPending = (worker: HookWorkerClient, error: Error) => {
  for (const pending of worker.pending.values()) {
    pending.reject(error)
  }
  worker.pending.clear()
}

const launchWorker = (key: string, cwd: string, env: Record<string, string>) => {
  const worker: HookWorkerClient = {
    child: spawn(
      process.execPath,
      [
        '--conditions=__oneworks__',
        '--require',
        createRequireFromWorkerScript().resolve('@oneworks/register/preload'),
        resolveWorkerScriptPath()
      ],
      {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    ),
    nextId: 0,
    pending: new Map(),
    stderrChunks: [],
    warmupKeys: new Set()
  }

  let stdoutBuffer = ''
  worker.child.stdout?.setEncoding('utf-8')
  worker.child.stdout?.on('data', (chunk) => {
    stdoutBuffer += chunk
    while (true) {
      const newlineIndex = stdoutBuffer.indexOf('\n')
      if (newlineIndex === -1) break
      const rawLine = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (!rawLine) continue
      handleWorkerResponse(worker, rawLine)
    }
  })
  worker.child.stderr?.on('data', chunk => worker.stderrChunks.push(Buffer.from(chunk)))
  worker.child.once('error', (error) => {
    workers.delete(key)
    rejectPending(worker, error instanceof Error ? error : new Error(String(error)))
  })
  worker.child.once('exit', (code, signal) => {
    workers.delete(key)
    rejectPending(worker, new Error(`hook worker exited code=${code ?? '<null>'} signal=${signal ?? '<null>'}`))
  })

  workers.set(key, worker)
  return worker
}

const createRequireFromWorkerScript = () => createRequire(resolveWorkerScriptPath())

const handleWorkerResponse = (worker: HookWorkerClient, rawLine: string) => {
  let response: HookWorkerResponse<HookEventName>
  try {
    response = JSON.parse(rawLine) as HookWorkerResponse<HookEventName>
  } catch (error) {
    rejectPending(worker, error instanceof Error ? error : new Error(String(error)))
    return
  }

  const pending = worker.pending.get(response.id)
  if (pending == null) return
  worker.pending.delete(response.id)

  if (response.ok) {
    pending.resolve(response.output)
    return
  }

  pending.reject(new Error(response.error ?? 'hook worker request failed'))
}

export const prewarmPersistentHookWorker = (
  env: Record<string, string>,
  cwd: string,
  options: PersistentHookWorkerPrewarmOptions = {}
): PersistentHookWorkerPrewarmResult | undefined => {
  if (env.ONEWORKS_HOOK_PERSISTENT_WORKER !== '1') {
    return undefined
  }

  try {
    const key = createWorkerKey(cwd, env)
    const existingWorker = workers.get(key)
    if (existingWorker != null) {
      if (options.warmup !== false) {
        warmWorker(existingWorker, env, cwd, options)
      }
      return { status: 'reused' }
    }

    const worker = launchWorker(key, cwd, env)
    if (options.warmup !== false) {
      warmWorker(worker, env, cwd, options)
    }
    return { status: 'started' }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      status: 'failed'
    }
  }
}

export const callHookWithPersistentWorker = async <K extends HookEventName>(
  hookEventName: K,
  input: Omit<HookInputs[K], 'hookEventName'>,
  env: Record<string, string>,
  cwd: string
): Promise<HookOutputs[K]> => {
  const key = createWorkerKey(cwd, env)
  const worker = workers.get(key) ?? launchWorker(key, cwd, env)
  const id = String(worker.nextId++)
  const request = {
    env,
    id,
    input: {
      ...input,
      hookEventName
    },
    type: 'hook'
  } satisfies HookWorkerHookRequest<K>

  return await sendWorkerRequest<HookOutputs[K]>(worker, request)
}
