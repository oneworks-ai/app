import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { compileChannelLinkAddress } from './address'
import type { ResolvedChannelLink } from './index'

const resolveAddress = (link: ResolvedChannelLink) => {
  try {
    return link.address ?? compileChannelLinkAddress(link.external, `Channel link ${link.path}`)
  } catch {
    return undefined
  }
}

export const matchesChannelLinkInbound = (
  link: ResolvedChannelLink,
  input: { channelKey: string; inbound: ChannelInboundEvent }
) => {
  if (link.channelKey !== input.channelKey) return false
  const address = resolveAddress(link)
  if (address == null || (address.kind !== 'thread' && address.kind !== input.inbound.sessionType)) return false
  if (address.kind === 'thread') return address.id === input.inbound.threadId
  return address.id === input.inbound.channelId ||
    (address.kind === 'direct' && address.id === input.inbound.senderId)
}

export const matchesChannelLinkBinding = (
  link: ResolvedChannelLink,
  input: { channelId: string; channelKey: string; senderId?: string; sessionType: string; threadId?: string }
) => {
  if (link.channelKey !== input.channelKey) return false
  const address = resolveAddress(link)
  if (address == null || (address.kind !== 'thread' && address.kind !== input.sessionType)) return false
  if (address.kind === 'thread') return address.id === input.threadId
  return address.id === input.channelId ||
    (address.kind === 'direct' && address.id === input.senderId)
}
