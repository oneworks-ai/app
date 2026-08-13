/* eslint-disable max-lines -- process lifecycle and serialized NDJSON consumption are one state machine. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createQwenProtocolProjector } from '../../protocol/incoming'
import {
  buildQwenHeadlessArgs,
  ensureQwenPromptSize,
  getQwenErrorMessage,
  mapQwenExitCode,
  normalizeQwenPrompt,
  prepareQwenSession,
  resolveQwenCodeAdapterConfig,
  toQwenAdapterError,
  validateQwenSelection
} from '../config'
import { createQwenRuntimeRedactor, interruptProcess, readQwenResumeSessionId } from './shared'

const isInvalidResumeError = (value: string) => (
  /invalid session identifier|session .*not found|no previous sessions found|cannot resume/i.test(value)
)

export const createStreamQwenSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveQwenCodeAdapterConfig(ctx)
  let qwenSessionId = await readQwenResumeSessionId(ctx.cache, options.type)
  const prepared = await prepareQwenSession(ctx, options)
  const redactor = createQwenRuntimeRedactor({
    additionalValues: [ctx.configs, ctx.configState, options.assetPlan],
    env: prepared.spawnEnv,
    qwenHome: prepared.qwenHome,
    runtimeDir: prepared.runtimeDir
  })
  let destroyed = false
  let currentPid: number | undefined
  let didEmitExit = false
  let didEmitFatalError = false

  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) didEmitFatalError = true
    options.onEvent(redactor.event(event))
  }
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (didEmitExit) return
    didEmitExit = true
    emitEvent({ type: 'exit', data })
  }
  const persistNativeSessionId = async (sessionId: string | undefined) => {
    if (sessionId == null || sessionId.trim() === '' || sessionId === qwenSessionId) return
    qwenSessionId = sessionId
    await ctx.cache.set('adapter.qwen-code.session', { qwenSessionId: sessionId })
  }

  const runTurn = async (
    event: Extract<AdapterEvent, { type: 'message' }>
  ): Promise<void> => {
    if (destroyed) return
    const prompt = normalizeQwenPrompt(event.content)
    ensureQwenPromptSize(prompt)
    validateQwenSelection({
      adapterConfig,
      extraOptions: options.extraOptions,
      prompt
    })
    const resumeSessionId = qwenSessionId
    let observedSessionId: string | undefined
    const args = buildQwenHeadlessArgs({
      adapterConfig,
      cliModel: prepared.cliModel,
      options,
      resumeSessionId
    })
    const proc = spawn(prepared.binaryPath, args, {
      cwd: ctx.cwd,
      env: prepared.spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    currentPid = proc.pid
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let resultError: string | undefined
    let resumeIdentityErrorCode: 'qwen_code_resume_identity_mismatch' | 'qwen_code_resume_identity_missing' | undefined
    let sawResult = false
    const projector = createQwenProtocolProjector({
      cwd: ctx.cwd,
      model: options.model,
      sessionId: options.sessionId
    })
    let parseQueue = Promise.resolve()

    const handleLine = async (rawLine: string) => {
      const line = rawLine.trim()
      if (line === '') return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        resultError ??= 'Malformed Qwen Code stream-json output.'
        ctx.logger.warn('Qwen Code emitted malformed stream-json output', {
          byteLength: Buffer.byteLength(line)
        })
        return
      }
      if (
        parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).type === 'result'
      ) sawResult = true
      const projected = projector.project(parsed)
      if (projected.sessionId != null && projected.sessionId.trim() !== '') {
        const projectedSessionId = projected.sessionId.trim()
        if (redactor.string(projectedSessionId) !== projectedSessionId) {
          resultError ??= 'Qwen Code returned an unsafe native session identifier.'
        } else if (resumeSessionId != null && projectedSessionId !== resumeSessionId) {
          resultError ??=
            `Qwen Code resume returned native session "${projectedSessionId}"; expected "${resumeSessionId}".`
          resumeIdentityErrorCode ??= 'qwen_code_resume_identity_mismatch'
        } else {
          observedSessionId = projectedSessionId
        }
      }
      if (projected.resultError != null) resultError ??= redactor.string(projected.resultError)
      for (const outputEvent of projected.events) emitEvent(outputEvent)
    }
    const enqueueLine = (line: string) => {
      parseQueue = parseQueue.then(() => handleLine(line))
    }

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        enqueueLine(stdoutBuffer.slice(0, newlineIndex))
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
    })
    proc.stdin.end(prompt)

    const exitCode = await new Promise<number>((resolveExit, reject) => {
      proc.once('error', reject)
      proc.once('close', code => resolveExit(code ?? 1))
    })
    currentPid = undefined
    if (stdoutBuffer.trim() !== '') enqueueLine(stdoutBuffer)
    await parseQueue
    if (destroyed) return
    if (exitCode === 0 && !sawResult) {
      resultError ??= 'Qwen Code stream ended before a result event.'
    }
    if (exitCode === 0 && resumeSessionId != null && observedSessionId == null) {
      resultError ??= `Qwen Code resume did not corroborate cached native session "${resumeSessionId}".`
      resumeIdentityErrorCode ??= 'qwen_code_resume_identity_missing'
    }

    const effectiveExitCode = resultError != null && exitCode === 0 ? 1 : exitCode
    if (effectiveExitCode !== 0) {
      const redactedStderr = redactor.string(stderrBuffer.trim())
      const combinedError = redactor.string(`${resultError ?? ''}\n${stderrBuffer}`.trim())
      if (!didEmitFatalError) {
        emitEvent({
          type: 'error',
          data: toQwenAdapterError(combinedError || `Qwen Code exited with code ${effectiveExitCode}`, {
            code: resumeSessionId != null && isInvalidResumeError(combinedError)
              ? 'qwen_code_resume_invalid'
              : resumeIdentityErrorCode ?? mapQwenExitCode(effectiveExitCode),
            details: {
              exitCode: effectiveExitCode,
              stderr: redactedStderr || undefined
            }
          })
        })
      }
      emitExit({
        exitCode: effectiveExitCode,
        stderr: redactedStderr || resultError
      })
      return
    }
    await persistNativeSessionId(observedSessionId)
    emitEvent({ type: 'stop', data: projector.getLastAssistantMessage() })
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
        currentPid = undefined
        const message = redactor.string(getQwenErrorMessage(error))
        ctx.logger.error('Qwen Code session turn failed unexpectedly', { err: message })
        emitEvent({ type: 'error', data: toQwenAdapterError(message) })
        emitExit({ exitCode: 1, stderr: message })
      }
    })
  }

  if (options.description != null && options.description.trim() !== '') {
    enqueueMessage({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }

  return {
    kill: () => {
      destroyed = true
      interruptProcess(currentPid)
    },
    stop: () => {
      if (destroyed) return
      destroyed = true
      interruptProcess(currentPid)
      emitExit({ exitCode: 0 })
    },
    emit: (event) => {
      if (destroyed) return
      if (event.type === 'message') enqueueMessage(event)
      if (event.type === 'interrupt') interruptProcess(currentPid)
      if (event.type === 'stop') {
        destroyed = true
        interruptProcess(currentPid)
        emitExit({ exitCode: 0 })
      }
    },
    get pid() {
      return currentPid
    }
  }
}
