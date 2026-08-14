/* eslint-disable max-lines -- ACP updates and permission state share one replay-aware projector. */
import type {
  Client,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  StopReason,
  ToolCall,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'
import type { AdapterOutputEvent, AdapterQueryOptions, PermissionInteractionDecision } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

interface PendingPermission {
  options: PermissionOption[]
  resolve: (response: RequestPermissionResponse) => void
}

const permissionDecisionByKind: Record<PermissionInteractionDecision, PermissionOption['kind']> = {
  allow_once: 'allow_once',
  allow_session: 'allow_once',
  allow_project: 'allow_once',
  deny_once: 'reject_once',
  deny_session: 'reject_once',
  deny_project: 'reject_once'
}

const resolveToolName = (tool: Pick<ToolCall, 'kind' | 'title'>) => {
  const source = tool.kind ?? tool.title ?? 'other'
  const normalized = source.toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `adapter:cline:${normalized || 'other'}`
}

const projectToolOutput = (tool: ToolCallUpdate | ToolCall) => {
  if (tool.rawOutput !== undefined && tool.rawOutput !== '[image]') return tool.rawOutput
  const text = tool.content?.flatMap((item) => {
    if (item.type === 'content' && item.content.type === 'text') return [item.content.text]
    if (item.type === 'diff') return [item.newText]
    return []
  }).join('\n')
  return text?.trim() ? text : undefined
}

export class ClineAcpProjector {
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly replayedMessageIds = new Set<string>()
  private readonly replayedToolResults = new Set<string>()
  private readonly replayedToolUses = new Set<string>()
  private readonly seenToolUses = new Set<string>()
  private readonly seenToolResults = new Set<string>()
  private assistantText = ''
  private assistantTextCreatedAt = 0
  private assistantTextId: string | undefined
  private deliverableCount = 0
  private dedupeReplay = false
  private replaying = false
  private usageUpdateDiagnosticEmitted = false

  readonly client: Client = {
    requestPermission: params => this.requestPermission(params),
    sessionUpdate: params => this.sessionUpdate(params)
  }

  constructor(
    private readonly options: AdapterQueryOptions,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly now = () => Date.now()
  ) {}

  startReplay() {
    this.replayedMessageIds.clear()
    this.replayedToolResults.clear()
    this.replayedToolUses.clear()
    this.replaying = true
  }

  finishReplay() {
    this.replaying = false
    this.dedupeReplay = true
  }

  startTurn() {
    this.closeAssistantTextSegment()
    this.deliverableCount = 0
    this.seenToolResults.clear()
    this.seenToolUses.clear()
  }

  finishTurn(response: PromptResponse) {
    if (response.usage != null) {
      this.onEvent({
        type: 'usage',
        data: {
          aggregationMode: 'delta',
          cacheReadInputTokens: response.usage.cachedReadTokens ?? undefined,
          cacheCreationInputTokens: response.usage.cachedWriteTokens ?? undefined,
          inputTokens: response.usage.inputTokens,
          model: this.options.model,
          observedAt: this.now(),
          outputTokens: response.usage.outputTokens,
          quality: 'provider_reported'
        }
      })
    }
    const result = { deliverableCount: this.deliverableCount, stopReason: response.stopReason }
    this.closeAssistantTextSegment()
    this.dedupeReplay = false
    this.replayedMessageIds.clear()
    this.replayedToolResults.clear()
    this.replayedToolUses.clear()
    return result
  }

  settlePendingPermissions() {
    for (const pending of this.pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
    this.pendingPermissions.clear()
  }

  respond(interactionId: string, data: string | string[]) {
    const pending = this.pendingPermissions.get(interactionId)
    if (pending == null) return
    this.pendingPermissions.delete(interactionId)
    const rawValue = Array.isArray(data) ? data[0] : data
    const kind = permissionDecisionByKind[rawValue as PermissionInteractionDecision]
    const selected = pending.options.find(option => option.kind === kind)
    pending.resolve(
      selected == null
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: selected.optionId } }
    )
  }

  private async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const allowOnce = params.options.find(option => option.kind === 'allow_once')
    if (allowOnce == null) {
      this.onEvent({
        type: 'error',
        data: {
          message: 'Cline did not offer a request-scoped allow_once permission; the request was cancelled.',
          code: 'cline_permission_allow_once_unavailable',
          fatal: false
        }
      })
      return { outcome: { outcome: 'cancelled' } }
    }
    const automatic = this.resolveAutomaticPermission(params.options, params.toolCall.kind)
    if (automatic != null) {
      return { outcome: { outcome: 'selected', optionId: automatic.optionId } }
    }
    const interactionId = `cline-permission:${uuid()}`
    return await new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissions.set(interactionId, { options: params.options, resolve })
      this.onEvent({
        type: 'interaction_request',
        data: {
          id: interactionId,
          payload: {
            sessionId: this.options.sessionId,
            kind: 'permission',
            question: params.toolCall.title ?? 'Cline requests permission to use a tool.',
            options: [
              { label: allowOnce.name, value: 'allow_once', description: 'allow_once' },
              ...params.options
                .filter(option => option.kind === 'reject_once')
                .slice(0, 1)
                .map(option => ({ label: option.name, value: 'deny_once', description: 'reject_once' }))
            ],
            permissionContext: {
              adapter: 'cline',
              currentMode: this.options.permissionMode,
              scope: 'tool',
              subjectKey: params.toolCall.kind ?? params.toolCall.title ?? 'other',
              subjectLabel: params.toolCall.title ?? 'Cline tool'
            }
          }
        }
      })
    })
  }

  private resolveAutomaticPermission(options: PermissionOption[], toolKind: ToolCall['kind'] | null) {
    if (
      this.options.permissionMode === 'bypassPermissions' ||
      this.options.permissionMode === 'dontAsk'
    ) {
      return options.find(option => option.kind === 'allow_once')
    }
    if (this.options.permissionMode === 'acceptEdits' && toolKind === 'edit') {
      return options.find(option => option.kind === 'allow_once')
    }
    return undefined
  }

  private async sessionUpdate(params: SessionNotification) {
    const update = params.update
    if (this.replaying) {
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        if (update.messageId != null) this.replayedMessageIds.add(update.messageId)
      } else if (update.sessionUpdate === 'tool_call') {
        this.replayedToolUses.add(update.toolCallId)
        if (update.status === 'completed' || update.status === 'failed') this.replayedToolResults.add(update.toolCallId)
      } else if (update.sessionUpdate === 'tool_call_update') {
        this.replayedToolUses.add(update.toolCallId)
        if (update.status === 'completed' || update.status === 'failed') this.replayedToolResults.add(update.toolCallId)
      }
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk') {
      if (update.content.type !== 'text' || update.content.text === '') return
      if (
        this.dedupeReplay && update.messageId != null &&
        this.replayedMessageIds.has(update.messageId)
      ) return
      if (this.assistantTextId == null) {
        this.assistantTextId = `cline-text-${uuid()}`
        this.assistantTextCreatedAt = this.now()
        this.deliverableCount += 1
      }
      this.assistantText += update.content.text
      this.onEvent({
        type: 'message',
        data: {
          id: this.assistantTextId,
          role: 'assistant',
          content: this.assistantText,
          createdAt: this.assistantTextCreatedAt,
          ...(this.options.model != null ? { model: this.options.model } : {})
        }
      })
      return
    }
    this.closeAssistantTextSegment()
    if (update.sessionUpdate === 'tool_call') {
      this.projectToolUse(update)
      if (update.status === 'completed' || update.status === 'failed') this.projectToolResult(update)
      return
    }
    if (update.sessionUpdate === 'tool_call_update') {
      if (!this.seenToolUses.has(update.toolCallId)) {
        this.projectToolUse({
          toolCallId: update.toolCallId,
          title: update.title ?? 'Cline tool',
          kind: update.kind ?? 'other',
          rawInput: update.rawInput,
          status: update.status ?? undefined,
          content: update.content ?? undefined,
          locations: update.locations ?? undefined,
          rawOutput: update.rawOutput
        })
      }
      if (update.status === 'completed' || update.status === 'failed') this.projectToolResult(update)
      return
    }
    if (update.sessionUpdate === 'session_info_update' && update.title?.trim()) {
      this.onEvent({ type: 'session_update', data: { title: update.title.trim() } })
      return
    }
    if (update.sessionUpdate === 'usage_update') {
      if (this.usageUpdateDiagnosticEmitted) return
      this.usageUpdateDiagnosticEmitted = true
      this.onEvent({
        type: 'error',
        data: {
          message: 'Cline ACP usage_update reports current context usage, which One Works cannot represent safely.',
          code: 'cline_context_usage_unsupported',
          fatal: false
        }
      })
    }
  }

  private projectToolUse(tool: ToolCall) {
    if (this.seenToolUses.has(tool.toolCallId)) return
    this.seenToolUses.add(tool.toolCallId)
    if (this.dedupeReplay && this.replayedToolUses.has(tool.toolCallId)) return
    const name = resolveToolName(tool)
    this.deliverableCount += 1
    this.onEvent({
      type: 'message',
      data: {
        id: tool.toolCallId,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: tool.toolCallId,
          name,
          input: tool.rawInput ?? {}
        }],
        createdAt: this.now(),
        ...(this.options.model != null ? { model: this.options.model } : {})
      }
    })
  }

  private projectToolResult(tool: ToolCallUpdate | ToolCall) {
    if (this.seenToolResults.has(tool.toolCallId)) return
    this.seenToolResults.add(tool.toolCallId)
    if (this.dedupeReplay && this.replayedToolResults.has(tool.toolCallId)) return
    const output = projectToolOutput(tool)
    if (output === undefined && tool.status !== 'failed') return
    this.deliverableCount += 1
    this.onEvent({
      type: 'message',
      data: {
        id: `${tool.toolCallId}:result`,
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.toolCallId,
          content: output ?? 'Cline reported that the tool failed without exposing a result.',
          ...(tool.status === 'failed' ? { is_error: true } : {})
        }],
        createdAt: this.now(),
        ...(this.options.model != null ? { model: this.options.model } : {})
      }
    })
  }

  private closeAssistantTextSegment() {
    this.assistantText = ''
    this.assistantTextCreatedAt = 0
    this.assistantTextId = undefined
  }
}

export const isNormalClineEmptyTurn = (stopReason: StopReason) => stopReason === 'cancelled'

export const CLINE_AMBIGUOUS_EMPTY_TURN_MESSAGE =
  'Cline ACP ended the turn without any deliverable text, tool, or result and did not expose the underlying error.'
