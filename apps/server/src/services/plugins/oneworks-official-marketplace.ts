import type {
  OneWorksMarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource
} from '@oneworks/types'

import serverPackageJson from '../../../package.json'

import { toCatalogPlugin } from './marketplace-catalog-view'

export const ONEWORKS_OFFICIAL_MARKETPLACE_KEY = 'oneworks-official'

export const ONEWORKS_OFFICIAL_MARKETPLACE_ENTRY: OneWorksMarketplaceConfigEntry = {
  type: 'oneworks',
  options: { version: serverPackageJson.version }
}

export interface OneWorksOfficialPluginDefinition {
  description?: string
  displayName: string
  featured?: boolean
  name: string
  searchKeywords?: string[]
}

export const ONEWORKS_OFFICIAL_PLUGINS: OneWorksOfficialPluginDefinition[] = [
  {
    displayName: 'Browser Driver',
    name: '@oneworks/plugin-browser-driver'
  },
  {
    description: 'An optional China Edition theme pack for One Works.',
    displayName: 'China Edition Theme',
    name: '@oneworks/plugin-china-red-theme',
    searchKeywords: ['中国方案主题']
  },
  {
    displayName: 'Chrome DevTools',
    name: '@oneworks/plugin-chrome-devtools'
  },
  {
    displayName: 'Chrome Driver',
    name: '@oneworks/plugin-chrome-driver'
  },
  {
    displayName: 'CLI Skills',
    name: '@oneworks/plugin-cli-skills'
  },
  {
    displayName: 'CUA Driver',
    name: '@oneworks/plugin-cua-driver'
  },
  {
    description: 'A compact reference plugin for One Works routes, commands, panels, and configuration.',
    displayName: 'Plugin Demo',
    name: '@oneworks/plugin-demo'
  },
  {
    description: 'An extension companion that contributes actions and commands to Plugin Demo.',
    displayName: 'Plugin Demo Extension',
    name: '@oneworks/plugin-demo-extension'
  },
  {
    description: 'An optional restrained, low-noise workbench theme for One Works.',
    displayName: 'Codex Theme',
    name: '@oneworks/plugin-focus-workbench-theme'
  },
  {
    description: 'Structured runtime logging and diagnostics for One Works plugins.',
    displayName: 'Logger',
    name: '@oneworks/plugin-logger'
  },
  {
    description: 'An optional neo-brutalist theme pack for One Works.',
    displayName: 'Neo Workshop Theme',
    name: '@oneworks/plugin-neo-workshop-theme'
  },
  {
    description: 'Connects the current workspace to One Works Relay for account and remote client access.',
    displayName: 'Relay',
    featured: true,
    name: '@oneworks/plugin-relay'
  },
  {
    displayName: 'Standard Development',
    featured: true,
    name: '@oneworks/plugin-standard-dev'
  },
  {
    description: 'An optional warm, card-oriented collaboration theme for One Works.',
    displayName: 'Cowork Theme',
    name: '@oneworks/plugin-warm-cowork-theme'
  }
]

const officialPluginNames = new Set(ONEWORKS_OFFICIAL_PLUGINS.map(plugin => plugin.name))

export const isOneWorksOfficialPlugin = (marketplace: string, plugin: string) => (
  marketplace === ONEWORKS_OFFICIAL_MARKETPLACE_KEY && officialPluginNames.has(plugin)
)

export const loadOneWorksOfficialMarketplaceCatalog = (params: {
  builtIn: boolean
  configSource?: PluginMarketplaceConfigSource
  installedSources: (plugin: string) => PluginMarketplaceCatalogPlugin['installedSources']
  key: string
  marketplace: OneWorksMarketplaceConfigEntry
}): { plugins: PluginMarketplaceCatalogPlugin[]; source: PluginMarketplaceCatalogSource } => {
  if (params.key !== ONEWORKS_OFFICIAL_MARKETPLACE_KEY) {
    return {
      plugins: [],
      source: {
        builtIn: params.builtIn,
        entry: params.marketplace,
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: 0,
        error: `Unsupported One Works marketplace ${params.key}.`,
        ...(params.configSource != null ? { configSource: params.configSource } : {})
      }
    }
  }

  const version = params.marketplace.options?.version ?? serverPackageJson.version
  const plugins = ONEWORKS_OFFICIAL_PLUGINS.map(plugin =>
    toCatalogPlugin({
      builtIn: params.builtIn,
      source: { label: `${plugin.name}@${version}`, type: 'npm' },
      configSource: params.configSource,
      marketplace: params.marketplace,
      marketplaceKey: params.key,
      marketplaceTitle: 'One Works',
      installedSources: params.installedSources(plugin.name),
      version,
      plugin
    })
  )
  return {
    plugins,
    source: {
      builtIn: params.builtIn,
      entry: params.marketplace,
      key: params.key,
      type: params.marketplace.type,
      enabled: params.marketplace.enabled !== false,
      pluginCount: plugins.length,
      title: 'One Works',
      ...(params.configSource != null ? { configSource: params.configSource } : {})
    }
  }
}
