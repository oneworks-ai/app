/* eslint-disable max-lines -- lifecycle ownership and single-terminal cleanup stay colocated. */
import { spawn } from 'node:child_process'

import type {
  AdapterCtx,
  AdapterEvent,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AdapterSession,
  ChatMessageContent
} from '@oneworks/types'

import { DROID_CLI_VERSION, DROID_CLI_VERSION_ENV } from '../paths'
import { prepareDroidSession } from './config'
import type { DroidPreparedSession } from './config'
import { DroidInteractionBridge } from './interaction'
import { DroidEventProjector } from './projector'
import { DroidJsonRpcClient } from './protocol/client'
import type { DroidInitializeResult } from './protocol/types'
import { DroidDiagnosticRedactor } from './redaction'

const buildUserMessage = (content: ChatMessageContent[]) => {
  const texts: string[] = []
  const imagePaths: string[] = []
  for (const item of content) {
    if (item.type === 'text') texts.push(item.text)
    else if (item.type === 'image' && item.path != null) imagePaths.push(item.path)
    else if (item.type === 'file') texts.push(`Attached file: ${item.path}`)
    else if (item.type === 'tool_result') {
      texts.push(typeof item.content === 'string' ? item.content : JSON.stringify(item.content))
    }
  }
  return {
    text: texts.join('\n'),
    ...(imagePaths.length === 0 ? {} : { imagePaths }),
    queuePlacement: 'end_of_turn'
  }
}

export const createDroidSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const redactor = new DroidDiagnosticRedactor([ctx.env.FACTORY_API_KEY, ctx.env.FACTORY_TOKEN])
  let prepared: DroidPreparedSession
  try {
    prepared = await prepareDroidSession(ctx, options)
  } catch (error) {
    throw redactor.error(error)
  }
  const child = spawn(prepared.binaryPath, prepared.args, {
    cwd: prepared.processCwd,
    env: prepared.spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const client = new DroidJsonRpcClient(child, { redact: redactor.redact })
  const emitSafeEvent = (event: AdapterOutputEvent) => options.onEvent(redactor.value(event))
  const projector = new DroidEventProjector(emitSafeEvent)
  let fatalEmitted = false
  let exitEmitted = false
  let initialized = false
  let stopping = false
  let nativeSessionId = ''
  let stopPromise: Promise<void> | undefined
  let sendQueue = Promise.resolve()
  const emitFatalOnce = (error: unknown) => {
    if (fatalEmitted) return
    fatalEmitted = true
    emitSafeEvent({
      type: 'error',
      data: { message: redactor.error(error).message, fatal: true }
    })
  }
  const emitExitOnce = (code: number | null) => {
    if (exitEmitted) return
    exitEmitted = true
    const safeStderr = client.capturedStderr
    emitSafeEvent({
      type: 'exit',
      data: {
        ...(code == null ? {} : { exitCode: code }),
        ...(safeStderr === '' ? {} : { stderr: safeStderr })
      }
    })
  }

  const interactions = new DroidInteractionBridge(
    client,
    options,
    emitSafeEvent,
    error => emitFatalOnce(error)
  )
  const terminateAfterFatal = (error: unknown) => {
    emitFatalOnce(error)
    stopping = true
    projector.settleAcceptedTurns()
    stopPromise ??= (async () => {
      await interactions.cancelAll()
      await client.close()
    })()
    return stopPromise
  }
  client.onNotification(notification => projector.handle(notification))
  client.onRequest((request) => {
    if (stopping) {
      void client.respondError(request.id, { code: -32000, message: 'One Works session is closing.' })
      return
    }
    interactions.handle(request)
  })
  client.onError((error) => {
    void terminateAfterFatal(error)
  })
  client.onExit((code) => {
    void interactions.cancelAll()
    projector.settleAcceptedTurns()
    if (!stopping) {
      emitFatalOnce(
        new Error(
          code == null || code === 0
            ? 'Factory Droid exited unexpectedly.'
            : `Factory Droid exited with code ${code}.${
              client.capturedStderr === '' ? '' : ` ${client.capturedStderr}`
            }`
        )
      )
    }
    emitExitOnce(code)
    if (!initialized) void prepared.cleanup()
  })

  try {
    const cached = await ctx.cache.get('adapter.droid.session')
    let result: DroidInitializeResult
    if (options.type === 'resume') {
      if (cached?.droidSessionId == null || cached.droidSessionId.trim() === '') {
        throw new Error('Factory Droid resume requires a cached native session id.')
      }
      nativeSessionId = cached.droidSessionId
      result = await client.request<DroidInitializeResult>('droid.load_session', {
        ...prepared.loadParams,
        sessionId: nativeSessionId
      })
      if (result.sessionId !== nativeSessionId) {
        throw new Error(
          `Factory Droid loaded native session ${result.sessionId}, expected ${nativeSessionId}.`
        )
      }
    } else {
      result = await client.request<DroidInitializeResult>('droid.initialize_session', prepared.initParams)
      if (typeof result?.sessionId !== 'string' || result.sessionId.trim() === '') {
        throw new Error('Factory Droid initialize_session returned no native session id.')
      }
      nativeSessionId = result.sessionId
    }
    initialized = true
    await ctx.cache.set('adapter.droid.session', {
      droidSessionId: nativeSessionId,
      title: redactor.redact(result.session?.title ?? options.description ?? cached?.title ?? '') || undefined
    })
    emitSafeEvent({
      type: 'init',
      data: {
        uuid: options.sessionId,
        model: result.settings?.modelId ?? prepared.model,
        adapter: 'droid',
        effort: options.effort,
        version: ctx.env[DROID_CLI_VERSION_ENV] ?? DROID_CLI_VERSION,
        tools: [],
        slashCommands: [],
        cwd: ctx.cwd,
        agents: [],
        title: result.session?.title ?? options.description,
        assetDiagnostics: prepared.assetDiagnostics
      }
    })
  } catch (error) {
    const safeError = redactor.error(error)
    emitFatalOnce(safeError)
    stopping = true
    await client.close()
    await prepared.cleanup()
    throw safeError
  }

  const interrupt = async () => {
    await interactions.cancelAll()
    await client.request('droid.interrupt_session', {})
    projector.settleAcceptedTurns()
  }

  const stop = () => {
    stopPromise ??= (async () => {
      stopping = true
      await interactions.cancelAll()
      projector.settleAcceptedTurns()
      try {
        await client.request('droid.close_session', { reason: 'other' })
      } catch (error) {
        if (!exitEmitted) {
          const safeError = redactor.error(error)
          ctx.logger.warn('[droid session] close_session failed', {
            error: safeError.message,
            stack: safeError.stack
          })
        }
      }
      await client.close()
    })()
    return stopPromise
  }

  const emit = (event: AdapterEvent) => {
    if (event.type === 'stop') {
      void stop()
      return
    }
    if (event.type === 'interrupt') {
      void interrupt().catch(error => terminateAfterFatal(error))
      return
    }
    sendQueue = sendQueue.then(async () => {
      const turn = projector.reserveTurn()
      try {
        await client.request('droid.add_user_message', buildUserMessage(event.content))
        projector.acceptTurn(turn)
      } catch (error) {
        projector.rejectTurn(turn)
        throw error
      }
    }).catch((error) => {
      if (!stopping) void terminateAfterFatal(error)
    })
  }

  return {
    pid: child.pid,
    emit,
    kill: () => {
      void stop()
    },
    stop,
    respondInteraction: (interactionId, data) => interactions.respond(interactionId, data)
  }
}
