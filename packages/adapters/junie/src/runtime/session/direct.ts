import { spawn } from 'node:child_process'

import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import {
  DEFAULT_JUNIE_TOOLS,
  buildJunieArgs,
  getErrorMessage,
  prepareJunieSession,
  refreshJunieChildAuthEnv,
  resolveJunieAdapterConfig,
  validateJunieEffortSelection,
  validateJunieExtraOptions
} from '../shared'

export const createDirectJunieSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveJunieAdapterConfig(ctx)
  validateJunieEffortSelection(adapterConfig, options)
  validateJunieExtraOptions(options.extraOptions)
  const prepared = await prepareJunieSession(ctx, options)
  const cached = await ctx.cache.get('adapter.junie.session')
  const nativeSessionId = options.type === 'resume' ? cached?.junieSessionId : undefined
  if (options.type === 'resume' && nativeSessionId == null) {
    throw new Error('Cannot resume Junie: the native session id is missing from this One Works session cache.')
  }

  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'junie',
      model: options.model ?? 'default',
      effort: options.effort,
      version: '26.8.x (2651.4)',
      tools: DEFAULT_JUNIE_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })
  if (options.type === 'create') {
    options.onEvent({
      type: 'error',
      data: {
        message:
          'Junie direct mode does not expose a stable native session id; use the default stream mode when later resume is required.',
        code: 'junie_direct_session_id_unobservable',
        fatal: false
      }
    })
  }

  const proc = spawn(
    prepared.binaryPath,
    buildJunieArgs({
      adapterConfig,
      nativeSessionId,
      options,
      prepared,
      prompt: options.description,
      stream: false
    }),
    {
      cwd: ctx.cwd,
      env: refreshJunieChildAuthEnv({ adapterConfig, baseEnv: prepared.spawnEnv, env: ctx.env }),
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
    const message = getErrorMessage(error)
    emitEvent({ type: 'error', data: { message, code: 'junie_spawn_error', fatal: true } })
    emitExit({ exitCode: 1, stderr: message })
  })
  proc.on('exit', (code, signal) => {
    const exitCode = code ?? (signal == null ? 1 : 130)
    if (exitCode !== 0 && !didFatalError) {
      emitEvent({
        type: 'error',
        data: {
          message: `Junie exited with code ${exitCode}${signal == null ? '' : ` (${signal})`}.`,
          code: 'junie_process_exit',
          fatal: true,
          details: { exitCode, signal }
        }
      })
    }
    emitExit({ exitCode })
  })

  return {
    kill: () => proc.kill('SIGINT'),
    stop: () => proc.kill('SIGINT'),
    emit: () => ctx.logger.warn('emit() is not supported in direct mode for junie'),
    pid: proc.pid
  }
}
