import path from 'node:path'

import { convertClaudePluginToOneWorks } from '@oneworks/adapter-claude-code/plugins'
import type { AdapterPluginInstaller } from '@oneworks/types'

import { resolveCodexMarketplaceInstallSource } from './marketplace'
import { loadCodexMarketplaceCatalogFromSource } from './marketplace-catalog'
import type { CodexPluginManifest } from './source'
import { detectCodexPluginRoot, mergeCodexPluginManifest, parseCodexPluginManifest } from './source'

const convertCodexPluginToOneWorks: AdapterPluginInstaller<CodexPluginManifest>['convertToOneWorks'] = async (
  params
) => {
  const manifest = params.manifest == null
    ? undefined
    : {
      ...params.manifest,
      ...(params.manifest.hooks == null ? { hooks: './hooks.json' } : {}),
      ...(params.manifest.mcpServers == null ? { mcpServers: './.mcp.json' } : {})
    }
  await convertClaudePluginToOneWorks({ ...params, manifest })
}

export const codexPluginInstaller: AdapterPluginInstaller<CodexPluginManifest> = {
  adapter: 'codex',
  displayName: 'Codex',
  resolveSource: resolveCodexMarketplaceInstallSource,
  detectPluginRoot: detectCodexPluginRoot,
  readManifest: parseCodexPluginManifest,
  mergeManifest: mergeCodexPluginManifest,
  getPluginName: ({ pluginRoot, manifest }) => manifest?.name?.trim() || path.basename(pluginRoot),
  convertToOneWorks: convertCodexPluginToOneWorks,
  formatInstallSummary: params => [
    `Installed Codex plugin: ${params.pluginName}`,
    `  Native: ${params.nativePluginDir}`,
    `  OneWorks: ${params.oneworksPluginDir}`
  ]
}

export default codexPluginInstaller

export { loadCodexMarketplaceCatalogFromSource }
export { CODEX_BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
export { getEffectiveCodexMarketplace } from './marketplace'
export type { CodexMarketplaceCatalog, CodexMarketplacePluginDefinition } from './marketplace-catalog'
