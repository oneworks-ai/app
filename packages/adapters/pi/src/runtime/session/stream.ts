/* eslint-disable max-lines -- stream lifecycle needs one shared terminal state machine. */

import { spawn } from 'node:child_process'

import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { PI_CLI_VERSION } from '#~/paths.js'
import { PiEventProjector } from '../common/events'
import { mapContentToPiPrompt } from '../common/input'
import { PiRpcClient } from '../protocol/client'
import type { PiProcess, PiRpcEvent, PiRpcSessionState } from '../protocol/types'
import { PiInteractionBridge } from './interaction'
import type { PiSessionBase } from './prepare'

export interface PiStreamDependencies {
  createClient?: (process: PiProcess) => PiRpcClient
  spawnProcess?: typeof spawn
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const createStreamPiSession = async (
  base: PiSessionBase,
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: PiStreamDependencies = {}
): Promise<AdapterSession> => {
  const spawnProcess = dependencies.spawnProcess ?? spawn
  const proc = spawnProcess(base.binaryPath, base.args, {
    cwd: ctx.cwd,
    env: base.spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as PiProcess
  const client = dependencies.createClient?.(proc) ?? new PiRpcClient(proc)
  let activeTurn = false
  let exited = false
  let stopping = false
  let terminalFailure: Error | undefined
  let sendQueue = Promise.resolve()

  const emitExit = (exitCode?: number, stderr?: string) => {
    if (exited) return
    exited = true
    options.onEvent({ type: 'exit', data: { exitCode, ...(stderr?.trim() ? { stderr: stderr.trim() } : {}) } })
  }
  const closeAfterTerminalFailure = (message: string) => {
    if (exited) return
    terminalFailure = new Error(message)
    stopping = true
    emitExit(1, message)
    void client.close().catch(() => proc.kill('SIGTERM'))
  }
  const emitAdapterEvent = (event: AdapterOutputEvent) => {
    options.onEvent(event)
    if (event.type === 'error' && event.data.fatal !== false) {
      closeAfterTerminalFailure(event.data.message)
    }
  }
  const emitError = (error: unknown, fatal: boolean) => {
    emitAdapterEvent({ type: 'error', data: { message: getErrorMessage(error), fatal } })
  }
  const projector = new PiEventProjector(base.model, emitAdapterEvent)
  const interactions = new PiInteractionBridge(client, ctx, options, emitAdapterEvent, error => {
    if (!stopping) emitError(error, true)
  })

  client.onEvent((event: PiRpcEvent) => {
    if (interactions.handle(event)) return
    if (event.type === 'agent_start') activeTurn = true
    if (event.type === 'agent_settled') activeTurn = false
    projector.handle(event)
  })
  client.onError((error) => {
    if (stopping) return
    emitError(error, true)
    if (!proc.killed) proc.kill('SIGTERM')
  })
  client.onExit((code) => {
    if (!stopping && activeTurn) {
      emitError(new Error('Pi exited before the active turn settled.'), true)
      return
    }
    if (!stopping && code !== 0) {
      emitError(client.capturedStderr || `Pi exited with code ${code ?? 'unknown'}.`, true)
    }
    emitExit(code ?? undefined, client.capturedStderr)
  })

  let state: PiRpcSessionState
  let commands: Array<{ name?: string }> = []
  try {
    state = await client.request<PiRpcSessionState>({ type: 'get_state' })
    const commandResult = await client.request<{ commands?: Array<{ name?: string }> }>({ type: 'get_commands' })
      .catch(() => ({ commands: [] }))
    commands = commandResult.commands ?? []
  } catch (error) {
    try {
      await client.close()
    } catch {
      proc.kill('SIGKILL')
    }
    throw error
  }
  if (exited) throw terminalFailure ?? new Error('Pi exited during session startup.')

  const stateModel = state.model
  const reportedModel = stateModel?.provider && stateModel.id
    ? `${stateModel.provider}/${stateModel.id}`
    : base.model
  projector.setModel(reportedModel)
  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      model: reportedModel,
      effort: options.effort,
      version: PI_CLI_VERSION,
      tools: base.tools,
      slashCommands: commands.map(command => command.name).filter((name): name is string => Boolean(name)),
      cwd: ctx.cwd,
      agents: ['pi'],
      title: state.sessionName,
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  const sendPrompt = async (
    message: string,
    images?: Array<{ type: 'image'; data: string; mimeType: string }>,
    throwOnTerminalFailure = false
  ) => {
    if (stopping) return
    const normalizedMessage = message.trim() || (images?.length ? 'Please inspect the attached image.' : '')
    if (normalizedMessage === '') return
    const wasActive = activeTurn
    if (!wasActive) activeTurn = true
    try {
      await client.request({
        type: 'prompt',
        message: normalizedMessage,
        ...(images?.length ? { images } : {}),
        ...(wasActive ? { streamingBehavior: 'steer' } : {})
      })
    } catch (error) {
      if (stopping) return
      if (wasActive) {
        emitError(error, false)
        return
      }
      activeTurn = false
      const message = getErrorMessage(error)
      options.onEvent({
        type: 'operation',
        data: { type: 'operation_failed', operationId: 'pi-turn', message, adapter: 'pi' }
      })
      emitError(error, true)
      if (throwOnTerminalFailure) throw error
    }
  }
  const enqueue = (task: () => Promise<void>) => {
    sendQueue = sendQueue.then(task).catch(error => {
      if (stopping) return
      if (activeTurn) {
        emitError(error, false)
        return
      }
      options.onEvent({
        type: 'operation',
        data: { type: 'operation_failed', operationId: 'pi-turn', message: getErrorMessage(error), adapter: 'pi' }
      })
      emitError(error, true)
    })
  }

  if (options.description?.trim()) {
    await sendPrompt(options.description, undefined, true)
    if (exited) throw terminalFailure ?? new Error('Pi exited during session startup.')
  }

  const stop = () => {
    if (stopping) return
    stopping = true
    void client.notify({ type: 'abort' }).catch(() => undefined)
    void client.close().catch(() => proc.kill('SIGTERM'))
  }

  return {
    kill: () => {
      stopping = true
      proc.kill('SIGKILL')
    },
    stop,
    emit: (event: AdapterEvent) => {
      if (event.type === 'message') {
        if (stopping) return
        enqueue(async () => {
          const input = await mapContentToPiPrompt(event.content)
          await sendPrompt(input.message, input.images)
        })
      } else if (event.type === 'interrupt') {
        if (activeTurn) projector.interruptCurrentTurn()
        void client.request({ type: 'abort' }).catch(error => emitError(error, false))
      } else if (event.type === 'stop') {
        stop()
      }
    },
    respondInteraction: (interactionId, data) => interactions.respond(interactionId, data),
    pid: proc.pid
  }
}
