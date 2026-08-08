import type { ChannelInboundEvent } from '@oneworks/core/channel'
import type { ChannelLink } from '@oneworks/types'

import type { ResolvedChannelLink } from './index'

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const toStringValues = (...values: unknown[]) => (
  values.map(trimNonEmpty).filter((value): value is string => value != null)
)

const normalizeExternalType = (value: string) => {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'group' || normalized === 'room') return 'group'
  if (normalized === 'direct' || normalized === 'dm' || normalized === 'private' || normalized === 'user') {
    return 'direct'
  }
  return normalized
}

const matchesGroupExternal = (external: ChannelLink['external'], inbound: ChannelInboundEvent) => {
  if (inbound.sessionType !== 'group') return false
  const ids = toStringValues(external.channelId, external.chatId, external.groupId, external.roomId, external.id)
  return ids.length > 0 && ids.includes(inbound.channelId)
}

const matchesDirectExternal = (external: ChannelLink['external'], inbound: ChannelInboundEvent) => {
  if (inbound.sessionType !== 'direct') return false
  const ids = toStringValues(
    external.channelId,
    external.senderId,
    external.directId,
    external.userId,
    external.openId,
    external.accountId,
    external.id
  )
  return ids.length > 0 && (ids.includes(inbound.senderId ?? '') || ids.includes(inbound.channelId))
}

const matchesThreadExternal = (external: ChannelLink['external'], inbound: ChannelInboundEvent) => {
  const ids = toStringValues(external.channelId, external.threadId, external.id)
  return ids.length > 0 && ids.includes(inbound.channelId)
}

const allExternalIds = (external: ChannelLink['external']) =>
  toStringValues(
    external.channelId,
    external.chatId,
    external.groupId,
    external.roomId,
    external.senderId,
    external.directId,
    external.threadId,
    external.userId,
    external.openId,
    external.accountId,
    external.id
  )

export const matchesChannelLinkInbound = (
  link: ResolvedChannelLink,
  input: { channelKey: string; inbound: ChannelInboundEvent }
) => {
  if (link.channelKey !== input.channelKey) return false
  const externalType = normalizeExternalType(link.external.type)
  if (externalType === 'group') return matchesGroupExternal(link.external, input.inbound)
  if (externalType === 'direct') return matchesDirectExternal(link.external, input.inbound)
  if (externalType === 'thread') return matchesThreadExternal(link.external, input.inbound)

  const ids = allExternalIds(link.external)
  return ids.includes(input.inbound.channelId) || ids.includes(input.inbound.senderId ?? '')
}

export const matchesChannelLinkBinding = (
  link: ResolvedChannelLink,
  input: { channelId: string; channelKey: string; senderId?: string; sessionType: string }
) => {
  if (link.channelKey !== input.channelKey) return false
  const externalType = normalizeExternalType(link.external.type)
  if (externalType === 'group') {
    if (input.sessionType !== 'group') return false
    const ids = toStringValues(
      link.external.channelId,
      link.external.chatId,
      link.external.groupId,
      link.external.roomId,
      link.external.id
    )
    return ids.length > 0 && ids.includes(input.channelId)
  }
  if (externalType === 'direct') {
    if (input.sessionType !== 'direct') return false
    const ids = toStringValues(
      link.external.channelId,
      link.external.senderId,
      link.external.directId,
      link.external.userId,
      link.external.openId,
      link.external.accountId,
      link.external.id
    )
    return ids.length > 0 && (ids.includes(input.senderId ?? '') || ids.includes(input.channelId))
  }
  if (externalType === 'thread') {
    const ids = toStringValues(link.external.channelId, link.external.threadId, link.external.id)
    return ids.length > 0 && ids.includes(input.channelId)
  }

  const ids = allExternalIds(link.external)
  return ids.includes(input.channelId) || ids.includes(input.senderId ?? '')
}
