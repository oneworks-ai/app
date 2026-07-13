import path from 'node:path'

import type { CodexMarketplaceSource } from '@oneworks/types'
import { resolveOptionalPath, resolveRealUserHome } from '@oneworks/utils'

import { listCodexPlugins } from '../native-plugins/cli.js'
import {
  installCodexAppServerPlugin,
  listCodexAppServerPlugins,
  resolveCodexPluginBinaryPath
} from './app-server-marketplace'
import type { CodexAppServerPluginSummary } from './app-server-marketplace'
import type {
  CodexMarketplaceCatalog,
  CodexMarketplacePluginDefinition,
  CodexMarketplaceRuntime
} from './marketplace-types'

type AppServerMarketplaceSource = Extract<CodexMarketplaceSource, { source: 'app-server' }>

export const toCodexAppServerCatalogPlugin = (
  plugin: CodexAppServerPluginSummary,
  marketplace: string,
  featuredPluginIds: ReadonlySet<string>
): CodexMarketplacePluginDefinition => {
  const pluginInterface = plugin.interface
  const remoteIcon = pluginInterface?.logoUrl ?? pluginInterface?.composerIconUrl
  return {
    name: plugin.name,
    source: {
      source: 'app-server',
      marketplace,
      pluginId: plugin.id
    },
    ...(pluginInterface?.longDescription ?? pluginInterface?.shortDescription) != null
      ? { description: pluginInterface?.longDescription ?? pluginInterface?.shortDescription }
      : {},
    ...(pluginInterface?.displayName != null ? { displayName: pluginInterface.displayName } : {}),
    ...(remoteIcon != null ? { icon: { kind: 'url', url: remoteIcon } } : {}),
    nativeEnabled: plugin.enabled,
    nativeInstalled: plugin.installed,
    ...(plugin.remoteVersion ?? plugin.localVersion) != null
      ? { version: plugin.remoteVersion ?? plugin.localVersion }
      : {},
    ...(featuredPluginIds.has(plugin.id) ? { featured: true } : {}),
    ...(
      plugin.installPolicy === 'NOT_AVAILABLE' ||
        plugin.availability === 'NOT_AVAILABLE' ||
        plugin.availability === 'DISABLED_BY_ADMIN'
        ? { installable: false }
        : {}
    )
  }
}

export const loadCodexAppServerMarketplaceCatalog = async (
  source: AppServerMarketplaceSource,
  runtime: CodexMarketplaceRuntime
): Promise<CodexMarketplaceCatalog> => {
  const includeRemoteCatalog = source.includeRemoteCatalog === true
  const [response, defaultResponse] = await Promise.all([
    listCodexAppServerPlugins({ ...runtime, includeRemoteCatalog }),
    includeRemoteCatalog
      ? listCodexAppServerPlugins({ ...runtime, includeRemoteCatalog: false })
      : Promise.resolve(undefined)
  ])
  const marketplace = response.marketplaces.find(entry => entry.name === source.marketplace)
  if (marketplace == null) {
    throw new Error(`Codex app-server marketplace ${source.marketplace} was not found.`)
  }
  const featuredPluginIds = new Set([
    ...response.featuredPluginIds,
    ...(defaultResponse?.featuredPluginIds ?? [])
  ])

  return {
    name: marketplace.name,
    title: marketplace.title,
    plugins: marketplace.plugins.map(plugin =>
      toCodexAppServerCatalogPlugin(plugin, marketplace.name, featuredPluginIds)
    )
  }
}

export const resolveCodexAppServerMarketplacePluginPath = async (
  plugin: CodexMarketplacePluginDefinition,
  marketplaceName: string,
  runtime: CodexMarketplaceRuntime,
  resolveWithinRoot: (rootDir: string, candidatePath: string, description: string) => Promise<string>
) => {
  if (plugin.source.source !== 'app-server') {
    throw new TypeError('Expected an app-server-backed Codex marketplace plugin.')
  }
  const appServerSource = plugin.source
  const installed = await installCodexAppServerPlugin({
    ...runtime,
    includeRemoteCatalog: true,
    marketplace: appServerSource.marketplace,
    pluginName: plugin.name
  })
  const installedPath = installed.source.type === 'local' && installed.source.path != null
    ? installed.source.path
    : (await listCodexPlugins(
      runtime.cwd,
      runtime.env,
      resolveCodexPluginBinaryPath(runtime.env, runtime.cwd)
    )).find(candidate => (
      candidate.installed &&
      candidate.name === plugin.name &&
      candidate.marketplaceName === appServerSource.marketplace
    ))?.sourcePath
  if (installedPath == null) {
    throw new Error(
      `Codex app-server installed ${plugin.name}@${marketplaceName}, but did not expose a safe local package path.`
    )
  }
  const realHome = resolveRealUserHome(runtime.env)
  const codexHome = resolveOptionalPath(runtime.env.CODEX_HOME) ?? path.resolve(realHome, '.codex')
  return resolveWithinRoot(
    codexHome,
    installedPath,
    `Installed Codex plugin ${plugin.name}@${marketplaceName}`
  )
}
