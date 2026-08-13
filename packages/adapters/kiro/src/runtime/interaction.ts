/* eslint-disable max-lines -- native option normalization and single-settlement behavior stay together. */
import type {
  AdapterInteractionRequest,
  AdapterOutputEvent,
  AdapterQueryOptions,
  PermissionInteractionDecision,
  PermissionInteractionOptionPresentation
} from '@oneworks/types'

import type { KiroAcpClient } from '../protocol/client'
import type { AcpMessage } from '../protocol/types'

type KiroPermissionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

interface AcpPermissionOption {
  kind?: string
  name?: string
  optionId: string
  scope?: KiroPermissionKind
}

interface PendingPermission {
  options: AcpPermissionOption[]
  requestId: number | string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const firstValue = (data: string | string[]) => Array.isArray(data) ? data[0] : data

const normalizePermissionKind = (value: string | undefined): KiroPermissionKind | undefined => {
  const normalized = value
    ?.replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replaceAll(/[\s-]+/gu, '_')
    .toLowerCase()
  if (
    normalized === 'allow_once' || normalized === 'allow_always' ||
    normalized === 'reject_once' || normalized === 'reject_always'
  ) return normalized
  return undefined
}

const normalizePermissionOptions = (value: unknown): AcpPermissionOption[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: AcpPermissionOption[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.optionId !== 'string' || item.optionId.trim() === '') continue
    const optionId = item.optionId.trim()
    if (seen.has(optionId)) continue
    seen.add(optionId)
    const kind = typeof item.kind === 'string' ? item.kind : undefined
    normalized.push({
      kind,
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : undefined,
      optionId,
      scope: normalizePermissionKind(kind)
    })
  }
  return normalized
}

const frameworkDecisionScope = (value: string): KiroPermissionKind | undefined => {
  const decision = value as PermissionInteractionDecision
  if (decision === 'allow_once') return 'allow_once'
  if (decision === 'allow_session' || decision === 'allow_project') return 'allow_once'
  if (decision === 'deny_once') return 'reject_once'
  if (decision === 'deny_session' || decision === 'deny_project') return 'reject_once'
  return undefined
}

const findExactPermissionOption = (options: AcpPermissionOption[], kind: KiroPermissionKind) => (
  options.find(option => option.scope === kind)
)

const describePermissionOption = (option: AcpPermissionOption): {
  description?: string
  label: string
  permission: PermissionInteractionOptionPresentation
} => {
  if (option.scope === 'allow_once') {
    return {
      label: option.name ?? option.optionId,
      permission: { adapterLabel: 'Kiro', semantic: 'allow_once' }
    }
  }
  if (option.scope === 'allow_always') {
    return {
      label: option.name ?? option.optionId,
      permission: { adapterLabel: 'Kiro', semantic: 'allow_persistent' }
    }
  }
  if (option.scope === 'reject_once') {
    return {
      label: option.name ?? option.optionId,
      permission: { adapterLabel: 'Kiro', semantic: 'deny_once' }
    }
  }
  if (option.scope === 'reject_always') {
    return {
      label: option.name ?? option.optionId,
      permission: { adapterLabel: 'Kiro', semantic: 'deny_persistent' }
    }
  }
  const nativeLabel = option.name ?? option.kind ?? option.optionId
  return {
    label: nativeLabel,
    permission: { adapterLabel: 'Kiro', nativeLabel, semantic: 'native_unknown' }
  }
}

export class KiroInteractionBridge {
  private readonly pending = new Map<string, PendingPermission>()

  constructor(
    private readonly client: KiroAcpClient,
    private readonly options: AdapterQueryOptions,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly onSendError: (error: unknown) => void
  ) {}

  handle(message: AcpMessage) {
    if (message.method !== 'session/request_permission' || message.id == null || !isRecord(message.params)) {
      return false
    }
    const params = message.params
    const options = normalizePermissionOptions(params.options)
    const automatic = this.resolveAutomaticOption(options, params)
    if (automatic.required) {
      if (automatic.option != null) {
        void this.client.respond(message.id, {
          outcome: { outcome: 'selected', optionId: automatic.option.optionId }
        }).catch(this.onSendError)
      } else {
        this.cancelAndFail(
          message.id,
          `Kiro requested permission in ${
            this.options.permissionMode ?? 'default'
          } mode without a request-scoped allow option.`
        )
      }
      return true
    }

    if (options.length === 0) {
      this.cancelAndFail(message.id, 'Kiro requested permission without any response option IDs.')
      return true
    }

    const interactionId = `kiro-permission:${String(message.id)}`
    this.pending.set(interactionId, { options, requestId: message.id })
    this.onEvent({
      type: 'interaction_request',
      data: this.buildInteraction(interactionId, options, params)
    })
    return true
  }

  async respond(interactionId: string, data: string | string[]) {
    const pending = this.pending.get(interactionId)
    if (pending == null) return
    this.pending.delete(interactionId)
    const decision = firstValue(data)?.trim() ?? 'cancel'
    const exact = pending.options.find(option => option.optionId === decision)
    const mappedScope = frameworkDecisionScope(decision)
    // Framework session/project decisions are One Works memory, not permission to mutate Kiro's
    // persistent state. Only a current response carrying a non-framework exact native ID can select
    // a native persistent option.
    const option = mappedScope == null
      ? exact
      : findExactPermissionOption(pending.options, mappedScope)
    const result = decision !== 'cancel' && option != null
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } }
    await this.client.respond(pending.requestId, result).catch(this.onSendError)
  }

  async cancelAll() {
    const responses = [...this.pending.values()].map(pending => (
      this.client.respond(pending.requestId, { outcome: { outcome: 'cancelled' } })
        .catch(this.onSendError)
    ))
    this.pending.clear()
    await Promise.all(responses)
  }

  private cancelAndFail(requestId: number | string, message: string) {
    void this.client.respond(requestId, { outcome: { outcome: 'cancelled' } })
      .then(() => this.onSendError(new Error(message)))
      .catch(this.onSendError)
  }

  private resolveAutomaticOption(options: AcpPermissionOption[], params: Record<string, unknown>) {
    if (this.options.permissionMode === 'bypassPermissions' || this.options.permissionMode === 'dontAsk') {
      return { required: true, option: findExactPermissionOption(options, 'allow_once') }
    }
    if (this.options.permissionMode === 'acceptEdits') {
      const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
      const kind = String(toolCall.kind ?? toolCall.title ?? '').toLowerCase()
      if (kind.includes('edit') || kind.includes('write')) {
        return { required: true, option: findExactPermissionOption(options, 'allow_once') }
      }
    }
    return { required: false, option: undefined }
  }

  private buildInteraction(
    interactionId: string,
    options: AcpPermissionOption[],
    params: Record<string, unknown>
  ): AdapterInteractionRequest {
    const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
    const title = String(toolCall.title ?? toolCall.kind ?? 'requested tool')
    return {
      id: interactionId,
      payload: {
        sessionId: this.options.sessionId,
        kind: 'permission',
        question: title,
        options: options.map((option) => ({
          ...describePermissionOption(option),
          value: option.optionId
        })),
        permissionContext: {
          adapter: 'kiro',
          currentMode: this.options.permissionMode,
          subjectKey: title,
          subjectLookupKeys: [String(toolCall.kind ?? title)],
          subjectLabel: title,
          scope: 'tool',
          projectConfigPath: '.oo.config.json'
        }
      }
    }
  }
}
