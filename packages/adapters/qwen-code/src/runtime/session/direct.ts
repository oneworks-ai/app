import { spawn } from 'node:child_process'
import process from 'node:process'

import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import {
  buildQwenDirectArgs,
  getQwenErrorMessage,
  mapQwenExitCode,
  prepareQwenSession,
  resolveLatestQwenSessionId,
  resolveQwenCodeAdapterConfig,
  toQwenAdapterError
} from '../config'
import { createQwenRuntimeRedactor, interruptProcess, readQwenResumeSessionId } from './shared'

export const createDirectQwenSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveQwenCodeAdapterConfig(ctx)
  const resumeSessionId = await readQwenResumeSessionId(ctx.cache, options.type)
  const prepared = await prepareQwenSession(ctx, options)
  const redactor = createQwenRuntimeRedactor({
    additionalValues: [ctx.configs, ctx.configState, options.assetPlan],
    env: prepared.spawnEnv,
    qwenHome: prepared.qwenHome,
    runtimeDir: prepared.runtimeDir
  })
  let finished = false
  let settlementStarted = false
  let stopRequested = false
  let didEmitFatalError = false
  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) didEmitFatalError = true
    options.onEvent(redactor.event(event))
  }
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (finished) return
    finished = true
    emitEvent({ type: 'exit', data })
  }
  const args = buildQwenDirectArgs({
    adapterConfig,
    cliModel: prepared.cliModel,
    options,
    resumeSessionId
  })
  const startedAt = Date.now()
  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'qwen-code',
      model: options.model ?? 'default',
      version: 'unknown',
      tools: [],
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })
  const proc = spawn(prepared.binaryPath, args, {
    cwd: ctx.cwd,
    env: prepared.spawnEnv,
    stdio: 'inherit',
    detached: process.platform !== 'win32'
  })
  const settleFailure = (error: unknown, code = 'qwen_code_direct_settlement_failed') => {
    const message = redactor.string(getQwenErrorMessage(error))
    ctx.logger.error('Qwen Code direct session settlement failed', {
      error: redactor.unknown(error)
    })
    if (!didEmitFatalError) {
      emitEvent({
        type: 'error',
        data: toQwenAdapterError(message, { code })
      })
    }
    emitExit({ exitCode: 1, stderr: message })
  }
  const settleAfterClose = async (code: number | null) => {
    let effectiveExitCode = code ?? 1
    if (effectiveExitCode === 0) {
      const qwenSessionId = await resolveLatestQwenSessionId({
        ctx,
        minMtimeMs: startedAt,
        runtimeDir: prepared.runtimeDir
      })
      if (qwenSessionId != null && redactor.string(qwenSessionId) !== qwenSessionId) {
        effectiveExitCode = 1
        emitEvent({
          type: 'error',
          data: toQwenAdapterError('Qwen Code returned an unsafe native session identifier.', {
            code: 'qwen_code_session_id_unsafe'
          })
        })
      } else if (resumeSessionId != null && qwenSessionId == null) {
        effectiveExitCode = 1
        emitEvent({
          type: 'error',
          data: toQwenAdapterError('Qwen Code resume did not corroborate the cached native session identifier.', {
            code: 'qwen_code_resume_identity_missing'
          })
        })
      } else if (resumeSessionId != null && qwenSessionId !== resumeSessionId) {
        effectiveExitCode = 1
        emitEvent({
          type: 'error',
          data: toQwenAdapterError('Qwen Code resume returned a different native session identifier.', {
            code: 'qwen_code_resume_identity_mismatch'
          })
        })
      } else if (resumeSessionId == null && qwenSessionId != null) {
        await ctx.cache.set('adapter.qwen-code.session', { qwenSessionId })
      }
    } else if (!didEmitFatalError) {
      emitEvent({
        type: 'error',
        data: toQwenAdapterError(`Process exited with code ${effectiveExitCode}`, {
          code: mapQwenExitCode(effectiveExitCode),
          details: { exitCode: effectiveExitCode }
        })
      })
    }
    emitExit({ exitCode: effectiveExitCode })
  }
  const beginSettlement = (settle: () => Promise<void>) => {
    if (settlementStarted || finished) return
    settlementStarted = true
    void settle().catch(settleFailure)
  }
  proc.once('error', (error) => {
    beginSettlement(async () => settleFailure(error, 'qwen_code_spawn_failed'))
  })
  proc.once('close', code => {
    beginSettlement(() => settleAfterClose(code))
  })
  const stop = () => {
    if (finished || stopRequested) return
    stopRequested = true
    interruptProcess(proc.pid)
    emitExit({ exitCode: 0 })
  }
  return {
    kill: () => interruptProcess(proc.pid),
    stop,
    emit: (event) => {
      if (event.type === 'stop') {
        stop()
        return
      }
      if (event.type === 'interrupt') {
        interruptProcess(proc.pid)
        return
      }
      ctx.logger.warn('message emit() is not supported in direct mode for qwen-code')
    },
    pid: proc.pid
  }
}
