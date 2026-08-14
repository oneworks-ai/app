/* eslint-disable max-lines -- The per-turn process, protocol, and cache transaction stays auditable together. */
import { spawn } from 'node:child_process'

import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createJunieJsonStreamParser } from '../../protocol/json-stream'
import {
  buildJunieArgs,
  getErrorMessage,
  normalizeJuniePrompt,
  prepareJunieSession,
  refreshJunieChildAuthEnv,
  resolveJunieAdapterConfig,
  validateJunieEffortSelection,
  validateJunieExtraOptions
} from '../shared'
import { emitJunieSessionInit } from './init-event'

export const createStreamJunieSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveJunieAdapterConfig(ctx)
  validateJunieEffortSelection(adapterConfig, options)
  validateJunieExtraOptions(options.extraOptions)
  const prepared = await prepareJunieSession(ctx, options)
  const cached = await ctx.cache.get('adapter.junie.session')
  let nativeSessionId = options.type === 'resume' ? cached?.junieSessionId : undefined
  if (options.type === 'resume' && nativeSessionId == null) {
    throw new Error('Cannot resume Junie: the native session id is missing from this One Works session cache.')
  }

  let destroyed = false
  let stopping = false
  let currentPid: number | undefined
  let currentKill: (() => void) | undefined
  let didEmitExit = false
  let currentTurnDidFatalError = false
  let currentTurnDidStop = false
  const emitEvent = (event: AdapterOutputEvent) => options.onEvent(event)
  const emitTurnEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) currentTurnDidFatalError = true
    if (event.type === 'stop') currentTurnDidStop = true
    emitEvent(event)
  }
  const emitTurnFatal = (data: Extract<AdapterOutputEvent, { type: 'error' }>['data']) => {
    if (currentTurnDidFatalError) return
    emitTurnEvent({ type: 'error', data: { ...data, fatal: true } })
  }
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (didEmitExit) return
    didEmitExit = true
    emitEvent({ type: 'exit', data })
  }

  emitJunieSessionInit(ctx, options, emitEvent)

  const runTurn = async (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (destroyed) return
    currentTurnDidFatalError = false
    currentTurnDidStop = false
    const prompt = normalizeJuniePrompt(event.content)
    if (prompt === '') return
    const expectedSessionId = nativeSessionId
    const proc = spawn(
      prepared.binaryPath,
      buildJunieArgs({ adapterConfig, nativeSessionId, options, prepared, prompt, stream: true }),
      {
        cwd: ctx.cwd,
        env: refreshJunieChildAuthEnv({ adapterConfig, baseEnv: prepared.spawnEnv, env: ctx.env }),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    currentPid = proc.pid
    currentKill = () => proc.kill('SIGINT')
    let stderr = ''
    let unknownEventCount = 0
    let tentativeSessionId: string | undefined
    const parser = createJunieJsonStreamParser({
      effort: options.effort,
      expectedSessionId,
      model: options.model,
      onDiagnostic: (diagnostic) => {
        ctx.logger.warn('[junie protocol] json-stream diagnostic', diagnostic)
        if (diagnostic.code === 'unknown_event') {
          unknownEventCount += 1
          emitTurnEvent({
            type: 'error',
            data: {
              message: diagnostic.message,
              code: 'junie_protocol_unknown_event',
              details: diagnostic,
              fatal: false
            }
          })
        }
      },
      // A result is tentative until EOF and process completion. Hold the parser's
      // stop event so a late failure can still terminate as error -> stop -> exit.
      onEvent: (projectedEvent) => {
        if (projectedEvent.type !== 'stop') emitTurnEvent(projectedEvent)
      },
      onSessionId: (nextSessionId) => {
        tentativeSessionId = nextSessionId
      }
    })
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => parser.push(chunk))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        proc.once('error', reject)
        proc.once('close', (code, signal) => resolve({ code, signal }))
      }
    )
    const parseResult = parser.finish()
    currentPid = undefined
    currentKill = undefined
    const stderrText = stderr.trim()

    if (destroyed) {
      if (!currentTurnDidStop) emitTurnEvent({ type: 'stop' })
      emitExit({ exitCode: stopping ? 0 : 130, stderr: stderrText || undefined })
      return
    }
    if (parseResult.eventCount === 0) {
      emitTurnFatal({
        message:
          'Junie exited without emitting any json-stream events. The installed CLI may be incompatible or authentication may be required.',
        code: 'junie_protocol_empty_stream'
      })
    }
    const processExitCode = code ?? (signal == null ? 1 : 130)
    if (processExitCode !== 0) {
      emitTurnFatal({
        message: stderrText || `Junie exited with code ${processExitCode}${signal == null ? '' : ` (${signal})`}.`,
        code: 'junie_process_exit',
        details: { exitCode: processExitCode, signal, unknownEventCount }
      })
    }
    if (processExitCode === 0 && !currentTurnDidFatalError && !parseResult.didResult) {
      emitTurnFatal({
        message:
          'Junie ended its json-stream without a confirmed result event. The stream is incomplete or incompatible.',
        code: 'junie_protocol_incomplete_stream',
        details: { eventCount: parseResult.eventCount, unknownEventCount }
      })
    }
    if (processExitCode === 0 && !currentTurnDidFatalError && tentativeSessionId == null) {
      emitTurnFatal({
        message: 'Junie completed without exposing a native session id; this turn cannot be resumed safely.',
        code: 'junie_session_id_missing'
      })
    }
    const effectiveExitCode = currentTurnDidFatalError
      ? processExitCode === 0 ? 1 : processExitCode
      : processExitCode
    if (effectiveExitCode !== 0) {
      if (!currentTurnDidStop) emitTurnEvent({ type: 'stop' })
      emitExit({ exitCode: effectiveExitCode, stderr: stderrText || undefined })
      return
    }
    if (!parseResult.didStop) {
      emitTurnFatal({
        message: 'Junie result event did not produce the required terminal stop event.',
        code: 'junie_protocol_result_without_stop'
      })
    }
    if (currentTurnDidFatalError) {
      if (!currentTurnDidStop) emitTurnEvent({ type: 'stop' })
      emitExit({ exitCode: 1 })
      return
    }
    await ctx.cache.set('adapter.junie.session', {
      junieSessionId: tentativeSessionId!,
      title: `OneWorks:${options.sessionId}`
    })
    nativeSessionId = tentativeSessionId
    emitTurnEvent({ type: 'stop' })
    emitExit({ exitCode: 0 })
  }

  let queue = Promise.resolve()
  const enqueueMessage = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    queue = queue.catch(() => undefined).then(async () => {
      try {
        await runTurn(event)
      } catch (error) {
        if (destroyed) return
        destroyed = true
        const message = getErrorMessage(error)
        emitTurnFatal({ message, code: 'junie_spawn_error' })
        if (!currentTurnDidStop) emitTurnEvent({ type: 'stop' })
        emitExit({ exitCode: 1, stderr: message })
      }
    })
  }

  if (options.description?.trim()) {
    enqueueMessage({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }

  return {
    kill: () => {
      destroyed = true
      stopping = false
      currentKill?.()
      if (currentPid == null) emitExit({ exitCode: 130 })
    },
    stop: () => {
      if (destroyed) return
      destroyed = true
      stopping = true
      currentKill?.()
      if (currentPid == null) emitExit({ exitCode: 0 })
    },
    emit: (event) => {
      if (destroyed) return
      if (event.type === 'message') enqueueMessage(event)
      if (event.type === 'interrupt') currentKill?.()
      if (event.type === 'stop') {
        destroyed = true
        stopping = true
        currentKill?.()
      }
    },
    get pid() {
      return currentPid
    }
  }
}
