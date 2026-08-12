import { spawn } from 'node:child_process'
import process from 'node:process'

import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { handleGrokIncomingEvent } from '../../protocol/incoming'
import type { GrokIncomingEvent } from '../../protocol/types'
import { buildGrokHeadlessArgs, prepareGrokSession, resolveGrokAdapterConfig, writeGrokPromptFile } from '../config'
import { getErrorMessage, isMissingGrokResume, normalizeGrokPrompt, toAdapterErrorData } from './shared'

export const createStreamGrokSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveGrokAdapterConfig(ctx)
  const prepared = await prepareGrokSession(ctx, options)
  let destroyed = false
  let currentPid: number | undefined
  let currentKill: (() => void) | undefined
  let didEmitExit = false
  let hasNativeSession = options.type === 'resume'

  const emitEvent = (event: AdapterOutputEvent) => options.onEvent(event)
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (didEmitExit) return
    didEmitExit = true
    emitEvent({ type: 'exit', data })
  }

  const runTurn = async (
    event: Extract<AdapterEvent, { type: 'message' }>,
    allowResumeRetry: boolean
  ): Promise<void> => {
    if (destroyed) return
    const promptPath = await writeGrokPromptFile(prepared.grokHome, normalizeGrokPrompt(event.content))
    const resume = hasNativeSession
    const proc = spawn(
      prepared.binaryPath,
      buildGrokHeadlessArgs({
        adapterConfig,
        cliModel: prepared.cliModel,
        options,
        promptFile: promptPath,
        resume
      }),
      {
        cwd: ctx.cwd,
        env: prepared.spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    currentPid = proc.pid
    currentKill = () => {
      if (proc.pid == null) return
      try {
        process.kill(proc.pid, 'SIGINT')
      } catch {
      }
    }

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let didStop = false
    let didFatalError = false
    const deferredResultEvents: AdapterOutputEvent[] = []
    const resultErrorTexts: string[] = []
    const onParsedEvent: AdapterQueryOptions['onEvent'] = (outputEvent) => {
      if (outputEvent.type === 'stop') didStop = true
      if (outputEvent.type === 'error' && outputEvent.data.fatal !== false) didFatalError = true
      emitEvent(outputEvent)
    }
    const handleLine = (rawLine: string) => {
      const line = rawLine.trim()
      if (line === '') return
      try {
        const parsed = JSON.parse(line) as GrokIncomingEvent
        if (
          parsed.type === 'result' &&
          (parsed.subtype === 'error_during_execution' || parsed.is_error === true)
        ) {
          if (parsed.result?.trim()) resultErrorTexts.push(parsed.result.trim())
          resultErrorTexts.push(...(parsed.errors ?? []).map(item => item.trim()).filter(Boolean))
        }
        handleGrokIncomingEvent(
          parsed,
          resume && allowResumeRetry && parsed.type === 'result'
            ? outputEvent => deferredResultEvents.push(outputEvent)
            : onParsedEvent,
          options.effort
        )
      } catch {
        ctx.logger.warn('Ignoring non-JSON Grok stdout line', { line })
      }
    }

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        handleLine(stdoutBuffer.slice(0, newlineIndex))
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', code => resolve(code ?? 1))
    })
    currentPid = undefined
    currentKill = undefined
    handleLine(stdoutBuffer)
    if (destroyed) return

    const failureText = [stderrBuffer.trim(), ...resultErrorTexts]
      .filter(text => text !== '')
      .join('\n')
    if (resume && allowResumeRetry && isMissingGrokResume(failureText)) {
      hasNativeSession = false
      emitEvent({
        type: 'error',
        data: toAdapterErrorData('The Grok session was not found. Starting a fresh native session.', {
          code: 'grok_resume_missing',
          fatal: false
        })
      })
      await runTurn(event, false)
      return
    }
    for (const outputEvent of deferredResultEvents) onParsedEvent(outputEvent)

    if (exitCode !== 0) {
      const errorText = failureText
      if (!didFatalError) {
        emitEvent({
          type: 'error',
          data: toAdapterErrorData(errorText || `Grok exited with code ${exitCode}`, {
            code: 'process_exit',
            details: { exitCode, stderr: errorText || undefined }
          })
        })
      }
      emitExit({ exitCode, stderr: errorText || undefined })
      return
    }

    hasNativeSession = true
    if (!didStop) emitEvent({ type: 'stop' })
    emitExit({ exitCode: 0 })
  }

  let queue = Promise.resolve()
  const enqueueMessage = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    queue = queue.catch(() => undefined).then(async () => {
      try {
        await runTurn(event, true)
      } catch (error) {
        if (destroyed) return
        destroyed = true
        emitEvent({ type: 'error', data: toAdapterErrorData(error) })
        emitExit({ exitCode: 1, stderr: getErrorMessage(error) })
      }
    })
  }

  if (options.description != null && options.description.trim() !== '') {
    enqueueMessage({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }

  return {
    kill: () => {
      destroyed = true
      currentKill?.()
    },
    stop: () => {
      if (destroyed) return
      destroyed = true
      currentKill?.()
      if (currentPid == null) emitExit({ exitCode: 0 })
    },
    emit: (event) => {
      if (destroyed) return
      if (event.type === 'message') enqueueMessage(event)
      if (event.type === 'interrupt') currentKill?.()
      if (event.type === 'stop') {
        destroyed = true
        currentKill?.()
      }
    },
    get pid() {
      return currentPid
    }
  }
}
