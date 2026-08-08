import { basename, dirname } from 'node:path'

import type { ChannelLink, Definition, DefinitionSource } from '@oneworks/types'
import { resolveWorkspaceAssetSource } from '@oneworks/workspace-assets'

export interface WorkspaceDefinitionAsset<TDefinition extends { name?: string }> {
  payload: {
    definition: Definition<TDefinition>
  }
  displayName: string
  instancePath?: string
  origin: 'workspace' | 'plugin'
  resolvedBy?: string
}

const resolveDefinitionSource = (
  asset: Pick<WorkspaceDefinitionAsset<{ name?: string }>, 'origin' | 'resolvedBy'>
): DefinitionSource => resolveWorkspaceAssetSource(asset)

export const toResolvedDefinitions = <TDefinition extends { name?: string }>(
  assets: WorkspaceDefinitionAsset<TDefinition>[]
): Definition<TDefinition>[] => (
  assets.map(asset => ({
    ...asset.payload.definition,
    resolvedName: asset.displayName,
    resolvedInstancePath: asset.instancePath,
    resolvedSource: resolveDefinitionSource(asset)
  }))
)

export const resolveChannelLinkIdentifier = (definition: Definition<ChannelLink>) => (
  definition.attributes.name?.trim() ||
  definition.resolvedName ||
  basename(dirname(definition.path))
)
