import { spawn } from 'node:child_process'

import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { buildGrokDirectArgs, prepareGrokSession, resolveGrokAdapterConfig } from '../config'
import { getErrorMessage, toAdapterErrorData } from './shared'

export const createDirectGrokSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveGrokAdapterConfig(ctx)
  const prepared = await prepareGrokSession(ctx, options)
  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      model: options.model ?? 'default',
      effort: options.effort,
      version: 'unknown',
      tools: [],
      slashCommands: [],
      cwd: ctx.cwd,
      agents: []
    }
  })
  const proc = spawn(
    prepared.binaryPath,
    buildGrokDirectArgs({ adapterConfig, cliModel: prepared.cliModel, options }),
    {
      cwd: ctx.cwd,
      env: prepared.spawnEnv,
      stdio: 'inherit'
    }
  )

  let finished = false
  let didFatalError = false
  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) didFatalError = true
    options.onEvent(event)
  }
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (finished) return
    finished = true
    emitEvent({ type: 'exit', data })
  }
  proc.on('error', (error) => {
    emitEvent({ type: 'error', data: toAdapterErrorData(error) })
    emitExit({ exitCode: 1, stderr: getErrorMessage(error) })
  })
  proc.on('exit', (code) => {
    const exitCode = code ?? 1
    if (exitCode !== 0 && !didFatalError) {
      emitEvent({
        type: 'error',
        data: toAdapterErrorData(`Grok exited with code ${exitCode}`, {
          code: 'process_exit',
          details: { exitCode }
        })
      })
    }
    emitExit({ exitCode })
  })

  return {
    kill: () => proc.kill(),
    emit: () => ctx.logger.warn('emit() is not supported in direct mode for grok'),
    pid: proc.pid
  }
}
