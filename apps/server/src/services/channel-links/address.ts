import type { ChannelLink, Definition } from '@oneworks/types'

const externalIdsByKind = {
  direct: ['channelId', 'senderId', 'directId', 'userId', 'openId', 'accountId', 'id'],
  group: ['channelId', 'chatId', 'groupId', 'roomId', 'id'],
  thread: ['channelId', 'threadId', 'id']
} as const

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const normalizeExternalKind = (value: string): 'direct' | 'group' | 'thread' | undefined => {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'group' || normalized === 'room') return 'group'
  if (normalized === 'direct' || normalized === 'dm' || normalized === 'private' || normalized === 'user') {
    return 'direct'
  }
  return normalized === 'thread' ? 'thread' : undefined
}

export const compileChannelLinkAddress = (
  external: ChannelLink['external'],
  source = 'channel link'
) => {
  const kind = normalizeExternalKind(external.type)
  if (kind == null) {
    throw new Error(`${source} has unsupported external.type.`)
  }

  const ids = [
    ...new Set(
      externalIdsByKind[kind]
        .map(field => trimNonEmpty(external[field]))
        .filter((value): value is string => value != null)
    )
  ]
  if (ids.length !== 1) {
    throw new Error(`${source} must resolve to exactly one ${kind} external id.`)
  }
  return { id: ids[0]!, kind }
}

export const compileChannelLinkDefinitionAddress = (definition: Definition<ChannelLink>) =>
  compileChannelLinkAddress(definition.attributes.external, `Channel link ${definition.path}`)
