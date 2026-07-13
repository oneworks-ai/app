import path from 'node:path'

import type { AdapterPluginInstaller } from '@oneworks/types'

import { convertClaudePluginToOneWorks } from './convert'
import { resolveClaudeMarketplaceInstallSource } from './marketplace'
import type { ClaudePluginManifest } from './source'
import { detectClaudePluginRoot, mergeClaudePluginManifest, parseClaudePluginManifest } from './source'

const formatClaudeInstallSummary = (params: {
  pluginName: string
  nativePluginDir: string
  oneworksPluginDir: string
}) => [
  `Installed Claude plugin: ${params.pluginName}`,
  `  Native: ${params.nativePluginDir}`,
  `  OneWorks: ${params.oneworksPluginDir}`
]

const validateClaudeManifest = (params: {
  manifest: ClaudePluginManifest | undefined
}) => {
  if (params.manifest?.userConfig != null) {
    throw new Error(
      'Claude plugins that declare userConfig are not supported yet. Install requires marketplace-style plugin options, which One Works does not map yet.'
    )
  }
}

export const claudeCodePluginInstaller: AdapterPluginInstaller<ClaudePluginManifest> = {
  adapter: 'claude',
  displayName: 'Claude',
  resolveSource: resolveClaudeMarketplaceInstallSource,
  detectPluginRoot: detectClaudePluginRoot,
  readManifest: parseClaudePluginManifest,
  mergeManifest: mergeClaudePluginManifest,
  validateManifest: validateClaudeManifest,
  getPluginName: ({ pluginRoot, manifest }) => manifest?.name?.trim() || path.basename(pluginRoot),
  convertToOneWorks: convertClaudePluginToOneWorks,
  formatInstallSummary: formatClaudeInstallSummary
}

export default claudeCodePluginInstaller

export { CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
export { convertClaudePluginToOneWorks } from './convert'
export { loadMarketplaceCatalogFromSource } from './marketplace-catalog'
export type { ClaudeMarketplaceCatalog } from './marketplace-catalog'
export type { ClaudePluginManifest } from './source'
