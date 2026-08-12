/* eslint-disable max-lines -- Cursor stream and direct runtimes share native session state and event parsing. */
import type { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

import type {
  AdapterCtx,
  AdapterEvent,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AdapterSession,
  ChatMessage
} from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { resolveCursorBinaryPath } from '#~/paths.js'
import {
  DEFAULT_CURSOR_TOOLS,
  buildCursorArgs,
  getErrorMessage,
  normalizeCursorPrompt,
  prepareCursorSessionRuntime,
  resolveCursorAdapterConfig
} from './shared'

interface CursorStreamEvent {
  type?: string
  subtype?: string
  session_id?: string
  model?: string
  message?: {
    content?: unknown
  }
  call_id?: string
  tool_call?: unknown
  result?: unknown
  error?: unknown
}

const execFileAsync = promisify(execFile)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value !== '' ? value : undefined

const readTextContent = (value: unknown) => {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => (
    isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  )).join('')
}

const readToolCall = (event: CursorStreamEvent) => {
  if (!isRecord(event.tool_call)) return undefined
  const [kind, payload] = Object.entries(event.tool_call)[0] ?? []
  if (kind == null || !isRecord(payload)) return undefined
  return {
    id: event.call_id ?? uuid(),
    input: payload.args ?? {},
    kind,
    result: payload.result
  }
}

const createLineConsumer = (onLine: (line: string) => void) => {
  let buffer = ''
  return {
    push: (chunk: Buffer | string) => {
      buffer += chunk.toString()
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line !== '') onLine(line)
        index = buffer.indexOf('\n')
      }
    },
    flush: () => {
      const line = buffer.trim()
      buffer = ''
      if (line !== '') onLine(line)
    }
  }
}

const createCursorNativeChat = async (
  binaryPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv
) => {
  const { stdout } = await execFileAsync(binaryPath, ['create-chat'], { cwd, env })
  const nativeSessionId = stdout.trim().split(/\s+/u).at(-1)
  if (nativeSessionId == null || nativeSessionId === '') {
    throw new Error('Cursor Agent CLI did not return a chat id from create-chat.')
  }
  return nativeSessionId
}

const createDirectCursorSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveCursorAdapterConfig(ctx)
  const binaryPath = resolveCursorBinaryPath(ctx.env, adapterConfig.cliPath ?? adapterConfig.cli?.path)
  const runtime = await prepareCursorSessionRuntime(ctx, options, adapterConfig)
  const cache = await ctx.cache.get('adapter.cursor.session')
  const nativeSessionId = options.type === 'resume' && cache?.cursorSessionId != null
    ? cache.cursorSessionId
    : await createCursorNativeChat(binaryPath, ctx.cwd, runtime.env)
  await ctx.cache.set('adapter.cursor.session', {
    cursorSessionId: nativeSessionId,
    title: `OneWorks:${options.sessionId}`
  })

  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'cursor',
      model: options.model ?? 'default',
      effort: options.effort,
      version: 'unknown',
      tools: DEFAULT_CURSOR_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  const proc = spawn(
    binaryPath,
    buildCursorArgs({
      adapterConfig,
      nativeSessionId,
      options,
      prompt: options.description,
      stream: false
    }),
    {
      cwd: ctx.cwd,
      env: runtime.env,
      stdio: 'inherit'
    }
  )
  let finished = false
  let didEmitFatalError = false
  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) didEmitFatalError = true
    options.onEvent(event)
  }
  const emitExitOnce = (data: { exitCode: number; stderr?: string }) => {
    if (finished) return
    finished = true
    emitEvent({ type: 'exit', data })
  }

  proc.on('error', (error) => {
    const message = getErrorMessage(error)
    emitEvent({
      type: 'error',
      data: { message, fatal: true }
    })
    emitExitOnce({ exitCode: 1, stderr: message })
  })
  proc.on('exit', (code) => {
    const exitCode = code ?? 0
    if (exitCode !== 0 && !didEmitFatalError) {
      emitEvent({
        type: 'error',
        data: { message: `Cursor process exited with code ${exitCode}`, fatal: true }
      })
    }
    emitExitOnce({ exitCode })
  })

  return {
    kill: () => proc.kill(),
    emit: () => ctx.logger.warn('emit() is not supported in direct mode for cursor'),
    pid: proc.pid
  }
}

const createStreamCursorSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const adapterConfig = resolveCursorAdapterConfig(ctx)
  const binaryPath = resolveCursorBinaryPath(ctx.env, adapterConfig.cliPath ?? adapterConfig.cli?.path)
  const runtime = await prepareCursorSessionRuntime(ctx, options, adapterConfig)
  const cachedSession = await ctx.cache.get('adapter.cursor.session')
  let nativeSessionId = options.type === 'resume' ? cachedSession?.cursorSessionId : undefined
  let destroyed = false
  let stopping = false
  let currentPid: number | undefined
  let currentKill: (() => void) | undefined
  let didEmitExit = false
  let cacheWrite: Promise<unknown> = Promise.resolve()

  const emitEvent = (event: AdapterOutputEvent) => options.onEvent(event)
  const emitExit = (data: { exitCode: number; stderr?: string }) => {
    if (didEmitExit) return
    didEmitExit = true
    emitEvent({ type: 'exit', data })
  }

  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'cursor',
      model: options.model ?? 'default',
      effort: options.effort,
      version: 'unknown',
      tools: DEFAULT_CURSOR_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  const runTurn = async (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (destroyed) return
    const prompt = normalizeCursorPrompt(event.content)
    if (prompt === '') return

    const proc = spawn(
      binaryPath,
      buildCursorArgs({
        adapterConfig,
        nativeSessionId,
        options,
        prompt,
        stream: true
      }),
      {
        cwd: ctx.cwd,
        env: runtime.env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    currentPid = proc.pid
    currentKill = () => {
      if (proc.pid == null) return
      try {
        process.kill(proc.pid, 'SIGINT')
      } catch {}
    }

    let assistantText = ''
    let stderr = ''
    let lastAssistantMessage: ChatMessage | undefined
    const rawOutput: string[] = []
    const consumer = createLineConsumer((line) => {
      let cursorEvent: CursorStreamEvent
      try {
        cursorEvent = JSON.parse(line) as CursorStreamEvent
      } catch {
        rawOutput.push(line)
        return
      }

      if (cursorEvent.type === 'system' && cursorEvent.subtype === 'init') {
        const nextNativeSessionId = asString(cursorEvent.session_id)
        if (nextNativeSessionId != null) {
          nativeSessionId = nextNativeSessionId
          cacheWrite = ctx.cache.set('adapter.cursor.session', {
            cursorSessionId: nextNativeSessionId,
            title: `OneWorks:${options.sessionId}`
          })
        }
        return
      }
      if (cursorEvent.type === 'assistant') {
        assistantText += readTextContent(cursorEvent.message?.content)
        return
      }
      if (cursorEvent.type === 'tool_call') {
        const toolCall = readToolCall(cursorEvent)
        if (toolCall == null) return
        if (cursorEvent.subtype === 'started') {
          emitEvent({
            type: 'message',
            data: {
              id: toolCall.id,
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: toolCall.id,
                name: `adapter:cursor:${toolCall.kind}`,
                input: toolCall.input
              }],
              createdAt: Date.now()
            }
          })
        } else if (cursorEvent.subtype === 'completed') {
          emitEvent({
            type: 'message',
            data: {
              id: `${toolCall.id}:result`,
              role: 'assistant',
              content: [{
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: toolCall.result ?? ''
              }],
              createdAt: Date.now()
            }
          })
        }
        return
      }
      if (cursorEvent.type === 'result' && cursorEvent.subtype !== 'success') {
        emitEvent({
          type: 'error',
          data: {
            message: asString(cursorEvent.error) ?? `Cursor turn failed: ${cursorEvent.subtype ?? 'unknown error'}`,
            details: cursorEvent,
            fatal: true
          }
        })
      }
    })

    proc.stdout?.on('data', chunk => consumer.push(chunk))
    proc.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      proc.once('error', reject)
      proc.once('exit', code => resolveExit(code ?? 0))
    })
    consumer.flush()
    await cacheWrite
    currentPid = undefined
    currentKill = undefined

    if (assistantText.trim() === '' && rawOutput.length > 0) assistantText = rawOutput.join('\n')
    if (assistantText.trim() !== '') {
      lastAssistantMessage = {
        id: uuid(),
        role: 'assistant',
        content: assistantText,
        createdAt: Date.now(),
        ...(options.model != null ? { model: options.model } : {})
      }
      emitEvent({ type: 'message', data: lastAssistantMessage })
    }

    if (destroyed) {
      emitExit({ exitCode: stopping ? 0 : exitCode, stderr: stderr.trim() || undefined })
      return
    }
    if (exitCode !== 0) {
      emitEvent({
        type: 'error',
        data: {
          message: stderr.trim() || `Cursor process exited with code ${exitCode}`,
          details: { exitCode, stderr },
          fatal: true
        }
      })
      emitExit({ exitCode, stderr: stderr.trim() || undefined })
      return
    }
    emitEvent({ type: 'stop', data: lastAssistantMessage })
  }

  let queue = Promise.resolve()
  const enqueue = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    queue = queue.catch(() => undefined).then(() => runTurn(event)).catch((error) => {
      emitEvent({ type: 'error', data: { message: getErrorMessage(error), fatal: true } })
      emitExit({ exitCode: 1, stderr: getErrorMessage(error) })
    })
  }
  if (options.description?.trim()) {
    enqueue({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }

  return {
    kill: () => {
      destroyed = true
      currentKill?.()
    },
    stop: () => {
      destroyed = true
      stopping = true
      currentKill?.()
      if (currentPid == null) emitExit({ exitCode: 0 })
    },
    emit: (event) => {
      if (destroyed) return
      if (event.type === 'message') enqueue(event)
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

export const createCursorSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
) =>
  options.mode === 'direct'
    ? createDirectCursorSession(ctx, options)
    : createStreamCursorSession(ctx, options)
