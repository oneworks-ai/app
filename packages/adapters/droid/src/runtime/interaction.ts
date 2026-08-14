/* eslint-disable max-lines -- native interaction correlation and fail-closed mappings stay centralized. */
import { AskUserRequestParamsSchema, AskUserResultSchema } from '@factory/droid-sdk'
import type { AdapterOutputEvent, AdapterQueryOptions, PermissionInteractionDecision } from '@oneworks/types'

import type { DroidJsonRpcClient } from './protocol/client'
import type { FactoryRequest } from './protocol/types'

type NormalizedPermissionDecision = PermissionInteractionDecision | 'cancel'

interface FactoryQuestion {
  index: number
  multiSelect: boolean
  options: Array<{ label: string; value?: string; description?: string }>
  question: string
  topic?: string
}

interface PendingAskUser {
  answers: Array<{ index: number; question: string; answer: string }>
  kind: 'ask_user'
  position: number
  questions: FactoryQuestion[]
  requestId: string
}

interface PendingPermission {
  cancelValue?: string
  decisions: Map<PermissionInteractionDecision, string>
  kind: 'permission'
  requestId: string
}

type PendingInteraction = PendingAskUser | PendingPermission

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const asString = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value : undefined
const firstValue = (value: string | string[]) => Array.isArray(value) ? value[0] : value

const hasSparseEntries = (values: string[]) =>
  Array.from({ length: values.length }, (_, index) => Object.hasOwn(values, index)).includes(false)

const encodeAskUserAnswer = (question: FactoryQuestion, data: string | string[]) => {
  const selections = Array.isArray(data) ? data : [data]
  if (hasSparseEntries(selections) || !selections.every(value => typeof value === 'string')) {
    throw new Error('Factory ask_user selections must be a dense string array.')
  }

  const trimmed = selections.map(value => value.trim())
  if (trimmed.includes('')) {
    throw new Error('Factory ask_user selections cannot contain empty values.')
  }
  if (!question.multiSelect) {
    if (trimmed.length !== 1) {
      throw new Error('Factory ask_user single-select questions require exactly one answer.')
    }
    return trimmed[0]!
  }

  const nativeValues = question.options.map(option => option.value ?? option.label)
  const unassigned = [...trimmed]
  const orderedOptions = nativeValues.flatMap((value) => {
    const selectedIndex = unassigned.indexOf(value)
    if (selectedIndex < 0) return []
    unassigned.splice(selectedIndex, 1)
    return [value]
  })
  const customAnswers = unassigned
  if (customAnswers.length > 1) {
    throw new Error('Factory ask_user multi-select questions allow at most one custom answer.')
  }

  // Factory CLI 0.195.0 owns this wire convention: selected native options are
  // ordered by their original indexes, then the trimmed custom answer is
  // appended, and the opaque SDK answer string is joined with comma + space.
  return [...orderedOptions, ...customAnswers].join(', ')
}

const knownPermissionDecision = (value: string): PermissionInteractionDecision | undefined => {
  if (value === 'proceed_once') return 'allow_once'
  if (value === 'proceed_always') return 'allow_session'
  if (value === 'proceed_project') return 'allow_project'
  if (value === 'cancel' || value === 'deny_once' || value === 'reject_once') return 'deny_once'
  if (value === 'deny_always' || value === 'deny_session' || value === 'reject_always') return 'deny_session'
  if (value === 'deny_project' || value === 'reject_project') return 'deny_project'
  return undefined
}

const metadataPermissionDecision = (
  option: Record<string, unknown>
): PermissionInteractionDecision | undefined => {
  const action = asString(option.action ?? option.outcome)?.toLowerCase()
  const scope = asString(option.scope ?? option.permissionScope)?.toLowerCase()
  if (action !== 'allow' && action !== 'deny') return undefined
  if (scope === 'once' || scope === 'one_time' || scope === 'request') return `${action}_once`
  if (scope === 'session') return `${action}_session`
  if (scope === 'project') return `${action}_project`
  return undefined
}

