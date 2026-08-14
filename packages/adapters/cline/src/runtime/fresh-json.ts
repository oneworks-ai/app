/* eslint-disable max-lines -- fresh-only JSON lifecycle keeps parsing and single-settle behavior together. */
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

import type { AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { mapContentToFreshText } from './input'
import type { ClinePreparedSession } from './prepare'
import type { ClineRedactor } from './redaction'

interface ClineJsonRecord {
  type?: string
  message?: string
  text?: string
  event?: {
    type?: string
    contentType?: string
    error?: unknown
    input?: unknown
    output?: unknown
    recoverable?: boolean
    text?: string
    toolName?: string
    toolUseId?: string
  }
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const withoutAcpApprovalFlags = (args: string[]) => {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--acp') continue
    if (arg === '--auto-approve') {
      index += 1
      continue
    }
    if (arg.startsWith('--auto-approve=')) continue
    result.push(arg)
  }
  return result
}

export const buildClineFreshJsonArgs = (
  prepared: ClinePreparedSession,
  permissionMode: AdapterQueryOptions['permissionMode']
) => {
  const commonArgs = withoutAcpApprovalFlags(prepared.args)
  if (permissionMode === 'dontAsk' || permissionMode === 'bypassPermissions') {
    return ['--json', '--cwd', prepared.cwd, ...commonArgs, '--yolo']
  }
  if (permissionMode === 'plan') {
    return ['--json', '--cwd', prepared.cwd, ...commonArgs]
  }
  throw new Error(
    `Cline fresh-only JSON cannot represent One Works permission mode "${permissionMode ?? 'default'}" ` +
      'without an interactive permission responder. Use plan, dontAsk, or bypassPermissions.'
  )
}

const createLineConsumer = (onLine: (line: string) => void) => {
  let buffer = ''
  return {
    push(chunk: Buffer | string) {
      buffer += chunk.toString()
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) onLine(line)
        index = buffer.indexOf('\n')
      }
    },
    flush() {
      const line = buffer.trim()
      buffer = ''
      if (line) onLine(line)
    }
  }
}

