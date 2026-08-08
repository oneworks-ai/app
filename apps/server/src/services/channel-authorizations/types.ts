import type { WSEvent } from '@oneworks/core'

import type { ResolvedChannelLink } from '#~/services/channel-links/index.js'

export type InteractionRequestEvent = Extract<WSEvent, { type: 'interaction_request' }>

export interface ChannelAuthorizationBinding {
  channelId: string
  channelKey: string
  channelType: string
  senderId?: string
  sessionType: string
}

export interface EnsureChannelAuthorizationRequestInput {
  binding: ChannelAuthorizationBinding
  event: InteractionRequestEvent
  link?: ResolvedChannelLink
  sessionId: string
}
