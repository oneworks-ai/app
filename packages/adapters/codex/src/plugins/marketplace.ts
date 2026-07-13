import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import type { AdapterPluginResolveSourceContext, Config, ResolvedAdapterPluginSource } from '@oneworks/types'
import { mergeMarketplaceConfigs } from '@oneworks/utils'

import { CODEX_BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
import { loadCodexMarketplaceCatalogFromSource, resolveCodexMarketplacePluginPath } from './marketplace-catalog'
import type { CodexPluginManifest } from './source'

const EXPLICIT_NON_MARKETPLACE_PREFIXES = [
  'npm:',
  'github:',
  'git+',
  'http://',
  'https://',
  'ssh://',
  'git@',
  './',
  '../',
  '/'
] as const

const parseMarketplaceInstallReference = (value: string) => {
  if (
    value.startsWith('@') ||
    EXPLICIT_NON_MARKETPLACE_PREFIXES.some(prefix => value.startsWith(prefix)) ||
    /^[a-z]:[\\/]/i.test(value)
  ) return undefined

  const separatorIndex = value.lastIndexOf('@')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return undefined
  const plugin = value.slice(0, separatorIndex).trim()
  const marketplace = value.slice(separatorIndex + 1).trim()
  return plugin === '' || marketplace === '' ? undefined : { plugin, marketplace }
}

const getConfiguredCodexMarketplace = (config: Config | undefined, marketplaceName: string) => {
  const marketplace = config?.marketplaces?.[marketplaceName]
  return marketplace?.type === 'codex' ? marketplace : undefined
}

export const getEffectiveCodexMarketplace = (config: Config | undefined, marketplaceName: string) => {
  const effectiveMarketplaces = mergeMarketplaceConfigs(
    CODEX_BUILT_IN_PLUGIN_MARKETPLACES,
    config?.marketplaces
  )
  return getConfiguredCodexMarketplace(
    effectiveMarketplaces == null ? undefined : { marketplaces: effectiveMarketplaces },
    marketplaceName
  )
}

export const resolveCodexMarketplaceInstallSource = async (
  params: AdapterPluginResolveSourceContext
): Promise<ResolvedAdapterPluginSource<CodexPluginManifest> | undefined> => {
  const reference = parseMarketplaceInstallReference(params.requestedSource)
  if (reference == null) return undefined

  const { mergedConfig } = await loadConfigState({
    cwd: params.cwd,
    jsonVariables: buildConfigJsonVariables(params.cwd)
  })
  const configuredMarketplace = getEffectiveCodexMarketplace(mergedConfig, reference.marketplace)
  if (configuredMarketplace == null) {
    throw new Error(`No Codex marketplace named "${reference.marketplace}" is configured.`)
  }
  if (configuredMarketplace.enabled === false) {
    throw new Error(`Codex marketplace ${reference.marketplace} is disabled in config.`)
  }
  if (configuredMarketplace.options?.source == null) {
    throw new Error(`Codex marketplace ${reference.marketplace} is missing options.source in config.`)
  }

  const { catalog, rootDir } = await loadCodexMarketplaceCatalogFromSource(
    params.tempDir,
    configuredMarketplace.options.source,
    reference.marketplace,
    params.installSource,
    { cwd: params.cwd, env: params.env }
  )
  const plugin = catalog.plugins.find(entry => entry.name === reference.plugin)
  if (plugin == null) {
    throw new Error(`Codex marketplace plugin ${reference.plugin}@${reference.marketplace} was not found.`)
  }

  return {
    installSource: {
      type: 'path',
      path: await resolveCodexMarketplacePluginPath(
        rootDir,
        plugin,
        reference.marketplace,
        { cwd: params.cwd, env: params.env }
      )
    },
    managedSource: {
      type: 'marketplace',
      marketplace: reference.marketplace,
      plugin: reference.plugin
    },
    manifestOverrides: {
      name: plugin.name,
      ...(plugin.description != null ? { description: plugin.description } : {}),
      ...(plugin.displayName != null ? { displayName: plugin.displayName } : {}),
      ...(plugin.version != null ? { version: plugin.version } : {})
    }
  }
}
