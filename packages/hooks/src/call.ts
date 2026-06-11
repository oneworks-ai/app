import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import { createStartupProfiler } from '@oneworks/utils'

import { resolveManagedHookPackageDir, resolveManagedHookScriptPath } from './native'
import type { HookInputs, HookOutputs } from './type'
import { callHookWithPersistentWorker } from './worker-client'

export type HookEventName = keyof HookInputs

type HookInputPayload<K extends HookEventName> = Omit<HookInputs[K], 'hookEventName'>

const pickHookEnv = (env: Record<string, unknown>): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

const createRequireFromHere = () => createRequire(resolveManagedHookScriptPath('call-hook.js'))

const resolveManagedHookProcess = () => {
  const scriptPath = resolveManagedHookScriptPath('call-hook.js')
  const packageDir = resolveManagedHookPackageDir()
  const sourceEntrypoint = resolve(packageDir, 'src/entry.ts')

  if (!existsSync(sourceEntrypoint)) {
    return {
      args: [scriptPath],
      env: {}
    }
  }

  return {
    args: [
      '--conditions=__oneworks__',
      '--require',
      createRequireFromHere().resolve('@oneworks/register/preload'),
      scriptPath
    ],
    env: {
      // call-hook.js normally forks again to enter source runtime. The internal
      // callHook path already controls the Node flags, so skip that wrapper hop.
      __IS_ONEWORKS_HOOK_LOADER__: 'true'
    }
  }
}

export const callHook = async <K extends HookEventName>(
  hookEventName: K,
  input: HookInputPayload<K>,
  env: Record<string, unknown> = process.env
): Promise<HookOutputs[K]> => {
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd()
  const profiler = createStartupProfiler({
    cwd,
    ctxId: typeof env.__ONEWORKS_PROJECT_CTX_ID__ === 'string' ? env.__ONEWORKS_PROJECT_CTX_ID__ : undefined,
    env: pickHookEnv(env),
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined
  })
  const prepareEnvStartedAt = profiler.now()
  const childEnv = pickHookEnv(env)
  childEnv.__ONEWORKS_HOOK_EVENT_NAME__ = hookEventName
  profiler.mark(`hook.${hookEventName}.parent.prepareEnv`, prepareEnvStartedAt, {
    envCount: Object.keys(childEnv).length
  })

  if (childEnv.ONEWORKS_HOOK_PERSISTENT_WORKER === '1') {
    const workerStartedAt = profiler.now()
    try {
      const output = await callHookWithPersistentWorker(hookEventName, input, childEnv, cwd)
      profiler.mark(`hook.${hookEventName}.parent.workerRequest`, workerStartedAt)
      return output
    } catch (error) {
      profiler.mark(`hook.${hookEventName}.parent.workerFallback`, workerStartedAt, {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const resolveProcessStartedAt = profiler.now()
  const hookProcess = resolveManagedHookProcess()
  Object.assign(childEnv, hookProcess.env)
  profiler.mark(`hook.${hookEventName}.parent.resolveProcess`, resolveProcessStartedAt, {
    argCount: hookProcess.args.length
  })

  const beforeSpawnEpochMs = Date.now()
  childEnv.__ONEWORKS_HOOK_PARENT_BEFORE_SPAWN_EPOCH_MS__ = String(beforeSpawnEpochMs)
  childEnv.__ONEWORKS_HOOK_PARENT_SPAWNED_AT_EPOCH_MS__ = String(beforeSpawnEpochMs)
  const spawnStartedAt = profiler.now()
  const child = spawn(process.execPath, hookProcess.args, {
    cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  profiler.mark(`hook.${hookEventName}.parent.spawn`, spawnStartedAt)

  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []

  child.stdout.on('data', chunk => stdoutChunks.push(chunk))
  child.stderr.on('data', chunk => stderrChunks.push(chunk))

  const payloadStartedAt = profiler.now()
  const payload = JSON.stringify({
    ...input,
    hookEventName
  })
  profiler.mark(`hook.${hookEventName}.parent.serializeInput`, payloadStartedAt, {
    bytes: Buffer.byteLength(payload)
  })

  const childExit = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 0))
  })

  const writeFlushStartedAt = profiler.now()
  const writeCallStartedAt = profiler.now()
  const writeReturned = child.stdin.write(payload, () => {
    profiler.mark(`hook.${hookEventName}.parent.writeInputFlush`, writeFlushStartedAt)
  })
  profiler.mark(`hook.${hookEventName}.parent.writeInputCall`, writeCallStartedAt, {
    bytes: Buffer.byteLength(payload),
    writeReturned
  })

  if (!writeReturned) {
    const drainStartedAt = profiler.now()
    child.stdin.once('drain', () => {
      profiler.mark(`hook.${hookEventName}.parent.writeInputDrain`, drainStartedAt)
    })
  }

  const endInputStartedAt = profiler.now()
  child.stdin.end(() => {
    profiler.mark(`hook.${hookEventName}.parent.endInput`, endInputStartedAt)
  })

  const waitChildStartedAt = profiler.now()
  const exitCode = await childExit
  profiler.mark(`hook.${hookEventName}.parent.waitChild`, waitChildStartedAt, {
    exitCode
  })

  const collectOutputStartedAt = profiler.now()
  const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim()
  const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
  profiler.mark(`hook.${hookEventName}.parent.collectOutput`, collectOutputStartedAt, {
    stderrBytes: Buffer.byteLength(stderr),
    stdoutBytes: Buffer.byteLength(stdout)
  })

  if (exitCode !== 0) {
    throw new Error(`Failed to call hook: process exited with code ${exitCode}${stderr ? ` - ${stderr}` : ''}`)
  }

  if (stdout === '') {
    return { continue: true } as HookOutputs[K]
  }

  try {
    const parseOutputStartedAt = profiler.now()
    const output = JSON.parse(stdout) as HookOutputs[K]
    profiler.mark(`hook.${hookEventName}.parent.parseOutput`, parseOutputStartedAt)
    return output
  } catch (error) {
    throw new Error(`Failed to parse hook output: ${stdout}${stderr ? `\nstderr: ${stderr}` : ''}`, { cause: error })
  }
}
