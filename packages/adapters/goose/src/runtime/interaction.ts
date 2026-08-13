import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'

import type { AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

interface PendingPermission {
  options: RequestPermissionRequest['options']
  resolve: (response: RequestPermissionResponse) => void
}

const firstAnswer = (value: string | string[]) => Array.isArray(value) ? value[0] : value

const automaticOption = (
  request: RequestPermissionRequest,
  mode: AdapterQueryOptions['permissionMode']
) => {
  if (mode === 'plan') {
    return request.options.find(option => option.kind === 'reject_once') ??
      request.options.find(option => option.kind === 'reject_always')
  }
  if (mode === 'bypassPermissions' || mode === 'dontAsk') {
    return request.options.find(option => option.kind === 'allow_once') ??
      request.options.find(option => option.kind === 'allow_always')
  }
  return undefined
}

const frameworkValueForKind = (kind: string) => {
  if (kind === 'allow_once') return 'allow_once'
  if (kind === 'allow_always') return 'allow_session'
  if (kind === 'reject_once') return 'deny_once'
  if (kind === 'reject_always') return 'deny_session'
  return undefined
}

const nativeKindsForDecision = (decision: string) => {
  if (decision === 'allow_once') return ['allow_once']
  if (decision === 'allow_session' || decision === 'allow_project') return ['allow_once', 'allow_always']
  if (decision === 'deny_once') return ['reject_once']
  if (decision === 'deny_session' || decision === 'deny_project') return ['reject_once', 'reject_always']
  return []
}

export class GoosePermissionBridge {
  private counter = 0
  private readonly pending = new Map<string, PendingPermission>()

  constructor(
    private readonly options: AdapterQueryOptions,
    private readonly onEvent: (event: AdapterOutputEvent) => void
  ) {}

  handle(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const automatic = automaticOption(request, this.options.permissionMode)
    if (automatic != null) {
      return Promise.resolve({ outcome: { outcome: 'selected', optionId: automatic.optionId } })
    }

    this.counter += 1
    const interactionId = `goose-permission:${this.counter}`
    return new Promise((resolve) => {
      this.pending.set(interactionId, { options: request.options, resolve })
      const toolName = request.toolCall.name?.trim() || request.toolCall.kind || request.toolCall.title || 'tool'
      const seenValues = new Set<string>()
      const mappedOptions = request.options.flatMap((option) => {
        const value = frameworkValueForKind(option.kind)
        if (value == null || seenValues.has(value)) return []
        seenValues.add(value)
        return [{
          label: option.name,
          value,
          description: option.kind.replaceAll('_', ' ')
        }]
      })
      if (mappedOptions.length === 0) {
        this.pending.delete(interactionId)
        resolve({ outcome: { outcome: 'cancelled' } })
        return
      }
      this.onEvent({
        type: 'interaction_request',
        data: {
          id: interactionId,
          payload: {
            sessionId: this.options.sessionId,
            kind: 'permission',
            question: `Allow Goose to run ${toolName}?`,
            options: mappedOptions,
            permissionContext: {
              adapter: 'goose',
              currentMode: this.options.permissionMode,
              deniedTools: [toolName],
              subjectKey: toolName,
              subjectLookupKeys: [toolName],
              subjectLabel: toolName,
              scope: 'tool'
            }
          }
        }
      })
    })
  }

  respond(interactionId: string, data: string | string[]) {
    const pending = this.pending.get(interactionId)
    if (pending == null) return
    this.pending.delete(interactionId)
    const answer = firstAnswer(data)
    const nativeKinds = nativeKindsForDecision(answer)
    const option = nativeKinds.flatMap(kind => pending.options.filter(candidate => candidate.kind === kind))[0]
    pending.resolve(
      option == null
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: option.optionId } }
    )
  }

  cancelAll() {
    for (const pending of this.pending.values()) pending.resolve({ outcome: { outcome: 'cancelled' } })
    this.pending.clear()
  }
}