const safeFallbackDecisions = (
  decision: NormalizedPermissionDecision
): PermissionInteractionDecision[] => {
  if (decision === 'allow_project') return ['allow_project', 'allow_session', 'allow_once']
  if (decision === 'allow_session') return ['allow_session', 'allow_once']
  if (decision === 'allow_once') return ['allow_once']
  if (decision === 'deny_project') return ['deny_project', 'deny_session', 'deny_once']
  if (decision === 'deny_session') return ['deny_session', 'deny_once']
  return ['deny_once']
}

export class DroidInteractionBridge {
  private readonly pending = new Map<string, PendingInteraction>()

  constructor(
    private readonly client: DroidJsonRpcClient,
    private readonly options: AdapterQueryOptions,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly onError: (error: unknown) => void
  ) {}

  handle(request: FactoryRequest) {
    if (request.method === 'droid.request_permission') {
      this.handlePermission(request)
      return true
    }
    if (request.method === 'droid.ask_user') {
      this.handleAskUser(request)
      return true
    }
    void this.client.respondError(request.id, {
      code: -32601,
      message: `One Works does not implement Factory client method ${request.method}.`
    }).catch(this.onError)
    return false
  }

  async respond(interactionId: string, data: string | string[]) {
    const pending = this.pending.get(interactionId)
    if (pending == null) return
    this.pending.delete(interactionId)

    if (pending.kind === 'permission') {
      const selected = firstValue(data) as NormalizedPermissionDecision | undefined
      await this.respondPermission(pending, selected ?? 'cancel')
      return
    }

    const selected = Array.isArray(data) ? data : [data]
    if (selected.length === 0 || (!Array.isArray(data) && data === 'cancel')) {
      await this.respondAskUser(pending.requestId, { cancelled: true, answers: [] })
      return
    }
    const question = pending.questions[pending.position]
    if (question == null) {
      await this.client.respondError(pending.requestId, {
        code: -32603,
        message: 'Factory ask_user correlation was lost.'
      })
      return
    }
    let answer: string
    try {
      answer = encodeAskUserAnswer(question, selected)
    } catch (error) {
      const safeError = error instanceof Error ? error : new Error(String(error))
      await this.client.respondError(pending.requestId, { code: -32602, message: safeError.message })
      throw safeError
    }
    pending.answers.push({
      index: question.index,
      question: question.question,
      answer
    })
    pending.position += 1
    if (pending.position < pending.questions.length) {
      this.emitAskQuestion(pending)
      return
    }
    await this.respondAskUser(pending.requestId, { answers: pending.answers })
  }

  cancelAll() {
    const interactions = [...new Set(this.pending.values())]
    this.pending.clear()
    const responses = interactions.map(async (pending) => {
      if (pending.kind === 'permission') {
        await this.respondPermission(pending, 'cancel')
      } else {
        await this.respondAskUser(pending.requestId, { cancelled: true, answers: [] })
      }
    })
    return Promise.allSettled(responses)
  }

  private async respondAskUser(requestId: string, result: unknown) {
    const validated = AskUserResultSchema.safeParse(result)
    if (!validated.success) {
      const error = new Error(`Factory ask_user response failed SDK validation: ${validated.error.message}`)
      await this.client.respondError(requestId, { code: -32603, message: error.message })
      throw error
    }
    await this.client.respond(requestId, validated.data)
  }

  private async respondPermission(
    pending: PendingPermission,
    decision: NormalizedPermissionDecision
  ) {
    const nativeValue = safeFallbackDecisions(decision)
      .map(candidate => pending.decisions.get(candidate))
      .find((value): value is string => value != null) ?? pending.cancelValue
    if (nativeValue != null) {
      await this.client.respond(pending.requestId, { selectedOption: nativeValue })
      return
    }
    await this.client.respondError(pending.requestId, {
      code: -32000,
      message: 'Factory permission request provided no safe denial option.'
    })
  }

