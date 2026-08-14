import { basename, dirname } from 'node:path'

import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { resolveEntityIdentifier } from '@oneworks/definition-core'
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
  const entityReferences = new Map<string, string | null>()
  for (const entity of entities) {
    const canonicalEntity = entity.resolvedName?.trim() ||
      resolveEntityIdentifier(entity.path, entity.attributes.name)
    const references = [
      entity.resolvedName,
      trimNonEmpty(entity.attributes.name),
      basename(dirname(entity.path))
    ].filter((value): value is string => value != null)
    for (const reference of references) {
      if (entityReferences.has(reference) && entityReferences.get(reference) !== canonicalEntity) {
        entityReferences.set(reference, null)
      } else {
        entityReferences.set(reference, canonicalEntity)
      }
    }
  }
  const links = definitions.map(toResolvedChannelLink)
  const normalizedLinks = links.map(link => {
    const canonicalEntity = entityReferences.get(link.entity)
    if (canonicalEntity === undefined) {
      throw new Error(`Channel link ${link.path} references missing entity ${link.entity}.`)
    }
    if (canonicalEntity === null) {
      throw new Error(`Channel link ${link.path} references ambiguous entity ${link.entity}.`)
    }
    return { ...link, entity: canonicalEntity }
  })
  const bindingKeys = new Map<string, ResolvedChannelLink>()
  const linksByChannelKey = new Map<string, ResolvedChannelLink>()
  for (const link of normalizedLinks) {
    const existingChannelLink = linksByChannelKey.get(link.channelKey)
    if (existingChannelLink != null && existingChannelLink.entity !== link.entity) {
      throw new Error(
        `Channel links ${existingChannelLink.path} and ${link.path} reuse channel key ` +
          `${link.channelKey} across entities ${existingChannelLink.entity} and ${link.entity}.`
      )
    }
    linksByChannelKey.set(link.channelKey, link)
    const bindingKey = `${link.channelKey}\0${link.address!.kind}\0${link.address!.id}`
    const existing = bindingKeys.get(bindingKey)
    if (existing != null) {
      throw new Error(`Channel links ${existing.path} and ${link.path} bind the same external address.`)
    }
    bindingKeys.set(bindingKey, link)
  }
  return normalizedLinks
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
