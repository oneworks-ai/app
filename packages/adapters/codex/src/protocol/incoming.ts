import type { ChatMessage } from '@oneworks/core'
import type { AdapterQueryOptions } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { formatCodexCommandForDisplay } from '#~/command-display.js'
import type {
  CodexItemAgentMessage,
  CodexItemCommandExecution,
  CodexItemContextCompaction,
  CodexItemFileChange,
  CodexItemMcpToolCall,
  CodexItemWebSearch,
  CodexTurnStatus,
  ItemAgentMessageDeltaParams,
  ItemCommandExecutionOutputDeltaParams,
  ItemCompletedParams,
  ItemStartedParams,
  ThreadNameUpdatedParams,
  TurnCompletedParams
} from '#~/types.js'
import type { CodexRpcClient } from './rpc'

const formatOptionalTurnErrorPart = (value: unknown) => {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const formatTurnErrorMessage = (
  error?: { message?: unknown; codexErrorInfo?: unknown; additionalDetails?: unknown } | null
) => {
  const parts = [
    formatOptionalTurnErrorPart(error?.message),
    formatOptionalTurnErrorPart(error?.codexErrorInfo),
    formatOptionalTurnErrorPart(error?.additionalDetails)
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)

  return parts.length > 0 ? parts.join('\n') : 'Turn failed'
}

/**
 * Prefix a tool name with the adapter namespace so the core framework can
 * route tool-use / tool-result events to the correct adapter.
 */
export const prefixToolName = (name: string) => name.startsWith('adapter:codex:') ? name : `adapter:codex:${name}`

const normalizeSessionTitle = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Accumulator for in-flight agent messages while the turn is active.
 * We buffer text deltas and flush on `item/completed`.
 */
export class AgentMessageAccumulator {
  private textBuffer = new Map<string, string>()

  append(itemId: string, delta: string): void {
    const current = this.textBuffer.get(itemId) ?? ''
    this.textBuffer.set(itemId, current + delta)
  }

  get(itemId: string): string {
    return this.textBuffer.get(itemId) ?? ''
  }

  delete(itemId: string): void {
    this.textBuffer.delete(itemId)
  }

  clear(): void {
    this.textBuffer.clear()
  }
}

/**
 * Accumulator for in-flight command output deltas.
 */
export class CommandOutputAccumulator {
  private outputBuffer = new Map<string, string>()

  append(itemId: string, delta: string): void {
    const current = this.outputBuffer.get(itemId) ?? ''
    this.outputBuffer.set(itemId, current + delta)
  }

  get(itemId: string): string {
    return this.outputBuffer.get(itemId) ?? ''
  }

  delete(itemId: string): void {
    this.outputBuffer.delete(itemId)
  }

  clear(): void {
    this.outputBuffer.clear()
  }
}

/**
 * Handle a single incoming Codex notification and translate it into
 * the oneworks `AdapterOutputEvent` model.
 *
 * @param method   - The JSON-RPC notification method name
 * @param params   - The notification params (as raw Record)
 * @param _rpc     - The RPC client (used to respond to server-initiated approval requests)
 * @param onEvent  - The event emitter from `AdapterQueryOptions`
 * @param msgAcc   - Agent message text accumulator
 * @param cmdAcc   - Command output accumulator
 * @param _approvalPolicy - 'never' | 'unlessTrusted' | 'onRequest'
 */
export const handleIncomingNotification = (
  method: string,
  params: Record<string, unknown>,
  _rpc: CodexRpcClient,
  onEvent: AdapterQueryOptions['onEvent'],
  msgAcc: AgentMessageAccumulator,
  cmdAcc: CommandOutputAccumulator,
  _approvalPolicy: string = 'unlessTrusted'
): void => {
  // ── Thread metadata ─────────────────────────────────────────────────────────
  if (method === 'thread/name/updated') {
    const p = params as unknown as ThreadNameUpdatedParams
    const title = normalizeSessionTitle(p.threadName)
    if (title != null) {
      onEvent({
        type: 'session_update',
        data: { title }
      })
    }
    return
  }

  // ── Agent message delta ───────────────────────────────────────────────────
  if (method === 'item/agentMessage/delta') {
    const p = params as unknown as ItemAgentMessageDeltaParams
    msgAcc.append(p.itemId, p.delta)
    return
  }

  // ── Command output delta ──────────────────────────────────────────────────
  if (method === 'item/commandExecution/outputDelta') {
    const p = params as unknown as ItemCommandExecutionOutputDeltaParams
    cmdAcc.append(p.itemId, p.delta)
    return
  }

  // ── Item started ──────────────────────────────────────────────────────────
  if (method === 'item/started') {
    const { item } = params as unknown as ItemStartedParams
    if (item.type === 'commandExecution') {
      const cmdItem = item as CodexItemCommandExecution
      const command = formatCodexCommandForDisplay(cmdItem.command)
      // Emit a tool_use event so the client sees the command being kicked off
      const msg: ChatMessage = {
        id: cmdItem.id,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: cmdItem.id,
          name: prefixToolName('Bash'),
          input: {
            command,
            cwd: cmdItem.cwd
          }
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: msg })
    }
    if (item.type === 'webSearch') {
      const wsItem = item as CodexItemWebSearch
      const msg: ChatMessage = {
        id: wsItem.id,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: wsItem.id,
          name: prefixToolName('WebSearch'),
          input: { query: wsItem.query }
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: msg })
    }
    if (item.type === 'mcpToolCall') {
      const mcpItem = item as CodexItemMcpToolCall
      const msg: ChatMessage = {
        id: mcpItem.id,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: mcpItem.id,
          name: prefixToolName(`mcp:${mcpItem.server}:${mcpItem.tool}`),
          input: mcpItem.arguments ?? {}
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: msg })
    }
    if (item.type === 'contextCompaction') {
      const compactionItem = item as CodexItemContextCompaction
      onEvent({
        type: 'context_compaction',
        data: {
          id: compactionItem.id,
          createdAt: Date.now(),
          ...(compactionItem.tokenCount == null ? {} : { tokenCount: compactionItem.tokenCount }),
          ...(compactionItem.trigger == null ? {} : { trigger: compactionItem.trigger })
        }
      })
    }
    return
  }

  // ── Item completed ────────────────────────────────────────────────────────
  if (method === 'item/completed') {
    const { item } = params as unknown as ItemCompletedParams

    if (item.type === 'agentMessage') {
      const agentItem = item as CodexItemAgentMessage
      // Use accumulated text if present, otherwise fall back to item.text
      const text = msgAcc.get(agentItem.id) || agentItem.text
      msgAcc.delete(agentItem.id)
      if (text) {
        const msg: ChatMessage = {
          id: agentItem.id,
          role: 'assistant',
          content: text,
          createdAt: Date.now()
        }
        onEvent({ type: 'message', data: msg })
      }
    }

    if (item.type === 'commandExecution') {
      const cmdItem = item as CodexItemCommandExecution
      const output = cmdAcc.get(cmdItem.id) || cmdItem.aggregatedOutput || ''
      cmdAcc.delete(cmdItem.id)
      const resultMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: cmdItem.id,
          content: output !== ''
            ? output
            : `[exited ${cmdItem.exitCode ?? 0}]`,
          is_error: cmdItem.exitCode != null && cmdItem.exitCode !== 0
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: resultMsg })
    }

    if (item.type === 'fileChange') {
      const fcItem = item as CodexItemFileChange
      const summary = fcItem.changes
        .map(c => `${c.kind} ${c.path}`)
        .join('\n')
      const resultMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: fcItem.id,
          content: summary || `[file changes ${fcItem.status}]`,
          is_error: fcItem.status === 'failed' || fcItem.status === 'declined'
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: resultMsg })
    }

    if (item.type === 'mcpToolCall') {
      const mcpItem = item as CodexItemMcpToolCall
      const resultMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: mcpItem.id,
          content: mcpItem.result ?? (mcpItem.error ? String(mcpItem.error) : '[done]'),
          is_error: mcpItem.status === 'failed'
        }],
        createdAt: Date.now()
      }
      onEvent({ type: 'message', data: resultMsg })
    }

    return
  }

  // ── Turn completed ────────────────────────────────────────────────────────
  if (method === 'turn/completed') {
    const { turn } = params as unknown as TurnCompletedParams
    const status: CodexTurnStatus = turn.status
    if (status === 'completed') {
      msgAcc.clear()
      cmdAcc.clear()
      onEvent({ type: 'stop', data: undefined })
    } else if (status === 'interrupted') {
      msgAcc.clear()
      cmdAcc.clear()
      const errorMsg = 'Turn interrupted'
      onEvent({
        type: 'error',
        data: {
          message: errorMsg,
          details: turn,
          fatal: true
        }
      })
      const data: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: errorMsg,
        createdAt: Date.now()
      }
      onEvent({ type: 'stop', data })
    } else if (status === 'failed') {
      const errorMsg = formatTurnErrorMessage(turn.error)
      onEvent({
        type: 'error',
        data: {
          message: errorMsg,
          details: turn.error,
          fatal: true
        }
      })
      const data: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: errorMsg,
        createdAt: Date.now()
      }
      onEvent({ type: 'stop', data })
    }
  }
}
