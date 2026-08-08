import { basename, dirname } from 'node:path'

import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { ChannelLink, Definition } from '@oneworks/types'

import { getWorkspaceFolder } from '#~/services/config/index.js'

import { matchesChannelLinkBinding, matchesChannelLinkInbound } from './matching'

export { matchesChannelLinkBinding, matchesChannelLinkInbound } from './matching'

export interface ResolvedChannelLink {
  authorization?: ChannelLink['authorization']
  availability?: ChannelLink['availability']
  definition: Definition<ChannelLink>
  entity: string
  external: ChannelLink['external']
  ingress?: ChannelLink['ingress']
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
  authorization: definition.attributes.authorization,
  availability: definition.attributes.availability,
  definition,
  entity: definition.attributes.entity.trim(),
  external: definition.attributes.external,
  ingress: definition.attributes.ingress,
  name: resolveChannelLinkName(definition),
  path: definition.path,
  channelKey: definition.attributes.channel.trim()
})

export const loadChannelLinks = async (
  workspaceFolder = getWorkspaceFolder()
): Promise<ResolvedChannelLink[]> => {
  const loader = new DefinitionLoader(workspaceFolder)
  const definitions = await loader.loadDefaultChannelLinks()
  return definitions.map(toResolvedChannelLink)
}

export const resolveChannelLinkBinding = (
  links: readonly ResolvedChannelLink[],
  input: {
    channelId: string
    channelKey: string
    senderId?: string
    sessionType: string
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
