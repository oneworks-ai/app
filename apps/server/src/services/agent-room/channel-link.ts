import type { AgentRoomChannelLink } from '@oneworks/core'

import { getChannelManager } from '#~/channels/index.js'

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const defaultReceiveIdType = (
  channelType: string,
  kind: AgentRoomChannelLink['conversationKind']
) => {
  if (channelType === 'lark') return kind === 'direct' ? 'open_id' : 'chat_id'
  if (channelType === 'wechat') return kind === 'direct' ? 'wxid' : 'chatroom'
  if (channelType === 'oneworks') return kind === 'direct' ? 'direct' : 'room'
  return undefined
}

export const resolveAgentRoomChannelLink = async (
  channelLinkName: string
): Promise<Omit<AgentRoomChannelLink, 'createdAt' | 'roomId'>> => {
  const manager = getChannelManager()
  if (manager == null) throw new Error('Channel runtime is not initialized.')
  const matches = [...manager.states.values()].flatMap(state =>
    (state.channelLinks ?? [])
      .filter(link => link.name === channelLinkName)
      .map(link => ({ link, state }))
  )
  if (matches.length === 0) throw new Error(`ChannelLink not found: ${channelLinkName}`)
  if (matches.length > 1) throw new Error(`ChannelLink name is ambiguous: ${channelLinkName}`)

  const { link, state } = matches[0]!
  if (link.address == null) throw new Error(`ChannelLink has no deliverable address: ${channelLinkName}`)
  const conversationKind = link.address.kind
  if (conversationKind === 'thread') {
    throw new Error(`Thread ChannelLink is not deliverable without its parent conversation: ${channelLinkName}`)
  }
  const receiveIdType = trimNonEmpty(link.external.receiveIdType) ??
    defaultReceiveIdType(state.type, conversationKind)
  if (receiveIdType == null) {
    throw new Error(`ChannelLink must declare external.receiveIdType: ${channelLinkName}`)
  }

  return {
    ...(trimNonEmpty(state.config?.title) == null ? {} : { accountLabel: trimNonEmpty(state.config?.title) }),
    channelId: link.address.id,
    channelKey: state.key,
    channelLinkName: link.name,
    channelType: state.type,
    conversationKind,
    entity: link.entity,
    label: link.name,
    receiveId: link.address.id,
    receiveIdType
  }
}
