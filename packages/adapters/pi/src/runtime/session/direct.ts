import { spawn } from 'node:child_process'

import type { AdapterCtx, AdapterEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { PI_CLI_VERSION } from '#~/paths.js'
import type { PiSessionBase } from './prepare'

export const encodeDirectInitialPrompt = (description: string | undefined) => {
  const prompt = description?.trim()
  if (prompt == null || prompt === '') return undefined
  return prompt.startsWith('-') || prompt.startsWith('@') ? ` ${prompt}` : prompt
}

export const createDirectPiSession = (
  base: PiSessionBase,
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  spawnProcess: typeof spawn = spawn
): AdapterSession => {
  const initialPrompt = encodeDirectInitialPrompt(options.description)
  const args = [
    ...base.args,
    ...(initialPrompt == null ? [] : [initialPrompt])
  ]
  const proc = spawnProcess(base.binaryPath, args, {
    cwd: ctx.cwd,
    env: base.spawnEnv,
    stdio: 'inherit'
  })
  let exited = false
  const emitExit = (exitCode?: number) => {
    if (exited) return
    exited = true
    options.onEvent({ type: 'exit', data: { exitCode } })
  }
  proc.on('error', (error) => {
    options.onEvent({ type: 'error', data: { message: error.message, fatal: true } })
    emitExit(1)
  })
  proc.on('exit', code => emitExit(code ?? undefined))
  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      model: base.model,
      effort: options.effort,
      version: PI_CLI_VERSION,
      tools: base.tools,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: ['pi'],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  const stop = () => {
    if (!proc.killed) proc.kill('SIGTERM')
  }
  return {
    kill: stop,
    stop,
    emit: (event: AdapterEvent) => {
      if (event.type === 'interrupt') proc.kill('SIGINT')
      else if (event.type === 'stop') stop()
    },
    pid: proc.pid
  }
}
