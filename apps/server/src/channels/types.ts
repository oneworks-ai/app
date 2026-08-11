import type { ConfigSource, WSEvent } from '@oneworks/core'
import type { ChannelBaseConfig, ChannelConnection } from '@oneworks/core/channel'

import type { ResolvedChannelLink } from '#~/services/channel-links/index.js'

import type { ChannelTextMessage } from './middleware/@types'

export interface ChannelRuntimeState {
  key: string
  type: string
  status: 'connected' | 'disabled' | 'error'
  connection?: ChannelConnection<ChannelTextMessage>
  config?: ChannelBaseConfig
  configSource?: ConfigSource
  channelLinks?: ResolvedChannelLink[]
  error?: string
  resolveRuntime?: (channelKey: string) => ChannelRuntimeState | undefined
}

export interface ChannelSessionBinding {
  channelType: string
  channelKey: string
  channelId: string
  threadId?: string
  sessionType: string
  senderId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
}

export interface ChannelManager {
  states: Map<string, ChannelRuntimeState>
  handleSessionEvent: (sessionId: string, event: WSEvent) => Promise<boolean>
  closeAll: () => Promise<void>
}
