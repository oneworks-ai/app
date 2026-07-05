import type { SessionWorkspaceChanges } from './git'
import type { AskUserQuestionParams } from './interaction'
import type { ChatMessage } from './message'
import type { SessionCreationProgressEvent, SessionMessageQueueState, SessionPanelState } from './session'

export type WSEvent<
  TAdapterErrorData = unknown,
  TSessionInfo = unknown,
  TSession = unknown,
  TInteractionPayload = AskUserQuestionParams,
> =
  | { type: 'error'; data: TAdapterErrorData; message?: string }
  | { type: 'message'; message: ChatMessage }
  | {
    type: 'operation_started' | 'operation_completed' | 'operation_failed'
    adapter?: string
    error?: string
    id?: string
    message?: string
    operationId?: string
    sessionId?: string
    status?: string
    summary?: string
    title?: string
    ts?: number
  }
  | { type: 'session_info'; info: TSessionInfo }
  | { type: 'tool_result'; toolCallId: string; output: any; isError: boolean }
  | { type: 'adapter_result'; result: any; usage?: any }
  | { type: 'adapter_event'; data: any }
  | { type: 'session_updated'; session: TSession }
  | { type: 'config_updated'; workspaceFolder: string; updatedAt: number }
  | { type: 'workspace_panel_state_updated'; panelState: SessionPanelState; updatedAt: number }
  | { type: 'session_creation_progress'; sessionId: string; progress: SessionCreationProgressEvent }
  | { type: 'session_queue_updated'; queue: SessionMessageQueueState }
  | { type: 'workspace_changes'; changes: SessionWorkspaceChanges }
  | { type: 'interaction_request'; id: string; payload: TInteractionPayload }
  | { type: 'interaction_response'; id: string; data: string | string[] }
