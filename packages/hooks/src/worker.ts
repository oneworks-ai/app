import process from 'node:process'
import { createInterface } from 'node:readline'

import type { PluginConfig, ResolvedPluginInstanceMetadata } from '@oneworks/types'

import { executeHookInput } from './runtime'
import { warmHookRuntime } from './runtime-warmup'
import type { HookInput } from './type'

interface HookWorkerHookRequest {
  env?: Record<string, string>
  id: string
  input: HookInput
  type?: 'hook'
}

interface HookWorkerWarmupRequest {
  cwd: string
  env?: Record<string, string>
  id: string
  light?: boolean
  pluginConfig?: PluginConfig
  pluginInstances?: ResolvedPluginInstanceMetadata[]
  sessionId?: string
  type: 'warmup'
}

type HookWorkerRequest = HookWorkerHookRequest | HookWorkerWarmupRequest

interface HookWorkerResponse {
  error?: string
  id: string
  ok: boolean
  output?: unknown
}

const writeResponse = (response: HookWorkerResponse) => {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

const pickDefinedEnv = (env: NodeJS.ProcessEnv) => (
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
)

const replaceProcessEnv = (nextEnv: Record<string, string>) => {
  const previousEnv = pickDefinedEnv(process.env)

  for (const key of Object.keys(process.env)) {
    if (!(key in nextEnv)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, nextEnv)

  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, previousEnv)
  }
}

const handleRequest = async (request: HookWorkerRequest) => {
  const restoreEnv = replaceProcessEnv({
    ...pickDefinedEnv(process.env),
    ...(request.env ?? {})
  })

  try {
    const output = request.type === 'warmup'
      ? await warmHookRuntime({
        cwd: request.cwd,
        light: request.light,
        pluginConfig: request.pluginConfig,
        pluginInstances: request.pluginInstances,
        sessionId: request.sessionId
      }, process.env)
      : await executeHookInput(request.input, process.env)
    writeResponse({
      id: request.id,
      ok: true,
      output
    })
  } catch (error) {
    writeResponse({
      error: error instanceof Error ? error.message : String(error),
      id: request.id,
      ok: false
    })
  } finally {
    restoreEnv()
  }
}

export const runHookWorkerCli = async () => {
  const lineReader = createInterface({
    input: process.stdin,
    terminal: false
  })

  let queue = Promise.resolve()
  lineReader.on('line', (line) => {
    const trimmedLine = line.trim()
    if (!trimmedLine) {
      return
    }

    queue = queue.then(async () => {
      await handleRequest(JSON.parse(trimmedLine) as HookWorkerRequest)
    }).catch((error) => {
      const fallbackId = (() => {
        try {
          const parsed = JSON.parse(trimmedLine) as Partial<HookWorkerRequest>
          return typeof parsed.id === 'string' ? parsed.id : '<unknown>'
        } catch {
          return '<unknown>'
        }
      })()
      writeResponse({
        error: error instanceof Error ? error.message : String(error),
        id: fallbackId,
        ok: false
      })
    })
  })
}
