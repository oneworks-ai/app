/* eslint-disable max-lines */

import { spawn } from 'node:child_process'

import type {
  AdapterCtx,
  AdapterEvent,
  AdapterInteractionRequest,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AdapterSession,
  PermissionInteractionDecision
} from '@oneworks/types'
import { createStartupProfiler } from '@oneworks/utils'

import { getErrorMessage, toAdapterErrorData } from './common'
import { hasStoredKimiSessionState, resolveKimiSessionBase } from './config'
import {
  buildKimiPermissionSubject,
  createKimiSessionPermissionState,
  rememberSessionPermissionDecision,
  resolveManagedPermissionDecisionForCtx,
  resolveSessionPermissionDecision
} from './permissions'
import {
  KimiWireMessageState,
  extractKimiWireApprovalToolInput,
  handleKimiWireEvent,
  mapContentToKimiWireInput
} from './wire-messages'
import type { KimiWireUserInput } from './wire-messages'
import { KimiWireRpcClient, KimiWireRpcError } from './wire-rpc'

const WIRE_PROTOCOL_VERSION = '1.9'

type KimiApprovalResponse = 'approve' | 'approve_for_session' | 'reject'

interface KimiInitializeResult {
  protocol_version?: string
  server?: {
    name?: string
    version?: string
  }
  slash_commands?: Array<{
    name?: string
    description?: string
    aliases?: string[]
  }>
}

interface KimiPromptResult {
  status?: 'finished' | 'cancelled' | 'max_steps_reached'
  steps?: number
}

interface KimiApprovalRequestPayload {
  id?: string
  tool_call_id?: string
  sender?: string
  action?: string
  description?: string
  display?: unknown[]
}

