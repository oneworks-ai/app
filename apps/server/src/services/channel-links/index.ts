import { basename, dirname } from 'node:path'

import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { ChannelLink, Definition } from '@oneworks/types'

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
  definition: Definition<ChannelLink>
  entity: string
  external: ChannelLink['external']
  ingress?: ChannelLink['ingress']
  moderation?: ChannelLink['moderation']
  name: string
  path: string
  channelKey: string
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
  definition,
  entity: definition.attributes.entity.trim(),
  external: definition.attributes.external,
  ingress: definition.attributes.ingress,
  moderation: definition.attributes.moderation,
  name: resolveChannelLinkName(definition),
  path: definition.path,
  channelKey: definition.attributes.channel.trim()
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
  const bindingKeys = new Map<string, ResolvedChannelLink>()
  const linksByChannelKey = new Map<string, ResolvedChannelLink>()
  for (const link of links) {
    if (!entityNames.has(link.entity)) {
      throw new Error(`Channel link ${link.path} references missing entity ${link.entity}.`)
    }
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
