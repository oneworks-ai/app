import type {
  ChannelAuthorizationRequestRow,
  ChannelCommandRunPermission,
  ChannelCommandRunSource,
  ChannelUserCredentialRow
} from '#~/db/index.js'

export type ChannelApprovalDecisionStatus =
  | 'allow'
  | 'ask_trigger_user'
  | 'ask_resource_owner'
  | 'ask_channel_admin'
  | 'deny'
  | 'degrade'

export interface ChannelApprovalCredentialRequirement {
  credentialKey: string
  requiredScopes?: readonly string[]
  subjectUserId?: string
}

export interface ChannelApprovalRequestInput {
  actorAccountId?: string
  actorUserId?: string
  capability: string
  channelAdmins?: readonly string[]
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType: string
  childRunId?: string
  conversationStateId?: string
  createAuthorizationRequest?: boolean
  credential?: ChannelApprovalCredentialRequirement
  defaultDecision?: {
    reasonCode: string
    status: Exclude<ChannelApprovalDecisionStatus, 'allow'>
  }
  entity?: string
  metadata?: Record<string, unknown>
  permission?: ChannelCommandRunPermission
  senderId?: string
  sessionId?: string
  sessionType?: string
  source?: ChannelCommandRunSource | 'system'
  threadKey?: string
}

export interface ChannelApprovalDecision {
  actorAccountId?: string
  actorUserId?: string
  authorizationRequest?: ChannelAuthorizationRequestRow
  capability: string
  credential?: ChannelUserCredentialRow
  credentialKey?: string
  credentialSubjectUserId?: string
  missingScopes?: string[]
  reasonCode: string
  status: ChannelApprovalDecisionStatus
}