interface KimiQuestionRequestPayload {
  id?: string
  tool_call_id?: string
  questions?: Array<{
    question?: string
    header?: string
    options?: Array<{
      label?: string
      description?: string
    }>
    multi_select?: boolean
  }>
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asRecord = (value: unknown): Record<string, unknown> => (
  isRecord(value) ? value : {}
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const buildPermissionInteractionOptions = () => [
  { label: '同意本次', value: 'allow_once', description: '仅继续这次被拦截的操作。' },
  { label: '同意并在当前会话忽略类似调用', value: 'allow_session', description: '本会话内同类工具不再重复询问。' },
  {
    label: '同意并在当前项目忽略类似调用',
    value: 'allow_project',
    description: '写入 .oo.config.json，后续新会话仍生效。'
  },
  { label: '拒绝本次', value: 'deny_once', description: '拒绝当前这次操作。' },
  { label: '拒绝并在当前会话阻止类似调用', value: 'deny_session', description: '本会话内同类工具直接拒绝。' },
  {
    label: '拒绝并在当前项目阻止类似调用',
    value: 'deny_project',
    description: '写入 .oo.config.json，后续新会话仍生效。'
  }
]

const isEditLikeSubject = (subjectKey: string) => subjectKey === 'Edit' || subjectKey === 'Write'

const shouldAutoApprove = (
  permissionMode: AdapterQueryOptions['permissionMode'],
  payload: KimiApprovalRequestPayload
) => {
  if (permissionMode === 'dontAsk' || permissionMode === 'bypassPermissions') return true
  if (permissionMode !== 'acceptEdits') return false
  return isEditLikeSubject(buildKimiPermissionSubject(payload.sender).subjectKey)
}

const buildKimiPermissionInteraction = (params: {
  sessionId: string
  interactionId: string
  permissionMode: AdapterQueryOptions['permissionMode']
  payload: KimiApprovalRequestPayload
}): AdapterInteractionRequest => {
  const subject = buildKimiPermissionSubject(params.payload.sender)
  const action = params.payload.action?.trim()
  const description = params.payload.description?.trim()
  const question = [
    action != null && action !== '' ? `允许 ${action}？` : `允许执行 ${subject.subjectKey}？`,
    description != null && description !== '' ? `说明：${description}` : undefined
  ].filter((item): item is string => item != null).join('\n')

  return {
    id: params.interactionId,
    payload: {
      sessionId: params.sessionId,
      kind: 'permission',
      question,
      options: buildPermissionInteractionOptions(),
      permissionContext: {
        adapter: 'kimi',
        currentMode: params.permissionMode,
        deniedTools: [subject.subjectKey],
        reasons: [description, action].filter((item): item is string => item != null && item !== ''),
        subjectKey: subject.subjectKey,
        subjectLookupKeys: subject.subjectLookupKeys,
        subjectLabel: subject.subjectLabel,
        scope: 'tool',
        projectConfigPath: '.oo.config.json'
      }
    }
  }
}

const resolveApprovalResponse = (answer: string | string[]): KimiApprovalResponse => {
  const raw = Array.isArray(answer) ? answer[0] : answer
  const normalized = typeof raw === 'string' ? raw.trim() : ''

  if (normalized === 'allow_session' || normalized === 'allow_project') return 'approve_for_session'
  if (normalized === 'allow_once') return 'approve'
  return 'reject'
}

const isPermissionInteractionDecision = (value: string): value is PermissionInteractionDecision => (
  value === 'allow_once' ||
  value === 'allow_session' ||
  value === 'allow_project' ||
  value === 'deny_once' ||
  value === 'deny_session' ||
  value === 'deny_project'
)

const buildQuestionInteraction = (params: {
  sessionId: string
  interactionId: string
  payload: KimiQuestionRequestPayload
}): AdapterInteractionRequest => {
  const firstQuestion = params.payload.questions?.[0]
  const question = firstQuestion?.question?.trim() || 'Kimi 需要你的输入'
  const options = (firstQuestion?.options ?? [])
    .map(option => {
      const label = option.label?.trim()
      if (label == null || label === '') return undefined
      return {
        label,
        value: label,
        ...(option.description?.trim() ? { description: option.description.trim() } : {})
      }
    })
    .filter((item): item is { label: string; value: string; description?: string } => item != null)

  return {
    id: params.interactionId,
    payload: {
      sessionId: params.sessionId,
      kind: 'question',
      question,
      ...(options.length > 0 ? { options } : {}),
      ...(firstQuestion?.multi_select === true ? { multiselect: true } : {})
    }
  }
}

const buildQuestionResponse = (payload: KimiQuestionRequestPayload, answer: string | string[]) => {
  const question = payload.questions?.[0]?.question?.trim()
  const normalizedAnswer = Array.isArray(answer)
    ? answer.filter(item => typeof item === 'string' && item.trim() !== '').join(',')
    : typeof answer === 'string'
    ? answer.trim()
    : ''

  return {
    request_id: payload.id ?? '',
    answers: question != null && question !== '' && normalizedAnswer !== ''
      ? { [question]: normalizedAnswer }
      : {}
  }
}

const isInvalidStateError = (error: unknown) => error instanceof KimiWireRpcError && error.code === -32000

export const createKimiSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId: options.sessionId
  })
  const sessionBaseStartedAt = startupProfiler.now()
  const base = await resolveKimiSessionBase(ctx, options)
  startupProfiler.mark('kimi.session.resolveSessionBase', sessionBaseStartedAt)
  const shouldContinue = options.type === 'resume' && hasStoredKimiSessionState(base.shareDir)
  const args = [
    ...base.turnArgPrefix,
    ...(options.permissionMode === 'bypassPermissions' ? ['--yolo'] : []),
    ...(options.permissionMode === 'plan' ? ['--plan'] : []),
    ...(shouldContinue ? ['--continue'] : []),
    '--wire'
  ]
  const spawnStartedAt = startupProfiler.now()
  const proc = spawn(base.binaryPath, args, {
    cwd: ctx.cwd,
    env: base.spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  startupProfiler.mark('kimi.session.spawnWire', spawnStartedAt)
  const rpc = new KimiWireRpcClient(proc, ctx.logger)
  const messageState = new KimiWireMessageState()
  const sessionPermissionState = createKimiSessionPermissionState()
  const pendingInteractions = new Map<string, {
    kind: 'approval' | 'question'
    rpcId: string
    payload: KimiApprovalRequestPayload | KimiQuestionRequestPayload
  }>()

  let activeTurn = false
  let destroyed = false
  let stoppedByUser = false
  let didEmitExit = false
  let didEmitFatalError = false
  let stderr = ''
  let promptQueue = Promise.resolve()
  const model = base.reportedModel ?? base.cliModel ?? options.model ?? 'default'

  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) {
      didEmitFatalError = true
    }
    options.onEvent(event)
  }

  const emitExit = (data: { exitCode?: number; stderr?: string }) => {
    if (didEmitExit) return
    didEmitExit = true
    rpc.destroy(data.stderr ?? 'Kimi Wire session exited')
    emitEvent({ type: 'exit', data })
  }

  const emitFailureAndExit = (error: unknown) => {
    if (didEmitExit) return
    const message = getErrorMessage(error)
    ctx.logger.error('[kimi wire session] session failed', { error, sessionId: options.sessionId })
    if (!didEmitFatalError) {
      emitEvent({ type: 'error', data: toAdapterErrorData(error) })
    }
    destroyed = true
    emitExit({ exitCode: 1, stderr: message })
    proc.kill()
  }

  proc.stderr?.on('data', chunk => {
    stderr += String(chunk)
  })
  proc.on('error', emitFailureAndExit)
  proc.on('exit', (code) => {
    if (didEmitExit) return
    const exitCode = stoppedByUser ? 0 : code ?? undefined
    if (!stoppedByUser && (code ?? 0) !== 0 && !didEmitFatalError) {
      emitEvent({
        type: 'error',
        data: toAdapterErrorData(stderr || `Process exited with code ${code ?? 1}`, {
          details: { exitCode: code ?? 1, stderr }
        })
      })
    }
    emitExit({ exitCode, ...(stderr !== '' ? { stderr } : {}) })
  })

  rpc.onNotification((method, params) => {
    if (method !== 'event') {
      ctx.logger.warn('[kimi wire session] unhandled notification', { method, params })
      return
    }

    const handled = handleKimiWireEvent(params, messageState, model, emitEvent)
    if (!handled) {
      ctx.logger.debug('[kimi wire session] ignored wire event', { type: params.type })
    }
    if (params.type === 'TurnEnd') {
      messageState.flushPendingToolCalls(model, emitEvent)
      messageState.flushText(model, emitEvent)
    }
  })

  rpc.onRequest((id, method, params) => {
    if (method !== 'request') {
      ctx.logger.warn('[kimi wire session] unhandled request', { id, method, params })
      rpc.respondError(id, {
        code: -32601,
        message: `Unsupported Kimi wire method: ${method}`
      })
      return
    }

    if (params.type === 'ApprovalRequest') {
      const payload = asRecord(params.payload) as KimiApprovalRequestPayload
      const subject = buildKimiPermissionSubject(payload.sender)
      const requestId = readString(payload.id) ?? id
      const toolCallId = readString(payload.tool_call_id)
      if (toolCallId != null) {
        messageState.flushToolCall(
          toolCallId,
          model,
          emitEvent,
          extractKimiWireApprovalToolInput(asRecord(params.payload))
        )
      }
      if (shouldAutoApprove(options.permissionMode, payload)) {
        rpc.respond(id, {
          request_id: requestId,
          response: 'approve'
        })
        return
      }

      const managedDecision = resolveSessionPermissionDecision({
        state: sessionPermissionState,
        subjectKeys: subject.decisionKeys
      })
      if (managedDecision === 'allow') {
        rpc.respond(id, {
          request_id: requestId,
          response: 'approve_for_session'
        })
        return
      }
      if (managedDecision === 'deny') {
        rpc.respond(id, {
          request_id: requestId,
          response: 'reject'
        })
        return
      }

      const configDecision = resolveManagedPermissionDecisionForCtx({
        ctx,
        subjectKeys: subject.decisionKeys
      })
      if (configDecision === 'allow') {
        rpc.respond(id, {
          request_id: requestId,
          response: 'approve_for_session'
        })
        return
      }
      if (configDecision === 'deny') {
        rpc.respond(id, {
          request_id: requestId,
          response: 'reject'
        })
        return
      }

      const interactionId = `kimi-approval:${requestId}`
      pendingInteractions.set(interactionId, {
        kind: 'approval',
        rpcId: id,
        payload: {
          ...payload,
          id: requestId
        }
      })
      emitEvent({
        type: 'interaction_request',
        data: buildKimiPermissionInteraction({
          sessionId: options.sessionId,
          interactionId,
          permissionMode: options.permissionMode,
          payload
        })
      })
      return
    }

    if (params.type === 'QuestionRequest') {
      const payload = asRecord(params.payload) as KimiQuestionRequestPayload
      const requestId = readString(payload.id) ?? id
      const normalizedPayload = {
        ...payload,
        id: requestId
      }
      const interactionId = `kimi-question:${requestId}`
      pendingInteractions.set(interactionId, {
        kind: 'question',
        rpcId: id,
        payload: normalizedPayload
      })
      emitEvent({
        type: 'interaction_request',
        data: buildQuestionInteraction({
          sessionId: options.sessionId,
          interactionId,
          payload: normalizedPayload
        })
      })
      return
    }

    if (params.type === 'ToolCallRequest') {
      const payload = asRecord(params.payload)
      const toolCallId = readString(payload.id) ?? id
      const toolName = readString(payload.name) ?? 'external_tool'
      ctx.logger.warn('[kimi wire session] unsupported external tool request', { toolCallId, toolName })
      rpc.respond(id, {
        tool_call_id: toolCallId,
        return_value: {
          is_error: true,
          output: `Unsupported external tool: ${toolName}`,
          message: `One Works did not register external tool ${toolName}.`,
          display: []
        }
      })
      return
    }

    if (params.type === 'HookRequest') {
      const payload = asRecord(params.payload)
      rpc.respond(id, {
        request_id: readString(payload.id) ?? id,
        action: 'allow',
        reason: ''
      })
      return
    }

    ctx.logger.warn('[kimi wire session] unhandled wire request type', { id, params })
    rpc.respondError(id, {
      code: -32602,
      message: `Unsupported Kimi wire request type: ${String(params.type ?? 'unknown')}`
    })
  })

  const runPrompt = async (userInput: KimiWireUserInput, source: string) => {
    if (destroyed) return
    activeTurn = true
    try {
      const result = await rpc.request<KimiPromptResult>('prompt', { user_input: userInput })
      messageState.flushText(model, emitEvent)
      if (result.status === 'max_steps_reached') {
        emitEvent({
          type: 'error',
          data: toAdapterErrorData(`Kimi reached max steps${result.steps != null ? ` (${result.steps})` : ''}`, {
            code: 'max_steps_reached',
            fatal: false,
            details: result
          })
        })
      }
      emitEvent({ type: 'stop', data: messageState.getLastMessage() })
    } catch (error) {
      if (destroyed && stoppedByUser) return
      ctx.logger.error('[kimi wire session] prompt failed', { source, error })
      emitFailureAndExit(error)
    } finally {
      activeTurn = false
    }
  }

  const enqueuePrompt = (userInput: KimiWireUserInput | undefined, source: string) => {
    if (userInput == null) return
    promptQueue = promptQueue
      .catch(() => undefined)
      .then(() => runPrompt(userInput, source))
  }

  const sendUserInput = (userInput: KimiWireUserInput | undefined) => {
    if (destroyed || userInput == null) return
    if (!activeTurn) {
      enqueuePrompt(userInput, 'emit')
      return
    }

    rpc.request('steer', { user_input: userInput }).catch(error => {
      if (destroyed) return
      if (isInvalidStateError(error)) {
        enqueuePrompt(userInput, 'steer-fallback')
        return
      }
      ctx.logger.error('[kimi wire session] steer failed', { error })
      emitFailureAndExit(error)
    })
  }

  let initResult: KimiInitializeResult
  try {
    const initializeStartedAt = startupProfiler.now()
    initResult = await rpc.request<KimiInitializeResult>('initialize', {
      protocol_version: WIRE_PROTOCOL_VERSION,
      client: {
        name: 'oneworks',
        version: '2.0.0'
      },
      capabilities: {
        supports_question: true,
        supports_plan_mode: true
      }
    })
    startupProfiler.mark('kimi.session.initializeWire', initializeStartedAt)
  } catch (error) {
    emitFailureAndExit(error)
    throw error
  }

  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      model,
      effort: options.effort,
      version: initResult.server?.version ?? 'unknown',
      tools: base.toolNames,
      slashCommands: (initResult.slash_commands ?? [])
        .map(command => command.name)
        .filter((name): name is string => typeof name === 'string' && name !== ''),
      cwd: ctx.cwd,
      agents: base.reportedAgent != null ? [base.reportedAgent] : [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  if (options.description != null && options.description.trim() !== '') {
    enqueuePrompt(options.description.trim(), 'initial')
  }

  const stopSession = () => {
    destroyed = true
    stoppedByUser = true
    rpc.destroy('Kimi Wire session stopped')
    proc.kill()
    if (proc.pid == null) {
      emitExit({ exitCode: 0 })
    }
  }

  return {
    kill: stopSession,
    stop: stopSession,
    emit: (event: AdapterEvent) => {
      if (destroyed) return
      if (event.type === 'message') {
        sendUserInput(mapContentToKimiWireInput(event.content))
      } else if (event.type === 'interrupt') {
        if (activeTurn) {
          rpc.request('cancel').catch(error => {
            if (!isInvalidStateError(error)) {
              ctx.logger.warn('[kimi wire session] cancel failed', { error })
            }
          })
        }
      } else if (event.type === 'stop') {
        stopSession()
      }
    },
    respondInteraction: (interactionId: string, data: string | string[]) => {
      const pending = pendingInteractions.get(interactionId)
      if (pending == null) return
      pendingInteractions.delete(interactionId)

      if (pending.kind === 'approval') {
        const payload = pending.payload as KimiApprovalRequestPayload
        const subject = buildKimiPermissionSubject(payload.sender)
        const answer = Array.isArray(data) ? data[0] : data
        if (typeof answer === 'string' && isPermissionInteractionDecision(answer)) {
          rememberSessionPermissionDecision({
            state: sessionPermissionState,
            subjectKeys: subject.decisionKeys,
            action: answer
          })
        }
        rpc.respond(pending.rpcId, {
          request_id: payload.id ?? pending.rpcId,
          response: resolveApprovalResponse(data)
        })
        return
      }

      const payload = pending.payload as KimiQuestionRequestPayload
      rpc.respond(pending.rpcId, buildQuestionResponse(payload, data))
    },
    pid: proc.pid
  }
}
