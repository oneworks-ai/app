import { basename, dirname } from 'node:path'

import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { ChannelLink, ChannelLinkIngress, ChannelLinkRouting, Definition } from '@oneworks/types'

import { getWorkspaceFolder } from '#~/services/config/index.js'

import { compileChannelLinkDefinitionAddress } from './address'
import { matchesChannelLinkBinding, matchesChannelLinkInbound } from './matching'

export { matchesChannelLinkBinding, matchesChannelLinkInbound } from './matching'

export interface ResolvedChannelLink {
  address?: {
    id: string
    kind: 'direct' | 'group' | 'thread'
  }
  authorization?: ChannelLink['authorization']
  availability?: ChannelLink['availability']
  moderation?: ChannelLink['moderation']
  definition: Definition<ChannelLink>
  entity: string
  external: ChannelLink['external']
  ingress:
    & Required<
      Pick<
        ChannelLinkIngress,
        'ambientRouting' | 'createOnMention' | 'createOnCommand' | 'createOnReplyToBot' | 'createOnPendingIntent'
      >
    >
    & ChannelLinkIngress
  name: string
  path: string
  channelKey: string
  routing: Required<Pick<ChannelLinkRouting, 'default' | 'modes' | 'users' | 'accounts'>>
}

export interface ChannelLinkMatchResult {
  duplicates: ResolvedChannelLink[]
  link: ResolvedChannelLink
}

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const resolveChannelLinkName = (definition: Definition<ChannelLink>) => (
  definition.resolvedName ??
    trimNonEmpty(definition.attributes.name) ??
    basename(dirname(definition.path))
)

const toResolvedChannelLink = (definition: Definition<ChannelLink>): ResolvedChannelLink => ({
  address: compileChannelLinkDefinitionAddress(definition),
  authorization: definition.attributes.authorization,
  availability: definition.attributes.availability,
  moderation: definition.attributes.moderation,
  definition,
  entity: definition.attributes.entity.trim(),
  external: definition.attributes.external,
  ingress: {
    ambientRouting: definition.attributes.ingress?.ambientRouting ?? false,
    createOnMention: definition.attributes.ingress?.createOnMention ?? true,
    createOnCommand: definition.attributes.ingress?.createOnCommand ?? true,
    createOnReplyToBot: definition.attributes.ingress?.createOnReplyToBot ?? true,
    createOnPendingIntent: definition.attributes.ingress?.createOnPendingIntent ?? true,
    ...definition.attributes.ingress
  },
  name: resolveChannelLinkName(definition),
  path: definition.path,
  channelKey: definition.attributes.channel.trim(),
  routing: {
    default: definition.attributes.routing?.default ?? {},
    modes: definition.attributes.routing?.modes ?? {},
    users: definition.attributes.routing?.users ?? {},
    accounts: definition.attributes.routing?.accounts ?? {}
  }
})

export const loadChannelLinks = async (
  workspaceFolder = getWorkspaceFolder()
): Promise<ResolvedChannelLink[]> => {
  const loader = new DefinitionLoader(workspaceFolder)
  const [definitions, entities] = await Promise.all([
    loader.loadDefaultChannelLinks(),
    loader.loadDefaultEntities()
  ])
  const entityNames = new Set(entities.flatMap(entity =>
    [
      entity.resolvedName,
      trimNonEmpty(entity.attributes.name),
      basename(dirname(entity.path))
    ].filter((value): value is string => value != null)
  ))
  const links = definitions.map(toResolvedChannelLink)
  for (const link of links) {
    if (!entityNames.has(link.entity)) {
      throw new Error(`Channel link ${link.path} references missing entity ${link.entity}.`)
    }
  }
  return links
}

export const resolveChannelLinkBinding = (
  links: readonly ResolvedChannelLink[],
  input: {
    channelId: string
    channelKey: string
    senderId?: string
    sessionType: string
    threadId?: string
  }
): ChannelLinkMatchResult | undefined => {
  const matches = links.filter(link => matchesChannelLinkBinding(link, input))
  const [link, ...duplicates] = matches
  return link == null ? undefined : { link, duplicates }
}

export const resolveInboundChannelLink = (
  links: readonly ResolvedChannelLink[],
  input: {
    channelKey: string
    inbound: ChannelInboundEvent
  }
): ChannelLinkMatchResult | undefined => {
  const matches = links.filter(link => matchesChannelLinkInbound(link, input))
  const [link, ...duplicates] = matches
  return link == null ? undefined : { link, duplicates }
}
