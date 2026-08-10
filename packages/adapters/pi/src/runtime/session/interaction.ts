import type {
  AdapterCtx,
  AdapterInteractionRequest,
  AdapterOutputEvent,
  AdapterQueryOptions,
  PermissionInteractionDecision
} from '@oneworks/types'

import {
  PI_PERMISSION_ALLOW,
  PI_PERMISSION_DENY,
  buildPiPermissionInteraction,
  createPiSessionPermissionState,
  isAllowDecision,
  isPermissionDecision,
  parsePiPermissionTitle,
  rememberPiSessionPermission,
  resolveConfiguredPiPermission,
  resolvePiSessionPermission
} from '../common/permission'
import type { PiRpcClient } from '../protocol/client'
import type { PiRpcEvent } from '../protocol/types'

type DialogMethod = 'confirm' | 'editor' | 'input' | 'select'

interface PendingInteraction {
  method: DialogMethod
  permissionTool?: string
  rpcId: string
}

const firstValue = (data: string | string[]) => Array.isArray(data) ? data[0] : data

export class PiInteractionBridge {
  private readonly pending = new Map<string, PendingInteraction>()
  private readonly permissions = createPiSessionPermissionState()

  constructor(
    private readonly client: PiRpcClient,
    private readonly ctx: AdapterCtx,
    private readonly options: AdapterQueryOptions,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly onSendError: (error: unknown) => void = error => {
      this.onEvent({
        type: 'error',
        data: { message: error instanceof Error ? error.message : String(error), fatal: true }
      })
    }
  ) {}

  handle(event: PiRpcEvent) {
    if (event.type !== 'extension_ui_request') return false
    const id = typeof event.id === 'string' ? event.id : undefined
    const method = event.method
    if (id == null || typeof method !== 'string') return true

    if (method === 'setTitle' && typeof event.title === 'string') {
      this.onEvent({ type: 'session_update', data: { title: event.title } })
      return true
    }
    if (method === 'notify') {
      const message = typeof event.message === 'string' ? event.message : 'Pi extension notification'
      if (event.notifyType === 'error') this.onEvent({ type: 'error', data: { message, fatal: false } })
      else this.emitOperation(id, message, 'operation_completed')
      return true
    }
    if (method === 'setStatus') {
      const statusKey = typeof event.statusKey === 'string' && event.statusKey.trim() !== '' ? event.statusKey : id
      this.emitOperation(
        statusKey,
        String(event.statusText ?? ''),
        event.statusText ? 'operation_started' : 'operation_completed'
      )
      return true
    }
    if (method !== 'select' && method !== 'confirm' && method !== 'input' && method !== 'editor') return true

    const interactionId = `pi-ui:${id}`
    const title = typeof event.title === 'string' ? event.title : 'Pi needs input'
    const permission = method === 'select' ? parsePiPermissionTitle(title) : undefined
    if (permission != null) {
      const decision = resolvePiSessionPermission(this.permissions, permission.toolName)
      const configured = resolveConfiguredPiPermission(this.ctx, permission.toolName)
      const automatic = decision !== 'inherit' ? decision : configured
      if (automatic === 'allow' || automatic === 'deny') {
        void this.send({
          type: 'extension_ui_response',
          id,
          value: automatic === 'allow' ? PI_PERMISSION_ALLOW : PI_PERMISSION_DENY
        })
        return true
      }
      this.pending.set(interactionId, { method, permissionTool: permission.toolName, rpcId: id })
      this.onEvent({
        type: 'interaction_request',
        data: buildPiPermissionInteraction({
          interactionId,
          payload: permission,
          permissionMode: this.options.permissionMode,
          sessionId: this.options.sessionId
        })
      })
      return true
    }

    this.pending.set(interactionId, { method, rpcId: id })
    this.onEvent({ type: 'interaction_request', data: this.buildQuestion(interactionId, method, event) })
    return true
  }

  respond(interactionId: string, data: string | string[]) {
    const pending = this.pending.get(interactionId)
    if (pending == null) return
    this.pending.delete(interactionId)
    const answer = firstValue(data)
    if (pending.permissionTool != null) {
      const decision = answer?.trim() ?? ''
      if (isPermissionDecision(decision)) {
        rememberPiSessionPermission(this.permissions, pending.permissionTool, decision as PermissionInteractionDecision)
      }
      void this.send({
        type: 'extension_ui_response',
        id: pending.rpcId,
        value: isAllowDecision(decision) ? PI_PERMISSION_ALLOW : PI_PERMISSION_DENY
      })
      return
    }
    if (answer == null || answer === 'cancel') {
      void this.send({ type: 'extension_ui_response', id: pending.rpcId, cancelled: true })
    } else if (pending.method === 'confirm') {
      void this.send({
        type: 'extension_ui_response',
        id: pending.rpcId,
        confirmed: ['yes', 'true', 'confirm'].includes(answer.trim())
      })
    } else {
      void this.send({ type: 'extension_ui_response', id: pending.rpcId, value: answer })
    }
  }

  private buildQuestion(
    interactionId: string,
    method: DialogMethod,
    event: PiRpcEvent
  ): AdapterInteractionRequest {
    const title = typeof event.title === 'string' ? event.title : 'Pi needs input'
    const question = method === 'confirm' && typeof event.message === 'string' ? `${title}\n${event.message}` : title
    const options = method === 'select' && Array.isArray(event.options)
      ? event.options.filter((item): item is string => typeof item === 'string').map(label => ({ label, value: label }))
      : method === 'confirm'
      ? [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]
      : undefined
    return { id: interactionId, payload: { sessionId: this.options.sessionId, question, options } }
  }

  private emitOperation(
    operationId: string,
    message: string,
    type: 'operation_started' | 'operation_completed'
  ) {
    this.onEvent({
      type: 'operation',
      data: { type, operationId: `pi-extension-${operationId}`, message, adapter: 'pi' }
    })
  }

  private async send(command: PiRpcEvent) {
    try {
      await this.client.notify(command)
    } catch (error) {
      this.ctx.logger.warn('[pi session] failed to answer extension UI', { error })
      this.onSendError(error)
    }
  }
}