export const createFreshJsonClineSession = (
  prepared: ClinePreparedSession,
  options: AdapterQueryOptions,
  onEvent: (event: AdapterOutputEvent) => void,
  redactor: ClineRedactor
): AdapterSession => {
  const freshArgs = buildClineFreshJsonArgs(prepared, options.permissionMode)
  let stopped = false
  let terminalSettled = false
  let current: ReturnType<typeof spawn> | undefined
  let queue = Promise.resolve()

  const emitExitOnce = (exitCode: number, stderr?: string) => {
    if (terminalSettled) return
    terminalSettled = true
    onEvent({
      type: 'exit',
      data: {
        exitCode,
        ...(stderr?.trim() ? { stderr: redactor.redactDiagnostic(stderr) } : {})
      }
    })
  }

  const waitForClose = (proc: ReturnType<typeof spawn>) =>
    new Promise<number>((resolve) => {
      if (proc.exitCode != null) {
        resolve(proc.exitCode)
        return
      }
      proc.once('close', code => resolve(code ?? 1))
    })

  const terminate = async (exitCode: number) => {
    const proc = current
    if (proc == null) {
      emitExitOnce(exitCode)
      return
    }
    proc.stdin?.destroy()
    if (proc.exitCode == null) proc.kill('SIGTERM')
    const closedAfterTerm = await Promise.race([
      waitForClose(proc).then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 1_000))
    ])
    if (!closedAfterTerm && proc.exitCode == null) proc.kill('SIGKILL')
    if (!closedAfterTerm) {
      // A terminal event represents a dead child, not merely a delivered signal.
      await waitForClose(proc)
    }
    if (current === proc) current = undefined
    emitExitOnce(exitCode)
  }

  const writePrompt = async (proc: ReturnType<typeof spawn>, prompt: string) => {
    await new Promise<void>((resolve, reject) => {
      const stdin = proc.stdin
      if (stdin == null) {
        reject(new Error('Cline fresh-only JSON stdin was not created.'))
        return
      }
      const onError = (error: Error) => reject(error)
      stdin.once('error', onError)
      stdin.end(prompt, () => {
        stdin.off('error', onError)
        resolve()
      })
    })
  }

  const runTurn = async (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (stopped) return
    const prompt = mapContentToFreshText(event.content)
    if (!prompt) return
    redactor.addDiagnosticValue(prompt)
    const proc = spawn(
      prepared.binaryPath,
      freshArgs,
      {
        cwd: prepared.cwd,
        env: prepared.spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    current = proc
    // Child exit can race a completed stdin write; consume the late stream error locally.
    proc.stdin?.on('error', () => undefined)
    let didFatal = false
    let didDeliver = false
    let stderr = ''
    let currentToolId: string | undefined
    let currentToolName: string | undefined
    let textSegmentContent = ''
    let textSegmentCreatedAt = 0
    let textSegmentId: string | undefined
    let streamedText = ''
    const closeTextSegment = () => {
      textSegmentContent = ''
      textSegmentCreatedAt = 0
      textSegmentId = undefined
    }
    const appendText = (text: string) => {
      if (text === '') return
      if (textSegmentId == null) {
        textSegmentId = `cline-json-text-${uuid()}`
        textSegmentCreatedAt = Date.now()
      }
      textSegmentContent += text
      streamedText += text
      didDeliver = true
      onEvent({
        type: 'message',
        data: {
          id: textSegmentId,
          role: 'assistant',
          content: textSegmentContent,
          createdAt: textSegmentCreatedAt,
          ...(options.model != null ? { model: options.model } : {})
        }
      })
    }
    const handleRecord = (record: ClineJsonRecord) => {
      if (record.type === 'error') {
        didFatal = true
        onEvent({
          type: 'error',
          data: { message: record.message ?? 'Cline fresh-only JSON run failed.', fatal: true }
        })
        return
      }
      if (record.type === 'run_result' && record.text?.trim()) {
        if (streamedText === '') {
          appendText(record.text)
        } else if (record.text === streamedText) {
          // The final result repeats the structured stream exactly.
        } else if (record.text.startsWith(streamedText)) {
          appendText(record.text.slice(streamedText.length))
        } else {
          didFatal = true
          onEvent({
            type: 'error',
            data: {
              message: 'Cline fresh-only JSON final result did not match its structured text stream.',
              code: 'cline_fresh_output_mismatch',
              fatal: true
            }
          })
        }
        return
      }
      if (record.type !== 'agent_event' || record.event == null) return
      const agentEvent = record.event
      if (agentEvent.type === 'content_start' && agentEvent.contentType === 'text' && agentEvent.text) {
        appendText(agentEvent.text)
      } else if (agentEvent.type === 'content_start' && agentEvent.contentType === 'tool') {
        closeTextSegment()
        currentToolId = agentEvent.toolUseId ?? `cline-json-tool-${uuid()}`
        currentToolName = agentEvent.toolName ?? 'other'
        didDeliver = true
        onEvent({
          type: 'message',
          data: {
            id: currentToolId,
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: currentToolId,
              name: `adapter:cline:${currentToolName}`,
              input: agentEvent.input ?? {}
            }],
            createdAt: Date.now()
          }
        })
      } else if (agentEvent.type === 'content_end' && agentEvent.contentType === 'tool' && currentToolId) {
        closeTextSegment()
        didDeliver = true
        onEvent({
          type: 'message',
          data: {
            id: `${currentToolId}:result`,
            role: 'assistant',
            content: [{
              type: 'tool_result',
              tool_use_id: currentToolId,
              content: agentEvent.output ?? agentEvent.error ?? '',
              ...(agentEvent.error != null ? { is_error: true } : {})
            }],
            createdAt: Date.now()
          }
        })
        currentToolId = undefined
        currentToolName = undefined
      } else if (agentEvent.type === 'error' && !agentEvent.recoverable) {
        closeTextSegment()
        didFatal = true
        onEvent({
          type: 'error',
          data: { message: getErrorMessage(agentEvent.error ?? 'Cline fresh-only JSON run failed.'), fatal: true }
        })
      }
    }
    const stdout = createLineConsumer((line) => {
      try {
        handleRecord(JSON.parse(line) as ClineJsonRecord)
      } catch {
        // Cline's documented JSON mode is JSONL. Terminal UI text is never parsed as a fallback.
      }
    })
    proc.stdout?.on('data', chunk => stdout.push(chunk))
    proc.stderr?.on('data', chunk => {
      const text = chunk.toString()
      stderr = `${stderr}${text}`.slice(-65_536)
      for (const line of text.split(/\r?\n/u).filter(Boolean)) {
        try {
          handleRecord(JSON.parse(line) as ClineJsonRecord)
        } catch {
          // Ignore non-JSON diagnostics instead of scraping terminal output.
        }
      }
    })
    await new Promise<void>((resolve, reject) => {
      proc.once('spawn', resolve)
      proc.once('error', reject)
    })
    await writePrompt(proc, prompt)
    const exitCode = await waitForClose(proc)
    stdout.flush()
    if (current === proc) current = undefined
    if (stopped) return
    if (exitCode !== 0 || didFatal) {
      if (!didFatal) {
        onEvent({
          type: 'error',
          data: { message: `Cline fresh-only JSON process exited with code ${exitCode}.`, fatal: true }
        })
      }
      emitExitOnce(exitCode || 1, stderr)
      stopped = true
      return
    }
    if (!didDeliver) {
      onEvent({
        type: 'error',
        data: {
          message: 'Cline fresh-only JSON run completed without any deliverable structured output.',
          fatal: true
        }
      })
      emitExitOnce(1)
      stopped = true
      return
    }
    onEvent({ type: 'stop' })
  }

  const enqueue = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    queue = queue.catch(() => undefined).then(() => runTurn(event)).catch((error) => {
      if (stopped) return
      stopped = true
      const message = getErrorMessage(error)
      onEvent({ type: 'error', data: { message, fatal: true } })
      emitExitOnce(1, '')
    })
  }
  if (options.description?.trim()) {
    enqueue({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }
  return {
    kill: () => {
      if (terminalSettled) return
      stopped = true
      void terminate(1)
    },
    stop: () => {
      if (terminalSettled) return
      stopped = true
      void terminate(0)
    },
    emit: (event) => {
      if (stopped) return
      if (event.type === 'message') enqueue(event)
      else if (event.type === 'interrupt') current?.kill('SIGINT')
      else if (event.type === 'stop') {
        stopped = true
        void terminate(0)
      }
    },
    get pid() {
      return current?.pid
    }
  }
}
