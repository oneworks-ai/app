import type { ReactNode } from 'react'

import type { AskUserQuestionParams, ChatMessageContent, SessionQueuedMessageMode, SessionStatus } from '@oneworks/core'
import type { SessionInfo } from '@oneworks/types'

import type { AgentRoomTargetMember } from '#~/components/agent-room/@core/resolve-room-target'
import type { ContextReferenceRequest } from '#~/components/workspace/context-file-types'
import type { ChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import type { ChatSessionWorkspaceDraft } from '#~/hooks/chat/chat-session-workspace-draft'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'
import type { ChatEffort } from '#~/hooks/chat/use-chat-effort'
import type {
  ChatAdapterSelectOption,
  HiddenBuiltinAdapterOption,
  ModelSelectMenuGroup,
  ModelSelectOption
} from '#~/hooks/chat/use-chat-model-adapter-selection'
import type { PermissionMode } from '#~/hooks/chat/use-chat-permission-mode'

import type { SenderInitialContent, SenderSubmitResult, SenderVariant } from './sender-types'

export type SenderStatusBarGitControlsInMore =
  | {
    type: 'session'
    sessionId: string
  }
  | {
    type: 'draft'
    disabled?: boolean
    draftWorkspace: ChatSessionWorkspaceDraft
    onDraftWorkspaceChange: (nextDraft: ChatSessionWorkspaceDraft) => void
  }

export interface SenderProps {
  onSend: (text: string, mode?: SessionQueuedMessageMode) => SenderSubmitResult | Promise<SenderSubmitResult>
  onSendContent: (
    content: ChatMessageContent[],
    mode?: SessionQueuedMessageMode
  ) => SenderSubmitResult | Promise<SenderSubmitResult>
  variant?: SenderVariant
  adapterLocked?: boolean
  sessionStatus?: SessionStatus
  onInterrupt: () => void
  onClear?: () => void
  sessionId?: string
  sessionInfo?: SessionInfo | null
  interactionRequest?: { id: string; payload: AskUserQuestionParams } | null
  onInteractionResponse?: (id: string, data: string | string[]) => void
  interactionOptionNavigation?: {
    optionCount: number
    activeIndex: number
    onMove: (delta: number) => void
    onSubmit: () => void
  }
  placeholder?: string
  initialContent?: SenderInitialContent
  onInputChange?: (value: string) => void
  onCancel?: () => void
  submitLabel?: string
  submitLoading?: boolean
  stopLoading?: boolean
  forceEffortControl?: boolean
  hideReferenceActions?: boolean
  hideHeaderControls?: boolean
  hideSelectionControls?: boolean
  hideSubmitAction?: boolean
  enableVoiceInput?: boolean
  hiddenVoiceInputActions?: {
    onConfigure: () => void
    onShow: () => void
  }
  autoFocus?: boolean
  autoFocusKey?: string
  modelMenuGroups?: ModelSelectMenuGroup[]
  modelSearchOptions?: ModelSelectOption[]
  builtinPreviewModelOptions?: ModelSelectOption[]
  recommendedModelOptions?: ModelSelectOption[]
  servicePreviewModelOptions?: ModelSelectOption[]
  onToggleRecommendedModel?: (option: ModelSelectOption) => void | Promise<void>
  onConnectMoreModelServices?: () => void
  onOpenModelServicesConfig?: () => void
  updatingRecommendedModelValue?: string
  selectedModel?: string
  onModelChange?: (model: string) => void
  effort?: ChatEffort
  effortOptions?: Array<{ value: ChatEffort; label: ReactNode }>
  onEffortChange?: (effort: ChatEffort) => void
  permissionMode?: PermissionMode
  permissionModeOptions?: Array<{ value: PermissionMode; label: ReactNode }>
  onPermissionModeChange?: (mode: PermissionMode) => void
  selectedAdapter?: string
  adapterOptions?: ChatAdapterSelectOption[]
  hiddenBuiltinAdapterOptions?: HiddenBuiltinAdapterOption[]
  onAdapterChange?: (adapter: string) => void
  selectedAccount?: string
  accountOptions?: ChatAdapterAccountOption[]
  showAccountSelector?: boolean
  onAccountChange?: (account: string) => void
  showStatusBarControlsInMore?: boolean
  statusBarGitControlsInMore?: SenderStatusBarGitControlsInMore
  modelUnavailable?: boolean
  sessionTarget?: {
    draft: ChatSessionTargetDraft
    locked: boolean
    disabled?: boolean
    onChange: (target: ChatSessionTargetDraft) => void
  }
  agentRoomTargetMembers?: AgentRoomTargetMember[]
  queueMode?: SessionQueuedMessageMode
  onQueueModeChange?: (mode: SessionQueuedMessageMode) => void
  contextReferenceRequest?: ContextReferenceRequest | null
}