  private handlePermission(request: FactoryRequest) {
    const params = asRecord(request.params)
    const rawOptions = Array.isArray(params.options) ? params.options : []
    const decisions = new Map<PermissionInteractionDecision, string>()
    const options: Array<{ label: string; value: string; description?: string }> = []
    let cancelValue: string | undefined
    let autoRunValue: string | undefined
    for (const item of rawOptions) {
      const record = asRecord(item)
      const nativeValue = asString(record.value)
      if (nativeValue == null) continue
      if (nativeValue === 'proceed_auto_run') autoRunValue ??= nativeValue
      const decision = knownPermissionDecision(nativeValue) ?? metadataPermissionDecision(record)
      if (decision == null || decisions.has(decision)) continue
      decisions.set(decision, nativeValue)
      if (decision.startsWith('deny_')) cancelValue ??= nativeValue
      options.push({
        label: asString(record.label) ?? nativeValue,
        value: decision,
        ...(asString(record.description) == null ? {} : { description: asString(record.description) })
      })
    }

    const pending: PendingPermission = { cancelValue, decisions, kind: 'permission', requestId: request.id }
    if (this.options.permissionMode === 'dontAsk') {
      void this.respondPermission(pending, 'cancel').catch(this.onError)
      return
    }
    if (this.options.permissionMode === 'bypassPermissions') {
      const nativeValue = autoRunValue ?? decisions.get('allow_session') ?? decisions.get('allow_once')
      if (nativeValue != null) {
        void this.client.respond(request.id, { selectedOption: nativeValue }).catch(this.onError)
      } else {
        void this.respondPermission(pending, 'cancel').catch(this.onError)
      }
      return
    }

    const toolUses = Array.isArray(params.toolUses) ? params.toolUses.map(asRecord) : []
    const toolNames = toolUses
      .map(item => asString(asRecord(item.toolUse).name))
      .filter((value): value is string => value != null)
    const interactionId = `droid-permission:${request.id}`
    this.pending.set(interactionId, pending)
    this.onEvent({
      type: 'interaction_request',
      data: {
        id: interactionId,
        payload: {
          sessionId: this.options.sessionId,
          question: toolNames.length === 0
            ? 'Factory Droid requests permission to continue.'
            : `Factory Droid requests permission for: ${toolNames.join(', ')}`,
          options,
          kind: 'permission',
          permissionContext: {
            adapter: 'droid',
            currentMode: this.options.permissionMode,
            deniedTools: toolNames,
            ...(toolNames[0] == null ? {} : { subjectKey: toolNames[0] }),
            subjectLabel: toolNames.join(', ') || 'Factory Droid tool',
            scope: 'tool'
          }
        }
      }
    })
  }

  private handleAskUser(request: FactoryRequest) {
    const params = asRecord(request.params)
    const parsed = AskUserRequestParamsSchema.safeParse(params)
    if (!parsed.success) {
      void this.client.respondError(request.id, {
        code: -32602,
        message: `Factory ask_user request failed SDK validation: ${parsed.error.message}`
      }).catch(this.onError)
      return
    }
    const indexes = new Set<number>()
    const questions: FactoryQuestion[] = []
    for (const question of parsed.data.questions) {
      const normalizedOptions = question.options.map(option => option.trim().toLowerCase())
      if (
        indexes.has(question.index) ||
        normalizedOptions.includes('') ||
        new Set(normalizedOptions).size !== normalizedOptions.length
      ) {
        void this.client.respondError(request.id, {
          code: -32602,
          message: 'Factory ask_user request contains duplicate indexes or ambiguous options.'
        }).catch(this.onError)
        return
      }
      indexes.add(question.index)
      questions.push({
        index: question.index,
        topic: question.topic,
        question: question.question,
        options: question.options.map(option => ({ label: option, value: option })),
        multiSelect: question.multiSelect === true
      })
    }
    const pending: PendingAskUser = {
      answers: [],
      kind: 'ask_user',
      position: 0,
      questions,
      requestId: request.id
    }
    if (questions.length === 0) {
      void this.client.respondError(request.id, {
        code: -32602,
        message: 'Factory ask_user request contained no questions.'
      }).catch(this.onError)
      return
    }
    this.emitAskQuestion(pending)
  }

  private emitAskQuestion(pending: PendingAskUser) {
    const question = pending.questions[pending.position]!
    const interactionId = `droid-question:${pending.requestId}:${question.index}`
    this.pending.set(interactionId, pending)
    this.onEvent({
      type: 'interaction_request',
      data: {
        id: interactionId,
        payload: {
          sessionId: this.options.sessionId,
          question: question.topic == null
            ? question.question
            : `${question.topic}\n${question.question}`,
          options: question.options,
          multiselect: question.multiSelect,
          kind: 'question'
        }
      }
    })
  }
}
