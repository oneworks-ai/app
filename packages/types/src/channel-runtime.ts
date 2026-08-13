export type ChannelConversationKind = 'direct' | 'group' | 'room' | 'thread' | 'unknown'

export interface ChannelConversationReference {
  id: string
  kind: ChannelConversationKind
  label?: string
  threadId?: string
}

export interface ChannelMessageReference {
  id?: string
  replyToId?: string
  rootId?: string
}

export interface ChannelNavigationReference {
  appHomeUrl?: string
  conversationWebUrl?: string
  embeddable?: boolean
  messageWebUrl?: string
  nativeAppUrl?: string
}

export interface ChannelDeliveryTarget {
  accountLabel?: string
  channelId: string
  channelKey: string
  channelLinkName?: string
  channelType: string
  conversationKind: ChannelConversationKind
  label: string
  receiveId: string
  receiveIdType: string
  threadId?: string
}

export interface ChannelExecutionContext {
  actor?: {
    canonicalUserId?: string
    displayName?: string
    externalAccountId?: string
  }
  availableDeliveryTargets: ChannelDeliveryTarget[]
  defaultReplyTarget?: ChannelDeliveryTarget
  entity: {
    id: string
    label: string
  }
  room?: {
    id: string
    memberKey?: string
    ownerNodeId?: string
    title: string
  }
  source: {
    accountLabel?: string
    channelKey: string
    channelLinkName?: string
    channelType: string
    conversation: ChannelConversationReference
    message: ChannelMessageReference
    tenantLabel?: string
  }
}

export type ChannelNavigationMode = 'appHome' | 'ask' | 'externalWeb' | 'nativeApp' | 'rightPanel'

export interface ChannelNavigationPreferences {
  accounts?: Record<string, ChannelNavigationMode[]>
  default: ChannelNavigationMode[]
  providers?: Record<string, ChannelNavigationMode[]>
}

export interface ChannelCommandEffect {
  actor?: string
  destinations?: string[]
  effect: 'external-read' | 'external-write' | 'local-read' | 'local-write'
  entity?: string
  operation: string
}
